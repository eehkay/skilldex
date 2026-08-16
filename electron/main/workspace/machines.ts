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
import os from 'node:os'
import { logger } from './log'
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
  /**
   * This host's own name/user, for self-detection (injected in tests).
   * A machine record matching both runs through local bash instead of SSH —
   * SSH-to-self bypasses the Tailscale tunnel and would hit the keyless
   * OpenSSH daemon, so a hub hosted on a dev machine manages that machine
   * directly.
   */
  selfHost?: string
  selfUser?: string
}

export type MachineInstallInput = {
  repo: string
  skillId: string
  scope: 'global' | 'project'
  projectName?: string
  /** Pinned ref (library version); the machine downloads exactly this. */
  ref?: string
}

export type MachineUninstallInput = {
  /** Skill folder name under the target scope's skills root. */
  dirName: string
  scope: 'global' | 'project'
  projectName?: string
}

export type MachineSetEnabledInput = MachineUninstallInput & { enabled: boolean }

/** A skill's files as shipped back by the agent's read-skill command. */
export type MachineSkillFiles = {
  skill: import('./types').SkillRecord
  files: Array<{ path: string; base64: string }>
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
  uninstall(machine: MachineRecord, input: MachineUninstallInput): Promise<WorkspaceSnapshot>
  /** Enable/disable a skill by folder name (idempotent). */
  setEnabled(machine: MachineRecord, input: MachineSetEnabledInput): Promise<WorkspaceSnapshot>
  /** Read a machine skill's files (for adopting it into the library). */
  readSkill(machine: MachineRecord, id: string): Promise<MachineSkillFiles>
  /** Write a skill's files onto a machine (global scope; refuses to overwrite). */
  writeSkill(
    machine: MachineRecord,
    input: { dirName: string; files: Array<{ path: string; base64: string }> },
  ): Promise<WorkspaceSnapshot>
  skillOp(machine: MachineRecord, op: 'enable' | 'disable' | 'remove', id: string): Promise<WorkspaceSnapshot>
  /** Does this record point at the host we're running on, as our user (local bash, no SSH)? */
  isSelf(machine: MachineRecord): boolean
}

