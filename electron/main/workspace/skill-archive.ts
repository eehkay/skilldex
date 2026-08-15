/**
 * Zip import for skills — turn an uploaded archive into a skill folder.
 *
 * A hand-rolled reader on `node:zlib` (matching the repo's no-extra-deps
 * ethos): skill archives are small, and the subset that matters — stored or
 * deflated entries, no zip64, no encryption — is a few dozen lines. Entries
 * are enumerated from the central directory, so archives written with data
 * descriptors (streaming zippers) still report correct sizes.
 *
 * The archive may hold the skill at its root (`SKILL.md` top-level) or in a
 * single folder (`my-skill/SKILL.md`, the shape you get from zipping a
 * directory). Everything outside the folder that holds the shallowest
 * `SKILL.md` is ignored; junk like `__MACOSX/` and `.DS_Store` never lands.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import zlib from 'node:zlib'
import { parseFrontmatter } from './frontmatter'
import { slugify } from './skill-manager'

export type ArchiveEntry = { path: string; data: Buffer }

const SIG_EOCD = 0x06054b50
const SIG_CENTRAL = 0x02014b50
const SIG_LOCAL = 0x04034b50
const METHOD_STORED = 0
const METHOD_DEFLATE = 8

/** Cap on the total unpacked size so a zip bomb can't fill the disk. */
export const MAX_UNPACKED_BYTES = 64 * 1024 * 1024
/** Cap on the archive itself (checked before decoding). */
export const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024

/** List the files in a zip archive (directories omitted, paths as written). */
export function readZip(bytes: Buffer): ArchiveEntry[] {
  const eocd = findEndOfCentralDirectory(bytes)
  const count = bytes.readUInt16LE(eocd + 10)
  const cdOffset = bytes.readUInt32LE(eocd + 16)
  if (count === 0xffff || cdOffset === 0xffffffff) throw new Error('Zip64 archives are not supported.')

  const entries: ArchiveEntry[] = []
  let unpacked = 0
  let cursor = cdOffset
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > bytes.length || bytes.readUInt32LE(cursor) !== SIG_CENTRAL)
      throw new Error('Corrupt zip: bad central directory.')
    const flags = bytes.readUInt16LE(cursor + 8)
    const method = bytes.readUInt16LE(cursor + 10)
    const compressedSize = bytes.readUInt32LE(cursor + 20)
    const uncompressedSize = bytes.readUInt32LE(cursor + 24)
    const nameLength = bytes.readUInt16LE(cursor + 28)
    const extraLength = bytes.readUInt16LE(cursor + 30)
    const commentLength = bytes.readUInt16LE(cursor + 32)
    const localOffset = bytes.readUInt32LE(cursor + 42)
    const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8')
    cursor += 46 + nameLength + extraLength + commentLength

    if (name.endsWith('/')) continue // directory entry
    if (flags & 0x1) throw new Error(`Encrypted zip entries are not supported (${name}).`)
    if (method !== METHOD_STORED && method !== METHOD_DEFLATE)
      throw new Error(`Unsupported compression method ${method} (${name}).`)

    unpacked += uncompressedSize
    if (unpacked > MAX_UNPACKED_BYTES) throw new Error('Archive unpacks to more than 64 MB.')

    if (localOffset + 30 > bytes.length || bytes.readUInt32LE(localOffset) !== SIG_LOCAL)
      throw new Error(`Corrupt zip: bad local header for ${name}.`)
    const localNameLength = bytes.readUInt16LE(localOffset + 26)
    const localExtraLength = bytes.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    const raw = bytes.subarray(dataStart, dataStart + compressedSize)
    if (raw.length !== compressedSize) throw new Error(`Corrupt zip: truncated data for ${name}.`)

    const data =
      method === METHOD_STORED
        ? Buffer.from(raw)
        : zlib.inflateRawSync(raw, { maxOutputLength: uncompressedSize || undefined })
    if (data.length !== uncompressedSize) throw new Error(`Corrupt zip: size mismatch for ${name}.`)
    entries.push({ path: name, data })
  }
  return entries
}

