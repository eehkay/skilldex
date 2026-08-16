/**
 * The Skilldex machine agent — a single self-contained JS file the hub pushes
 * over SSH (`~/.skilldex-agent.js`) and executes on demand. Not a daemon:
 * every invocation is one command, JSON in on stdin, JSON out on stdout,
 * `{"error": …}` + exit 1 on failure.
 *
 * The agent reuses the exact SkillWorkspace the desktop app runs, pointed at
 * the desktop app's own config file, so a machine's project roots (and
 * anything else Skilldex-on-that-machine knows) apply to remote operations
 * too. Updates are content-addressed: the hub compares the file's sha256 and
 * re-pushes when its bundled copy differs — the agent itself has no version.
 *
 * Commands:
 *   ping      → {"ok":true,"node":"v22.x"}
 *   snapshot  → WorkspaceSnapshot
 *   install   ← {"repo":"owner/repo","skillId":…,"scope":"global"|"project","projectName"?} → WorkspaceSnapshot
 *   enable | disable | remove ← {"id":…} → WorkspaceSnapshot
 *   plugins            → {available, plugins, marketplaces, error?}   (Claude Code plugin inventory)
 *   plugins-available  → AvailablePlugin[]                             (what this machine's marketplaces offer)
 *   plugin-op ← {op, plugin, marketplaceSource?, marketplaceName?} → plugins result (after the change)
 */

import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { createConfigStore } from '../electron/main/workspace/config'
import { resolveProjectDirs } from '../electron/main/workspace/filesystem-source'
import {
  downloadRepoSkill,
  fetchRepoCatalog,
  type FetchLike,
} from '../electron/main/workspace/repo-catalog'
import { packSkillFiles } from '../electron/main/workspace/filesystem-source'
import { writeSkillArchive } from '../electron/main/workspace/skill-archive'
import {
  disableSkillDir,
  enableSkillDir,
  removeSkillDir,
  slugify,
} from '../electron/main/workspace/skill-manager'
import { createSkillWorkspace, writeSkillLockEntry } from '../electron/main/workspace/skill-workspace'

