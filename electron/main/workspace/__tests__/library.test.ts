import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createConfigStore } from '../config'
import { createLibraryStore } from '../library-store'
import type { ExecLike, ExecResult } from '../machines'
import type { FetchLike } from '../repo-catalog'
import { createSkillWorkspace, type SkillWorkspace } from '../skill-workspace'

const SLUG = 'acme/skills'
const API = `https://api.github.com/repos/${SLUG}`
const SHA = 'abc123abc123abc123abc123abc123abc123abc1'

function routes(): Record<string, unknown> {
  const tree = {
    truncated: false,
    tree: [
      { path: 'skills/tdd', type: 'tree' },
      { path: 'skills/tdd/SKILL.md', type: 'blob' },
    ],
  }
  return {
    [API]: { default_branch: 'main' },
    [`${API}/commits/main`]: { sha: SHA },
    [`${API}/git/trees/main?recursive=1`]: tree,
    // The pinned install re-reads the tree and files at the commit sha.
    [`${API}/git/trees/${SHA}?recursive=1`]: tree,
    [`https://raw.githubusercontent.com/${SLUG}/main/skills/tdd/SKILL.md`]:
      '---\nname: tdd\ndescription: TDD\n---\n',
    [`https://raw.githubusercontent.com/${SLUG}/${SHA}/skills/tdd/SKILL.md`]:
      '---\nname: tdd\ndescription: TDD\n---\n',
  }
}

function fakeFetch(map: Record<string, unknown>): FetchLike {
  return async (url) => {
    const body = map[url]
    return {
      ok: body !== undefined,
      status: body !== undefined ? 200 : 404,
      json: async () => body,
      text: async () => String(body ?? ''),
      arrayBuffer: async () =>
        new TextEncoder().encode(typeof body === 'string' ? body : JSON.stringify(body)).buffer as ArrayBuffer,
    }
  }
}

/** Fake machine that records agent installs/uninstalls. */
function fakeRemote() {
  const calls: Array<{ command: string; input: unknown }> = []
  const exec: ExecLike = async (_cmd, args, { input }) => {
    const remote = args[args.length - 1]
    const ok = (stdout: string): ExecResult => ({ stdout, stderr: '', code: 0 })
    if (remote.includes('sha256sum')) return ok('missing')
    if (remote.includes('cat >')) return ok('')
    const match = /agent\.js (\w+)/.exec(remote)
    if (match) {
      calls.push({ command: match[1], input: input ? JSON.parse(input) : undefined })
      if (match[1] === 'ping') return ok(JSON.stringify({ ok: true }))
      return ok(JSON.stringify({ skills: [], projects: [], sources: [], errors: [], scannedAt: '', homeDir: '/x' }))
    }
    return { stdout: '', stderr: 'unexpected', code: 1 }
  }
  return { exec, calls }
}

describe('library and syndication', () => {
  let tmp: string
  let ws: SkillWorkspace
  let remote: ReturnType<typeof fakeRemote>

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'skilldex-library-'))
    const agentPath = path.join(tmp, 'agent.js')
    await fs.writeFile(agentPath, '// agent')
    remote = fakeRemote()
    ws = createSkillWorkspace({
      homeDir: tmp,
      configStore: createConfigStore(path.join(tmp, 'config.json')),
      libraryStore: createLibraryStore(path.join(tmp, 'library.json')),
      fetchImpl: fakeFetch(routes()),
      agentPath,
      execImpl: remote.exec,
    })
    await ws.addSkillRepo(SLUG)
    await ws.addMachine({ name: 'tower', host: 'arch-tower', user: 'kellogg' })
  })

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true })
  })

  it('pins imports to the commit sha and exposes library metadata', async () => {
    const snapshot = await ws.installRepoSkill({ repo: SLUG, skillId: `${SLUG}:skills/tdd`, scope: 'global' })
    const skill = snapshot.skills.find((entry) => entry.name === 'tdd')
    expect(skill?.library).toEqual({ repo: SLUG, path: 'skills/tdd', ref: SHA, targets: [] })
  })

  it('routes machine installs through the library and records the target', async () => {
    const result = await ws.installOnMachine('tower', {
      repo: SLUG,
      skillId: `${SLUG}:skills/tdd`,
      scope: 'global',
    })
    expect(result.machine.name).toBe('tower')

    // Local library copy exists even though the install targeted a machine.
    await expect(fs.access(path.join(tmp, '.claude', 'skills', 'tdd', 'SKILL.md'))).resolves.toBeUndefined()

    // The machine downloaded the pinned version.
    const install = remote.calls.find((call) => call.command === 'install')
    expect(install?.input).toMatchObject({ repo: SLUG, ref: SHA, scope: 'global' })

    const snapshot = await ws.getSnapshot()
    expect(snapshot.skills.find((entry) => entry.name === 'tdd')?.library?.targets).toEqual([
      { machine: 'tower', scope: 'global', projectName: undefined },
    ])
  })

  it('setSyndication uninstalls from one machine and updates targets', async () => {
    await ws.installOnMachine('tower', { repo: SLUG, skillId: `${SLUG}:skills/tdd`, scope: 'global' })
    const snapshot = await ws.getSnapshot()
    const skill = snapshot.skills.find((entry) => entry.name === 'tdd')!

    const result = await ws.setSyndication({
      skillId: skill.id,
      machine: 'tower',
      enabled: false,
      scope: 'global',
    })
    const uninstall = remote.calls.find((call) => call.command === 'uninstall')
    expect(uninstall?.input).toMatchObject({ dirName: 'tdd', scope: 'global' })
    expect(result.workspace.skills.find((entry) => entry.name === 'tdd')?.library?.targets).toEqual([])
    // Local library copy is untouched.
    await expect(fs.access(path.join(tmp, '.claude', 'skills', 'tdd'))).resolves.toBeUndefined()
  })

  it('library removal cascades an uninstall to every syndicated machine', async () => {
    await ws.installOnMachine('tower', { repo: SLUG, skillId: `${SLUG}:skills/tdd`, scope: 'global' })
    const snapshot = await ws.getSnapshot()
    const skill = snapshot.skills.find((entry) => entry.name === 'tdd')!

    const after = await ws.removeSkill(skill.id)
    expect(remote.calls.some((call) => call.command === 'uninstall')).toBe(true)
    expect(after.skills.find((entry) => entry.name === 'tdd')).toBeUndefined()
    await expect(fs.access(path.join(tmp, '.claude', 'skills', 'tdd'))).rejects.toThrow()

    const ledger = JSON.parse(await fs.readFile(path.join(tmp, 'library.json'), 'utf8'))
    expect(ledger.skills.tdd).toBeUndefined()
  })
})
