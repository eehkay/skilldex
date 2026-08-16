import { ArrowUpCircle, Check, Download, PackageSearch, Server, Sparkles, X } from 'lucide-react'
import type { MachineSnapshot, RepoCatalog, Skill } from '@/features/skills/model/skills'

type GettingStartedProps = {
  skills: Skill[]
  repos: RepoCatalog[]
  machines: MachineSnapshot[]
  onAddRepo: () => void
  onOpenRepo: (slug: string) => void
  onAddMachine: () => void
  onOpenMachine: (name: string) => void
  onCategorize: () => void
  onDismiss: () => void
}

/**
 * A checklist, not a wizard: it stays until every step is done or the user
 * dismisses it, and each step deep-links to the place that completes it.
 * Shown while the library is still taking shape.
 */
export function GettingStarted({ skills, repos, machines, onAddRepo, onOpenRepo, onAddMachine, onOpenMachine, onCategorize, onDismiss }: GettingStartedProps) {
  const library = skills.filter((skill) => skill.scope === 'global')
  const categorized = library.filter((skill) => skill.library?.category).length
  const machineWithSkillsOnly = machines.find((entry) => entry.snapshot && entry.snapshot.skills.some((s) => s.sourceKind === 'Personal'))

  const steps: Array<{ done: boolean; title: string; detail: string; action?: { label: string; onClick: () => void }; icon: React.ComponentType<{ className?: string }> }> = [
    {
      done: repos.length > 0,
      icon: PackageSearch,
      title: 'Add a skill source',
      detail: 'Point SkillSync at a GitHub repo of skills. Try anthropics/skills, or an "awesome list" — its linked repos are offered automatically.',
      action: repos.length > 0 ? { label: 'Add another', onClick: onAddRepo } : { label: 'Add a repo', onClick: onAddRepo },
    },
    {
      done: library.length > 0,
      icon: Download,
      title: 'Import your first skills',
      detail: 'Open a repo and Import what you want. Each import is pinned to the exact commit, so it can be updated later.',
      action: repos.length > 0 ? { label: `Browse ${repos[0].slug}`, onClick: () => onOpenRepo(repos[0].slug) } : undefined,
    },
    {
      done: machines.length > 0,
      icon: Server,
      title: 'Connect your machines',
      detail: 'Add a machine reachable over Tailscale SSH — nothing to install there; the hub pushes its own agent.',
      action: { label: machines.length > 0 ? 'Add another' : 'Add a machine', onClick: onAddMachine },
    },
    {
      done: machines.length > 0 && library.length >= 5,
      icon: ArrowUpCircle,
      title: 'Adopt what your machines already have',
      detail: 'A machine\'s Sync tab shows what it has that the library lacks — adopt it all in one click, then sync the other way.',
      action: machineWithSkillsOnly ? { label: `Open ${machineWithSkillsOnly.machine.name} → Sync`, onClick: () => onOpenMachine(machineWithSkillsOnly.machine.name) } : undefined,
    },
    {
      done: library.length > 0 && categorized >= Math.min(library.length, 5),
      icon: Sparkles,
      title: 'Sort the shelf',
      detail: 'Categorize groups the library into nine shelves — structure first (free), then Claude for the rest if you add a key in Settings.',
      action: library.length > 0 ? { label: 'Categorize', onClick: onCategorize } : undefined,
    },
  ]
  const remaining = steps.filter((step) => !step.done).length
  if (remaining === 0) return null

  return (
    <div className="mb-5 overflow-hidden rounded-[13px] border border-[#2a2a30] bg-gradient-to-br from-[#141417] to-[#0f0f12]">
      <div className="flex items-start justify-between gap-4 px-5 pb-3 pt-4">
        <div>
          <div className="text-[14px] font-semibold text-[#fafafa]">Get set up</div>
          <div className="mt-0.5 text-[12.5px] text-[#71717a]">{steps.length - remaining} of {steps.length} done — the rest each take about a minute.</div>
        </div>
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className="grid size-7 place-items-center rounded-lg text-[#52525b] transition hover:bg-[#1c1c20] hover:text-[#a1a1aa]">
          <X className="size-4" />
        </button>
      </div>
      <div className="grid grid-cols-1 gap-px bg-[#1c1c20] md:grid-cols-5">
        {steps.map((step) => {
          const Icon = step.icon
          return (
            <div key={step.title} className={`flex flex-col gap-2 bg-[#0f0f12] px-4 py-3.5 ${step.done ? 'opacity-60' : ''}`}>
              <div className="flex items-center gap-2">
                <span className={`grid size-6 place-items-center rounded-md ${step.done ? 'bg-[#0f1a11] text-[#4ade80]' : 'bg-[#1a1109] text-[#fb923c]'}`}>
                  {step.done ? <Check className="size-3.5" /> : <Icon className="size-3.5" />}
                </span>
                <span className="text-[12.5px] font-semibold text-[#e4e4e7]">{step.title}</span>
              </div>
              <p className="min-h-[54px] text-[11.5px] leading-relaxed text-[#71717a]">{step.detail}</p>
              {!step.done && step.action && (
                <button
                  type="button"
                  onClick={step.action.onClick}
                  className="mt-auto flex h-7 items-center justify-center rounded-[8px] border border-[#27272a] bg-[#18181b] px-2.5 text-[12px] font-medium text-[#e4e4e7] transition hover:border-[#3a3a42]"
                >
                  {step.action.label}
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
