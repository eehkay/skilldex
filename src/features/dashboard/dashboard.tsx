import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, ArrowUpCircle, Link2, ListFilter, Loader2, Plus, RefreshCw, Sparkles } from 'lucide-react'
import { MachineDialog } from '@/features/machines/ui/machine-dialog'
import { LogsView } from '@/features/logs/ui/logs-view'
import { GettingStarted } from '@/features/onboarding/ui/getting-started'
import { UpdatesPanel } from '@/features/updates/ui/updates-panel'
import { MachineView } from '@/features/machines/ui/machine-view'
import { Sidebar, type FilterKey, type SidebarCounts } from '@/features/navigation/ui/sidebar'
import { AddRepoDialog } from '@/features/repos/ui/add-repo-dialog'
import { InstallSkillDialog, type InstallTarget } from '@/features/repos/ui/install-skill-dialog'
import { RepoBrowser } from '@/features/repos/ui/repo-browser'
import { SettingsDialog } from '@/features/settings/ui/settings-dialog'
import { searchSkills } from '@/features/skills/model/search'
import { CATEGORY_LABELS, CATEGORY_ORDER, type RepoSkill, type Skill, type SkillCategory } from '@/features/skills/model/skills'
import { useWorkspace } from '@/features/skills/model/use-workspace'
import { AddSkillDialog } from '@/features/skills/ui/add-skill-dialog'
import { ProjectGroups } from '@/features/skills/ui/project-groups'
import { SkillCard } from '@/features/skills/ui/skill-card'
import { SkillDetail } from '@/features/skills/ui/skill-detail'

const HEADINGS: Record<FilterKey, { title: string; subtitle: string; pill: string }> = {
  all: {
    title: 'Library',
    subtitle: 'Your skill collection — everything installed here, imported from repos, or in your open projects.',
    pill: 'All sources',
  },
  favourites: {
    title: 'Favourites',
    subtitle: 'Skills you have starred. Enabled or not, they live here for quick access.',
    pill: 'Starred',
  },
  global: {
    title: 'Global Skills',
    subtitle: 'Personal skills installed on this machine. Available to every project you open.',
    pill: 'On this machine',
  },
  plugin: {
    title: 'Plugin Skills',
    subtitle: 'Skills provided by the plugins you have installed.',
    pill: 'From plugins',
  },
  project: {
    title: 'Project Skills',
    subtitle: 'Skills committed inside a project folder. They travel with the repo.',
    pill: 'In projects',
  },
  disabled: {
    title: 'Disabled Skills',
    subtitle: 'Switched-off skills, parked on disk and hidden from Claude. Toggle one back on to restore it.',
    pill: 'Switched off',
  },
}

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'favourites', label: 'Favourites' },
  { key: 'global', label: 'Global' },
  { key: 'plugin', label: 'Plugins' },
  { key: 'project', label: 'Project' },
  { key: 'disabled', label: 'Disabled' },
]

