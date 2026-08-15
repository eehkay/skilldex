/**
 * The library ledger — which skills were imported from where, pinned at what
 * version, and which machines they're syndicated to. Keyed by the skill's
 * canonical folder name under `~/.claude/skills`.
 *
 * Same shape and guarantees as the config store: injected path, atomic
 * writes, tolerant loads. The skill folders themselves stay the source of
 * truth for content; this file only carries what a folder can't — provenance
 * and desired placement.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import type { LibrarySkillMeta, SyndicationTarget } from './types'

export type LibraryStore = {
  load(): Promise<Record<string, LibrarySkillMeta>>
  /** Merge-set one entry (null removes it). Returns the updated ledger. */
  set(name: string, meta: LibrarySkillMeta | null): Promise<Record<string, LibrarySkillMeta>>
}

export function createLibraryStore(filePath: string): LibraryStore {
  async function load(): Promise<Record<string, LibrarySkillMeta>> {
    try {
      const raw = JSON.parse(await fs.readFile(filePath, 'utf8')) as { skills?: unknown }
      return normalize(raw.skills)
    } catch {
      return {}
    }
  }

  return {
    load,
    async set(name, meta) {
      const skills = await load()
      if (meta === null) delete skills[name]
      else skills[name] = meta
      await fs.mkdir(path.dirname(filePath), { recursive: true })
      const tmp = `${filePath}.${process.pid}.tmp`
      await fs.writeFile(tmp, JSON.stringify({ skills }, null, 2), 'utf8')
      await fs.rename(tmp, filePath)
      return skills
    },
  }
}

/** An in-memory store for tests and callers that don't persist a library. */
export function createMemoryLibraryStore(): LibraryStore {
  let skills: Record<string, LibrarySkillMeta> = {}
  return {
    load: async () => ({ ...skills }),
    set: async (name, meta) => {
      if (meta === null) delete skills[name]
      else skills[name] = meta
      return { ...skills }
    },
  }
}

function normalize(value: unknown): Record<string, LibrarySkillMeta> {
  if (typeof value !== 'object' || value === null) return {}
  const result: Record<string, LibrarySkillMeta> = {}
  for (const [name, meta] of Object.entries(value as Record<string, unknown>)) {
    if (typeof meta !== 'object' || meta === null) continue
    const entry = meta as Partial<LibrarySkillMeta>
    if (typeof entry.repo !== 'string' || typeof entry.ref !== 'string') continue
    result[name] = {
      repo: entry.repo,
      path: typeof entry.path === 'string' ? entry.path : '',
      ref: entry.ref,
      targets: Array.isArray(entry.targets)
        ? entry.targets.filter(
            (target): target is SyndicationTarget =>
              typeof target === 'object' &&
              target !== null &&
              typeof (target as { machine?: unknown }).machine === 'string' &&
              ((target as { scope?: unknown }).scope === 'global' ||
                (target as { scope?: unknown }).scope === 'project'),
          )
        : [],
    }
  }
  return result
}
