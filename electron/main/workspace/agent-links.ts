/**
 * Cross-agent skill directories, reconciled by symlink.
 *
 * The SKILL.md format is shared across coding agents, but each one reads its
 * own directory layout: Claude Code (and OpenCode, which reads Claude's paths
 * too) use `.claude/skills`, Codex CLI uses `.codex/skills`. Rather than
 * copying skills per agent, `.claude/skills` stays the single canonical copy
 * and every other enabled agent gets a relative symlink per skill.
 *
 * `syncAgentLinks` is a full reconciliation, safe to run any time: it links
 * every enabled canonical skill into each enabled agent's directory, and
 * removes stale links (skill disabled, removed, or the agent toggled off).
 * It only ever deletes symlinks that point into the sibling `.claude/skills`
 * — a real directory a user created inside `.codex/skills` is never touched.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { DISABLED_DIR } from './skill-manager'
import type { SkillAgent } from './types'

/** Per-agent skills directory, relative to the same base as `.claude/skills`. */
const AGENT_DIRS: Record<Exclude<SkillAgent, 'claude'>, string[]> = {
  codex: ['.codex', 'skills'],
}

/**
 * Reconcile agent skill directories under every base that has a canonical
 * `.claude/skills` (the home directory and each project directory).
 * Returns human-readable errors instead of throwing — link maintenance must
 * never break a scan.
 */
export async function syncAgentLinks(
  bases: string[],
  agents: SkillAgent[],
): Promise<string[]> {
  const errors: string[] = []
  for (const base of bases) {
    for (const [agent, dirSegments] of Object.entries(AGENT_DIRS)) {
      const canonical = path.join(base, '.claude', 'skills')
      const agentDir = path.join(base, ...dirSegments)
      const enabled = agents.includes(agent as SkillAgent)
      try {
        await syncOne(canonical, agentDir, enabled)
      } catch (cause) {
        errors.push(`${agent} links (${agentDir}): ${cause instanceof Error ? cause.message : String(cause)}`)
      }
    }
  }
  return errors
}

async function syncOne(canonical: string, agentDir: string, enabled: boolean): Promise<void> {
  const desired = enabled ? await enabledSkillDirs(canonical) : new Set<string>()

  // Ensure a link per enabled canonical skill.
  if (desired.size > 0) await fs.mkdir(agentDir, { recursive: true })
  for (const name of desired) {
    const link = path.join(agentDir, name)
    const existing = await fs.lstat(link).catch(() => null)
    if (existing) continue // already linked, or a real dir we must not clobber
    await fs.symlink(path.relative(agentDir, path.join(canonical, name)), link)
  }

  // Drop stale links that point into the canonical root but are no longer wanted.
  const entries = await fs.readdir(agentDir).catch(() => [] as string[])
  for (const entry of entries) {
    if (desired.has(entry)) continue
    const link = path.join(agentDir, entry)
    const stat = await fs.lstat(link).catch(() => null)
    if (!stat?.isSymbolicLink()) continue
    const target = path.resolve(agentDir, await fs.readlink(link))
    if (target.startsWith(canonical + path.sep)) await fs.unlink(link)
  }
}

/** Names of enabled skill folders (contain a SKILL.md, not under `.disabled/`). */
async function enabledSkillDirs(canonical: string): Promise<Set<string>> {
  const names = new Set<string>()
  const entries = await fs.readdir(canonical, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (entry.name === DISABLED_DIR) continue
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
    const hasManifest = await fs
      .access(path.join(canonical, entry.name, 'SKILL.md'))
      .then(() => true)
      .catch(() => false)
    if (hasManifest) names.add(entry.name)
  }
  return names
}