export function Dashboard() {
  const {
    skills,
    snapshot,
    config,
    loading,
    error,
    rescan,
    configure,
    pickDirectory,
    getReadme,
    listFiles,
    reveal,
    enable,
    disable,
    remove,
    toggleFavourite,
    create,
    importArchive,
    repoCatalogs,
    reposLoading,
    addRepo,
    removeRepo,
    refreshRepo,
    installRepoSkill,
    machineSnapshots,
    machinesLoading,
    addMachine,
    updateMachine,
    removeMachine,
    refreshMachine,
    installOnMachine,
    machineSkillOp,
    setSyndication,
    setSkillEnabled,
    machineDiff,
    adoptFromMachine,
    convergeMachine,
    clearMachine,
    checkUpdates,
    applyUpdates,
    findOrigin,
    linkOrigin,
    linkOrigins,
    categorizeLibrary,
    setSkillCategory,
    getLogs,
  } = useWorkspace()
  const [filter, setFilter] = useState<FilterKey>('all')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [activeRepo, setActiveRepo] = useState<string | null>(null)
  const [showAddRepo, setShowAddRepo] = useState(false)
  const [installTarget, setInstallTarget] = useState<RepoSkill | null>(null)
  const [activeMachine, setActiveMachine] = useState<string | null>(null)
  const [category, setCategory] = useState<SkillCategory | 'uncategorized' | null>(null)
  const [showLogs, setShowLogs] = useState(false)
  const [showUpdates, setShowUpdates] = useState(false)
  const [updateCount, setUpdateCount] = useState<number | null>(null)
  const [onboardingDismissed, setOnboardingDismissed] = useState(
    () => typeof window !== 'undefined' && window.localStorage.getItem('skillsync.onboarding.dismissed') === '1',
  )
  const dismissOnboarding = () => {
    window.localStorage.setItem('skillsync.onboarding.dismissed', '1')
    setOnboardingDismissed(true)
  }

  // A light background check on load so the Updates button can show a badge
  // without the user having to open it. Errors are silent here — the panel
  // itself surfaces them when opened.
  useEffect(() => {
    let cancelled = false
    void checkUpdates()
      .then((result) => { if (!cancelled && result) setUpdateCount(result.updates.length) })
      .catch(() => {})
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [categorizing, setCategorizing] = useState(false)
  const [categorizeNote, setCategorizeNote] = useState<string | null>(null)
  const [linkingOrigins, setLinkingOrigins] = useState(false)
  // null = closed, 'add' = new machine, otherwise the name of the machine being edited.
  const [machineDialog, setMachineDialog] = useState<'add' | string | null>(null)

  // Enabling/disabling moves a skill on disk, so its id changes. Re-select the
  // same skill (by name + kind) in the new snapshot so the detail view stays put.
  // A syndicated library skill toggles everywhere at once; per-machine
  // granularity lives in the detail view's Machines panel.
  const toggleSkill = async (skill: Skill) => {
    try {
      const syndicated = (skill.library?.targets.length ?? 0) > 0
      const next = syndicated
        ? await setSkillEnabled({ skillId: skill.id, enabled: !skill.enabled, target: 'everywhere' })
        : await (skill.enabled ? disable(skill.id) : enable(skill.id))
      if (next && selectedId === skill.id) {
        const match = next.skills.find((s) => s.name === skill.name && s.sourceKind === skill.sourceKind)
        setSelectedId(match ? match.id : null)
      }
    } catch {
      // Error surfaced via the hook's error state.
    }
  }

  const removeSkill = async (id: string) => {
    try {
      await remove(id)
      setSelectedId(null)
    } catch {
      // Error surfaced via the hook's error state.
    }
  }

  const favourite = (skill: Skill) => {
    // Favouriting never moves the skill on disk, so its id (and any selection)
    // stays valid — no re-selection dance needed.
    void toggleFavourite(skill.id)
  }

  const searching = query.trim().length > 0

  // Search spans the whole library — every scope, disabled included — so
  // "where is my pdf skill?" always has an answer. Ranked, name hits first.
  const matches = useMemo(() => (searching ? searchSkills(skills, query) : skills), [skills, query, searching])

  // Switched-off skills live only in the Disabled tab; the source tabs list the
  // active library so a skill never shows up greyed-out in two places at once.
  // While searching, "All" is every match and the tabs narrow the results.
  const counts: SidebarCounts = useMemo(() => {
    const active = matches.filter((skill) => skill.enabled)
    return {
      all: searching ? matches.length : active.length,
      // Favourites are shown regardless of enabled state (Q7), so count them all.
      favourites: matches.filter((skill) => skill.isFavourite).length,
      global: active.filter((skill) => skill.scope === 'global').length,
      plugin: active.filter((skill) => skill.scope === 'plugin').length,
      project: active.filter((skill) => skill.scope === 'project').length,
      disabled: matches.filter((skill) => !skill.enabled).length,
    }
  }, [matches, searching])

  const scopedSkills = useMemo(() => {
    switch (filter) {
      case 'disabled':
        return matches.filter((skill) => !skill.enabled)
      case 'favourites':
        return matches.filter((skill) => skill.isFavourite)
      case 'all':
        return searching ? matches : matches.filter((skill) => skill.enabled)
      default:
        return matches.filter((skill) => skill.enabled && skill.scope === filter)
    }
  }, [matches, filter, searching])

  // Category chips narrow the current tab; only library (global) skills carry
  // categories, so 'uncategorized' means a global skill with none yet.
  const visibleSkills = useMemo(() => {
    if (category === null) return scopedSkills
    if (category === 'uncategorized')
      return scopedSkills.filter((skill) => skill.scope === 'global' && !skill.library?.category)
    return scopedSkills.filter((skill) => skill.library?.category === category)
  }, [scopedSkills, category])

  const categoryCounts = useMemo(() => {
    const counts = new Map<SkillCategory | 'uncategorized', number>()
    for (const skill of scopedSkills) {
      if (skill.scope !== 'global') continue
      const key = skill.library?.category ?? 'uncategorized'
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return counts
  }, [scopedSkills])

  // Library skills with no repo pin — adopted originals and anything imported
  // before origin tracking. Candidates for "Link origins".
  const unpinnedCount = useMemo(
    () => skills.filter((skill) => skill.scope === 'global' && skill.sourceKind === 'Personal' && !skill.library?.repo).length,
    [skills],
  )

  const runLinkOrigins = async () => {
    setLinkingOrigins(true)
    setCategorizeNote(null)
    try {
      const result = await linkOrigins()
      if (result) {
        const parts = [`${result.linked.length} linked`]
        if (result.likely.length) parts.push(`${result.likely.length} likely (edited locally — link from the skill page)`)
        if (result.unmatched) parts.push(`${result.unmatched} not in any tracked repo`)
        setCategorizeNote(result.scanned === 0 ? 'Every library skill is already pinned.' : parts.join(', '))
      }
    } catch (cause) {
      setCategorizeNote(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLinkingOrigins(false)
    }
  }

  const runCategorize = async (force = false) => {
    setCategorizing(true)
    setCategorizeNote(null)
    try {
      const result = await categorizeLibrary({ force })
      if (result) {
        setCategorizeNote(
          `${result.categorized} categorized` +
            (result.uncategorized > 0
              ? `, ${result.uncategorized} left${result.usedLlm ? '' : ' — add an Anthropic API key in Settings for smart categorization'}`
              : '') +
            '.',
        )
      }
    } catch (cause) {
      setCategorizeNote(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setCategorizing(false)
    }
  }

  // Typing in the sidebar search always lands you on the library, on the
  // all-encompassing tab, whatever pane was open — results are never hidden
  // behind a machine, repo, or detail view.
  const search = (value: string) => {
    if (value.trim() && !searching) {
      setFilter('all')
      setSelectedId(null)
      setActiveRepo(null)
      setActiveMachine(null)
      setShowLogs(false)
    }
    setQuery(value)
  }

  // In the Project tab, organize the (already search-filtered) skills by project.
  const projectGroups = useMemo(() => {
    if (filter !== 'project') return null
    return snapshot.projects
      .map((project) => ({ project, skills: visibleSkills.filter((skill) => skill.projects.includes(project.name)) }))
      .filter((group) => group.skills.length > 0)
  }, [filter, snapshot.projects, visibleSkills])

  const selected = selectedId ? skills.find((skill) => skill.id === selectedId) ?? null : null
  const heading = searching
    ? {
        title: 'Search',
        subtitle: `${matches.length} ${matches.length === 1 ? 'skill matches' : 'skills match'} “${query.trim()}” across your whole library. Pick a tab to narrow the results.`,
        pill: `${matches.length} ${matches.length === 1 ? 'result' : 'results'}`,
      }
    : HEADINGS[filter]
  const activeCatalog = activeRepo ? repoCatalogs.find((repo) => repo.slug === activeRepo) ?? null : null
  const activeMachineEntry = activeMachine
    ? machineSnapshots.find((entry) => entry.machine.name === activeMachine) ?? null
    : null

  // Install destinations: this app's own library plus every reachable machine.
  const installTargets: InstallTarget[] = [
    { key: 'local', label: 'This machine (local)', projects: snapshot.projects },
    ...machineSnapshots
      .filter((entry) => entry.snapshot)
      .map((entry) => ({
        key: entry.machine.name,
        label: `${entry.machine.name} (${entry.machine.host})`,
        projects: entry.snapshot?.projects ?? [],
      })),
  ]

  return (
    <div className="flex h-screen overflow-hidden bg-[#09090b] text-[#fafafa]">
      <Sidebar
        active={filter}
        counts={counts}
        projects={snapshot.projects}
        repos={repoCatalogs}
        activeRepo={activeRepo}
        machines={machineSnapshots}
        activeMachine={activeMachine}
        query={query}
        onQuery={search}
        onFilter={(key) => { setFilter(key); setSelectedId(null); setActiveRepo(null); setActiveMachine(null); setCategory(null); setShowLogs(false) }}
        onSelectRepo={(slug) => { setActiveRepo(slug); setSelectedId(null); setActiveMachine(null); setShowLogs(false) }}
        onAddRepo={() => setShowAddRepo(true)}
        onSelectMachine={(name) => { setActiveMachine(name); setSelectedId(null); setActiveRepo(null); setShowLogs(false) }}
        onAddMachine={() => setMachineDialog('add')}
        onOpenLogs={() => { setShowLogs(true); setSelectedId(null); setActiveRepo(null); setActiveMachine(null) }}
        logsActive={showLogs}
        onEditMachine={(name) => setMachineDialog(name)}
        onOpenSettings={() => setShowSettings(true)}
      />

      <main className="relative flex min-w-0 flex-1 flex-col">
        {showLogs ? (
          <LogsView getLogs={getLogs} />
        ) : activeMachineEntry ? (
          <MachineView
            entry={activeMachineEntry}
            busy={machinesLoading}
            onRefresh={() => void refreshMachine(activeMachineEntry.machine.name).catch(() => {})}
            onEdit={() => setMachineDialog(activeMachineEntry.machine.name)}
            onRemove={() => {
              setActiveMachine(null)
              void removeMachine(activeMachineEntry.machine.name).catch(() => {})
            }}
            onSkillOp={(op, id) =>
              void machineSkillOp(activeMachineEntry.machine.name, op, id).catch(() => {})
            }
            loadDiff={machineDiff}
            onAdopt={(ids) => adoptFromMachine(activeMachineEntry.machine.name, ids)}
            onConverge={(names) => convergeMachine(activeMachineEntry.machine.name, names)}
            onClear={() => clearMachine(activeMachineEntry.machine.name)}
          />
        ) : activeCatalog ? (
          <RepoBrowser
            catalog={activeCatalog}
            localSkills={skills}
            configuredSlugs={repoCatalogs.map((repo) => repo.slug)}
            busy={reposLoading}
            onRefresh={() => void refreshRepo(activeCatalog.slug).catch(() => {})}
            onRemove={() => {
              setActiveRepo(null)
              void removeRepo(activeCatalog.slug).catch(() => {})
            }}
            onInstall={(skill) => setInstallTarget(skill)}
            onAddLinked={(slug) => addRepo(slug)}
          />
        ) : selected ? (
          <SkillDetail
            skill={selected}
            machines={machineSnapshots}
            getReadme={getReadme}
            listFiles={listFiles}
            reveal={reveal}
            onToggle={() => void toggleSkill(selected)}
            onToggleFavourite={() => favourite(selected)}
            onRemove={() => void removeSkill(selected.id)}
            onSetSyndication={setSyndication}
            onSetSkillEnabled={async (input) => {
              await setSkillEnabled(input)
            }}
            onSetCategory={async (value) => {
              await setSkillCategory(selected.id, value)
            }}
            findOrigin={findOrigin}
            onLinkOrigin={async (origin) => {
              await linkOrigin(selected.id, origin)
            }}
            onBack={() => setSelectedId(null)}
          />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="shrink-0 px-7 pt-5">
              <div className="flex items-start gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2.5">
                    <h1 className="text-[22px] font-semibold tracking-tight text-[#fafafa]">{heading.title}</h1>
                    <span className="rounded-[7px] border border-[#27272a] bg-[#18181b] px-2.5 py-1 text-[11px] font-medium text-[#a1a1aa]">
                      {heading.pill}
                    </span>
                  </div>
                  <p className="mt-1.5 max-w-[560px] text-[13.5px] leading-relaxed text-[#71717a]">{heading.subtitle}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowUpdates(true)}
                  title="Check tracked repos for newer versions of pinned skills"
                  className="relative flex h-[38px] items-center gap-1.5 rounded-[9px] border border-[#27272a] bg-[#18181b] px-3.5 text-[13px] font-medium text-[#e4e4e7] transition hover:border-[#3a3a42]"
                >
                  <ArrowUpCircle className="size-[15px]" />
                  Updates
                  {updateCount !== null && updateCount > 0 && (
                    <span className="ml-0.5 rounded-full bg-[#f97316] px-1.5 py-0.5 font-mono text-[10.5px] font-semibold leading-none text-white">{updateCount}</span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setShowCreate(true)}
                  className="flex h-[38px] items-center gap-1.5 rounded-[9px] bg-[#f97316] px-4 text-[13px] font-semibold text-white shadow-[0_6px_18px_-6px_rgba(249,115,22,.6)] transition hover:bg-[#ea580c]"
                >
                  <Plus className="size-[15px]" />
                  Add Skill
                </button>
              </div>

              <div className="mt-5 flex items-center gap-2 border-b border-[#1c1c20]">
                {FILTERS.map((item) => {
                  const active = filter === item.key
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => setFilter(item.key)}
                      className={`-mb-px border-b-2 px-1 pb-2.5 text-[13px] transition ${
                        active ? 'border-[#f97316] font-semibold text-[#fafafa]' : 'border-transparent font-medium text-[#71717a]'
                      }`}
                    >
                      {item.label} <span className="font-mono text-[11px] opacity-60">{counts[item.key]}</span>
                    </button>
                  )
                })}
                <div className="flex-1" />
                <button
                  type="button"
                  onClick={() => void rescan()}
                  className="mb-2 flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-[#71717a] transition hover:text-[#a1a1aa]"
                >
                  <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
                  Rescan
                </button>
                <div className="mb-2.5 flex items-center gap-1.5 text-[12px] text-[#52525b]">
                  <ListFilter className="size-3.5" />
                  Sort: Name
                </div>
              </div>

              {categoryCounts.size > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <CategoryChip label="All categories" active={category === null} onClick={() => setCategory(null)} />
                  {CATEGORY_ORDER.filter((key) => (categoryCounts.get(key) ?? 0) > 0).map((key) => (
                    <CategoryChip
                      key={key}
                      label={CATEGORY_LABELS[key]}
                      count={categoryCounts.get(key)}
                      active={category === key}
                      onClick={() => setCategory(category === key ? null : key)}
                    />
                  ))}
                  {(categoryCounts.get('uncategorized') ?? 0) > 0 && (
                    <CategoryChip
                      label="Uncategorized"
                      count={categoryCounts.get('uncategorized')}
                      active={category === 'uncategorized'}
                      muted
                      onClick={() => setCategory(category === 'uncategorized' ? null : 'uncategorized')}
                    />
                  )}
                  <div className="flex-1" />
                  {categorizeNote && <span className="text-[12px] text-[#71717a]">{categorizeNote}</span>}
                  {unpinnedCount > 0 && (
                    <button
                      type="button"
                      onClick={() => void runLinkOrigins()}
                      disabled={linkingOrigins}
                      title={`Pin the ${unpinnedCount} unpinned library skill${unpinnedCount === 1 ? '' : 's'} to the tracked repos they came from. Only byte-identical matches are linked; edited skills are reported, not linked.`}
                      className="flex h-7 items-center gap-1.5 rounded-[8px] border border-[#27272a] bg-[#18181b] px-2.5 text-[12px] font-medium text-[#e4e4e7] transition hover:border-[#3a3a42] disabled:opacity-60"
                    >
                      {linkingOrigins ? <Loader2 className="size-3.5 animate-spin" /> : <Link2 className="size-3.5 text-[#60a5fa]" />}
                      Link origins
                      <span className="rounded-full bg-[#27272a] px-1.5 text-[10.5px] text-[#a1a1aa]">{unpinnedCount}</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void runCategorize(false)}
                    disabled={categorizing}
                    title="Assign categories to uncategorized library skills"
                    className="flex h-7 items-center gap-1.5 rounded-[8px] border border-[#27272a] bg-[#18181b] px-2.5 text-[12px] font-medium text-[#e4e4e7] transition hover:border-[#3a3a42] disabled:opacity-60"
                  >
                    {categorizing ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5 text-[#fb923c]" />}
                    Categorize
                  </button>
                </div>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-7 pb-7 pt-5">
              {!onboardingDismissed && filter === 'all' && !searching && (
                <GettingStarted
                  skills={skills}
                  repos={repoCatalogs}
                  machines={machineSnapshots}
                  onAddRepo={() => setShowAddRepo(true)}
                  onOpenRepo={(slug) => { setActiveRepo(slug); setSelectedId(null); setActiveMachine(null); setShowLogs(false) }}
                  onAddMachine={() => setMachineDialog('add')}
                  onOpenMachine={(name) => { setActiveMachine(name); setSelectedId(null); setActiveRepo(null); setShowLogs(false) }}
                  onCategorize={() => void runCategorize(false)}
                  onDismiss={dismissOnboarding}
                />
              )}
              {error ? (
                <div className="flex items-center gap-2 rounded-xl border border-[#3f2020] bg-[#1a0f0f] px-4 py-3 text-[13px] text-[#f87171]">
                  <AlertCircle className="size-4" />
                  {error}
                </div>
              ) : loading && skills.length === 0 ? (
                <div className="flex items-center gap-2 text-[13px] text-[#71717a]">
                  <Loader2 className="size-4 animate-spin" /> Scanning your skill sources…
                </div>
              ) : visibleSkills.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[#27272a] px-6 py-14 text-center text-[13px] text-[#71717a]">
                  {query
                    ? `No skills match “${query}”.`
                    : filter === 'project'
                      ? 'No project skills yet. Add a project folder in Settings.'
                      : filter === 'disabled'
                        ? 'No disabled skills. Everything is switched on.'
                        : filter === 'favourites'
                          ? 'No favourites yet. Tap the heart on any skill to star it.'
                          : 'No skills found in this scope yet.'}
                </div>
              ) : projectGroups && projectGroups.length > 0 ? (
                <ProjectGroups
                  groups={projectGroups}
                  onOpen={(id) => setSelectedId(id)}
                  onToggle={(skill) => void toggleSkill(skill)}
                  onToggleFavourite={(skill) => favourite(skill)}
                />
              ) : (
                <div className="grid grid-cols-1 gap-3.5 xl:grid-cols-2">
                  {visibleSkills.map((skill) => (
                    <SkillCard
                      key={skill.id}
                      skill={skill}
                      onOpen={() => setSelectedId(skill.id)}
                      onToggle={() => void toggleSkill(skill)}
                      onToggleFavourite={() => favourite(skill)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {showCreate && (
        <AddSkillDialog
          projects={snapshot.projects}
          onClose={() => setShowCreate(false)}
          onImport={async (input) => {
            await importArchive(input)
          }}
          onCreate={async (input) => {
            await create(input)
          }}
        />
      )}

      <SettingsDialog
        open={showSettings}
        config={config}
        homeDir={snapshot.homeDir}
        onClose={() => setShowSettings(false)}
        onConfigure={configure}
        onPickDirectory={pickDirectory}
      />

      <UpdatesPanel
        open={showUpdates}
        onClose={() => setShowUpdates(false)}
        checkUpdates={async () => {
          const result = await checkUpdates()
          if (result) setUpdateCount(result.updates.length)
          return result
        }}
        applyUpdates={applyUpdates}
      />

      <AddRepoDialog
        open={showAddRepo}
        onClose={() => setShowAddRepo(false)}
        onAdd={async (input) => {
          await addRepo(input)
        }}
      />

      <InstallSkillDialog
        skill={installTarget}
        repoSlug={activeRepo ?? ''}
        targets={installTargets}
        onClose={() => setInstallTarget(null)}
        onInstall={async ({ targetKeys, scope, projectName }) => {
          if (!installTarget || !activeRepo) return
          const base = { repo: activeRepo, skillId: installTarget.id }
          // Importing to the library always happens; a checked local target
          // with project scope additionally places a copy in that project.
          const localProject = targetKeys.includes('local') && scope === 'project'
          await installRepoSkill(
            localProject ? { ...base, scope: 'project', projectName } : { ...base, scope: 'global' },
          )
          // Then fan out to the checked machines, remembering every failure
          // so one offline machine doesn't hide the rest.
          const failures: string[] = []
          for (const key of targetKeys.filter((target) => target !== 'local')) {
            try {
              await installOnMachine(key, { ...base, scope, projectName })
            } catch (cause) {
              failures.push(cause instanceof Error ? cause.message : String(cause))
            }
          }
          if (failures.length > 0) throw new Error(failures.join(' · '))
        }}
      />

      {machineDialog === 'add' ? (
        <MachineDialog onClose={() => setMachineDialog(null)} onSubmit={addMachine} />
      ) : machineDialog ? (
        <MachineDialog
          key={machineDialog}
          initial={machineSnapshots.find((entry) => entry.machine.name === machineDialog)?.machine}
          onClose={() => setMachineDialog(null)}
          onSubmit={async (machine) => {
            await updateMachine(machineDialog, machine)
            // Keep the open pane pointed at the machine under its new name.
            if (activeMachine === machineDialog) setActiveMachine(machine.name)
          }}
        />
      ) : null}
    </div>
  )
}

function CategoryChip({
  label,
  count,
  active,
  muted = false,
  onClick,
}: {
  label: string
  count?: number
  active: boolean
  muted?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-medium transition ${
        active
          ? 'border-[#f97316] bg-[#1a1109] text-[#fb923c]'
          : muted
            ? 'border-dashed border-[#27272a] text-[#71717a] hover:border-[#3a3a42]'
            : 'border-[#27272a] bg-[#111114] text-[#a1a1aa] hover:border-[#3a3a42] hover:text-[#e4e4e7]'
      }`}
    >
      {label}
      {count !== undefined && <span className="font-mono text-[10.5px] opacity-70">{count}</span>}
    </button>
  )
}
