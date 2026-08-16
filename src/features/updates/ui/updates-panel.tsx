import { useEffect, useState } from 'react'
import { ArrowUpCircle, Check, GitCommitHorizontal, Loader2, RefreshCw, Server, X } from 'lucide-react'
import { shortRef, type CheckUpdatesResult, type SkillUpdate } from '@/features/skills/model/skills'

type UpdatesPanelProps = {
  open: boolean
  onClose: () => void
  checkUpdates: () => Promise<CheckUpdatesResult | null>
  applyUpdates: (skillIds?: string[]) => Promise<{
    updated: string[]
    failed: Record<string, string>
    repushed: Record<string, { ok: string[]; failed: Record<string, string> }>
  } | null>
}

/**
 * Upstream updates for repo-pinned library skills. Checking re-scans every
 * tracked repo and diffs each skill's folder between the pinned and current
 * commits, so the list only shows skills whose files actually changed.
 * Applying re-downloads at the new commit, re-pins, and re-pushes to every
 * machine the skill is syndicated to.
 */
export function UpdatesPanel({ open, onClose, checkUpdates, applyUpdates }: UpdatesPanelProps) {
  const [result, setResult] = useState<CheckUpdatesResult | null>(null)
  const [checking, setChecking] = useState(false)
  const [applying, setApplying] = useState<Set<string> | 'all' | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [report, setReport] = useState<string | null>(null)

  const check = async () => {
    setChecking(true)
    setReport(null)
    try {
      const next = await checkUpdates()
      setResult(next)
      setSelected(new Set(next?.updates.map((update) => update.skillId) ?? []))
    } finally {
      setChecking(false)
    }
  }

  useEffect(() => {
    if (open) void check()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!open) return null

  const apply = async (ids?: string[]) => {
    setApplying(ids ? new Set(ids) : 'all')
    setReport(null)
    try {
      const outcome = await applyUpdates(ids)
      if (outcome) {
        const failedCount = Object.keys(outcome.failed).length
        const repushFailures = Object.values(outcome.repushed).reduce((sum, r) => sum + Object.keys(r.failed).length, 0)
        setReport(
          `Updated ${outcome.updated.length}` +
            (failedCount ? `, ${failedCount} failed` : '') +
            (repushFailures ? `, ${repushFailures} machine re-push${repushFailures === 1 ? '' : 'es'} failed — see Logs` : '') +
            '.',
        )
      }
      await check()
    } catch (cause) {
      setReport(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setApplying(null)
    }
  }

  const updates = result?.updates ?? []
  const busy = checking || applying !== null

  return (
    <div onClick={onClose} className="absolute inset-0 z-20 flex items-center justify-center bg-black/60 backdrop-blur-[3px]">
      <div
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[82vh] w-[680px] flex-col overflow-hidden rounded-2xl border border-[#2a2a30] bg-[#111114] shadow-[0_40px_100px_-20px_rgba(0,0,0,.9)]"
      >
        <div className="flex items-start justify-between px-6 pb-4 pt-5">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold text-[#fafafa]">
              <ArrowUpCircle className="size-5 text-[#fb923c]" />
              Updates
            </h2>
            <p className="mt-1 text-[13px] text-[#71717a]">
              Library skills pinned to a repo commit that has since changed under that skill's folder.
              {result && ` Checked ${result.checked} pinned skill${result.checked === 1 ? '' : 's'}.`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void check()}
              disabled={busy}
              className="flex h-8 items-center gap-1.5 rounded-[9px] border border-[#27272a] bg-[#18181b] px-3 text-[12.5px] font-medium text-[#e4e4e7] transition hover:border-[#3a3a42] disabled:opacity-60"
            >
              <RefreshCw className={`size-3.5 ${checking ? 'animate-spin' : ''}`} />
              Check again
            </button>
            <button type="button" onClick={onClose} aria-label="Close" className="grid size-8 place-items-center rounded-lg text-[#71717a] transition hover:bg-[#1c1c20]">
              <X className="size-4" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-5">
          {report && (
            <div className="mb-3 rounded-xl border border-[#27272a] bg-[#0c0c0e] px-4 py-3 text-[13px] text-[#a1a1aa]">{report}</div>
          )}
          {result && Object.keys(result.errors).length > 0 && (
            <div className="mb-3 rounded-xl border border-[#3f2020] bg-[#1a0f0f] px-4 py-3 text-[12.5px] text-[#f87171]">
              {Object.entries(result.errors).map(([key, message]) => (
                <div key={key}>
                  <span className="font-mono">{key}</span>: {message}
                </div>
              ))}
            </div>
          )}
          {checking && !result ? (
            <div className="flex items-center gap-2 py-10 text-[13px] text-[#71717a]">
              <Loader2 className="size-4 animate-spin" /> Re-scanning repos and comparing pinned commits…
            </div>
          ) : updates.length === 0 ? (
            <div className="flex items-center gap-2 rounded-xl border border-[#1f3a24] bg-[#0f1a11] px-4 py-6 text-[13px] text-[#4ade80]">
              <Check className="size-4" /> Everything is up to date.
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-[#1c1c20] bg-[#0c0c0e]">
              {updates.map((update) => (
                <UpdateRow
                  key={update.skillId}
                  update={update}
                  checked={selected.has(update.skillId)}
                  applying={applying === 'all' || (applying instanceof Set && applying.has(update.skillId))}
                  disabled={busy}
                  onToggle={() =>
                    setSelected((current) => {
                      const next = new Set(current)
                      if (next.has(update.skillId)) next.delete(update.skillId)
                      else next.add(update.skillId)
                      return next
                    })
                  }
                  onUpdate={() => void apply([update.skillId])}
                />
              ))}
            </div>
          )}
        </div>

        {updates.length > 0 && (
          <div className="flex items-center justify-between border-t border-[#1c1c20] bg-[#0c0c0e] px-6 py-4">
            <span className="text-[12px] text-[#71717a]">
              Local edits to a skill are overwritten by an update. Syndicated machines are re-pushed automatically.
            </span>
            <button
              type="button"
              onClick={() => void apply([...selected])}
              disabled={busy || selected.size === 0}
              className={`flex h-9 items-center gap-1.5 rounded-[9px] bg-[#f97316] px-4 text-[13px] font-semibold text-white transition ${
                busy || selected.size === 0 ? 'cursor-not-allowed opacity-60' : 'hover:bg-[#ea580c]'
              }`}
            >
              {applying === 'all' || (applying instanceof Set && applying.size > 1) ? <Loader2 className="size-3.5 animate-spin" /> : <ArrowUpCircle className="size-3.5" />}
              Update {selected.size === updates.length ? 'all' : selected.size}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function UpdateRow({
  update,
  checked,
  applying,
  disabled,
  onToggle,
  onUpdate,
}: {
  update: SkillUpdate
  checked: boolean
  applying: boolean
  disabled: boolean
  onToggle: () => void
  onUpdate: () => void
}) {
  const [showFiles, setShowFiles] = useState(false)
  return (
    <div className="border-b border-[#17171a] px-4 py-3 last:border-b-0">
      <div className="flex items-start gap-3">
        <input type="checkbox" checked={checked} disabled={disabled} onChange={onToggle} className="mt-1 size-3.5 shrink-0 accent-[#f97316]" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[13.5px] font-semibold text-[#fafafa]">{update.dirName}</span>
            <span className="truncate font-mono text-[11px] text-[#52525b]">{update.repo}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-[#a1a1aa]">
            <span className="flex items-center gap-1 font-mono">
              <GitCommitHorizontal className="size-3 text-[#52525b]" />
              {shortRef(update.fromRef)} → <span className="text-[#fb923c]">{shortRef(update.toRef)}</span>
            </span>
            <button type="button" onClick={() => setShowFiles((v) => !v)} className="text-[#71717a] underline-offset-2 hover:text-[#e4e4e7] hover:underline">
              {update.changedFiles.length} file{update.changedFiles.length === 1 ? '' : 's'} changed
            </button>
            {update.targets > 0 && (
              <span className="flex items-center gap-1 text-[#71717a]">
                <Server className="size-3" /> re-push to {update.targets} machine{update.targets === 1 ? '' : 's'}
              </span>
            )}
          </div>
          {showFiles && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {update.changedFiles.map((file) => (
                <span key={file} className="rounded-md border border-[#1f1f24] bg-[#111114] px-1.5 py-0.5 font-mono text-[11px] text-[#a1a1aa]">{file}</span>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onUpdate}
          disabled={disabled}
          className="flex h-8 shrink-0 items-center gap-1.5 rounded-[9px] border border-[#27272a] bg-[#18181b] px-3 text-[12px] font-medium text-[#e4e4e7] transition hover:border-[#3a3a42] disabled:opacity-60"
        >
          {applying ? <Loader2 className="size-3.5 animate-spin" /> : <ArrowUpCircle className="size-3.5" />}
          Update
        </button>
      </div>
    </div>
  )
}
