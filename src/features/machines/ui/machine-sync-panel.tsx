import { useEffect, useState } from 'react'
import { ArrowDownToLine, ArrowUpFromLine, Check, Loader2, RefreshCw } from 'lucide-react'
import type { MachineDiff, SkillRecord } from '@/features/skills/model/skills'

type MachineSyncPanelProps = {
  machineName: string
  loadDiff: (name: string) => Promise<MachineDiff | null>
  onAdopt: (skillIds: string[]) => Promise<{ adopted: string[]; failed: Record<string, string> } | null>
  onConverge: (dirNames: string[]) => Promise<{ installed: string[]; failed: Record<string, string> } | null>
}

/**
 * The two-way diff between a machine and the library: adopt what only the
 * machine has, install what only the library has. Both flows are bulk-first
 * — this is the onboarding surface for a machine, in either direction.
 */
export function MachineSyncPanel({ machineName, loadDiff, onAdopt, onConverge }: MachineSyncPanelProps) {
  const [diff, setDiff] = useState<MachineDiff | null>(null)
  const [loading, setLoading] = useState(true)
  const [adoptSel, setAdoptSel] = useState<Set<string>>(new Set())
  const [installSel, setInstallSel] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<'adopt' | 'install' | null>(null)
  const [report, setReport] = useState<string | null>(null)
  const [failures, setFailures] = useState<Record<string, string>>({})

  const refresh = async () => {
    setLoading(true)
    setReport(null)
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
      await refresh()
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
      await refresh()
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

      {diff.onlyOnMachine.length > 0 && (
        <DiffSection
          title={`Only on ${machineName}`}
          hint="Adopt these into your library so SkillSync manages them. The machine's copies stay untouched."
          skills={diff.onlyOnMachine}
          keyOf={(skill) => skill.id}
          selected={adoptSel}
          onToggle={(key) => toggle(adoptSel, setAdoptSel, key)}
          onAll={() => setAdoptSel(new Set(diff.onlyOnMachine.map((skill) => skill.id)))}
          onNone={() => setAdoptSel(new Set())}
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
          onAll={() => setInstallSel(new Set(diff.onlyInLibrary.map(dirNameOf)))}
          onNone={() => setInstallSel(new Set())}
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
  onAll,
  onNone,
  action,
  badge,
}: {
  title: string
  hint: string
  skills: SkillRecord[]
  keyOf: (skill: SkillRecord) => string
  selected: Set<string>
  onToggle: (key: string) => void
  onAll: () => void
  onNone: () => void
  action: { icon: React.ReactNode; label: string; busy: boolean; disabled: boolean; onClick: () => void }
  badge: (skill: SkillRecord) => string
}) {
  return (
    <section className="rounded-[13px] border border-[#232328] bg-[#101013]">
      <div className="flex items-start justify-between gap-4 border-b border-[#1c1c20] px-4 py-3">
        <div>
          <div className="text-[13.5px] font-semibold text-[#fafafa]">{title}</div>
          <div className="mt-0.5 text-[12px] text-[#71717a]">{hint}</div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button type="button" onClick={onAll} className="text-[12px] text-[#a1a1aa] hover:text-[#e4e4e7]">All</button>
          <span className="text-[#3a3a42]">·</span>
          <button type="button" onClick={onNone} className="text-[12px] text-[#a1a1aa] hover:text-[#e4e4e7]">None</button>
        </div>
      </div>
      <div className="max-h-[320px] overflow-y-auto">
        {skills.map((skill) => {
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

function dirNameOf(skill: SkillRecord): string {
  return skill.realPath.split('/').filter(Boolean).pop() ?? skill.name
}
