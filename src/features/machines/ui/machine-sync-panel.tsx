import { useEffect, useMemo, useState } from 'react'
import { ArrowDownToLine, ArrowUpFromLine, Check, Eraser, Loader2, RefreshCw } from 'lucide-react'
import { CATEGORY_LABELS, CATEGORY_ORDER, dirNameOf as dirNameOfPath, type MachineDiff, type SkillCategory, type SkillRecord } from '@/features/skills/model/skills'

type MachineSyncPanelProps = {
  machineName: string
  loadDiff: (name: string) => Promise<MachineDiff | null>
  onAdopt: (skillIds: string[]) => Promise<{ adopted: string[]; failed: Record<string, string> } | null>
  onConverge: (dirNames: string[]) => Promise<{ installed: string[]; failed: Record<string, string> } | null>
  onClear: () => Promise<{ removed: string[]; failed: Record<string, string>; kept: string[] } | null>
}

/**
 * The two-way diff between a machine and the library: adopt what only the
 * machine has, install what only the library has. Both flows are bulk-first
 * — this is the onboarding surface for a machine, in either direction.
 */
export function MachineSyncPanel({ machineName, loadDiff, onAdopt, onConverge, onClear }: MachineSyncPanelProps) {
  const [diff, setDiff] = useState<MachineDiff | null>(null)
  const [loading, setLoading] = useState(true)
  const [adoptSel, setAdoptSel] = useState<Set<string>>(new Set())
  const [installSel, setInstallSel] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<'adopt' | 'install' | 'clear' | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const [report, setReport] = useState<string | null>(null)
  const [failures, setFailures] = useState<Record<string, string>>({})

  // Reloading the diff must not erase the report an action just set — the
  // actions call refresh() right after setReport(); only a machine switch
  // (the effect below) starts with a clean slate.
  const refresh = async ({ keepReport = false }: { keepReport?: boolean } = {}) => {
    setLoading(true)
    if (!keepReport) setReport(null)
    try {
      const next = await loadDiff(machineName)
      setDiff(next)
      // Default to everything selected: onboarding wants "all" one click away.
      setAdoptSel(new Set(next?.onlyOnMachine.map((skill) => skill.id) ?? []))
      setInstallSel(new Set(next?.onlyInLibrary.map(dirNameOf) ?? []))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machineName])

  const toggle = (set: Set<string>, setter: (next: Set<string>) => void, key: string) => {
    const next = new Set(set)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setter(next)
  }

  const runAdopt = async () => {
    if (adoptSel.size === 0) return
    setBusy('adopt')
    setFailures({})
    try {
      const result = await onAdopt([...adoptSel])
      if (result) {
        setReport(`Adopted ${result.adopted.length} into the library${Object.keys(result.failed).length ? `, ${Object.keys(result.failed).length} failed` : ''}.`)
        setFailures(result.failed)
      }
      await refresh({ keepReport: true })
    } catch (cause) {
      setReport(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(null)
    }
  }

  const runInstall = async () => {
    if (installSel.size === 0) return
    setBusy('install')
    setFailures({})
    try {
      const result = await onConverge([...installSel])
      if (result) {
        setReport(`Installed ${result.installed.length} on ${machineName}${Object.keys(result.failed).length ? `, ${Object.keys(result.failed).length} failed` : ''}.`)
        setFailures(result.failed)
      }
      await refresh({ keepReport: true })
    } catch (cause) {
      setReport(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(null)
    }
  }

  const runClear = async () => {
    setConfirmClear(false)
    setBusy('clear')
    setFailures({})
    try {
      const result = await onClear()
      if (result) {
        const parts = [`Removed ${result.removed.length} from ${machineName}`]
        if (result.kept.length) parts.push(`kept ${result.kept.length} the library has no copy of`)
        if (Object.keys(result.failed).length) parts.push(`${Object.keys(result.failed).length} failed`)
        setReport(parts.join(', ') + '. Bring skills back selectively from the list below.')
        setFailures(result.failed)
      }
      await refresh({ keepReport: true })
    } catch (cause) {
      setReport(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(null)
    }
  }

  if (loading && !diff) {
    return (
      <div className="flex items-center gap-2 text-[13px] text-[#71717a]">
        <Loader2 className="size-4 animate-spin" /> Comparing {machineName} with your library…
      </div>
    )
  }
  if (!diff) return null
  if (diff.error) {
    return <div className="rounded-xl border border-[#3f2020] bg-[#1a0f0f] px-4 py-3 text-[13px] text-[#f87171]">{diff.error}</div>
  }

  const allSynced = diff.onlyOnMachine.length === 0 && diff.onlyInLibrary.length === 0

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-[#71717a]">
          <span className="text-[#e4e4e7]">{diff.inSync}</span> in sync
          {diff.onlyOnMachine.length > 0 && <> · <span className="text-[#fb923c]">{diff.onlyOnMachine.length}</span> only here</>}
          {diff.onlyInLibrary.length > 0 && <> · <span className="text-[#38bdf8]">{diff.onlyInLibrary.length}</span> missing from this machine</>}
        </p>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading || busy !== null}
          className="flex h-8 items-center gap-1.5 rounded-[9px] border border-[#27272a] bg-[#18181b] px-3 text-[12px] font-medium text-[#e4e4e7] transition hover:border-[#3a3a42] disabled:opacity-60"
        >
          <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
          Recompare
        </button>
      </div>

      {report && (
        <div className="rounded-xl border border-[#27272a] bg-[#111114] px-4 py-3 text-[13px] text-[#a1a1aa]">
          {report}
          {Object.entries(failures).map(([name, message]) => (
            <div key={name} className="mt-1 text-[12px] text-[#f87171]">
              {name}: {message}
            </div>
          ))}
        </div>
      )}

      {allSynced && (
        <div className="flex items-center gap-2 rounded-xl border border-[#1f3a24] bg-[#0f1a11] px-4 py-3 text-[13px] text-[#4ade80]">
          <Check className="size-4" /> {machineName} and your library match.
        </div>
      )}

      {diff.inSync > 0 && (
        <section className="rounded-[13px] border border-[#232328] bg-[#101013]">
          <div className="flex items-start justify-between gap-4 px-4 py-3">
            <div>
              <div className="text-[13.5px] font-semibold text-[#fafafa]">Start clean</div>
              <div className="mt-0.5 text-[12px] text-[#71717a]">
                Remove all {diff.inSync} library-managed {diff.inSync === 1 ? 'skill' : 'skills'} from {machineName}, then bring back
                only the ones you want. Anything only on this machine is left alone — the library couldn't restore it.
              </div>
            </div>
            {confirmClear ? (
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmClear(false)}
                  className="h-8 rounded-[9px] border border-[#27272a] bg-transparent px-3 text-[12px] font-medium text-[#d4d4d8] transition hover:border-[#3a3a42]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void runClear()}
                  disabled={busy !== null}
                  className="flex h-8 items-center gap-1.5 rounded-[9px] bg-[#dc2626] px-3 text-[12px] font-semibold text-white transition hover:bg-[#b91c1c] disabled:opacity-60"
                >
                  {busy === 'clear' ? <Loader2 className="size-3.5 animate-spin" /> : <Eraser className="size-3.5" />}
                  Remove {diff.inSync} from {machineName}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmClear(true)}
                disabled={busy !== null}
                className="flex h-8 shrink-0 items-center gap-1.5 rounded-[9px] border border-[#3f2020] bg-transparent px-3 text-[12px] font-medium text-[#f87171] transition hover:bg-[#1e1010] disabled:opacity-60"
              >
                <Eraser className="size-3.5" />
                Clear machine…
              </button>
            )}
          </div>
        </section>
      )}

      {diff.onlyOnMachine.length > 0 && (
        <DiffSection
          title={`Only on ${machineName}`}
          hint="Adopt these into your library so SkillSync manages them. The machine's copies stay untouched."
          skills={diff.onlyOnMachine}
          keyOf={(skill) => skill.id}
          selected={adoptSel}
          onToggle={(key) => toggle(adoptSel, setAdoptSel, key)}
          onSelect={(keys) => setAdoptSel(new Set([...adoptSel, ...keys]))}
          onDeselect={(keys) => setAdoptSel(new Set([...adoptSel].filter((key) => !keys.includes(key))))}
          action={{
            icon: <ArrowDownToLine className="size-3.5" />,
            label: `Adopt into library (${adoptSel.size})`,
            busy: busy === 'adopt',
            disabled: busy !== null || adoptSel.size === 0,
            onClick: () => void runAdopt(),
          }}
          badge={(skill) => (skill.origin ? skill.origin.label : 'no known origin')}
        />
      )}

      {diff.onlyInLibrary.length > 0 && (
        <DiffSection
          title="In your library, missing here"
          hint={`Install these onto ${machineName} at the library's pinned versions.`}
          skills={diff.onlyInLibrary}
          keyOf={dirNameOf}
          selected={installSel}
          onToggle={(key) => toggle(installSel, setInstallSel, key)}
          onSelect={(keys) => setInstallSel(new Set([...installSel, ...keys]))}
          onDeselect={(keys) => setInstallSel(new Set([...installSel].filter((key) => !keys.includes(key))))}
          action={{
            icon: <ArrowUpFromLine className="size-3.5" />,
            label: `Install on ${machineName} (${installSel.size})`,
            busy: busy === 'install',
            disabled: busy !== null || installSel.size === 0,
            onClick: () => void runInstall(),
          }}
          badge={(skill) => (skill.library?.repo ? skill.library.repo : 'library files')}
        />
      )}
    </div>
  )
}

