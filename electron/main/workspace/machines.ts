/**
 * Machine manager — remote skill operations over (Tailscale) SSH.
 *
 * No daemons: each operation SSH-execs the single-file agent
 * (`~/.skilldex-agent.js`) on the target and speaks JSON over stdio. The
 * agent is content-addressed — before running a command the manager compares
 * the remote file's sha256 with its bundled copy and re-pushes on mismatch,
 * so agent updates ride along with hub deploys and there is nothing to
 * install or maintain on any machine.
 *
 * Fleet conventions honoured here: remote commands are always wrapped in
 * `bash -c` (arch boxes run fish), auth is Tailscale SSH (no keys, so
 * BatchMode never prompts), and the login user comes from the machine record
 * (macOS and Linux users differ).
 *
 * `exec` is injected so tests can fake the SSH layer entirely.
 */

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import type { MachineRecord, MachineSnapshot, WorkspaceSnapshot } from './types'

export type ExecResult = { stdout: string; stderr: string; code: number }

export type ExecLike = (
  command: string,
  args: string[],
  opts: { input?: string; timeoutMs: number },
) => Promise<ExecResult>

export type MachineManagerDeps = {
  /** Local path to the bundled agent file to push. */
  agentPath: string
  execImpl?: ExecLike
  /** Persist SSH host keys here (container mode); default is ssh's own. */
  knownHostsFile?: string
}

export type MachineInstallInput = {
  repo: string
  skillId: string
  scope: 'global' | 'project'
  projectName?: string
}

const AGENT_REMOTE = '~/.skilldex-agent.js'
const HASH_TIMEOUT = 15_000
const PUSH_TIMEOUT = 30_000
const SNAPSHOT_TIMEOUT = 60_000
const INSTALL_TIMEOUT = 300_000

export type MachineManager = {
  /** Push the agent if needed and confirm the machine answers. */
  ping(machine: MachineRecord): Promise<void>
  snapshot(machine: MachineRecord): Promise<MachineSnapshot>
  install(machine: MachineRecord, input: MachineInstallInput): Promise<WorkspaceSnapshot>
  skillOp(machine: MachineRecord, op: 'enable' | 'disable' | 'remove', id: string): Promise<WorkspaceSnapshot>
}

export function createMachineManager({
  agentPath,
  execImpl = spawnExec,
  knownHostsFile,
}: MachineManagerDeps): MachineManager {
  // Machines whose remote agent hash we've already confirmed this process.
  const confirmed = new Map<string, string>()

  function sshArgs(machine: MachineRecord, remoteCommand: string): string[] {
    const options = [
      '-o', 'BatchMode=yes',
      '-o', 'ConnectTimeout=10',
      '-o', 'StrictHostKeyChecking=accept-new',
    ]
    if (knownHostsFile) options.push('-o', `UserKnownHostsFile=${knownHostsFile}`)
    // Single argument so the remote login shell (fish on the arch boxes)
    // hands the whole command to bash unmangled.
    return [...options, `${machine.user}@${machine.host}`, `bash -c '${remoteCommand}'`]
  }

  async function run(
    machine: MachineRecord,
    remoteCommand: string,
    opts: { input?: string; timeoutMs: number },
  ): Promise<ExecResult> {
    return execImpl('ssh', sshArgs(machine, remoteCommand), opts)
  }

  async function ensureAgent(machine: MachineRecord): Promise<void> {
    const agent = await fs.readFile(agentPath, 'utf8')
    const localHash = createHash('sha256').update(agent).digest('hex')
    if (confirmed.get(machine.name) === localHash) return

    const probe = await run(
      machine,
      `sha256sum ${AGENT_REMOTE} 2>/dev/null || shasum -a 256 ${AGENT_REMOTE} 2>/dev/null || echo missing`,
      { timeoutMs: HASH_TIMEOUT },
    )
    if (probe.code !== 0) throw new Error(describeSshFailure(machine, probe))

    const remoteHash = probe.stdout.trim().split(/\s+/)[0]
    if (remoteHash !== localHash) {
      const push = await run(machine, `cat > ${AGENT_REMOTE}`, { input: agent, timeoutMs: PUSH_TIMEOUT })
      if (push.code !== 0) throw new Error(describeSshFailure(machine, push))
    }
    confirmed.set(machine.name, localHash)
  }

  async function agentCall<T>(
    machine: MachineRecord,
    command: string,
    opts: { input?: unknown; timeoutMs: number },
  ): Promise<T> {
    await ensureAgent(machine)
    const result = await run(machine, `node ${AGENT_REMOTE} ${command}`, {
      input: opts.input === undefined ? undefined : JSON.stringify(opts.input),
      timeoutMs: opts.timeoutMs,
    })

    let payload: unknown = null
    try {
      payload = JSON.parse(result.stdout)
    } catch {
      // Fall through to the failure paths below with payload null.
    }

    const errorMessage =
      payload && typeof payload === 'object' && 'error' in payload
        ? String((payload as { error: unknown }).error)
        : null
    if (result.code !== 0) throw new Error(errorMessage ?? describeSshFailure(machine, result))
    if (errorMessage) throw new Error(errorMessage)
    if (payload === null) throw new Error(`${machine.name}: agent returned unparseable output.`)
    return payload as T
  }

  return {
    async ping(machine) {
      await agentCall<{ ok: boolean }>(machine, 'ping', { timeoutMs: HASH_TIMEOUT })
    },

    async snapshot(machine) {
      try {
        const snapshot = await agentCall<WorkspaceSnapshot>(machine, 'snapshot', {
          timeoutMs: SNAPSHOT_TIMEOUT,
        })
        return { machine, snapshot }
      } catch (cause) {
        return { machine, snapshot: null, error: cause instanceof Error ? cause.message : String(cause) }
      }
    },

    install(machine, input) {
      return agentCall<WorkspaceSnapshot>(machine, 'install', { input, timeoutMs: INSTALL_TIMEOUT })
    },

    skillOp(machine, op, id) {
      return agentCall<WorkspaceSnapshot>(machine, op, { input: { id }, timeoutMs: SNAPSHOT_TIMEOUT })
    },
  }
}

function describeSshFailure(machine: MachineRecord, result: ExecResult): string {
  const stderr = result.stderr.trim().split('\n').pop() ?? ''
  return `${machine.name} (${machine.user}@${machine.host}) unreachable: ${stderr || `ssh exited ${result.code}`}`
}

// Default exec: spawn ssh, feed stdin, collect output, kill on timeout.
function spawnExec(
  command: string,
  args: string[],
  { input, timeoutMs }: { input?: string; timeoutMs: number },
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`ssh timed out after ${Math.round(timeoutMs / 1000)}s`))
    }, timeoutMs)

    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
    child.on('error', (cause) => {
      clearTimeout(timer)
      reject(cause)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        code: code ?? 1,
      })
    })

    if (input !== undefined) child.stdin.write(input)
    child.stdin.end()
  })
}