/** The desktop app's config path on this machine (Electron's userData layout). */
function desktopConfigPath(homeDir: string): string {
  if (process.platform === 'darwin')
    return path.join(homeDir, 'Library', 'Application Support', 'Skilldex', 'config.json')
  const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(homeDir, '.config')
  return path.join(xdgConfig, 'Skilldex', 'config.json')
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

async function main(): Promise<void> {
  const command = process.argv[2]
  const homeDir = os.homedir()
  const configStore = createConfigStore(desktopConfigPath(homeDir))
  const workspace = createSkillWorkspace({ homeDir, configStore })
  const fetchImpl = globalThis.fetch as unknown as FetchLike

  switch (command) {
    case 'ping': {
      emit({ ok: true, node: process.version })
      return
    }
    case 'snapshot': {
      emit(await workspace.getSnapshot())
      return
    }
    case 'install': {
      const input = JSON.parse(await readStdin()) as {
        repo: string
        skillId: string
        scope: 'global' | 'project'
        projectName?: string
        ref?: string
      }
      // The hub already validated the skill against its own catalog; the agent
      // re-scans the repo itself (at the hub's pinned ref, when given) so the
      // download comes from the machine's own network with fresh file lists.
      const scan = await fetchRepoCatalog({ slug: input.repo, ref: input.ref }, fetchImpl)
      const skill = scan.catalog.skills.find((entry) => entry.id === input.skillId)
      const files = skill && scan.filesBySkill.get(skill.id)
      if (!skill || !files) throw new Error(`Skill not found in ${input.repo}: ${input.skillId}`)

      let root: string
      if (input.scope === 'project') {
        const config = await configStore.load()
        const dirs = await resolveProjectDirs(config.projectRoots)
        const match = dirs.find((dir) => path.basename(dir) === input.projectName)
        if (!match) throw new Error(`Unknown project on this machine: ${input.projectName ?? '(none)'}`)
        root = path.join(match, '.claude', 'skills')
      } else {
        root = path.join(homeDir, '.claude', 'skills')
      }

      const dirName = skill.path ? path.posix.basename(skill.path) : slugify(skill.name)
      await fs.mkdir(root, { recursive: true })
      await downloadRepoSkill({
        slug: scan.catalog.slug,
        ref: scan.catalog.ref,
        dir: skill.path,
        files,
        dest: path.join(root, dirName),
        fetchImpl,
      })
      if (input.scope === 'global') {
        await writeSkillLockEntry(homeDir, dirName, {
          source: scan.catalog.slug,
          sourceType: 'github',
          sourceUrl: `https://github.com/${scan.catalog.slug}.git`,
          skillPath: skill.path ? `${skill.path}/SKILL.md` : 'SKILL.md',
        }).catch(() => {})
      }
      emit(await workspace.getSnapshot())
      return
    }
    case 'uninstall': {
      const input = JSON.parse(await readStdin()) as {
        dirName: string
        scope: 'global' | 'project'
        projectName?: string
      }
      // The folder name must be exactly one path segment — the agent never
      // deletes anything a hub couldn't have installed.
      if (path.basename(input.dirName) !== input.dirName || input.dirName.startsWith('.'))
        throw new Error(`Invalid skill folder name: ${input.dirName}`)

      let root: string
      if (input.scope === 'project') {
        const config = await configStore.load()
        const dirs = await resolveProjectDirs(config.projectRoots)
        const match = dirs.find((dir) => path.basename(dir) === input.projectName)
        if (!match) throw new Error(`Unknown project on this machine: ${input.projectName ?? '(none)'}`)
        root = path.join(match, '.claude', 'skills')
      } else {
        root = path.join(homeDir, '.claude', 'skills')
      }

      // The skill may be parked under .disabled/ — remove whichever exists.
      let removed = false
      for (const dir of [path.join(root, input.dirName), path.join(root, '.disabled', input.dirName)]) {
        const present = await fs.access(dir).then(() => true).catch(() => false)
        if (present) {
          await removeSkillDir(dir)
          removed = true
        }
      }
      if (!removed) throw new Error(`Skill not found on this machine: ${input.dirName}`)
      emit(await workspace.getSnapshot())
      return
    }
    case 'read-skill': {
      // Ship a skill's files back to the hub (for adopting a machine-local
      // skill into the library). Read-only; base64 so binaries survive JSON.
      const { id } = JSON.parse(await readStdin()) as { id: string }
      const snapshot = await workspace.getSnapshot()
      const skill = snapshot.skills.find((entry) => entry.id === id)
      if (!skill) throw new Error(`Unknown skill on this machine: ${id}`)
      emit({ skill, files: await packSkillFiles(skill.realPath) })
      return
    }
    case 'write-skill': {
      // Receive a skill's files from the hub (converging a hand-authored or
      // adopted library skill onto this machine). Refuses to overwrite.
      const input = JSON.parse(await readStdin()) as {
        dirName: string
        files: Array<{ path: string; base64: string }>
      }
      if (path.basename(input.dirName) !== input.dirName || input.dirName.startsWith('.'))
        throw new Error(`Invalid skill folder name: ${input.dirName}`)
      // Same writer the hub uses for imports: replaces a dangling symlink,
      // refuses a real entry, rejects unsafe paths, stages + renames atomically.
      const root = path.join(homeDir, '.claude', 'skills')
      await writeSkillArchive(root, {
        dirName: input.dirName,
        files: input.files.map((file) => ({ path: file.path, data: Buffer.from(file.base64, 'base64') })),
      })
      emit(await workspace.getSnapshot())
      return
    }
    case 'set-enabled': {
      const input = JSON.parse(await readStdin()) as {
        dirName: string
        scope: 'global' | 'project'
        projectName?: string
        enabled: boolean
      }
      if (path.basename(input.dirName) !== input.dirName || input.dirName.startsWith('.'))
        throw new Error(`Invalid skill folder name: ${input.dirName}`)

      let root: string
      if (input.scope === 'project') {
        const config = await configStore.load()
        const dirs = await resolveProjectDirs(config.projectRoots)
        const match = dirs.find((dir) => path.basename(dir) === input.projectName)
        if (!match) throw new Error(`Unknown project on this machine: ${input.projectName ?? '(none)'}`)
        root = path.join(match, '.claude', 'skills')
      } else {
        root = path.join(homeDir, '.claude', 'skills')
      }

      const active = path.join(root, input.dirName)
      const parked = path.join(root, '.disabled', input.dirName)
      const isActive = await fs.access(active).then(() => true).catch(() => false)
      const isParked = await fs.access(parked).then(() => true).catch(() => false)
      if (!isActive && !isParked) throw new Error(`Skill not found on this machine: ${input.dirName}`)

      // Already in the requested state → no-op, so the call is idempotent.
      if (input.enabled && isParked) await enableSkillDir(parked)
      if (!input.enabled && isActive) await disableSkillDir(active)
      emit(await workspace.getSnapshot())
      return
    }
    case 'enable':
    case 'disable':
    case 'remove': {
      const { id } = JSON.parse(await readStdin()) as { id: string }
      const op =
        command === 'enable'
          ? workspace.enableSkill(id)
          : command === 'disable'
            ? workspace.disableSkill(id)
            : workspace.removeSkill(id)
      emit(await op)
      return
    }
    case 'plugins': {
      emit(await pluginInventory(homeDir))
      return
    }
    case 'plugins-available': {
      const raw = await claudeJson<{ available?: unknown }>(homeDir, ['plugin', 'list', '--available', '--json'])
      const list = Array.isArray(raw?.available) ? raw.available : []
      emit(list.map(normalizeAvailable).filter((entry): entry is NonNullable<typeof entry> => entry !== null))
      return
    }
    case 'plugin-op': {
      const input = JSON.parse(await readStdin()) as {
        op: 'install' | 'uninstall' | 'enable' | 'disable'
        plugin: string
        marketplaceSource?: string
        marketplaceName?: string
        scope?: 'user' | 'project' | 'local'
      }
      if (!['install', 'uninstall', 'enable', 'disable'].includes(input.op)) throw new Error(`Unknown plugin op: ${input.op}`)
      const scope = input.scope && ['user', 'project', 'local'].includes(input.scope) ? input.scope : 'user'
      if (!input.plugin || /\s/.test(input.plugin)) throw new Error('Invalid plugin id.')
      if (input.op === 'install' && input.marketplaceSource && input.marketplaceName) {
        // Add the marketplace first if this machine doesn't know it yet.
        const known = await pluginInventory(homeDir)
        if (!known.marketplaces.some((m) => m.name === input.marketplaceName))
          await claudeRun(homeDir, ['plugin', 'marketplace', 'add', input.marketplaceSource])
      }
      const args =
        input.op === 'install'
          ? ['plugin', 'install', input.plugin, '--scope', scope, '-y']
          : input.op === 'uninstall'
            ? ['plugin', 'uninstall', input.plugin, '--scope', scope, '-y']
            : ['plugin', input.op, input.plugin, '--scope', scope]
      await claudeRun(homeDir, args)
      emit(await pluginInventory(homeDir))
      return
    }
    default:
      throw new Error(`Unknown agent command: ${command ?? '(none)'}`)
  }
}

// ---------------------------------------------------------------------------
// Claude Code plugins — thin wrapper over the `claude plugin` CLI.

const execFileAsync = promisify(execFile)

/** Find the claude binary: PATH first, then the usual install spots. */
async function claudeBinary(homeDir: string): Promise<string | null> {
  const candidates = [
    'claude',
    path.join(homeDir, '.local', 'bin', 'claude'),
    path.join(homeDir, '.claude', 'local', 'claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
    path.join(homeDir, '.npm-global', 'bin', 'claude'),
    path.join(homeDir, '.bun', 'bin', 'claude'),
  ]
  for (const candidate of candidates) {
    try {
      await execFileAsync(candidate, ['--version'], { timeout: 15_000 })
      return candidate
    } catch {
      // try the next one
    }
  }
  return null
}

async function claudeRun(homeDir: string, args: string[]): Promise<string> {
  const bin = await claudeBinary(homeDir)
  if (!bin) throw new Error('Claude Code CLI (`claude`) not found on this machine.')
  try {
    const { stdout } = await execFileAsync(bin, args, { timeout: 240_000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, CI: '1' } })
    return stdout
  } catch (cause) {
    const err = cause as { stderr?: string; stdout?: string; message?: string }
    const detail = (err.stderr || err.stdout || err.message || '').trim().split('\n').slice(-3).join(' ')
    throw new Error(`claude ${args.join(' ')} failed: ${detail || 'unknown error'}`)
  }
}

async function claudeJson<T>(homeDir: string, args: string[]): Promise<T> {
  const out = await claudeRun(homeDir, args)
  // The CLI may print a notice line before the JSON; parse from the first bracket.
  const start = Math.min(...['[', '{'].map((c) => out.indexOf(c)).filter((i) => i >= 0))
  if (!Number.isFinite(start)) throw new Error(`claude ${args.join(' ')}: no JSON in output.`)
  return JSON.parse(out.slice(start)) as T
}

async function pluginInventory(homeDir: string): Promise<{
  available: boolean
  plugins: Array<Record<string, unknown>>
  marketplaces: Array<Record<string, unknown>>
  error?: string
}> {
  if (!(await claudeBinary(homeDir)))
    return { available: false, plugins: [], marketplaces: [], error: 'Claude Code CLI (`claude`) not found on this machine.' }
  const [installed, marketplaces] = await Promise.all([
    claudeJson<unknown>(homeDir, ['plugin', 'list', '--json']),
    claudeJson<unknown>(homeDir, ['plugin', 'marketplace', 'list', '--json']),
  ])
  const plugins = (Array.isArray(installed) ? installed : [])
    .map((entry) => normalizeInstalled(entry))
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
  const markets = (Array.isArray(marketplaces) ? marketplaces : [])
    .map((entry) => normalizeMarketplace(entry))
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
  return { available: true, plugins, marketplaces: markets }
}

function normalizeInstalled(entry: unknown): Record<string, unknown> | null {
  if (typeof entry !== 'object' || entry === null) return null
  const e = entry as Record<string, unknown>
  const id = typeof e.id === 'string' ? e.id : ''
  if (!id) return null
  const at = id.lastIndexOf('@')
  const mcp = typeof e.mcpServers === 'object' && e.mcpServers !== null ? Object.keys(e.mcpServers as object) : undefined
  return {
    id,
    name: at > 0 ? id.slice(0, at) : id,
    marketplace: at > 0 ? id.slice(at + 1) : '',
    version: typeof e.version === 'string' ? e.version : 'unknown',
    scope: typeof e.scope === 'string' ? e.scope : 'user',
    enabled: e.enabled !== false,
    ...(typeof e.installPath === 'string' ? { installPath: e.installPath } : {}),
    ...(typeof e.installedAt === 'string' ? { installedAt: e.installedAt } : {}),
    ...(typeof e.lastUpdated === 'string' ? { lastUpdated: e.lastUpdated } : {}),
    ...(mcp && mcp.length ? { mcpServers: mcp } : {}),
  }
}

function normalizeMarketplace(entry: unknown): Record<string, unknown> | null {
  if (typeof entry !== 'object' || entry === null) return null
  const e = entry as Record<string, unknown>
  if (typeof e.name !== 'string') return null
  const source = typeof e.source === 'string' ? e.source : 'unknown'
  const location =
    typeof e.repo === 'string' ? e.repo : typeof e.url === 'string' ? e.url : typeof e.path === 'string' ? e.path : ''
  return { name: e.name, source, location }
}

function normalizeAvailable(entry: unknown): Record<string, unknown> | null {
  if (typeof entry !== 'object' || entry === null) return null
  const e = entry as Record<string, unknown>
  const id = typeof e.pluginId === 'string' ? e.pluginId : ''
  if (!id) return null
  return {
    id,
    name: typeof e.name === 'string' ? e.name : id.split('@')[0],
    marketplace: typeof e.marketplaceName === 'string' ? e.marketplaceName : id.split('@').pop() ?? '',
    description: typeof e.description === 'string' ? e.description : '',
    ...(typeof e.version === 'string' ? { version: e.version } : {}),
    ...(typeof e.installCount === 'number' ? { installCount: e.installCount } : {}),
  }
}

function emit(payload: unknown): void {
  process.stdout.write(JSON.stringify(payload))
}

main().catch((cause: unknown) => {
  process.stdout.write(JSON.stringify({ error: cause instanceof Error ? cause.message : String(cause) }))
  process.exit(1)
})
