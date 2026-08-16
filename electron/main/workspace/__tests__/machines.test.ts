import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMachineManager, type ExecLike, type ExecResult } from '../machines'
import type { MachineRecord } from '../types'

const MACHINE: MachineRecord = { name: 'tower', host: 'arch-tower', user: 'kellogg' }

let tmp: string
let agentPath: string
const AGENT_SOURCE = '// fake agent v1\n'

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'skilldex-machines-'))
  agentPath = path.join(tmp, 'skilldex-agent.js')
  await fs.writeFile(agentPath, AGENT_SOURCE)
})

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

/**
 * A fake remote machine: tracks the pushed agent content and answers hash
 * probes and agent commands the way the real ssh round-trip would.
 */
function fakeMachine(options: { reachable?: boolean; snapshot?: unknown; pluginsBroken?: boolean } = {}) {
  const state = {
    agent: null as string | null, pushes: 0, commands: [] as string[],
    plugins: [] as Array<{ id: string; name: string; marketplace: string; version: string; scope: string; enabled: boolean }>,
    pluginOps: [] as string[],
  }
  const exec: ExecLike = async (_cmd, args, { input }) => {
    const remote = args[args.length - 1]
    state.commands.push(remote)
    if (options.reachable === false)
      return { stdout: '', stderr: 'ssh: connect to host arch-tower port 22: Connection refused', code: 255 }

    const ok = (stdout: string): ExecResult => ({ stdout, stderr: '', code: 0 })
    if (remote.includes('sha256sum')) {
      if (state.agent === null) return ok('missing')
      return ok(`${createHash('sha256').update(state.agent).digest('hex')}  /home/kellogg/.skilldex-agent.js`)
    }
    if (remote.includes('cat >')) {
      state.agent = input ?? ''
      state.pushes++
      return ok('')
    }
    if (remote.includes('agent.js ping')) return ok(JSON.stringify({ ok: true, node: 'v22.0.0' }))
    if (remote.includes('agent.js snapshot')) return ok(JSON.stringify(options.snapshot ?? { skills: [] }))
    if (remote.includes('agent.js plugins-available')) return ok(JSON.stringify([{ id: 'x@m', name: 'x', marketplace: 'm', description: 'X' }]))
    if (remote.includes('agent.js plugins')) {
      if (options.pluginsBroken) return { stdout: JSON.stringify({ error: 'claude plugin list failed: boom' }), stderr: '', code: 1 }
      return ok(JSON.stringify({ available: true, plugins: state.plugins, marketplaces: [{ name: 'm', source: 'github', location: 'o/r' }] }))
    }
    if (remote.includes('agent.js plugin-op')) {
      const parsed = JSON.parse(input ?? '{}') as { op: string; plugin: string }
      state.pluginOps.push(`${parsed.op}:${parsed.plugin}`)
      if (parsed.op === 'install') state.plugins.push({ id: parsed.plugin, name: parsed.plugin.split('@')[0], marketplace: 'm', version: '1', scope: 'user', enabled: true })
      if (parsed.op === 'uninstall') state.plugins = state.plugins.filter((p) => p.id !== parsed.plugin)
      if (parsed.op === 'enable' || parsed.op === 'disable') for (const p of state.plugins) if (p.id === parsed.plugin) p.enabled = parsed.op === 'enable'
      return ok(JSON.stringify({ available: true, plugins: state.plugins, marketplaces: [] }))
    }
    if (remote.includes('agent.js install')) {
      const parsed = JSON.parse(input ?? '{}')
      if (parsed.skillId === 'boom') return { stdout: JSON.stringify({ error: 'download failed' }), stderr: '', code: 1 }
      return ok(JSON.stringify({ skills: [{ name: 'installed' }] }))
    }
    return { stdout: JSON.stringify({ error: `unknown: ${remote}` }), stderr: '', code: 1 }
  }
  return { exec, state }
}

