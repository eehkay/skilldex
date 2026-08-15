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
 */

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createConfigStore } from '../electron/main/workspace/config'
import { resolveProjectDirs } from '../electron/main/workspace/filesystem-source'
import {
  downloadRepoSkill,
  fetchRepoCatalog,
  type FetchLike,
} from '../electron/main/workspace/repo-catalog'
import { removeSkillDir, slugify } from '../electron/main/workspace/skill-manager'
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
    default:
      throw new Error(`Unknown agent command: ${command ?? '(none)'}`)
  }
}

function emit(payload: unknown): void {
  process.stdout.write(JSON.stringify(payload))
}

main().catch((cause: unknown) => {
  process.stdout.write(JSON.stringify({ error: cause instanceof Error ? cause.message : String(cause) }))
  process.exit(1)
})
