import { AlertCircle, Blocks, Boxes, FolderGit2, Globe, Heart, LayoutGrid, Monitor, PackageSearch, Pencil, Plus, PowerOff, Search, Server, Settings } from 'lucide-react'
import type { ComponentType } from 'react'
import { ACCENT_PALETTE, type MachineSnapshot, type ProjectRecord, type RepoCatalog } from '@/features/skills/model/skills'

export type FilterKey = 'all' | 'favourites' | 'global' | 'plugin' | 'project' | 'disabled'

export type SidebarCounts = Record<FilterKey, number>

type SidebarProps = {
  active: FilterKey
  counts: SidebarCounts
  projects: ProjectRecord[]
  repos: RepoCatalog[]
  /** Slug of the repo whose catalog fills the main pane, if any. */
  activeRepo: string | null
  machines: MachineSnapshot[]
  /** Name of the machine whose library fills the main pane, if any. */
  activeMachine: string | null
  query: string
  onQuery: (value: string) => void
  onFilter: (key: FilterKey) => void
  onSelectRepo: (slug: string) => void
  onAddRepo: () => void
  onSelectMachine: (name: string) => void
  onAddMachine: () => void
  onEditMachine: (name: string) => void
  onOpenSettings: () => void
}

const NAV: Array<{ key: FilterKey; label: string; icon: ComponentType<{ className?: string }> }> = [
  { key: 'all', label: 'Library', icon: LayoutGrid },
  { key: 'favourites', label: 'Favourites', icon: Heart },
  { key: 'global', label: 'Global', icon: Globe },
  { key: 'plugin', label: 'Plugins', icon: Blocks },
  { key: 'project', label: 'Projects', icon: FolderGit2 },
  { key: 'disabled', label: 'Disabled', icon: PowerOff },
]