describe('machine manager', () => {
  it('pushes the agent on first contact and skips when the hash matches', async () => {
    const remote = fakeMachine()
    const manager = createMachineManager({ agentPath, execImpl: remote.exec })

    await manager.ping(MACHINE)
    expect(remote.state.pushes).toBe(1)
    expect(remote.state.agent).toBe(AGENT_SOURCE)

    await manager.snapshot(MACHINE)
    expect(remote.state.pushes).toBe(1) // confirmed in-process, no re-hash
  })

  it('re-probes when the same name points at a new host', async () => {
    const remote = fakeMachine()
    const manager = createMachineManager({ agentPath, execImpl: remote.exec })
    await manager.ping(MACHINE)
    const probes = () => remote.state.commands.filter((command) => command.includes('sha256sum')).length
    expect(probes()).toBe(1)

    // A rename alone reuses the confirmation…
    await manager.ping({ ...MACHINE, name: 'renamed' })
    expect(probes()).toBe(1)
    // …but a new host must be checked (the agent may not be there yet).
    await manager.ping({ ...MACHINE, host: 'other-host' })
    expect(probes()).toBe(2)
  })

  it('re-pushes when the bundled agent changes', async () => {
    const remote = fakeMachine()
    const manager = createMachineManager({ agentPath, execImpl: remote.exec })
    await manager.ping(MACHINE)

    await fs.writeFile(agentPath, '// fake agent v2\n')
    await manager.ping(MACHINE)
    expect(remote.state.pushes).toBe(2)
    expect(remote.state.agent).toContain('v2')
  })

  it('returns snapshot errors inline instead of throwing', async () => {
    const remote = fakeMachine({ reachable: false })
    const manager = createMachineManager({ agentPath, execImpl: remote.exec })

    const result = await manager.snapshot(MACHINE)
    expect(result.snapshot).toBeNull()
    expect(result.error).toContain('unreachable')
    expect(result.error).toContain('Connection refused')
  })

  it('surfaces agent-reported errors as thrown messages on install', async () => {
    const remote = fakeMachine()
    const manager = createMachineManager({ agentPath, execImpl: remote.exec })

    await expect(
      manager.install(MACHINE, { repo: 'a/b', skillId: 'boom', scope: 'global' }),
    ).rejects.toThrow('download failed')

    const snapshot = await manager.install(MACHINE, { repo: 'a/b', skillId: 'a/b:x', scope: 'global' })
    expect(snapshot.skills[0]).toEqual({ name: 'installed' })
  })

  it('runs through local bash instead of ssh when the machine is this host', async () => {
    const seen: Array<{ cmd: string; args: string[] }> = []
    const exec: ExecLike = async (cmd, args) => {
      seen.push({ cmd, args })
      const remote = args[args.length - 1]
      if (remote.includes('sha256sum')) return { stdout: 'missing', stderr: '', code: 0 }
      if (remote.includes('cat >')) return { stdout: '', stderr: '', code: 0 }
      return { stdout: JSON.stringify({ ok: true }), stderr: '', code: 0 }
    }
    const manager = createMachineManager({
      agentPath,
      execImpl: exec,
      selfHost: 'arch-dev.taila7ae3.ts.net',
      selfUser: 'kellogg',
    })

    // Same host + same user → local bash, no ssh.
    await manager.ping({ name: 'dev', host: 'arch-dev', user: 'kellogg' })
    expect(seen.every((call) => call.cmd === 'bash')).toBe(true)

    // Same host but a different user is NOT self — must go over ssh.
    seen.length = 0
    await manager.ping({ name: 'dev-root', host: 'arch-dev', user: 'someone-else' }).catch(() => {})
    expect(seen[0]?.cmd).toBe('ssh')
  })

  it('wraps remote commands in bash -c for fish-shell machines', async () => {
    const remote = fakeMachine()
    const manager = createMachineManager({ agentPath, execImpl: remote.exec })
    await manager.ping(MACHINE)
    for (const command of remote.state.commands) {
      expect(command.startsWith("bash -c '")).toBe(true)
    }
  })
})

describe('machine manager: plugins', () => {
  it('reads the inventory, runs ops through the agent, and reflects the result', async () => {
    const machine = fakeMachine()
    const manager = createMachineManager({ agentPath, execImpl: machine.exec })
    expect(await manager.plugins(MACHINE)).toMatchObject({ machine: MACHINE, available: true, plugins: [], marketplaces: [{ name: 'm' }] })

    let result = await manager.pluginOp(MACHINE, { op: 'install', plugin: 'fd@m' })
    expect(result.plugins).toEqual([expect.objectContaining({ id: 'fd@m', enabled: true })])
    result = await manager.pluginOp(MACHINE, { op: 'disable', plugin: 'fd@m' })
    expect(result.plugins[0].enabled).toBe(false)
    result = await manager.pluginOp(MACHINE, { op: 'uninstall', plugin: 'fd@m' })
    expect(result.plugins).toEqual([])
    expect(machine.state.pluginOps).toEqual(['install:fd@m', 'disable:fd@m', 'uninstall:fd@m'])
    expect(await manager.availablePlugins(MACHINE)).toEqual([expect.objectContaining({ id: 'x@m' })])
  })

  it('never throws from plugins(): agent failure and unreachable host become error fields', async () => {
    const broken = fakeMachine({ pluginsBroken: true })
    const r1 = await createMachineManager({ agentPath, execImpl: broken.exec }).plugins(MACHINE)
    expect(r1.available).toBe(false)
    expect(r1.error).toContain('boom')
    const down = fakeMachine({ reachable: false })
    const r2 = await createMachineManager({ agentPath, execImpl: down.exec }).plugins(MACHINE)
    expect(r2.available).toBe(false)
    expect(r2.error).toBeTruthy()
  })
})
