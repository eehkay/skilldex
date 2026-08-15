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
function fakeMachine(options: { reachable?: boolean; snapshot?: unknown } = {}) {
  const state = { agent: null as string | null, pushes: 0, commands: [] as string[] }
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

  it('wraps remote commands in bash -c for fish-shell machines', async () => {
    const remote = fakeMachine()
    const manager = createMachineManager({ agentPath, execImpl: remote.exec })
    await manager.ping(MACHINE)
    for (const command of remote.state.commands) {
      expect(command.startsWith("bash -c '")).toBe(true)
    }
  })
})
