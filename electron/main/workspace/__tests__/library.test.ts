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
    const match = /agent\.js ([\w-]+)/.exec(remote)
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

  describe('setSkillEnabled', () => {
    it("target 'everywhere' disables the local copy and every syndicated machine", async () => {
      await ws.installOnMachine('tower', { repo: SLUG, skillId: `${SLUG}:skills/tdd`, scope: 'global' })
      const skill = (await ws.getSnapshot()).skills.find((entry) => entry.name === 'tdd')!

      const result = await ws.setSkillEnabled({ skillId: skill.id, enabled: false, target: 'everywhere' })
      const call = remote.calls.find((entry) => entry.command === 'set-enabled')
      expect(call?.input).toMatchObject({ dirName: 'tdd', scope: 'global', enabled: false })
      expect(result.machines.map((entry) => entry.machine.name)).toEqual(['tower'])
      // Local copy parked under .disabled.
      await expect(
        fs.access(path.join(tmp, '.claude', 'skills', '.disabled', 'tdd', 'SKILL.md')),
      ).resolves.toBeUndefined()
      expect(result.workspace.skills.find((entry) => entry.name === 'tdd')?.enabled).toBe(false)
    })

    it('a single-machine target never touches the local copy', async () => {
      await ws.installOnMachine('tower', { repo: SLUG, skillId: `${SLUG}:skills/tdd`, scope: 'global' })
      const skill = (await ws.getSnapshot()).skills.find((entry) => entry.name === 'tdd')!

      const result = await ws.setSkillEnabled({
        skillId: skill.id,
        enabled: false,
        target: { machine: 'tower', scope: 'global' },
      })
      expect(remote.calls.some((entry) => entry.command === 'set-enabled')).toBe(true)
      // Local copy stays active.
      await expect(fs.access(path.join(tmp, '.claude', 'skills', 'tdd', 'SKILL.md'))).resolves.toBeUndefined()
      expect(result.workspace.skills.find((entry) => entry.name === 'tdd')?.enabled).toBe(true)
    })
  })

  describe('updateMachine', () => {
    it('renames without pinging and carries syndication targets along', async () => {
      await ws.installOnMachine('tower', { repo: SLUG, skillId: `${SLUG}:skills/tdd`, scope: 'global' })
      const pingsBefore = remote.calls.filter((call) => call.command === 'ping').length

      const snapshots = await ws.updateMachine('tower', { name: 'arch-tower', host: 'arch-tower', user: 'kellogg' })
      expect(snapshots.map((entry) => entry.machine.name)).toEqual(['arch-tower'])
      expect(remote.calls.filter((call) => call.command === 'ping').length).toBe(pingsBefore)

      const config = await ws.getConfig()
      expect(config.machines).toEqual([{ name: 'arch-tower', host: 'arch-tower', user: 'kellogg' }])

      const snapshot = await ws.getSnapshot()
      expect(snapshot.skills.find((entry) => entry.name === 'tdd')?.library?.targets).toEqual([
        { machine: 'arch-tower', scope: 'global', projectName: undefined },
      ])
      // The old name no longer resolves; the new one does.
      await expect(ws.refreshMachine('tower')).rejects.toThrow('Unknown machine')
      await expect(ws.refreshMachine('arch-tower')).resolves.toMatchObject({ machine: { name: 'arch-tower' } })
    })

    it('pings the new login target when host or user changes', async () => {
      const pingsBefore = remote.calls.filter((call) => call.command === 'ping').length
      await ws.updateMachine('tower', { name: 'tower', host: 'tower.tail', user: 'kellogg' })
      expect(remote.calls.filter((call) => call.command === 'ping').length).toBe(pingsBefore + 1)
      expect((await ws.getConfig()).machines[0]).toEqual({ name: 'tower', host: 'tower.tail', user: 'kellogg' })
    })

    it('rejects unknown machines, empty fields, and name collisions', async () => {
      await ws.addMachine({ name: 'mini', host: 'mini.tail', user: 'kellogg' })
      await expect(ws.updateMachine('nope', { name: 'x', host: 'y', user: 'z' })).rejects.toThrow('Unknown machine')
      await expect(ws.updateMachine('tower', { name: '  ', host: 'y', user: 'z' })).rejects.toThrow('required')
      await expect(ws.updateMachine('tower', { name: 'mini', host: 'arch-tower', user: 'kellogg' })).rejects.toThrow(
        'already exists',
      )
      // Saving under its own name is not a collision.
      await expect(ws.updateMachine('tower', { name: 'tower', host: 'arch-tower', user: 'kellogg' })).resolves.toHaveLength(2)
    })
  })
})