export function createMachineManager({
  agentPath,
  execImpl = spawnExec,
  knownHostsFile,
  selfHost = os.hostname(),
  selfUser = safeUsername(),
}: MachineManagerDeps): MachineManager {
  /** Does this record point at the very host we're running on, as our user? */
  function isSelf(machine: MachineRecord): boolean {
    const host = machine.host.split('.')[0].toLowerCase()
    return host === selfHost.split('.')[0].toLowerCase() && machine.user === selfUser
  }
  // Hosts whose remote agent hash we've already confirmed this process.
  // Keyed by login target, not display name: renaming a machine keeps the
  // confirmation, while pointing a name at a new host forces a re-probe.
  const confirmed = new Map<string, string>()
  const confirmKey = (machine: MachineRecord) => `${machine.user}@${machine.host}`

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
    const started = Date.now()
    const local = isSelf(machine)
    // Summarize the command for logs without dumping agent payloads/stdin.
    const summary = remoteCommand.replace(/\s+/g, ' ').slice(0, 120)
    let result: ExecResult
    try {
      // Managing the host we run on: same commands, local bash, no SSH.
      result = local
        ? await execImpl('bash', ['-c', remoteCommand], opts)
        : await execImpl('ssh', sshArgs(machine, remoteCommand), opts)
    } catch (cause) {
      logger.error('machine.exec.error', {
        machine: machine.name, target: `${machine.user}@${machine.host}`, transport: local ? 'local' : 'ssh',
        command: summary, ms: Date.now() - started, error: cause instanceof Error ? cause.message : String(cause),
      })
      throw cause
    }
    const fields = {
      machine: machine.name, target: `${machine.user}@${machine.host}`, transport: local ? 'local' : 'ssh',
      command: summary, code: result.code, ms: Date.now() - started,
      stdoutBytes: result.stdout.length, inputBytes: opts.input?.length ?? 0,
    }
    if (result.code === 0) logger.debug('machine.exec', fields)
    else logger.warn('machine.exec.nonzero', { ...fields, stderr: result.stderr.trim().split('\n').slice(-3).join(' | ').slice(0, 300) })
    return result
  }

  async function ensureAgent(machine: MachineRecord): Promise<void> {
    const agent = await fs.readFile(agentPath, 'utf8')
    const localHash = createHash('sha256').update(agent).digest('hex')
    if (confirmed.get(confirmKey(machine)) === localHash) return

    const probe = await run(
      machine,
      `sha256sum ${AGENT_REMOTE} 2>/dev/null || shasum -a 256 ${AGENT_REMOTE} 2>/dev/null || echo missing`,
      { timeoutMs: HASH_TIMEOUT },
    )
    if (probe.code !== 0) throw new Error(describeSshFailure(machine, probe))

    const remoteHash = probe.stdout.trim().split(/\s+/)[0]
    if (remoteHash !== localHash) {
      logger.info('machine.agent.push', { machine: machine.name, reason: remoteHash === 'missing' ? 'missing' : 'stale', bytes: agent.length })
      const push = await run(machine, `cat > ${AGENT_REMOTE}`, { input: agent, timeoutMs: PUSH_TIMEOUT })
      if (push.code !== 0) throw new Error(describeSshFailure(machine, push))
    } else {
      logger.debug('machine.agent.current', { machine: machine.name })
    }
    confirmed.set(confirmKey(machine), localHash)
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
    if (result.code !== 0) {
      logger.warn('machine.agent.fail', { machine: machine.name, command, code: result.code, error: errorMessage ?? undefined })
      throw new Error(errorMessage ?? describeSshFailure(machine, result))
    }
    if (errorMessage) {
      logger.warn('machine.agent.error', { machine: machine.name, command, error: errorMessage })
      throw new Error(errorMessage)
    }
    if (payload === null) {
      logger.error('machine.agent.unparseable', { machine: machine.name, command, stdoutHead: result.stdout.slice(0, 200) })
      throw new Error(`${machine.name}: agent returned unparseable output.`)
    }
    return payload as T
  }

  return {
    isSelf,

    async ping(machine) {
      await agentCall<{ ok: boolean }>(machine, 'ping', { timeoutMs: HASH_TIMEOUT })
    },

    async snapshot(machine) {
      try {
        const snapshot = await agentCall<WorkspaceSnapshot>(machine, 'snapshot', {
          timeoutMs: SNAPSHOT_TIMEOUT,
        })
        const personal = snapshot.skills.filter((skill) => skill.sourceKind === 'Personal').length
        logger.info('machine.snapshot', {
          machine: machine.name, skills: snapshot.skills.length, personal,
          projects: snapshot.projects.length, scanErrors: snapshot.errors.length,
          symlinked: snapshot.skills.filter((skill) => skill.isSymlink).length,
        })
        if (snapshot.errors.length) logger.warn('machine.snapshot.scanErrors', { machine: machine.name, errors: snapshot.errors.slice(0, 5) })
        return { machine, snapshot }
      } catch (cause) {
        logger.warn('machine.snapshot.unreachable', { machine: machine.name, error: cause instanceof Error ? cause.message : String(cause) })
        return { machine, snapshot: null, error: cause instanceof Error ? cause.message : String(cause) }
      }
    },

    install(machine, input) {
      return agentCall<WorkspaceSnapshot>(machine, 'install', { input, timeoutMs: INSTALL_TIMEOUT })
    },

    uninstall(machine, input) {
      return agentCall<WorkspaceSnapshot>(machine, 'uninstall', { input, timeoutMs: SNAPSHOT_TIMEOUT })
    },

    setEnabled(machine, input) {
      return agentCall<WorkspaceSnapshot>(machine, 'set-enabled', { input, timeoutMs: SNAPSHOT_TIMEOUT })
    },

    readSkill(machine, id) {
      return agentCall<MachineSkillFiles>(machine, 'read-skill', { input: { id }, timeoutMs: INSTALL_TIMEOUT })
    },

    writeSkill(machine, input) {
      return agentCall<WorkspaceSnapshot>(machine, 'write-skill', { input, timeoutMs: INSTALL_TIMEOUT })
    },

    skillOp(machine, op, id) {
      return agentCall<WorkspaceSnapshot>(machine, op, { input: { id }, timeoutMs: SNAPSHOT_TIMEOUT })
    },
  }
}

/** os.userInfo() throws on some containers without a passwd entry. */
function safeUsername(): string {
  try {
    return os.userInfo().username
  } catch {
    return process.env.USER ?? ''
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
