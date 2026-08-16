import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import zlib from 'node:zlib'
import { planSkillArchive, readZip, removeSkillForReplace, writeSkillArchive } from '../skill-archive'
import { makeZip } from './zip-fixture'

const SKILL_MD = '---\nname: pdf-filler\ndescription: Fills PDFs\n---\n\n# PDF Filler\n'

describe('readZip', () => {
  it('reads stored and deflated entries and skips directory entries', () => {
    const zip = makeZip({ 'a/': '', 'a/one.txt': 'hello', 'a/two.bin': Buffer.from([0, 1, 2, 3]) })
    const entries = readZip(zip)
    expect(entries.map((entry) => entry.path)).toEqual(['a/one.txt', 'a/two.bin'])
    expect(entries[0].data.toString()).toBe('hello')
    expect([...entries[1].data]).toEqual([0, 1, 2, 3])

    const stored = readZip(makeZip({ 'x.txt': 'stored' }, { deflate: false }))
    expect(stored[0].data.toString()).toBe('stored')
  })

  it('rejects non-zip input', () => {
    expect(() => readZip(Buffer.from('definitely not a zip'))).toThrow('Not a zip archive')
  })

  it('bounds inflation even when the declared uncompressed size lies', () => {
    // A highly compressible 8 MB payload whose central directory claims 0 bytes:
    // the cap must still apply and the lie must be rejected, not inflated blind.
    const payload = Buffer.alloc(8 * 1024 * 1024, 0x61)
    const zip = makeZip({ 'big.bin': payload })
    // Patch the central-directory uncompressed size (offset 24 in the CD header) to 0.
    const eocd = zip.length - 22
    const cdOffset = zip.readUInt32LE(eocd + 16)
    zip.writeUInt32LE(0, cdOffset + 24)
    expect(() => readZip(zip)).toThrow(/inflates past its declared size|size mismatch/)
  })
})

describe('planSkillArchive', () => {
  it('uses the folder wrapping SKILL.md as the skill and drops junk', () => {
    const plan = planSkillArchive(
      readZip(
        makeZip({
          'pdf-filler/': '',
          'pdf-filler/SKILL.md': SKILL_MD,
          'pdf-filler/scripts/fill.py': 'print(1)',
          '__MACOSX/pdf-filler/._SKILL.md': 'junk',
          'pdf-filler/.DS_Store': 'junk',
          'README.md': 'outside the skill, ignored',
        }),
      ),
      'download',
    )
    expect(plan.dirName).toBe('pdf-filler')
    expect(plan.files.map((file) => file.path).sort()).toEqual(['SKILL.md', 'scripts/fill.py'])
  })

  it('names a root-level skill from its frontmatter, falling back to the zip name', () => {
    const named = planSkillArchive(readZip(makeZip({ 'SKILL.md': SKILL_MD, 'notes.md': 'x' })), 'whatever')
    expect(named.dirName).toBe('pdf-filler')
    expect(named.files.map((file) => file.path).sort()).toEqual(['SKILL.md', 'notes.md'])

    const unnamed = planSkillArchive(readZip(makeZip({ 'SKILL.md': '# no frontmatter\n' })), 'My Cool Skill')
    expect(unnamed.dirName).toBe('my-cool-skill')
  })

  it('prefers the frontmatter name over an unfriendly wrapping folder, then slugifies the folder', () => {
    const named = planSkillArchive(readZip(makeZip({ 'My Skill (v2)/SKILL.md': SKILL_MD })), 'x')
    expect(named.dirName).toBe('pdf-filler')
    const unnamed = planSkillArchive(readZip(makeZip({ 'My Skill (v2)/SKILL.md': '# bare\n' })), 'x')
    expect(unnamed.dirName).toBe('my-skill-v2')
  })

  it('refuses archives without SKILL.md, with several skills, or with unsafe paths', () => {
    expect(() => planSkillArchive(readZip(makeZip({ 'readme.txt': 'hi' })), 'x')).toThrow('No SKILL.md')
    expect(() =>
      planSkillArchive(readZip(makeZip({ 'a/SKILL.md': SKILL_MD, 'b/SKILL.md': SKILL_MD })), 'x'),
    ).toThrow('several skills')
    expect(() =>
      planSkillArchive(readZip(makeZip({ 'skill/SKILL.md': SKILL_MD, 'skill/../../evil.sh': 'rm' })), 'x'),
    ).toThrow('Unsafe path')
    expect(() =>
      planSkillArchive(readZip(makeZip({ 'SKILL.md': SKILL_MD, '/etc/passwd': 'x' })), 'x'),
    ).toThrow('Unsafe path')
  })
})

describe('writeSkillArchive', () => {
  let tmp: string
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'skilldex-archive-'))
  })
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true })
  })

  it('writes the skill folder and refuses to overwrite an existing one', async () => {
    const root = path.join(tmp, '.claude', 'skills')
    const plan = planSkillArchive(
      readZip(makeZip({ 'pdf-filler/SKILL.md': SKILL_MD, 'pdf-filler/scripts/fill.py': 'print(1)' })),
      'x',
    )
    const dir = await writeSkillArchive(root, plan)
    expect(dir).toBe(path.join(root, 'pdf-filler'))
    expect(await fs.readFile(path.join(dir, 'SKILL.md'), 'utf8')).toBe(SKILL_MD)
    expect(await fs.readFile(path.join(dir, 'scripts', 'fill.py'), 'utf8')).toBe('print(1)')
    // No staging debris left beside the root.
    expect((await fs.readdir(path.join(tmp, '.claude'))).sort()).toEqual(['skills'])

    await expect(writeSkillArchive(root, plan)).rejects.toThrow('already exists')
  })

  it('replaces a dangling symlink at the destination instead of failing', async () => {
    const root = path.join(tmp, '.claude', 'skills')
    await fs.mkdir(root, { recursive: true })
    await fs.symlink(path.join(tmp, 'gone', 'pdf-filler'), path.join(root, 'pdf-filler'))
    const plan = planSkillArchive(readZip(makeZip({ 'pdf-filler/SKILL.md': SKILL_MD })), 'x')
    await writeSkillArchive(root, plan)
    expect((await fs.lstat(path.join(root, 'pdf-filler'))).isDirectory()).toBe(true)
    // removeSkillForReplace also treats a dangling link as removable, but refuses a live one.
    await fs.symlink(path.join(tmp, 'gone', 'other'), path.join(root, 'other'))
    await expect(removeSkillForReplace(root, 'other')).resolves.toBe(false)
    await fs.mkdir(path.join(tmp, 'live'), { recursive: true })
    await fs.symlink(path.join(tmp, 'live'), path.join(root, 'linked'))
    await expect(removeSkillForReplace(root, 'linked')).rejects.toThrow('symlink')
  })

  it('rejects unsafe paths handed straight to the writer', async () => {
    const root = path.join(tmp, '.claude', 'skills')
    await expect(
      writeSkillArchive(root, { dirName: 'evil', files: [{ path: '../escape.txt', data: Buffer.from('x') }] }),
    ).rejects.toThrow('Unsafe path')
  })
})
