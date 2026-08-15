import { useMemo, useState } from 'react'
import { AlertCircle, FileText, RefreshCw, Trash2 } from 'lucide-react'
import { iconColorsFor, monoFor, toSkill, type MachineSnapshot, type Skill } from '@/features/skills/model/skills'
import { SkillToggle } from '@/features/skills/ui/skill-toggle'

type MachineViewProps = {
  entry: MachineSnapshot
  busy: boolean
  onRefresh: () => void
  onRemove: () => void
  onSkillOp: (op: 'enable' | 'disable' | 'remove', id: string) => void
}

/**
 * One remote machine's library: global and project skills with
 * enable/disable/remove. Read/detail affordances stay local-only for now —
 * this pane is about what's installed where.
 */
export function MachineView({ entry, busy, onRefresh, onRemove, onSkillOp }: MachineViewProps) {
  const [query, setQuery] = useState('')
  const skills = useMemo(
    () => (entry.snapshot ? entry.snapshot.skills.map(toSkill) : []),
    [entry.snapshot],
  )

  const visible = useMemo(() => {
    const value = query.trim().toLowerCase()
    if (!value) return skills
    return skills.filter((skill) =>
      [skill.name, skill.summary, skill.source].join(' ').toLowerCase().includes(value),
    )
  }, [skills, query])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-7 pt-5">
        <div className="flex items-start gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-2.5">
              <h1 className="text-[22px] font-semibold tracking-tight text-[#fafafa]">{entry.machine.name}</h1>
              <span className="rounded-[7px] border border-[#27272a] bg-[#18181b] px-2.5 py-1 text-[11px] font-medium text-[#a1a1aa]">
                Machine
              </span>
            </div>
            <p className="mt-1.5 font-mono text-[12px] text-[#71717a]">
              {entry.machine.user}@{entry.machine.host}
            </p>
          </div>
          <button
            type="button"
            onClick={onRefresh}
            disabled={busy}
            className="flex h-[34px] items-center gap-1.5 rounded-[9px] border border-[#27272a] bg-[#18181b] px-3 text-[12.5px] font-medium text-[#e4e4e7] transition hover:border-[#3a3a42] disabled:opacity-60"
          >
            <RefreshCw className={`size-3.5 ${busy ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            type="button"
            onClick={onRemove}
            disabled={busy}
            className="flex h-[34px] items-center gap-1.5 rounded-[9px] border border-[#27272a] bg-[#18181b] px-3 text-[12.5px] font-medium text-[#a1a1aa] transition hover:border-[#4a2020] hover:text-[#f87171] disabled:opacity-60"
          >
            <Trash2 className="size-3.5" />
            Forget
          </button>
        </div>

        {entry.snapshot && (
          <div className="mt-5 flex items-center gap-3 border-b border-[#1c1c20] pb-3">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter skills…"
              className="h-[32px] w-[260px] rounded-[9px] border border-[#27272a] bg-[#111114] px-3 text-[13px] text-[#e4e4e7] outline-none placeholder:text-[#52525b] focus:border-[#3a3a42]"
            />
            <span className="text-[12px] text-[#52525b]">
              {skills.length} {skills.length === 1 ? 'skill' : 'skills'} · {entry.snapshot.projects.length}{' '}
              {entry.snapshot.projects.length === 1 ? 'project' : 'projects'}
            </span>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-7 pb-7 pt-5">
        {entry.error ? (
          <div className="flex items-center gap-2 rounded-xl border border-[#3f2020] bg-[#1a0f0f] px-4 py-3 text-[13px] text-[#f87171]">
            <AlertCircle className="size-4 shrink-0" />
            {entry.error}
          </div>
        ) : !entry.snapshot ? (
          <div className="rounded-xl border border-dashed border-[#27272a] px-6 py-14 text-center text-[13px] text-[#71717a]">
            Not scanned yet. Hit Refresh to reach the machine.
          </div>
        ) : visible.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[#27272a] px-6 py-14 text-center text-[13px] text-[#71717a]">
            {query ? `No skills match “${query}”.` : 'No skills on this machine yet. Install one from a skill repo.'}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3.5 xl:grid-cols-2">
            {visible.map((skill) => (
              <MachineSkillCard key={skill.id} skill={skill} busy={busy} onSkillOp={onSkillOp} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function MachineSkillCard({
  skill,
  busy,
  onSkillOp,
}: {
  skill: Skill
  busy: boolean
  onSkillOp: (op: 'enable' | 'disable' | 'remove', id: string) => void
}) {
  const colors = iconColorsFor(skill.id)
  return (
    <div className="flex flex-col gap-3 rounded-[13px] border border-[#232328] bg-[#101013] p-4">
      <div className="flex items-start gap-3">
        <div
          className="grid size-10 shrink-0 place-items-center rounded-[11px] font-mono text-[15px] font-semibold"
          style={{ background: colors.bg, color: colors.fg }}
        >
          {monoFor(skill.name)}
        </div>
        <div className="min-w-0 flex-1">
          <span className="block truncate text-[14.5px] font-semibold text-[#fafafa]">{skill.name}</span>
          <span className="mt-0.5 block truncate font-mono text-[11px] text-[#52525b]">{skill.source}</span>
        </div>
        <span className="mt-0.5 flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => onSkillOp('remove', skill.id)}
            disabled={busy || skill.scope === 'plugin'}
            aria-label={`Remove ${skill.name}`}
            className="grid size-7 place-items-center rounded-lg text-[#52525b] transition hover:bg-[#1e1010] hover:text-[#f87171] disabled:opacity-40"
          >
            <Trash2 className="size-3.5" />
          </button>
          <SkillToggle
            enabled={skill.enabled}
            onToggle={busy || skill.scope === 'plugin' ? undefined : () => onSkillOp(skill.enabled ? 'disable' : 'enable', skill.id)}
            disabled={busy || skill.scope === 'plugin'}
          />
        </span>
      </div>
      <p className="line-clamp-2 min-h-[38px] text-[12.5px] leading-relaxed text-[#a1a1aa]">{skill.summary}</p>
      <span className="ml-auto flex items-center gap-1 font-mono text-[11px] text-[#52525b]">
        <FileText className="size-3" />
        {skill.fileCount} {skill.fileCount === 1 ? 'file' : 'files'}
      </span>
    </div>
  )
}