describe('machine diff, adopt, converge', () => {
  let tmp: string
  let ws: SkillWorkspace
  let calls: Array<{ command: string; input: unknown }>

  /** A fake machine holding one hand-authored skill and one repo-sourced skill. */
  function remoteWithSkills() {
    calls = []
    const machineSkills = [
      {
        id: '/home/k/.claude/skills/handmade', name: 'handmade', description: 'Local only',
        path: '/home/k/.claude/skills/handmade', realPath: '/home/k/.claude/skills/handmade',
        sourceKind: 'Personal', sourceRoot: '~/.claude/skills', displayPath: '~/.claude/skills/handmade',
        enabled: true, isFavourite: false, isSymlink: false, fileCount: 2, projects: [],
      },
      {
        id: '/home/k/.claude/skills/tdd', name: 'tdd', description: 'TDD',
        path: '/home/k/.claude/skills/tdd', realPath: '/home/k/.claude/skills/tdd',
        sourceKind: 'Personal', sourceRoot: '~/.claude/skills', displayPath: '~/.claude/skills/tdd',
        enabled: true, isFavourite: false, isSymlink: false, fileCount: 1, projects: [],
        origin: { host: 'github', label: SLUG, repoUrl: `https://github.com/${SLUG}`, webUrl: '' },
      },
    ]
    const exec: ExecLike = async (_cmd, args, { input }) => {
      const remote = args[args.length - 1]
      const ok = (stdout: string): ExecResult => ({ stdout, stderr: '', code: 0 })
      if (remote.includes('sha256sum')) return ok('missing')
      if (remote.includes('cat >')) return ok('')
      const match = /agent\.js ([\w-]+)/.exec(remote)
      if (!match) return { stdout: '', stderr: 'unexpected', code: 1 }
      const parsed = input ? JSON.parse(input) : undefined
      calls.push({ command: match[1], input: parsed })
      const snap = { skills: machineSkills, projects: [], sources: [], errors: [], scannedAt: '', homeDir: '/home/k' }
      if (match[1] === 'ping') return ok(JSON.stringify({ ok: true }))
      if (match[1] === 'snapshot') return ok(JSON.stringify(snap))
      if (match[1] === 'read-skill') {
        const skill = machineSkills.find((entry) => entry.id === parsed.id)
        return ok(JSON.stringify({
          skill,
          files: [
            { path: 'SKILL.md', base64: Buffer.from(`---\nname: ${skill?.name}\ndescription: ${skill?.description}\n---\n`).toString('base64') },
            { path: 'notes/extra.txt', base64: Buffer.from('extra').toString('base64') },
          ],
        }))
      }
      if (match[1] === 'write-skill' || match[1] === 'install') {
        machineSkills.push({ ...machineSkills[0], id: `/home/k/.claude/skills/${parsed.dirName ?? 'x'}`, name: parsed.dirName ?? 'x', realPath: `/home/k/.claude/skills/${parsed.dirName ?? 'x'}` })
        return ok(JSON.stringify(snap))
      }
      return ok(JSON.stringify(snap))
    }
    return exec
  }

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'skilldex-adopt-'))
    const agentPath = path.join(tmp, 'agent.js')
    await fs.writeFile(agentPath, '// agent')
    ws = createSkillWorkspace({
      homeDir: tmp,
      configStore: createConfigStore(path.join(tmp, 'config.json')),
      libraryStore: createLibraryStore(path.join(tmp, 'library.json')),
      fetchImpl: fakeFetch(routes()),
      agentPath,
      execImpl: remoteWithSkills(),
    })
    await ws.addSkillRepo(SLUG)
    await ws.addMachine({ name: 'tower', host: 'arch-tower', user: 'kellogg' })
  })

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true })
  })

  it('diff reports what is only on the machine and only in the library', async () => {
    // Put one skill in the library that the machine lacks.
    await ws.createSkill({ name: 'lib-only', description: 'hub authored', scope: 'global' })
    const diff = await ws.machineDiff('tower')
    expect(diff.onlyOnMachine.map((skill) => skill.name).sort()).toEqual(['handmade', 'tdd'])
    expect(diff.onlyInLibrary.map((skill) => skill.name)).toEqual(['lib-only'])
    expect(diff.inSync).toBe(0)
  })

  it('adopt copies origin-less skills and re-imports repo-sourced ones pinned', async () => {
    const result = await ws.adoptFromMachine('tower', ['/home/k/.claude/skills/handmade', '/home/k/.claude/skills/tdd'])
    expect(result.adopted.sort()).toEqual(['handmade', 'tdd'])
    expect(result.failed).toEqual({})

    // handmade: file copy, no repo, adoptedFrom recorded, machine as target
    await expect(fs.readFile(path.join(tmp, '.claude', 'skills', 'handmade', 'notes', 'extra.txt'), 'utf8')).resolves.toBe('extra')
    const ledger = JSON.parse(await fs.readFile(path.join(tmp, 'library.json'), 'utf8')).skills
    expect(ledger.handmade).toMatchObject({ repo: '', adoptedFrom: 'tower', targets: [{ machine: 'tower', scope: 'global' }] })

    // tdd: known origin in a tracked repo → re-imported at the pinned sha
    expect(ledger.tdd).toMatchObject({ repo: SLUG, path: 'skills/tdd', ref: SHA, adoptedFrom: 'tower' })
    // Nothing was written back to the machine.
    expect(calls.filter((call) => call.command === 'write-skill' || call.command === 'install')).toEqual([])
  })

  it('converge pushes library files for origin-less skills and repo installs for the rest', async () => {
    await ws.createSkill({ name: 'lib-only', description: 'hub authored', scope: 'global' })
    await ws.installRepoSkill({ repo: SLUG, skillId: `${SLUG}:skills/tdd`, scope: 'global' })
    // machine already has tdd, so only lib-only is missing → write-skill path
    const result = await ws.convergeMachine('tower')
    expect(result.installed).toEqual(['lib-only'])
    const write = calls.find((call) => call.command === 'write-skill')
    expect(write?.input).toMatchObject({ dirName: 'lib-only' })
    expect((write?.input as { files: unknown[] }).files.length).toBeGreaterThan(0)
  })
})