function DiffSection({
  title,
  hint,
  skills,
  keyOf,
  selected,
  onToggle,
  onSelect,
  onDeselect,
  action,
  badge,
}: {
  title: string
  hint: string
  skills: SkillRecord[]
  keyOf: (skill: SkillRecord) => string
  selected: Set<string>
  onToggle: (key: string) => void
  /** Add these keys to the selection (All, scoped to the current filter). */
  onSelect: (keys: string[]) => void
  /** Drop these keys from the selection (None, scoped to the current filter). */
  onDeselect: (keys: string[]) => void
  action: { icon: React.ReactNode; label: string; busy: boolean; disabled: boolean; onClick: () => void }
  badge: (skill: SkillRecord) => string
}) {
  // Library-style narrowing: search + category / tag / origin chips. All
  // client-side — the diff rows already carry the ledger metadata.
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<SkillCategory | null>(null)
  const [tag, setTag] = useState<string | null>(null)
  const [origin, setOrigin] = useState<'repo' | 'original' | null>(null)

  const categoryCounts = useMemo(() => {
    const counts = new Map<SkillCategory, number>()
    for (const skill of skills) {
      const value = skill.library?.category
      if (value) counts.set(value, (counts.get(value) ?? 0) + 1)
    }
    return counts
  }, [skills])
  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const skill of skills) for (const t of skill.library?.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  }, [skills])
  const originCounts = useMemo(() => {
    let repo = 0
    for (const skill of skills) if (skill.library?.repo) repo += 1
    return { repo, original: skills.length - repo }
  }, [skills])

  const visible = useMemo(() => {
    let result = skills
    if (category) result = result.filter((skill) => skill.library?.category === category)
    if (tag) result = result.filter((skill) => skill.library?.tags?.includes(tag))
    if (origin) result = result.filter((skill) => (skill.library?.repo ? 'repo' : 'original') === origin)
    const q = query.trim().toLowerCase()
    if (q)
      result = result.filter((skill) =>
        [skill.name, skill.description, skill.library?.repo ?? '', ...(skill.library?.tags ?? [])].join(' ').toLowerCase().includes(q),
      )
    return result
  }, [skills, category, tag, origin, query])

  const filtered = visible.length !== skills.length
  const visibleKeys = visible.map(keyOf)
  const selectedShown = visibleKeys.filter((key) => selected.has(key)).length
  const hasChips = categoryCounts.size > 0 || tagCounts.length > 0 || (originCounts.repo > 0 && originCounts.original > 0)

  const chip = (label: string, active: boolean, onClick: () => void, count?: number) => (
    <button
      key={label}
      type="button"
      onClick={onClick}
      className={`flex h-6 items-center gap-1 rounded-full border px-2 text-[11.5px] font-medium transition ${
        active
          ? 'border-[#f97316] bg-[#1a1109] text-[#fb923c]'
          : 'border-[#27272a] bg-[#111114] text-[#a1a1aa] hover:border-[#3a3a42] hover:text-[#e4e4e7]'
      }`}
    >
      {label}
      {typeof count === 'number' && <span className="font-mono text-[10px] opacity-60">{count}</span>}
    </button>
  )

  return (
    <section className="rounded-[13px] border border-[#232328] bg-[#101013]">
      <div className="flex items-start justify-between gap-4 border-b border-[#1c1c20] px-4 py-3">
        <div>
          <div className="text-[13.5px] font-semibold text-[#fafafa]">{title}</div>
          <div className="mt-0.5 text-[12px] text-[#71717a]">{hint}</div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-[11.5px] text-[#52525b]">
            {selectedShown}/{visible.length}{filtered ? ' shown' : ''} selected
          </span>
          <button type="button" onClick={() => onSelect(visibleKeys)} className="text-[12px] text-[#a1a1aa] hover:text-[#e4e4e7]">
            {filtered ? 'All shown' : 'All'}
          </button>
          <span className="text-[#3a3a42]">·</span>
          <button type="button" onClick={() => onDeselect(visibleKeys)} className="text-[12px] text-[#a1a1aa] hover:text-[#e4e4e7]">
            {filtered ? 'None shown' : 'None'}
          </button>
        </div>
      </div>

      {(skills.length > 8 || hasChips) && (
        <div className="flex flex-col gap-2 border-b border-[#1c1c20] px-4 py-2.5">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Search ${skills.length} skills…`}
            className="h-7 w-full max-w-[280px] rounded-[8px] border border-[#27272a] bg-[#0c0c0e] px-2.5 text-[12px] text-[#e4e4e7] outline-none placeholder:text-[#3f3f46] focus:border-[#3a3a42]"
          />
          {hasChips && (
            <div className="flex flex-wrap items-center gap-1.5">
              {originCounts.repo > 0 && originCounts.original > 0 && (
                <>
                  {chip('From repos', origin === 'repo', () => setOrigin(origin === 'repo' ? null : 'repo'), originCounts.repo)}
                  {chip('Originals', origin === 'original', () => setOrigin(origin === 'original' ? null : 'original'), originCounts.original)}
                  {(categoryCounts.size > 0 || tagCounts.length > 0) && <span className="mx-0.5 h-4 w-px bg-[#27272a]" />}
                </>
              )}
              {CATEGORY_ORDER.filter((key) => (categoryCounts.get(key) ?? 0) > 0).map((key) =>
                chip(CATEGORY_LABELS[key], category === key, () => setCategory(category === key ? null : key), categoryCounts.get(key)),
              )}
              {tagCounts.length > 0 && categoryCounts.size > 0 && <span className="mx-0.5 h-4 w-px bg-[#27272a]" />}
              {tagCounts.map(([value, count]) => chip(`#${value}`, tag === value, () => setTag(tag === value ? null : value), count))}
            </div>
          )}
        </div>
      )}

      <div className="max-h-[440px] overflow-y-auto">
        {visible.length === 0 && (
          <div className="px-4 py-8 text-center text-[12.5px] text-[#71717a]">Nothing matches the current filter.</div>
        )}
        {visible.map((skill) => {
          const key = keyOf(skill)
          return (
            <label
              key={key}
              className="flex cursor-pointer items-center gap-3 border-b border-[#17171a] px-4 py-2.5 last:border-b-0 hover:bg-[#141417]"
            >
              <input
                type="checkbox"
                checked={selected.has(key)}
                onChange={() => onToggle(key)}
                className="size-3.5 shrink-0 accent-[#f97316]"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-[#e4e4e7]">{skill.name}</span>
                <span className="block truncate text-[11.5px] text-[#71717a]">{skill.description || 'No description'}</span>
              </span>
              <span className="shrink-0 rounded-md border border-[#27272a] bg-[#1a1a1e] px-1.5 py-0.5 font-mono text-[10.5px] text-[#a1a1aa]">
                {badge(skill)}
              </span>
            </label>
          )
        })}
      </div>
      <div className="flex justify-end border-t border-[#1c1c20] px-4 py-3">
        <button
          type="button"
          onClick={action.onClick}
          disabled={action.disabled}
          className={`flex h-9 items-center gap-1.5 rounded-[9px] bg-[#f97316] px-4 text-[13px] font-semibold text-white transition ${
            action.disabled ? 'cursor-not-allowed opacity-60' : 'hover:bg-[#ea580c]'
          }`}
        >
          {action.busy ? <Loader2 className="size-3.5 animate-spin" /> : action.icon}
          {action.label}
        </button>
      </div>
    </section>
  )
}

const dirNameOf = (skill: { realPath: string; name: string }) => dirNameOfPath(skill.realPath) || skill.name