export function Sidebar({ active, counts, projects, repos, activeRepo, machines, activeMachine, query, onQuery, onFilter, onSelectRepo, onAddRepo, onSelectMachine, onAddMachine, onEditMachine, onOpenSettings }: SidebarProps) {
  return (
    <aside className="flex w-[248px] shrink-0 flex-col border-r border-[#1c1c20] bg-[#0b0b0d] px-3 py-3.5">
      <div className="flex items-center gap-2.5 px-2 pb-3.5 pt-1.5">
        <div className="grid size-[30px] place-items-center rounded-[9px] border border-[#27272a] bg-gradient-to-br from-[#1c1c1f] to-[#0a0a0b] shadow-[0_4px_14px_-2px_rgba(0,0,0,.5)]">
          <Boxes className="size-[17px] text-white" />
        </div>
        <span className="text-[15.5px] font-semibold tracking-tight text-[#fafafa]">Skilldex</span>
      </div>

      <label className="relative mb-4 block">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[#52525b]" />
        <input
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder="Search skills…"
          className="h-[34px] w-full rounded-[9px] border border-[#27272a] bg-[#111114] pl-[30px] pr-8 text-[13px] text-[#e4e4e7] outline-none placeholder:text-[#52525b] focus:border-[#3a3a42]"
        />
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded-[5px] border border-[#27272a] bg-[#18181b] px-1.5 py-0.5 font-mono text-[10px] text-[#52525b]">
          ⌘K
        </span>
      </label>

      <div className="px-2 pb-2 text-[10.5px] font-semibold uppercase tracking-[0.09em] text-[#52525b]">Library</div>
      <nav className="flex flex-col gap-0.5">
        {NAV.map((item) => {
          const Icon = item.icon
          const isActive = active === item.key && activeRepo === null && activeMachine === null
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => onFilter(item.key)}
              className={`flex items-center gap-3 rounded-[9px] px-2 py-2 text-[13.5px] font-medium transition ${
                isActive
                  ? 'bg-[#1a1109] text-[#fb923c] shadow-[inset_2px_0_0_#f97316]'
                  : 'text-[#a1a1aa] hover:bg-[#141417]'
              }`}
            >
              <span className="flex w-[18px] justify-center">
                <Icon className="size-[15px]" />
              </span>
              <span className="flex-1 text-left">{item.label}</span>
              <span className={`font-mono text-[11px] ${isActive ? 'text-[#fb923c]' : 'text-[#52525b]'}`}>
                {counts[item.key]}
              </span>
            </button>
          )
        })}
      </nav>

      <div className="flex items-center justify-between px-2 pb-2 pt-5">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-[#52525b]">Skill Repos</span>
        <button
          type="button"
          onClick={onAddRepo}
          aria-label="Add skill repo"
          className="grid size-5 place-items-center rounded-md text-[#52525b] transition hover:bg-[#141417] hover:text-[#a1a1aa]"
        >
          <Plus className="size-3.5" />
        </button>
      </div>
      <div className="flex flex-col gap-0.5">
        {repos.length === 0 ? (
          <p className="px-2 text-[12px] leading-relaxed text-[#52525b]">
            No skill repos yet. Add a GitHub repo to browse and install its skills.
          </p>
        ) : (
          repos.map((repo) => {
            const isActive = activeRepo === repo.slug
            return (
              <button
                key={repo.slug}
                type="button"
                onClick={() => onSelectRepo(repo.slug)}
                className={`flex items-center gap-3 rounded-[9px] px-2 py-2 text-[13px] font-medium transition ${
                  isActive
                    ? 'bg-[#1a1109] text-[#fb923c] shadow-[inset_2px_0_0_#f97316]'
                    : 'text-[#a1a1aa] hover:bg-[#141417]'
                }`}
              >
                <span className="flex w-[18px] justify-center">
                  <PackageSearch className="size-[15px]" />
                </span>
                <span className="flex-1 truncate text-left">{repo.slug}</span>
                {repo.error ? (
                  <AlertCircle className="size-3.5 shrink-0 text-[#f87171]" />
                ) : (
                  <span className={`font-mono text-[11px] ${isActive ? 'text-[#fb923c]' : 'text-[#52525b]'}`}>
                    {repo.skills.length}
                  </span>
                )}
              </button>
            )
          })
        )}
      </div>

      <div className="flex items-center justify-between px-2 pb-2 pt-5">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-[#52525b]">Machines</span>
        <button
          type="button"
          onClick={onAddMachine}
          aria-label="Add machine"
          className="grid size-5 place-items-center rounded-md text-[#52525b] transition hover:bg-[#141417] hover:text-[#a1a1aa]"
        >
          <Plus className="size-3.5" />
        </button>
      </div>
      <div className="flex flex-col gap-0.5">
        {machines.length === 0 ? (
          <p className="px-2 text-[12px] leading-relaxed text-[#52525b]">
            No machines yet. Add one to manage its skills over SSH.
          </p>
        ) : (
          machines.map((entry) => {
            const isActive = activeMachine === entry.machine.name
            return (
              // Row is a div (not a button) so the edit affordance can nest a
              // real button inside; the row itself stays keyboard-selectable.
              <div
                key={entry.machine.name}
                role="button"
                tabIndex={0}
                onClick={() => onSelectMachine(entry.machine.name)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onSelectMachine(entry.machine.name)
                  }
                }}
                className={`group flex cursor-pointer items-center gap-3 rounded-[9px] px-2 py-2 text-[13px] font-medium transition ${
                  isActive
                    ? 'bg-[#1a1109] text-[#fb923c] shadow-[inset_2px_0_0_#f97316]'
                    : 'text-[#a1a1aa] hover:bg-[#141417]'
                }`}
              >
                <span className="flex w-[18px] justify-center">
                  <Server className="size-[15px]" />
                </span>
                <span className="flex-1 truncate text-left" title={`${entry.machine.user}@${entry.machine.host}`}>
                  {entry.machine.name}
                </span>
                <span className="relative flex h-5 min-w-5 items-center justify-end">
                  {/* Count (or error) by default; the pencil takes its place on hover/focus. */}
                  <span className="flex items-center transition-opacity group-hover:opacity-0 group-focus-within:opacity-0">
                    {entry.error ? (
                      <AlertCircle className="size-3.5 shrink-0 text-[#f87171]" />
                    ) : (
                      <span className={`font-mono text-[11px] ${isActive ? 'text-[#fb923c]' : 'text-[#52525b]'}`}>
                        {entry.snapshot?.skills.length ?? '…'}
                      </span>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      onEditMachine(entry.machine.name)
                    }}
                    onKeyDown={(event) => event.stopPropagation()}
                    aria-label={`Edit ${entry.machine.name}`}
                    title="Rename or edit"
                    className={`absolute right-0 grid size-5 place-items-center rounded-md opacity-0 transition focus:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 ${
                      isActive
                        ? 'text-[#fb923c] hover:bg-[#2a1a0c]'
                        : 'text-[#71717a] hover:bg-[#1c1c20] hover:text-[#e4e4e7]'
                    }`}
                  >
                    <Pencil className="size-3" />
                  </button>
                </span>
              </div>
            )
          })
        )}
      </div>

      <div className="px-2 pb-2 pt-5 text-[10.5px] font-semibold uppercase tracking-[0.09em] text-[#52525b]">
        Projects
      </div>
      <div className="flex flex-col gap-0.5">
        {projects.length === 0 ? (
          <p className="px-2 text-[12px] leading-relaxed text-[#52525b]">
            No project sources yet. Add a project folder in Settings.
          </p>
        ) : (
          projects.map((project, index) => (
            <div
              key={project.path}
              className="flex items-center gap-3 rounded-[9px] px-2 py-1.5 text-[13px] text-[#a1a1aa]"
            >
              <span
                className="size-2 shrink-0 rounded-[3px]"
                style={{ background: ACCENT_PALETTE[index % ACCENT_PALETTE.length] }}
              />
              <span className="flex-1 truncate">{project.name}</span>
              <span className="font-mono text-[11px] text-[#52525b]">{project.skillCount}</span>
            </div>
          ))
        )}
      </div>

      <div className="mt-auto flex items-center gap-2.5 border-t border-[#1c1c20] px-2 pt-2.5">
        <div className="grid size-7 place-items-center rounded-lg bg-[#27272a] text-[#d4d4d8]">
          <Monitor className="size-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] font-medium text-[#e4e4e7]">Local machine</div>
          <div className="text-[11px] text-[#52525b]">Sign in coming soon</div>
        </div>
        <button
          type="button"
          onClick={onOpenSettings}
          aria-label="Settings"
          className="grid size-7 place-items-center rounded-lg text-[#52525b] transition hover:bg-[#141417] hover:text-[#a1a1aa]"
        >
          <Settings className="size-4" />
        </button>
      </div>
    </aside>
  )
}