describe('clearMachine', () => {
  let tmp: string
  let ws: SkillWorkspace
  let calls: Array<{ command: string; input: unknown }>

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'skilldex-clear-'))
    calls = []
    const agentPath = path.join(tmp, 'agent.js')
    await fs.writeFile(agentPath, '// agent')
    // Machine holds two skills: 'tdd' (also in library) and 'only-here' (not in library).
    const machineSkills = ['tdd', 'only-here'].map((name) => ({
      id: `/home/k/.claude/skills/${name}`, name, description: '', path: `/home/k/.claude/skills/${name}`,
      realPath: `/home/k/.claude/skills/${name}`, sourceKind: 'Personal', sourceRoot: '~/.claude/skills',
      displayPath: `~/.claude/skills/${name}`, enabled: true, isFavourite: false, isSymlink: false, fileCount: 1, projects: [],
    }))
    const exec: ExecLike = async (_cmd, args, { input }) => {
      const remote = args[args.length - 1]
      const ok = (stdout: string): ExecResult => ({ stdout, stderr: '', code: 0 })
      if (remote.includes('sha256sum')) return ok('missing')
      if (remote.includes('cat >')) return ok('')
      const match = /agent\.js ([\w-]+)/.exec(remote)
      if (!match) return { stdout: '', stderr: 'unexpected', code: 1 }
      const parsed = input ? JSON.parse(input) : undefined
      calls.push({ command: match[1], input: parsed })
      const snap = { skills: machineSkills, projects: [], sources: [], errors: [], scannedAt: '', homeDir: '/home/k' }
      if (match[1] === 'ping') return ok(JSON.stringify({ ok: true }))
      return ok(JSON.stringify(snap))
    }
    ws = createSkillWorkspace({
      homeDir: tmp,
      configStore: createConfigStore(path.join(tmp, 'config.json')),
      libraryStore: createLibraryStore(path.join(tmp, 'library.json')),
      fetchImpl: fakeFetch(routes()),
      agentPath,
      execImpl: exec,
    })
    await ws.addSkillRepo(SLUG)
    await ws.addMachine({ name: 'tower', host: 'arch-tower', user: 'kellogg' })
    // Put 'tdd' in the library and record tower as a target.
    await ws.installOnMachine('tower', { repo: SLUG, skillId: `${SLUG}:skills/tdd`, scope: 'global' })
  })

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true })
  })

  it('removes only library-managed skills, keeps machine-only ones, and drops the syndication target', async () => {
    const result = await ws.clearMachine('tower')
    expect(result.removed).toEqual(['tdd'])
    expect(result.kept).toEqual(['only-here'])
    expect(result.failed).toEqual({})
    const uninstalls = calls.filter((call) => call.command === 'uninstall').map((call) => (call.input as { dirName: string }).dirName)
    expect(uninstalls).toEqual(['tdd']) // never 'only-here'
    // Library copy intact; target for tower cleared so it can be re-added selectively.
    await expect(fs.access(path.join(tmp, '.claude', 'skills', 'tdd'))).resolves.toBeUndefined()
    expect(result.workspace.skills.find((skill) => skill.name === 'tdd')?.library?.targets).toEqual([])
  })

  it('honours an explicit subset', async () => {
    const result = await ws.clearMachine('tower', ['only-here'])
    // Requested a machine-only skill: refused (kept), nothing removed.
    expect(result.removed).toEqual([])
    expect(result.kept).toEqual(['only-here'])
  })
})
