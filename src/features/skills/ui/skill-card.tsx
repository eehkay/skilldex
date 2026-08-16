import { CheckSquare, FileText, GitFork, Hash, Server, Square, Tag } from 'lucide-react'
import { CATEGORY_LABELS, scopePillClass, shortRef, type Skill } from '../model/skills'
import { FavouriteButton } from './favourite-button'
import { SkillToggle } from './skill-toggle'

type SkillCardProps = {
  skill: Skill
  onOpen: () => void
  onToggle: () => void
  onToggleFavourite: () => void
  /**
   * Select mode: clicking the card toggles selection instead of opening it.
   * `selected: undefined` means this card cannot be selected (not a library
   * skill) and renders dimmed.
   */
  selectable?: boolean
  selected?: boolean
  onSelect?: () => void
}

export function SkillCard({ skill, onOpen, onToggle, onToggleFavourite, selectable = false, selected, onSelect }: SkillCardProps) {
  const canSelect = selectable && selected !== undefined
  const activate = () => {
    if (selectable) {
      if (canSelect) onSelect?.()
      return
    }
    onOpen()
  }
  const chips = skill.scope === 'project' ? skill.projects.slice(0, 2) : []
  // Where the skill came from: the library ledger (imported skills) or the
  // skills-CLI lock file (origin), whichever knows.
  const provenance = skill.library?.repo ?? skill.origin?.label
  const version = shortRef(skill.library?.ref)
  const machineCount = skill.library?.targets.length ?? 0

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={activate}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          activate()
        }
      }}
      aria-selected={canSelect ? selected : undefined}
      className={`flex flex-col gap-3 rounded-[13px] border bg-[#101013] p-4 text-left transition focus-visible:outline-none ${
        selectable && !canSelect
          ? 'cursor-not-allowed border-[#1c1c20] opacity-40'
          : selected
            ? 'cursor-pointer border-[#f97316] bg-[#141110]'
            : 'cursor-pointer border-[#232328] hover:-translate-y-0.5 hover:border-[#3a3a42] focus-visible:border-[#3a3a42]'
      }`}
    >
      <div className="flex items-start gap-3">
        {canSelect && (
          <span className="mt-2.5 shrink-0 text-[#a1a1aa]">
            {selected ? <CheckSquare className="size-4 text-[#fb923c]" /> : <Square className="size-4" />}
          </span>
        )}
        <div
          className="grid size-10 shrink-0 place-items-center rounded-[11px] font-mono text-[15px] font-semibold"
          style={{ background: skill.iconBg, color: skill.iconFg }}
        >
          {skill.mono}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[14.5px] font-semibold text-[#fafafa]">{skill.name}</span>
            <span
              className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide ${scopePillClass(skill.scope)}`}
            >
              {skill.scope}
            </span>
          </div>
          <div className="mt-0.5 truncate font-mono text-[11px] text-[#52525b]">{skill.source}</div>
        </div>
        <span className="mt-0.5 flex shrink-0 items-center gap-1.5">
          <FavouriteButton favourite={skill.isFavourite} onToggle={onToggleFavourite} />
          <SkillToggle enabled={skill.enabled} onToggle={onToggle} disabled={skill.scope === 'plugin'} />
        </span>
      </div>

      <p className="line-clamp-2 min-h-[38px] text-[12.5px] leading-relaxed text-[#a1a1aa]">{skill.summary}</p>

      <div className="flex flex-wrap items-center gap-1.5">
        {skill.library?.category && (
          <span
            title={`Category: ${CATEGORY_LABELS[skill.library.category]}${skill.library.categorySource === 'manual' ? ' (set by you)' : ''}`}
            className="flex items-center gap-1 rounded-md border border-[#2a2a30] bg-[#15151a] px-1.5 py-0.5 text-[11px] text-[#c4c4cc]"
          >
            <Tag className="size-3 shrink-0 text-[#71717a]" />
            {CATEGORY_LABELS[skill.library.category]}
          </span>
        )}
        {(skill.library?.tags ?? []).slice(0, 3).map((tag) => (
          <span
            key={tag}
            title={`Tag: ${tag}`}
            className="flex items-center gap-0.5 rounded-md border border-[#2a2a30] bg-[#15151a] px-1.5 py-0.5 text-[11px] text-[#a1a1aa]"
          >
            <Hash className="size-3 shrink-0 text-[#52525b]" />
            {tag}
          </span>
        ))}
        {(skill.library?.tags?.length ?? 0) > 3 && (
          <span className="text-[11px] text-[#52525b]">+{(skill.library?.tags?.length ?? 0) - 3}</span>
        )}
        {provenance && (
          <span
            title={version ? `Imported from ${provenance} @ ${version}` : `From ${provenance}`}
            className="flex max-w-[220px] items-center gap-1 rounded-md border border-[#27272a] bg-[#1a1a1e] px-1.5 py-0.5 font-mono text-[11px] text-[#a1a1aa]"
          >
            <GitFork className="size-3 shrink-0 text-[#52525b]" />
            <span className="truncate">{provenance}</span>
            {version && <span className="shrink-0 text-[#52525b]">@{version}</span>}
          </span>
        )}
        {machineCount > 0 && (
          <span
            title={`Syndicated to ${skill.library?.targets.map((target) => target.machine).join(', ')}`}
            className="flex items-center gap-1 rounded-md border border-[#27272a] bg-[#1a1a1e] px-1.5 py-0.5 text-[11px] text-[#a1a1aa]"
          >
            <Server className="size-3 text-[#52525b]" />
            {machineCount}
          </span>
        )}
        {chips.map((chip) => (
          <span
            key={chip}
            className="rounded-md border border-[#27272a] bg-[#1a1a1e] px-1.5 py-0.5 text-[11px] text-[#a1a1aa]"
          >
            {chip}
          </span>
        ))}
        <span className="ml-auto flex items-center gap-1 font-mono text-[11px] text-[#52525b]">
          <FileText className="size-3" />
          {skill.fileCount} {skill.fileCount === 1 ? 'file' : 'files'}
        </span>
      </div>
    </div>
  )
}