function findEndOfCentralDirectory(bytes: Buffer): number {
  // The EOCD is the last record; scan back over an optional comment (≤ 64 KB).
  const floor = Math.max(0, bytes.length - 22 - 0xffff)
  for (let i = bytes.length - 22; i >= floor; i--) {
    if (bytes.readUInt32LE(i) === SIG_EOCD) return i
  }
  throw new Error('Not a zip archive.')
}

const JUNK = /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db)(\/|$)/

/** Normalise an archive path and refuse anything that could escape the target. */
function safeRelativePath(entryPath: string): string | null {
  const normalised = entryPath.replace(/\\/g, '/').replace(/^\.\/+/, '')
  if (JUNK.test(normalised)) return null
  if (normalised === '' || normalised.startsWith('/') || /^[A-Za-z]:/.test(normalised)) {
    throw new Error(`Unsafe path in archive: ${entryPath}`)
  }
  const segments = normalised.split('/')
  if (segments.some((segment) => segment === '' || segment === '..' || segment === '.')) {
    throw new Error(`Unsafe path in archive: ${entryPath}`)
  }
  return normalised
}

export type SkillArchive = {
  /** Folder name the skill will be written under. */
  dirName: string
  /** Files relative to the skill folder, `SKILL.md` among them. */
  files: Array<{ path: string; data: Buffer }>
}

/**
 * Work out which files in the archive make up the skill and what to call its
 * folder. `fallbackName` (typically the zip's own filename) names a root-level
 * skill whose SKILL.md lacks a `name`.
 */
export function planSkillArchive(entries: ArchiveEntry[], fallbackName: string): SkillArchive {
  const files = entries
    .map((entry) => ({ path: safeRelativePath(entry.path), data: entry.data }))
    .filter((entry): entry is { path: string; data: Buffer } => entry.path !== null)

  const manifests = files.filter((entry) => path.posix.basename(entry.path) === 'SKILL.md')
  if (manifests.length === 0) throw new Error('No SKILL.md found in the archive.')

  const depth = (entry: { path: string }) => entry.path.split('/').length
  const shallowest = Math.min(...manifests.map(depth))
  const roots = manifests.filter((entry) => depth(entry) === shallowest)
  if (roots.length > 1) {
    const names = roots.map((entry) => path.posix.dirname(entry.path)).join(', ')
    throw new Error(`Archive contains several skills (${names}); zip one skill at a time.`)
  }

  const manifest = roots[0]
  const prefix = path.posix.dirname(manifest.path) // '.' when SKILL.md is at the root
  const scoped =
    prefix === '.'
      ? files
      : files
          .filter((entry) => entry.path.startsWith(`${prefix}/`))
          .map((entry) => ({ ...entry, path: entry.path.slice(prefix.length + 1) }))

  const frontmatter = parseFrontmatter(manifest.data.toString('utf8'))
  const folderName = prefix === '.' ? '' : path.posix.basename(prefix)
  const dirName =
    folderName && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(folderName)
      ? folderName
      : slugify(frontmatter.name?.trim() || folderName || fallbackName)

  return { dirName, files: scoped }
}

/**
 * Write a planned skill under `root/<dirName>`. Extracts into a temp folder
 * beside the root and renames into place, so a half-written skill never shows
 * up in a scan. Fails if the skill already exists (enabled or disabled).
 */
export async function writeSkillArchive(root: string, plan: SkillArchive): Promise<string> {
  const dest = path.join(root, plan.dirName)
  const disabled = path.join(root, '.disabled', plan.dirName)
  for (const existing of [dest, disabled]) {
    if (await fs.access(existing).then(() => true).catch(() => false))
      throw new Error(`A skill named "${plan.dirName}" already exists.`)
  }

  await fs.mkdir(root, { recursive: true })
  // Stage beside the root, not inside it: the scanner doesn't skip dot-dirs,
  // and a sibling stays on the same filesystem so the final rename is atomic.
  const staging = await fs.mkdtemp(path.join(path.dirname(root), `.skilldex-import-`))
  try {
    for (const file of plan.files) {
      const target = path.join(staging, file.path)
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.writeFile(target, file.data)
    }
    await fs.rename(staging, dest)
  } catch (cause) {
    await fs.rm(staging, { recursive: true, force: true })
    throw cause
  }
  return dest
}
