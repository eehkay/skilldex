import { useState } from 'react'
import { Check, ExternalLink, Link2, Loader2, Search } from 'lucide-react'
import { shortRef, type OriginCandidate, type Skill } from '../model/skills'

type OriginFinderPanelProps = {
  skill: Skill
  findOrigin: (id: string) => Promise<OriginCandidate[]>
  onLink: (origin: { repo: string; path: string; ref: string }) => Promise<void>
}

const CONFIDENCE_STYLE: Record<OriginCandidate['confidence'], { label: string; cls: string }> = {
  exact: { label: 'Exact match', cls: 'text-[#4ade80] border-[#1f3a24] bg-[#0f1a11]' },
  likely: { label: 'Likely (local edits)', cls: 'text-[#fb923c] border-[#4a2a10] bg-[#2a1709]' },
  'name-only': { label: 'Name only', cls: 'text-[#a1a1aa] border-[#2e2e34] bg-[#1a1a1e]' },
}

/**
 * For a library skill with no repo pin: search tracked repos for where it
 * came from, ranked by how well the SKILL.md matches, and let the user link
 * it — which pins the skill so it becomes updatable. Nothing is auto-linked;
 * even an exact match is a suggestion until clicked.
 */
export function OriginFinderPanel({ skill, findOrigin, onLink }: OriginFinderPanelProps) {
  const [candidates, setCandidates] = useState<OriginCandidate[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [linking, setLinking] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const search = async () => {
    setSearching(true)
    setError(null)
    try {
      setCandidates(await findOrigin(skill.id))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSearching(false)
    }
  }

  const link = async (candidate: OriginCandidate) => {
    const key = `${candidate.repo}:${candidate.path}`
    setLinking(key)
    setError(null)
    try {
      await onLink({ repo: candidate.repo, path: candidate.path, ref: candidate.ref })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLinking(null)
    }
  }

  return (
    <>
      <div className="mb-2.5 mt-5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#52525b]">Origin</div>
      <div className="rounded-[9px] border border-[#1c1c20] bg-[#0c0c0e] px-3 py-2.5">
        <div className="text-[12px] leading-relaxed text-[#71717a]">
          {skill.library?.adoptedFrom
            ? `Adopted from ${skill.library.adoptedFrom} with no repo pin, so it can't receive updates.`
            : 'No repo pin, so this skill can’t receive updates.'}{' '}
          Search your tracked repos for where it came from.
        </div>
        <button
          type="button"
          onClick={() => void search()}
          disabled={searching}
          className="mt-2.5 flex h-8 w-full items-center justify-center gap-1.5 rounded-[9px] border border-[#27272a] bg-[#18181b] text-[12.5px] font-medium text-[#e4e4e7] transition hover:border-[#3a3a42] disabled:opacity-60"
        >
          {searching ? <Loader2 className="size-3.5 animate-spin" /> : <Search className="size-3.5" />}
          {candidates === null ? 'Find origin' : 'Search again'}
        </button>
        {error && <p className="mt-2 text-[12px] text-[#f87171]">{error}</p>}
        {candidates !== null && candidates.length === 0 && (
          <p className="mt-2.5 text-[12px] text-[#71717a]">No matching skill in your tracked repos. Add the repo it came from and search again.</p>
        )}
        {candidates && candidates.length > 0 && (
          <div className="mt-2.5 flex flex-col gap-1.5">
            {candidates.map((candidate) => {
              const key = `${candidate.repo}:${candidate.path}`
              const style = CONFIDENCE_STYLE[candidate.confidence]
              return (
                <div key={key} className="rounded-[9px] border border-[#1f1f24] bg-[#111114] px-2.5 py-2">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-[#e4e4e7]">{candidate.repo}</span>
                    <span className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[10.5px] font-semibold ${style.cls}`}>{style.label}</span>
                  </div>
                  <div className="mt-1 text-[11.5px] leading-snug text-[#71717a]">{candidate.reason}</div>
                  <div className="mt-2 flex items-center gap-2">
                    <a
                      href={candidate.webUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1 text-[11.5px] text-[#71717a] hover:text-[#e4e4e7]"
                    >
                      <ExternalLink className="size-3" /> view @ {shortRef(candidate.ref)}
                    </a>
                    <div className="flex-1" />
                    <button
                      type="button"
                      onClick={() => void link(candidate)}
                      disabled={linking !== null}
                      className={`flex h-7 items-center gap-1.5 rounded-[8px] px-2.5 text-[12px] font-semibold transition ${
                        candidate.confidence === 'exact'
                          ? 'bg-[#f97316] text-white hover:bg-[#ea580c]'
                          : 'border border-[#27272a] bg-[#18181b] text-[#e4e4e7] hover:border-[#3a3a42]'
                      } disabled:opacity-60`}
                    >
                      {linking === key ? <Loader2 className="size-3.5 animate-spin" /> : <Link2 className="size-3.5" />}
                      Link
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
        {skill.library?.repo && (
          <div className="mt-2 flex items-center gap-1.5 text-[12px] text-[#4ade80]">
            <Check className="size-3.5" /> Linked to {skill.library.repo}
          </div>
        )}
      </div>
    </>
  )
}
