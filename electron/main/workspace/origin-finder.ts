/**
 * Find where an orphaned library skill came from.
 *
 * Adopted and hand-authored skills have no repo pin, so they can't be updated
 * from upstream. Many actually did come from a tracked repo — the provenance
 * just got lost along the way (wiped lock files, copied folders). This module
 * recovers it conservatively:
 *
 *  1. Candidates: catalog skills in tracked repos with the same folder name.
 *  2. Verification: fetch the candidate's SKILL.md at the catalog's commit and
 *     compare it with the local one. Byte-identical → high confidence; same
 *     frontmatter name+description but different body → the origin is almost
 *     certainly right but the local copy has edits ("likely"); name-only →
 *     low confidence, offered but never auto-linked.
 *
 * Pure over injected inputs (catalogs, a fetch, local file contents), so it
 * tests against fakes like everything else here.
 */

import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { parseFrontmatter } from './frontmatter'
import type { FetchLike, RepoScan } from './repo-catalog'

export type OriginConfidence = 'exact' | 'likely' | 'name-only'

export type OriginCandidate = {
  repo: string
  /** Directory within the repo. */
  path: string
  /** Commit sha (or ref) the catalog was scanned at. */
  ref: string
  webUrl: string
  confidence: OriginConfidence
  /** Human explanation shown next to the suggestion. */
  reason: string
}

const RAW = 'https://raw.githubusercontent.com'

function sha256(text: string): string {
  return createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex')
}

async function readLocalSkillMd(skillDir: string): Promise<string | null> {
  try {
    return await fs.readFile(path.join(skillDir, 'SKILL.md'), 'utf8')
  } catch {
    return null
  }
}

/**
 * Rank origin candidates for one local skill folder. `scans` is the set of
 * tracked repo catalogs (with their pinned commit shas). Never throws — a
 * fetch failure just downgrades that candidate to name-only.
 */
export async function findOriginCandidates(
  skillDir: string,
  scans: RepoScan[],
  fetchImpl: FetchLike,
): Promise<OriginCandidate[]> {
  const dirName = path.basename(skillDir)
  const local = await readLocalSkillMd(skillDir)
  const localHash = local === null ? null : sha256(local)
  const localMeta = local === null ? null : parseFrontmatter(local)

  const candidates: OriginCandidate[] = []
  for (const scan of scans) {
    const ref = scan.catalog.commitSha ?? scan.catalog.ref
    for (const skill of scan.catalog.skills) {
      const candidateDir = skill.path ? path.posix.basename(skill.path) : skill.name
      if (candidateDir !== dirName && skill.name !== dirName) continue

      let confidence: OriginConfidence = 'name-only'
      let reason = `Same folder name in ${scan.catalog.slug}`
      if (localHash) {
        try {
          const encoded = (skill.path ? `${skill.path}/SKILL.md` : 'SKILL.md').split('/').map(encodeURIComponent).join('/')
          const response = await fetchImpl(`${RAW}/${scan.catalog.slug}/${encodeURIComponent(ref)}/${encoded}`, {
            headers: { 'User-Agent': 'skilldex' },
          })
          if (response.ok) {
            const remote = Buffer.from(await response.arrayBuffer()).toString('utf8')
            if (sha256(remote) === localHash) {
              confidence = 'exact'
              reason = `SKILL.md is byte-identical to ${scan.catalog.slug} @ ${ref.slice(0, 7)}`
            } else {
              const remoteMeta = parseFrontmatter(remote)
              if (
                localMeta &&
                remoteMeta.name === localMeta.name &&
                (remoteMeta.description ?? '') === (localMeta.description ?? '')
              ) {
                confidence = 'likely'
                reason = `Same name and description as ${scan.catalog.slug}; local body differs (edited?)`
              }
            }
          }
        } catch {
          // keep name-only
        }
      }
      candidates.push({ repo: scan.catalog.slug, path: skill.path, ref, webUrl: skill.webUrl, confidence, reason })
    }
  }

  const rank: Record<OriginConfidence, number> = { exact: 0, likely: 1, 'name-only': 2 }
  return candidates.sort((a, b) => rank[a.confidence] - rank[b.confidence])
}
