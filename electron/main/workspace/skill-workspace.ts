/**
 * SkillWorkspace — the deep module behind the `window.skilldex` seam.
 *
 * Small interface (get config, get snapshot, configure sources); large hidden
 * implementation (multi-source scanning, dedup, per-source error isolation).
 * Dependencies are injected so tests exercise the whole thing through this
 * interface against a fixture home directory and a temp config store.
 */

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { syncAgentLinks } from './agent-links'
import { logger } from './log'
import { findOriginCandidates, type OriginCandidate } from './origin-finder'
import { categorizeSkills, createClassifierFromConfig, type ClassifierClient } from './categorizer'
import type { ConfigStore } from './config'
import { createMemoryLibraryStore, type LibraryStore } from './library-store'
import { favouriteKeyFor } from './favourite-key'
import {
  listSkillFiles,
  packSkillFiles,
  resolveProjectDirs,
  scanPersonalSkills,
  scanPluginSkills,
  scanProjectSkills,
} from './filesystem-source'
import {
  changedFilesBetween,
  downloadRepoSkill,
  fetchRepoCatalog,
  parseRepoInput,
  type FetchLike,
  type RepoScan,
} from './repo-catalog'
import {
  disableSkillDir,
  enableSkillDir,
  removeSkillDir,
  scaffoldSkill,
  slugify,
  DISABLED_DIR,
  inspectSkillPath,
} from './skill-manager'
import { createMachineManager, type ExecLike, type MachineManager } from './machines'
import { mapWithConcurrency } from './concurrency'
import {
  MAX_ARCHIVE_BYTES,
  MAX_UNPACKED_BYTES,
  planSkillArchive,
  readZip,
  removeSkillForReplace,
  writeSkillArchive,
  type ArchiveEntry,
} from './skill-archive'
import type {
  ApplyUpdatesResult,
  LinkOriginsResult,
  TagChange,
  CheckUpdatesResult,
  CreateSkillInput,
  DistributeSkillInput,
  DistributeSkillResult,
  ImportSkillArchiveInput,
  ImportSkillFilesInput,
  ImportSkillFilesResult,
  SkillLookup,
  InstallRepoSkillInput,
  LibrarySkillMeta,
  MachineRecord,
  MachineDiff,
  MachinePlugins,
  MachineSnapshot,
  AvailablePlugin,
  PluginOpInput,
  RepoCatalog,
  SkillCategory,
  SkillFile,
  SkillUpdate,
  SkillRecord,
  SourceRecord,
  SyndicationTarget,
  WorkspaceConfig,
  WorkspaceSnapshot,
} from './types'

export type SkillWorkspaceDeps = {
  homeDir: string
  configStore: ConfigStore
  /** Injected in tests; defaults to the global fetch. */
  fetchImpl?: FetchLike
  /** Bundled agent file for machine management; absent → machines unavailable. */
  agentPath?: string
  /** Injected in tests; defaults to spawning real ssh. */
  execImpl?: ExecLike
  /** Persist SSH host keys here (container mode). */
  knownHostsFile?: string
  /** Library ledger (import provenance + syndication); in-memory when absent. */
  libraryStore?: LibraryStore
  /** Builds the LLM classifier from config; injected in tests. */
  classifierFactory?: (config: WorkspaceConfig) => ClassifierClient | null
  /** Identity of the host we run on (for "self" machine records); injected in tests. */
  self?: { host?: string; user?: string; homeDir?: string }
}

/** Result of a syndication change: the library view plus the machine's new state. */
export type SyndicationResult = {
  workspace: WorkspaceSnapshot
  machine: MachineSnapshot
}

export type SetSyndicationInput = {
  /** Library skill id (its canonical path). */
  skillId: string
  machine: string
  enabled: boolean
  scope: 'global' | 'project'
  projectName?: string
}

export type SetSkillEnabledInput = {
  /** Library skill id (its canonical path). */
  skillId: string
  enabled: boolean
  /**
   * Where to apply: just the local copy, one syndicated machine, or the
   * local copy plus every syndicated machine.
   */
  target: 'local' | 'everywhere' | { machine: string; scope: 'global' | 'project'; projectName?: string }
}

export type SetSkillEnabledResult = {
  workspace: WorkspaceSnapshot
  /** Fresh snapshots for every machine that was touched. */
  machines: MachineSnapshot[]
}

export type AdoptResult = {
  workspace: WorkspaceSnapshot
  /** Skill folder names that landed in the library. */
  adopted: string[]
  /** Per-skill failures (name → message); the rest still succeeded. */
  failed: Record<string, string>
}

export type ConvergeResult = {
  workspace: WorkspaceSnapshot
  machine: MachineSnapshot
  installed: string[]
  failed: Record<string, string>
}

export type ClearResult = {
  workspace: WorkspaceSnapshot
  machine: MachineSnapshot
  removed: string[]
  failed: Record<string, string>
  /** Skills left in place because the library holds no copy (irreversible to remove). */
  kept: string[]
}

export type SkillWorkspace = {
  getConfig(): Promise<WorkspaceConfig>
  getSnapshot(): Promise<WorkspaceSnapshot>
  configureSources(config: WorkspaceConfig): Promise<WorkspaceSnapshot>
  /** Raw SKILL.md markdown for a known skill, or null if the id is unknown. */
  getSkillReadme(id: string): Promise<string | null>
  /** Files inside a known skill's directory, or null if the id is unknown. */
  listSkillFiles(id: string): Promise<SkillFile[] | null>
  /** Absolute SKILL.md path for a known skill, for a validated reveal. Null if unknown. */
  resolveSkillPath(id: string): Promise<string | null>
  /** Move a disabled skill back into its skills root. Returns the fresh snapshot. */
  enableSkill(id: string): Promise<WorkspaceSnapshot>
  /** Park a skill in its `.disabled/` folder. Returns the fresh snapshot. */
  disableSkill(id: string): Promise<WorkspaceSnapshot>
  /** Delete a skill from disk (destructive). Returns the fresh snapshot. */
  removeSkill(id: string): Promise<WorkspaceSnapshot>
  /** Flip a skill's favourite state (persisted in config). Returns the fresh snapshot. */
  toggleFavourite(id: string): Promise<WorkspaceSnapshot>
  /** Scaffold a new skill folder with a SKILL.md. Returns the fresh snapshot. */
  createSkill(input: CreateSkillInput): Promise<WorkspaceSnapshot>
  /** Unpack a zipped skill into the global or a project skills root. Returns the fresh snapshot. */
  importSkillArchive(input: ImportSkillArchiveInput): Promise<WorkspaceSnapshot>
  /** Write a skill from loose files (agent/API upload); `replace` swaps an existing copy. */
  importSkillFiles(input: ImportSkillFilesInput): Promise<ImportSkillFilesResult>
  /** Where a skill (by name, folder, or id) lives: library copies and each machine's copy. */
  findSkill(name: string, options?: { machines?: boolean }): Promise<SkillLookup>
  /** Push a library skill to machines — repo-pinned pull or file push, per skill provenance. */
  distributeSkill(input: DistributeSkillInput): Promise<DistributeSkillResult>
  /** Catalogs for every configured skill repo (per-repo errors inline, never thrown). */
  listRepoCatalogs(): Promise<RepoCatalog[]>
  /** Validate, scan, and persist a new skill repo. Returns all catalogs. */
  addSkillRepo(input: string): Promise<RepoCatalog[]>
  /** Forget a configured skill repo (never touches installed skills). Returns all catalogs. */
  removeSkillRepo(slug: string): Promise<RepoCatalog[]>
  /** Re-scan one configured skill repo. Returns all catalogs. */
  refreshSkillRepo(slug: string): Promise<RepoCatalog[]>
  /** Download a catalog skill into the global or a project skills root. */
  installRepoSkill(input: InstallRepoSkillInput): Promise<WorkspaceSnapshot>
  /** Every configured machine's library, fetched in parallel (per-machine errors inline). */
  listMachineSnapshots(): Promise<MachineSnapshot[]>
  /** Validate reachability (pushes the agent), then persist a new machine. */
  addMachine(machine: MachineRecord): Promise<MachineSnapshot[]>
  /**
   * Rename or re-point an existing machine. A changed host/user is pinged
   * before saving; a rename carries the library's syndication targets along.
   */
  updateMachine(name: string, machine: MachineRecord): Promise<MachineSnapshot[]>
  /** Forget a machine (never touches its skills). */
  removeMachine(name: string): Promise<MachineSnapshot[]>
  /** Re-scan one machine. */
  refreshMachine(name: string): Promise<MachineSnapshot>
  /** Install a catalog skill onto a machine (imports into the library first). */
  installOnMachine(name: string, input: InstallRepoSkillInput): Promise<MachineSnapshot>
  /** Enable/disable/remove a skill on a machine. Returns its fresh snapshot. */
  machineSkillOp(name: string, op: 'enable' | 'disable' | 'remove', id: string): Promise<MachineSnapshot>
  /** Claude Code plugin inventory for every machine (parallel; per-machine errors, never throws). */
  listMachinePlugins(): Promise<MachinePlugins[]>
  machinePlugins(name: string): Promise<MachinePlugins>
  /** What a machine's marketplaces offer (large; fetched on demand). */
  availablePlugins(name: string): Promise<AvailablePlugin[]>
  /** Install/uninstall/enable/disable a plugin on one machine through its `claude` CLI. */
  machinePluginOp(name: string, input: PluginOpInput): Promise<MachinePlugins>
  /** Syndicate a library skill to a machine (or uninstall it from one). */
  setSyndication(input: SetSyndicationInput): Promise<SyndicationResult>
  /** Enable/disable with granular reach: locally, on one machine, or everywhere. */
  setSkillEnabled(input: SetSkillEnabledInput): Promise<SetSkillEnabledResult>
  /** Compare a machine's Personal skills with the library, by folder name. */
  machineDiff(name: string): Promise<MachineDiff>
  /**
   * Bring machine-local skills into the library. Skills with a known GitHub
   * origin re-import from it (pinned); the rest are copied off the machine.
   * The machine's copy is left untouched and recorded as syndicated there.
   */
  adoptFromMachine(name: string, skillIds: string[]): Promise<AdoptResult>
  /** Install every library skill (or the given folder names) missing from a machine. */
  convergeMachine(name: string, dirNames?: string[]): Promise<ConvergeResult>
  /**
   * Compare every repo-pinned library skill against its repo's current
   * commit (fresh scan) and report the ones whose folder actually changed.
   */
  checkUpdates(): Promise<CheckUpdatesResult>
  /**
   * Update the given library skills (all available when omitted): re-download
   * at the repo's current commit, swap the library copy atomically, re-pin,
   * and re-push to every syndicated machine. Local edits are overwritten —
   * the UI warns when a skill has been modified since import.
   */
  applyUpdates(skillIds?: string[]): Promise<ApplyUpdatesResult>
  /**
   * Suggest where an orphaned library skill (no repo pin) came from, ranked
   * by confidence. Only searches repos the user has added.
   */
  findOrigin(skillId: string): Promise<OriginCandidate[]>
  /**
   * Link a library skill to a repo origin, pinning it there so it becomes
   * updatable. Files are left as they are; only the ledger changes.
   */
  linkOrigin(skillId: string, origin: { repo: string; path: string; ref: string }): Promise<WorkspaceSnapshot>
  /**
   * Run findOrigin across every unpinned library skill and link the ones
   * whose SKILL.md is byte-identical to a tracked repo's copy. Only exact
   * matches are linked — a same-name skill that was edited locally is
   * reported as "likely" so it can be linked deliberately. Safe to re-run;
   * meant to be run right after adding a source.
   */
  linkOrigins(): Promise<LinkOriginsResult>
  /**
   * Uninstall library-managed skills from a machine (all of them, or the
   * given folder names) so they can be brought back selectively. Skills the
   * library has no copy of are never touched — removing those would be
   * irreversible.
   */
  clearMachine(name: string, dirNames?: string[]): Promise<ClearResult>
  /**
   * Assign categories to library skills that lack one (or all, when force).
   * Manual assignments are never touched. Structural inference is free; the
   * LLM layer runs only when an Anthropic API key is configured.
   */
  categorizeLibrary(options?: { force?: boolean }): Promise<CategorizeResult>
  /** Manually set (or clear with null) a library skill's category. */
  setSkillCategory(skillId: string, category: SkillCategory | null): Promise<WorkspaceSnapshot>
  /**
   * Replace a library skill's tags. Tags are normalized (see normalizeTag);
   * an empty list removes the field.
   */
  setSkillTags(skillId: string, tags: string[]): Promise<WorkspaceSnapshot>
  /**
   * Add and/or remove tags across many library skills at once. Unknown or
   * non-library ids are skipped and reported in `skipped`.
   */
  tagSkills(skillIds: string[], change: TagChange): Promise<{ workspace: WorkspaceSnapshot; tagged: number; skipped: string[] }>
}

export type CategorizeResult = {
  workspace: WorkspaceSnapshot
  categorized: number
  /** Skills that could not be categorized (no structural signal, no LLM key or LLM skipped them). */
  uncategorized: number
  usedLlm: boolean
}

/** Management is only meaningful for skills we own on disk, never plugin skills. */
function assertManageable(skill: SkillRecord | null): asserts skill is SkillRecord {
  if (!skill) throw new Error('Unknown skill.')
  if (skill.sourceKind === 'Plugin') throw new Error('Plugin skills are managed by their plugin.')
}

export function createSkillWorkspace({
  homeDir,
  configStore,
  fetchImpl: injectedFetch = globalThis.fetch as unknown as FetchLike,
  agentPath,
  execImpl,
  knownHostsFile,
  libraryStore = createMemoryLibraryStore(),
  classifierFactory = createClassifierFromConfig,
  self = {},
}: SkillWorkspaceDeps): SkillWorkspace {
  // Every api.github.com call carries the configured token when one exists:
  // unauthenticated requests share a 60/hour per-IP limit that one update
  // check across a handful of repos exhausts; any token makes it 5,000/hour.
  const fetchImpl: FetchLike = async (url, init) => {
    if (url.startsWith('https://api.github.com')) {
      const token = (await configStore.load()).githubToken || process.env.GITHUB_TOKEN
      if (token) init = { ...init, headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}` } }
    }
    return injectedFetch(url, init)
  }

  const machineManager: MachineManager | null = agentPath
    ? createMachineManager({ agentPath, execImpl, knownHostsFile, selfHost: self.host, selfUser: self.user })
    : null
  const selfHomeDir = self.homeDir ?? os.homedir()

  function machines(): MachineManager {
    if (!machineManager) throw new Error('Machine management is not available in this build.')
    return machineManager
  }

  async function findMachine(name: string): Promise<MachineRecord> {
    const config = await configStore.load()
    const machine = config.machines.find((entry) => entry.name === name)
    if (!machine) throw new Error(`Unknown machine: ${name}`)
    return machine
  }

  /**
   * A machine record for the very host we run on, when our homeDir is that
   * host's home, points at the library itself: bulk removals there would
   * delete the only copy of everything they promise to restore. Refuse.
   */
  function assertNotLibraryHost(machine: MachineRecord, action: string): void {
    if (!machineManager?.isSelf(machine)) return
    if (path.resolve(homeDir) !== path.resolve(selfHomeDir)) return
    throw new Error(
      `${machine.name} is this host — its ~/.claude/skills is the library itself, so ${action} would delete the library. Use the library view instead.`,
    )
  }

  async function snapshotsFor(records: MachineRecord[]): Promise<MachineSnapshot[]> {
    const manager = machines()
    return Promise.all(records.map((machine) => manager.snapshot(machine)))
  }
  // Ids seen in the most recent snapshot — the allow-list guarding path access
  // so the renderer can never read or reveal an arbitrary filesystem path.
  const known = new Map<string, SkillRecord>()

  // Scanned repo catalogs, keyed by slug. Main-process memory only: the
  // renderer sees the serializable catalog, while the per-skill file lists stay
  // here so installs can only ever fetch paths we discovered ourselves.
  const repoScans = new Map<string, RepoScan>()

  async function scanRepo(slug: string, force = false): Promise<RepoScan> {
    const cached = repoScans.get(slug)
    if (cached && !force) return cached
    const scan = await fetchRepoCatalog({ slug }, fetchImpl)
    repoScans.set(slug, scan)
    return scan
  }

  /** Scan every tracked repo, skipping (and logging) ones that fail. */
  async function scanTrackedRepos(config: WorkspaceConfig): Promise<RepoScan[]> {
    const scans: RepoScan[] = []
    for (const slug of config.skillRepos) {
      try {
        scans.push(await scanRepo(slug))
      } catch (cause) {
        logger.warn('origin.scanFailed', { repo: slug, error: cause instanceof Error ? cause.message : String(cause) })
      }
    }
    return scans
  }

  /**
   * Pin a library skill to a repo origin in the ledger. Files are untouched;
   * targets, adoption provenance and category survive the re-pin.
   */
  async function pinOrigin(dirName: string, origin: { repo: string; path: string; ref: string }): Promise<void> {
    const existing = (await libraryStore.load())[dirName]
    await libraryStore.set(dirName, { ...EMPTY_META, ...existing, repo: origin.repo, path: origin.path, ref: origin.ref })
    logger.info('origin.linked', { skill: dirName, repo: origin.repo, ref: origin.ref })
  }

  async function catalogsFor(slugs: string[]): Promise<RepoCatalog[]> {
    return Promise.all(
      slugs.map(async (slug) => {
        try {
          return (await scanRepo(slug)).catalog
        } catch (cause) {
          return {
            slug,
            url: `https://github.com/${slug}`,
            ref: 'HEAD',
            skills: [],
            linkedRepos: [],
            truncated: false,
            error: cause instanceof Error ? cause.message : String(cause),
          }
        }
      }),
    )
  }

  /**
   * Ensure a catalog skill exists in the library: the canonical copy under
   * `~/.claude/skills` (downloaded at the catalog's current commit if
   * missing) plus a ledger entry pinned to that version. Idempotent — an
   * existing copy keeps its pinned ref. Only skills discovered in user-added
   * repos are accepted.
   */
  async function ensureLibraryCopy(
    config: WorkspaceConfig,
    input: { repo: string; skillId: string },
  ): Promise<{ dirName: string; meta: LibrarySkillMeta }> {
    if (!config.skillRepos.includes(input.repo)) throw new Error('Unknown skill repo.')
    const scan = await scanRepo(input.repo)
    const skill = scan.catalog.skills.find((entry) => entry.id === input.skillId)
    const files = skill && scan.filesBySkill.get(skill.id)
    if (!skill || !files) throw new Error('Unknown skill in this repo.')

    const dirName = skill.path ? path.posix.basename(skill.path) : slugify(skill.name)
    const pinnedRef = scan.catalog.commitSha ?? scan.catalog.ref
    const root = path.join(homeDir, '.claude', 'skills')
    const dest = path.join(root, dirName)

    const exists =
      (await fs.access(dest).then(() => true).catch(() => false)) ||
      (await fs.access(path.join(root, '.disabled', dirName)).then(() => true).catch(() => false))
    if (!exists) {
      await fs.mkdir(root, { recursive: true })
      await downloadRepoSkill({
        slug: scan.catalog.slug,
        ref: pinnedRef,
        dir: skill.path,
        files,
        dest,
        fetchImpl,
      })
      // Record provenance the same way the skills CLI does, so the detail
      // view's Source panel lights up. Best-effort.
      await writeSkillLockEntry(homeDir, dirName, {
        source: scan.catalog.slug,
        sourceType: 'github',
        sourceUrl: `https://github.com/${scan.catalog.slug}.git`,
        skillPath: skill.path ? `${skill.path}/SKILL.md` : 'SKILL.md',
      }).catch(() => {})
    }

    const existing = (await libraryStore.load())[dirName]
    // Spread the existing entry so category/adoptedFrom survive; an existing
    // library copy also keeps the version it was imported at.
    const meta: LibrarySkillMeta = {
      ...existing,
      repo: input.repo,
      path: skill.path,
      ref: existing?.ref ?? pinnedRef,
      targets: existing?.targets ?? [],
    }
    await libraryStore.set(dirName, meta)
    return { dirName, meta }
  }

  /** Skills root for a create/install target — global, or one configured project. */
  async function resolveTargetRoot(
    config: WorkspaceConfig,
    scope: 'global' | 'project',
    projectName?: string,
  ): Promise<string> {
    if (scope === 'project') {
      const dirs = await resolveProjectDirs(config.projectRoots)
      const match = dirs.find((dir) => path.basename(dir) === projectName)
      if (!match) throw new Error(`Unknown project: ${projectName ?? '(none selected)'}`)
      return path.join(match, '.claude', 'skills')
    }
    return path.join(homeDir, '.claude', 'skills')
  }

  /** Import into the library; a project-scoped install adds a project copy too. */
  async function importToLibrary(config: WorkspaceConfig, input: InstallRepoSkillInput): Promise<void> {
    const { dirName, meta } = await ensureLibraryCopy(config, input)
    if (input.scope !== 'project') return
    const scan = await scanRepo(input.repo)
    const files = scan.filesBySkill.get(input.skillId)
    if (!files) throw new Error('Unknown skill in this repo.')
    const root = await resolveTargetRoot(config, 'project', input.projectName)
    await fs.mkdir(root, { recursive: true })
    await downloadRepoSkill({
      slug: meta.repo,
      ref: meta.ref,
      dir: meta.path,
      files,
      dest: path.join(root, dirName),
      fetchImpl,
    })
  }

  async function resolveKnown(id: string): Promise<SkillRecord | null> {
    if (known.has(id)) return known.get(id)!
    await buildSnapshot(await configStore.load())
    return known.get(id) ?? null
  }

  async function buildSnapshot(config: WorkspaceConfig): Promise<WorkspaceSnapshot> {
    const sources: SourceRecord[] = []
    const errors: string[] = []
    const collected: SkillRecord[] = []

    // Reconcile other agents' skill directories (e.g. codex symlinks) before
    // scanning. Every read and mutation funnels through here, so links
    // self-heal after any change — including the toggle being switched off.
    errors.push(
      ...(await syncAgentLinks(
        [homeDir, ...(await resolveProjectDirs(config.projectRoots).catch(() => []))],
        config.agents,
      )),
    )

    if (config.includePersonal) {
      const result = await scanPersonalSkills(homeDir)
      sources.push({ kind: 'Personal', root: '~/.claude/skills', skillCount: result.skills.length, error: result.error })
      if (result.error) errors.push(`Personal skills: ${result.error}`)
      collected.push(...result.skills)
    }

    if (config.includePlugins) {
      const result = await scanPluginSkills(homeDir)
      sources.push({ kind: 'Plugin', root: '~/.claude/plugins', skillCount: result.skills.length, error: result.error })
      if (result.error) errors.push(`Plugin skills: ${result.error}`)
      collected.push(...result.skills)
    }

    const projectScan = await scanProjectSkills(config.projectRoots, homeDir)
    if (config.projectRoots.length > 0) {
      sources.push({ kind: 'Project', root: `${projectScan.projects.length} project(s)`, skillCount: projectScan.skills.length })
    }
    errors.push(...projectScan.errors)
    collected.push(...projectScan.skills)

    const favourites = new Set(config.favourites)
    const library = await libraryStore.load()
    const skills = dedupe(collected).map((skill) => ({
      ...skill,
      isFavourite: favourites.has(favouriteKeyFor(skill.realPath)),
      // Library metadata attaches to canonical (Personal) copies by folder name.
      library:
        skill.sourceKind === 'Personal' ? library[path.basename(skill.realPath)] : undefined,
    }))

    known.clear()
    for (const skill of skills) known.set(skill.id, skill)

    return {
      skills,
      projects: projectScan.projects.sort((a, b) => a.name.localeCompare(b.name)),
      sources,
      errors,
      scannedAt: new Date().toISOString(),
      homeDir,
    }
  }

  return {
    getConfig: () => configStore.load(),

    async getSnapshot() {
      return buildSnapshot(await configStore.load())
    },

    async configureSources(config) {
      const saved = await configStore.save(config)
      return buildSnapshot(saved)
    },

    async getSkillReadme(id) {
      const skill = await resolveKnown(id)
      if (!skill) return null
      return fs.readFile(path.join(skill.realPath, 'SKILL.md'), 'utf8').catch(() => null)
    },

    async listSkillFiles(id) {
      const skill = await resolveKnown(id)
      if (!skill) return null
      return listSkillFiles(skill.realPath).catch(() => [])
    },

    async resolveSkillPath(id) {
      const skill = await resolveKnown(id)
      if (!skill) return null
      return path.join(skill.realPath, 'SKILL.md')
    },

    async enableSkill(id) {
      const skill = await resolveKnown(id)
      assertManageable(skill)
      if (!skill.enabled) await enableSkillDir(skill.path)
      return buildSnapshot(await configStore.load())
    },

    async disableSkill(id) {
      const skill = await resolveKnown(id)
      assertManageable(skill)
      if (skill.enabled) await disableSkillDir(skill.path)
      return buildSnapshot(await configStore.load())
    },

    async removeSkill(id) {
      const skill = await resolveKnown(id)
      assertManageable(skill)

      // Removing a library skill is a full uninstall: pull it off every
      // syndicated machine first. Any machine failure aborts before the local
      // copy is touched, so a retry can finish the job.
      const dirName = path.basename(skill.realPath)
      const meta = skill.sourceKind === 'Personal' ? (await libraryStore.load())[dirName] : undefined
      if (meta && meta.targets.length > 0) {
        const config = await configStore.load()
        const failures: string[] = []
        let remaining = meta.targets
        for (const target of meta.targets) {
          const machine = config.machines.find((entry) => entry.name === target.machine)
          if (machine) {
            try {
              await machines().uninstall(machine, {
                dirName,
                scope: target.scope,
                projectName: target.projectName,
              })
            } catch (cause) {
              failures.push(`${target.machine}: ${cause instanceof Error ? cause.message : String(cause)}`)
              continue
            }
          }
          remaining = withoutTarget(remaining, target)
        }
        await libraryStore.set(dirName, { ...meta, targets: remaining })
        if (failures.length > 0)
          throw new Error(`Could not uninstall from every machine — ${failures.join('; ')}. Local copy kept; try again.`)
      }

      await removeSkillDir(skill.path)
      if (meta) await libraryStore.set(dirName, null)
      // A deleted skill can't stay favourited — prune its key so the set never
      // accumulates dead entries.
      const config = await configStore.load()
      const key = favouriteKeyFor(skill.realPath)
      const saved = config.favourites.includes(key)
        ? await configStore.save({ ...config, favourites: config.favourites.filter((k) => k !== key) })
        : config
      return buildSnapshot(saved)
    },

    async toggleFavourite(id) {
      const skill = await resolveKnown(id)
      if (!skill) throw new Error('Unknown skill.')
      const config = await configStore.load()
      const key = favouriteKeyFor(skill.realPath)
      const favourites = config.favourites.includes(key)
        ? config.favourites.filter((k) => k !== key)
        : [...config.favourites, key]
      const saved = await configStore.save({ ...config, favourites })
      return buildSnapshot(saved)
    },

    async createSkill(input) {
      const name = input.name.trim()
      if (!name) throw new Error('A skill name is required.')

      const config = await configStore.load()
      const root = await resolveTargetRoot(config, input.scope, input.projectName)
      await fs.mkdir(root, { recursive: true })
      await scaffoldSkill(root, name, input.description.trim())
      return buildSnapshot(config)
    },

    async importSkillArchive(input) {
      if (typeof input.data !== 'string' || !input.data) throw new Error('No archive data received.')
      // Base64 inflates by 4/3; bound the encoded size before decoding.
      if (input.data.length > (MAX_ARCHIVE_BYTES * 4) / 3 + 4)
        throw new Error('Archive is larger than 32 MB.')
      const bytes = Buffer.from(input.data, 'base64')
      const fallbackName = path.basename(input.fileName || 'skill', path.extname(input.fileName || ''))
      const plan = planSkillArchive(readZip(bytes), fallbackName)

      const config = await configStore.load()
      const root = await resolveTargetRoot(config, input.scope, input.projectName)
      await writeSkillArchive(root, plan)
      return buildSnapshot(config)
    },

    async importSkillFiles(input) {
      if (!Array.isArray(input.files) || input.files.length === 0) throw new Error('No files provided.')
      let total = 0
      const entries: ArchiveEntry[] = input.files.map((file) => {
        if (typeof file.path !== 'string' || !file.path) throw new Error('Every file needs a path.')
        const data =
          typeof file.base64 === 'string'
            ? Buffer.from(file.base64, 'base64')
            : Buffer.from(typeof file.content === 'string' ? file.content : '', 'utf8')
        total += data.length
        if (total > MAX_UNPACKED_BYTES) throw new Error('Skill files exceed 64 MB.')
        return { path: file.path, data }
      })
      const explicitName = input.name?.trim()
      const plan = planSkillArchive(entries, explicitName || 'skill')
      if (explicitName) plan.dirName = slugify(explicitName)

      const config = await configStore.load()
      const root = await resolveTargetRoot(config, input.scope, input.projectName)
      if (input.replace) await removeSkillForReplace(root, plan.dirName)
      const dir = await writeSkillArchive(root, plan)
      logger.info('skill.import.files', { dirName: plan.dirName, scope: input.scope, replaced: Boolean(input.replace) })
      return { dirName: plan.dirName, path: dir, workspace: await buildSnapshot(config) }
    },

    async findSkill(name, options = {}) {
      const needle = name.trim()
      if (!needle) throw new Error('A skill name is required.')
      const config = await configStore.load()
      const snapshot = await buildSnapshot(config)
      const matches = matchesSkillName(needle)
      const library = snapshot.skills.filter(matches)

      const includeMachines = options.machines !== false && machineManager !== null && config.machines.length > 0
      const machines = includeMachines
        ? (await snapshotsFor(config.machines)).map((entry) => {
            if (!entry.snapshot) return { machine: entry.machine.name, present: false, error: entry.error ?? 'Not scanned.' }
            const skill = entry.snapshot.skills.find(matches)
            return skill
              ? { machine: entry.machine.name, present: true, skill }
              : { machine: entry.machine.name, present: false }
          })
        : []
      return { name: needle, library, machines }
    },

    async distributeSkill(input) {
      const config = await configStore.load()
      const snapshot = await buildSnapshot(config)
      const needle = (input.skillId ?? input.name ?? '').trim()
      if (!needle) throw new Error('A skill name or id is required.')
      const matches = matchesSkillName(needle)
      const candidates = snapshot.skills.filter((skill) => skill.sourceKind === 'Personal' && matches(skill))
      if (candidates.length === 0) throw new Error(`No library skill named "${needle}". Only global (library) skills can be distributed.`)
      if (candidates.length > 1) throw new Error(`"${needle}" is ambiguous; pass skillId (one of ${candidates.map((s) => s.id).join(', ')}).`)
      const dirName = dirNameOf(candidates[0])

      const targets = input.machines?.length ? input.machines : config.machines.map((machine) => machine.name)
      if (targets.length === 0) throw new Error('No machines configured.')

      // Sequential on purpose: each converge does a load→modify→write of the
      // shared ledger, and concurrent writers would drop each other's targets.
      const results: DistributeSkillResult['results'] = {}
      for (const name of targets) {
          try {
            const machine = await findMachine(name)
            let replaced = false
            if (input.replace) {
              assertNotLibraryHost(machine, 'replace')
              const current = await machines().snapshot(machine)
              if (!current.snapshot) throw new Error(current.error ?? 'Machine not reachable.')
              const existing = current.snapshot.skills.find(
                (skill) => skill.sourceKind === 'Personal' && dirNameOf(skill) === dirName,
              )
              if (existing) {
                await machines().skillOp(machine, 'remove', existing.id)
                replaced = true
              }
            }
            const outcome = await this.convergeMachine(name, [dirName])
            if (outcome.installed.includes(dirName)) results[name] = { status: replaced ? 'replaced' : 'installed' }
            else if (outcome.failed[dirName]) results[name] = { status: 'failed', error: outcome.failed[dirName] }
            else results[name] = { status: 'present' }
          } catch (cause) {
            results[name] = { status: 'failed', error: cause instanceof Error ? cause.message : String(cause) }
          }
      }
      logger.info('skill.distribute', { dirName, results })
      return { dirName, results, workspace: await buildSnapshot(config) }
    },

    async listRepoCatalogs() {
      const config = await configStore.load()
      return catalogsFor(config.skillRepos)
    },

    async addSkillRepo(input) {
      const parsed = parseRepoInput(input)
      if (!parsed)
        throw new Error('Enter a GitHub repository like owner/repo or https://github.com/owner/repo.')

      // Scan before persisting, so a typo'd or unreachable repo is rejected
      // with the fetch error instead of being saved broken.
      const scan = await fetchRepoCatalog(parsed, fetchImpl)
      repoScans.set(parsed.slug, scan)

      const config = await configStore.load()
      const saved = config.skillRepos.includes(parsed.slug)
        ? config
        : await configStore.save({ ...config, skillRepos: [...config.skillRepos, parsed.slug] })
      return catalogsFor(saved.skillRepos)
    },

    async removeSkillRepo(slug) {
      const config = await configStore.load()
      const saved = await configStore.save({
        ...config,
        skillRepos: config.skillRepos.filter((existing) => existing !== slug),
      })
      repoScans.delete(slug)
      return catalogsFor(saved.skillRepos)
    },

    async refreshSkillRepo(slug) {
      const config = await configStore.load()
      if (config.skillRepos.includes(slug)) await scanRepo(slug, true)
      return catalogsFor(config.skillRepos)
    },

    async installRepoSkill(input) {
      const config = await configStore.load()
      await importToLibrary(config, input)
      return buildSnapshot(config)
    },

    async listMachineSnapshots() {
      const config = await configStore.load()
      return snapshotsFor(config.machines)
    },

    async addMachine(machine) {
      const name = machine.name.trim()
      const host = machine.host.trim()
      const user = machine.user.trim()
      if (!name || !host || !user) throw new Error('Machine name, host, and user are all required.')

      const config = await configStore.load()
      if (config.machines.some((entry) => entry.name === name))
        throw new Error(`A machine named "${name}" already exists.`)

      // Reach it (and push the agent) before persisting, so a typo'd host is
      // rejected with the SSH error instead of being saved broken.
      const record: MachineRecord = { name, host, user }
      await machines().ping(record)

      const saved = await configStore.save({ ...config, machines: [...config.machines, record] })
      return snapshotsFor(saved.machines)
    },

    async updateMachine(name, machine) {
      const next: MachineRecord = {
        name: machine.name.trim(),
        host: machine.host.trim(),
        user: machine.user.trim(),
      }
      if (!next.name || !next.host || !next.user)
        throw new Error('Machine name, host, and user are all required.')

      const config = await configStore.load()
      const current = config.machines.find((entry) => entry.name === name)
      if (!current) throw new Error(`Unknown machine: ${name}`)
      if (next.name !== name && config.machines.some((entry) => entry.name === next.name))
        throw new Error(`A machine named "${next.name}" already exists.`)

      // Only a changed login target needs to prove itself; a pure rename
      // shouldn't fail because the box happens to be asleep right now.
      if (next.host !== current.host || next.user !== current.user) await machines().ping(next)

      const saved = await configStore.save({
        ...config,
        machines: config.machines.map((entry) => (entry.name === name ? next : entry)),
      })

      if (next.name !== name) {
        // Syndication targets reference machines by name — follow the rename
        // so the library keeps knowing where each skill lives.
        const ledger = await libraryStore.load()
        for (const [dirName, meta] of Object.entries(ledger)) {
          if (!meta.targets.some((target) => target.machine === name)) continue
          await libraryStore.set(dirName, {
            ...meta,
            targets: meta.targets.map((target) =>
              target.machine === name ? { ...target, machine: next.name } : target,
            ),
          })
        }
      }
      return snapshotsFor(saved.machines)
    },

    async removeMachine(name) {
      const config = await configStore.load()
      const saved = await configStore.save({
        ...config,
        machines: config.machines.filter((entry) => entry.name !== name),
      })
      return snapshotsFor(saved.machines)
    },

    async refreshMachine(name) {
      return machines().snapshot(await findMachine(name))
    },

    async installOnMachine(name, input) {
      const config = await configStore.load()
      // Machine installs route through the library: import (pinning the
      // version) first, then push that exact version to the machine.
      const { dirName, meta } = await ensureLibraryCopy(config, input)
      const machine = await findMachine(name)
      const snapshot = await machines().install(machine, {
        repo: meta.repo,
        skillId: input.skillId,
        scope: input.scope,
        projectName: input.projectName,
        ref: meta.ref,
      })
      await libraryStore.set(dirName, {
        ...meta,
        targets: withTarget(meta.targets, { machine: name, scope: input.scope, projectName: input.projectName }),
      })
      return { machine, snapshot }
    },

    async machineSkillOp(name, op, id) {
      const machine = await findMachine(name)
      const snapshot = await machines().skillOp(machine, op, id)
      return { machine, snapshot }
    },

    async listMachinePlugins() {
      const config = await configStore.load()
      const manager = machines()
      return Promise.all(config.machines.map((machine) => manager.plugins(machine)))
    },

    async machinePlugins(name) {
      return machines().plugins(await findMachine(name))
    },

    async availablePlugins(name) {
      return machines().availablePlugins(await findMachine(name))
    },

    async machinePluginOp(name, input) {
      const ops = ['install', 'uninstall', 'enable', 'disable'] as const
      if (!ops.includes(input.op)) throw new Error(`Unknown plugin op "${String(input.op)}".`)
      if (!input.plugin?.trim() || /\s/.test(input.plugin)) throw new Error('Invalid plugin id.')
      return machines().pluginOp(await findMachine(name), input)
    },

    async setSyndication(input) {
      const skill = await resolveKnown(input.skillId)
      if (!skill || skill.sourceKind !== 'Personal') throw new Error('Not a library skill.')
      const dirName = path.basename(skill.realPath)
      const meta = (await libraryStore.load())[dirName]
      if (!meta) throw new Error('This skill was not imported from a repo — syndication needs provenance.')

      const config = await configStore.load()
      const machine = await findMachine(input.machine)
      const target: SyndicationTarget = {
        machine: input.machine,
        scope: input.scope,
        projectName: input.projectName,
      }

      let snapshot: WorkspaceSnapshot
      if (input.enabled) {
        snapshot = await machines().install(machine, {
          repo: meta.repo,
          skillId: `${meta.repo}:${meta.path}`,
          scope: input.scope,
          projectName: input.projectName,
          ref: meta.ref,
        })
        await libraryStore.set(dirName, { ...meta, targets: withTarget(meta.targets, target) })
      } else {
        snapshot = await machines().uninstall(machine, {
          dirName,
          scope: input.scope,
          projectName: input.projectName,
        })
        await libraryStore.set(dirName, { ...meta, targets: withoutTarget(meta.targets, target) })
      }

      return {
        workspace: await buildSnapshot(config),
        machine: { machine, snapshot },
      }
    },

    async setSkillEnabled(input) {
      const skill = await resolveKnown(input.skillId)
      assertManageable(skill)
      const dirName = path.basename(skill.realPath)
      const config = await configStore.load()
      const touched: MachineSnapshot[] = []

      const applyLocal = async () => {
        if (input.enabled && !skill.enabled) await enableSkillDir(skill.path)
        if (!input.enabled && skill.enabled) await disableSkillDir(skill.path)
      }

      if (input.target === 'local') {
        await applyLocal()
      } else if (input.target === 'everywhere') {
        // Machines first: if one is unreachable we fail before touching the
        // local copy, so the visible state never silently diverges.
        const meta = skill.sourceKind === 'Personal' ? (await libraryStore.load())[dirName] : undefined
        const failures: string[] = []
        for (const target of meta?.targets ?? []) {
          const machine = config.machines.find((entry) => entry.name === target.machine)
          if (!machine) continue
          try {
            const snapshot = await machines().setEnabled(machine, {
              dirName,
              scope: target.scope,
              projectName: target.projectName,
              enabled: input.enabled,
            })
            touched.push({ machine, snapshot })
          } catch (cause) {
            failures.push(`${target.machine}: ${cause instanceof Error ? cause.message : String(cause)}`)
          }
        }
        if (failures.length > 0)
          throw new Error(
            `Could not ${input.enabled ? 'enable' : 'disable'} on every machine — ${failures.join('; ')}. Local copy left unchanged; try again.`,
          )
        await applyLocal()
      } else {
        const machine = await findMachine(input.target.machine)
        const snapshot = await machines().setEnabled(machine, {
          dirName,
          scope: input.target.scope,
          projectName: input.target.projectName,
          enabled: input.enabled,
        })
        touched.push({ machine, snapshot })
      }

      return { workspace: await buildSnapshot(config), machines: touched }
    },

    async machineDiff(name) {
      const machine = await findMachine(name)
      const remote = await machines().snapshot(machine)
      const local = await buildSnapshot(await configStore.load())
      const libraryNames = new Map(
        local.skills
          .filter((skill) => skill.sourceKind === 'Personal')
          .map((skill) => [dirNameOf(skill), skill] as const),
      )
      if (!remote.snapshot) {
        return { machine, onlyOnMachine: [], onlyInLibrary: [], inSync: 0, error: remote.error }
      }
      const remotePersonal = remote.snapshot.skills.filter((skill) => skill.sourceKind === 'Personal')
      const remoteNames = new Set(remotePersonal.map(dirNameOf))
      const diff = {
        machine,
        onlyOnMachine: remotePersonal.filter((skill) => !libraryNames.has(dirNameOf(skill))),
        onlyInLibrary: [...libraryNames.values()].filter((skill) => !remoteNames.has(dirNameOf(skill))),
        inSync: remotePersonal.filter((skill) => libraryNames.has(dirNameOf(skill))).length,
      }
      logger.info('sync.diff', {
        machine: name, library: libraryNames.size, machinePersonal: remotePersonal.length,
        machineTotal: remote.snapshot.skills.length, inSync: diff.inSync,
        onlyOnMachine: diff.onlyOnMachine.length, onlyInLibrary: diff.onlyInLibrary.length,
        onlyOnMachineNames: diff.onlyOnMachine.map(dirNameOf).slice(0, 50),
      })
      return diff
    },

    async adoptFromMachine(name, skillIds) {
      const machine = await findMachine(name)
      const config = await configStore.load()
      const root = path.join(homeDir, '.claude', 'skills')
      await fs.mkdir(root, { recursive: true })
      const adopted: string[] = []
      const failed: Record<string, string> = {}

      logger.info('sync.adopt.start', { machine: name, requested: skillIds.length })
      // Reads are independent SSH sessions — fetch a few at a time. The local
      // side (writes, repo scans) then runs in order, and the ledger is
      // written once at the end.
      const fetched = await mapWithConcurrency(skillIds, MACHINE_CONCURRENCY, async (id) => {
        try {
          return { id, ...(await machines().readSkill(machine, id)), error: null }
        } catch (cause) {
          return { id, skill: null, files: [], error: cause instanceof Error ? cause.message : String(cause) }
        }
      })

      type Pending = { dirName: string; apply: (existing: LibrarySkillMeta | undefined) => LibrarySkillMeta }
      const pending: Pending[] = []
      const target: SyndicationTarget = { machine: name, scope: 'global' }

      for (const item of fetched) {
        if (item.error !== null || !item.skill) {
          failed[item.id] = item.error ?? 'Unknown skill on this machine.'
          logger.warn('sync.adopt.failed', { machine: name, skill: item.id, error: failed[item.id] })
          continue
        }
        const { skill, files } = item
        let label = skill.name
        try {
          if (skill.sourceKind !== 'Personal') throw new Error('Only personal (global) skills can be adopted.')
          const dirName = dirNameOf(skill)
          label = dirName
          const dest = path.join(root, dirName)
          // A disabled library copy still counts as "in the library"; a
          // dangling link is debris and gets replaced by the writer.
          const states = await Promise.all(
            [dest, path.join(root, DISABLED_DIR, dirName)].map((candidate) => inspectSkillPath(candidate)),
          )
          const exists = states.includes('present')
          logger.debug('sync.adopt.skill', {
            machine: name, skill: dirName, files: files.length, symlink: skill.isSymlink,
            realPath: skill.realPath, origin: skill.origin?.label, existsInLibrary: exists,
          })

          if (exists) {
            // Already in the library — just record that this machine has it.
            pending.push({ dirName, apply: (existing) => ({ ...EMPTY_META, ...existing, targets: withTarget(existing?.targets ?? [], target) }) })
            logger.info('sync.adopt.linked', { machine: name, skill: dirName, reason: 'already in library' })
            adopted.push(dirName)
            continue
          }

          // Known GitHub origin from a repo we track → re-import pinned from
          // there, so the library copy is updatable. Otherwise copy the files.
          const origin = skill.origin
          const originRepo = origin?.host === 'github' ? origin.label : undefined
          if (originRepo && config.skillRepos.includes(originRepo)) {
            const scan = await scanRepo(originRepo)
            const match = scan.catalog.skills.find((entry) => path.posix.basename(entry.path) === dirName)
            const repoFiles = match && scan.filesBySkill.get(match.id)
            if (match && repoFiles) {
              const pinnedRef = scan.catalog.commitSha ?? scan.catalog.ref
              await downloadRepoSkill({ slug: originRepo, ref: pinnedRef, dir: match.path, files: repoFiles, dest, fetchImpl })
              pending.push({
                dirName,
                apply: (existing) => ({ ...EMPTY_META, ...existing, repo: originRepo, path: match.path, ref: pinnedRef, targets: [target], adoptedFrom: name }),
              })
              logger.info('sync.adopt.reimported', { machine: name, skill: dirName, repo: originRepo, ref: pinnedRef })
              adopted.push(dirName)
              continue
            }
            logger.debug('sync.adopt.originNoMatch', { machine: name, skill: dirName, repo: originRepo })
          }

          // Same writer as zip/file import: rejects `..`/absolute paths from
          // the (remote-supplied) file list, stages, then renames atomically.
          await writeSkillArchive(root, {
            dirName,
            files: files.map((file) => ({ path: file.path, data: Buffer.from(file.base64, 'base64') })),
          })
          pending.push({
            dirName,
            apply: (existing) => ({ ...EMPTY_META, ...existing, repo: originRepo ?? '', path: '', ref: '', targets: [target], adoptedFrom: name }),
          })
          logger.info('sync.adopt.copied', { machine: name, skill: dirName, files: files.length })
          adopted.push(dirName)
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : String(cause)
          failed[label] = message
          logger.warn('sync.adopt.failed', { machine: name, skill: label, error: message })
        }
      }

      if (pending.length > 0) {
        await libraryStore.update((skills) => {
          for (const entry of pending) skills[entry.dirName] = entry.apply(skills[entry.dirName])
        })
      }

      logger.info('sync.adopt.done', { machine: name, adopted: adopted.length, failed: Object.keys(failed).length })
      return { workspace: await buildSnapshot(config), adopted, failed }
    },

    async convergeMachine(name, dirNames) {
      const machine = await findMachine(name)
      const config = await configStore.load()
      const diff = await this.machineDiff(name)
      if (diff.error) throw new Error(diff.error)
      const wanted = new Set(dirNames ?? diff.onlyInLibrary.map(dirNameOf))
      const ledger = await libraryStore.load()
      const target: SyndicationTarget = { machine: name, scope: 'global' }
      const todo = diff.onlyInLibrary.filter((skill) => wanted.has(dirNameOf(skill)))

      // Installs are independent SSH sessions; run a few at once. The ledger
      // is written once afterwards, and one fresh snapshot replaces the
      // per-install rescans the agent used to ship back.
      const outcomes = await mapWithConcurrency(todo, MACHINE_CONCURRENCY, async (skill) => {
        const dirName = dirNameOf(skill)
        const meta = ledger[dirName]
        try {
          if (meta?.repo && meta.ref) {
            // Repo-backed: the machine pulls the pinned version from origin.
            await machines().install(machine, {
              repo: meta.repo,
              skillId: `${meta.repo}:${meta.path}`,
              scope: 'global',
              ref: meta.ref,
            })
          } else {
            // Hand-authored or adopted-without-origin: push the library's own files.
            await machines().writeSkill(machine, { dirName, files: await packSkillFiles(skill.realPath) })
          }
          logger.info('sync.converge.installed', { machine: name, skill: dirName, via: meta?.repo && meta.ref ? 'repo' : 'files' })
          return { dirName, error: null }
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : String(cause)
          logger.warn('sync.converge.failed', { machine: name, skill: dirName, error: message })
          return { dirName, error: message }
        }
      })

      const installed = outcomes.filter((outcome) => outcome.error === null).map((outcome) => outcome.dirName)
      const failed = Object.fromEntries(
        outcomes.filter((outcome) => outcome.error !== null).map((outcome) => [outcome.dirName, outcome.error as string]),
      )
      if (installed.length > 0) {
        await libraryStore.update((skills) => {
          for (const dirName of installed) {
            skills[dirName] = { ...EMPTY_META, ...skills[dirName], targets: withTarget(skills[dirName]?.targets ?? [], target) }
          }
        })
      }
      logger.info('sync.converge.done', { machine: name, installed: installed.length, failed: Object.keys(failed).length })

      const machineState = await machines().snapshot(machine)
      return { workspace: await buildSnapshot(config), machine: machineState, installed, failed }
    },

    async checkUpdates() {
      const config = await configStore.load()
      const local = await buildSnapshot(config)
      const ledger = await libraryStore.load()
      const errors: Record<string, string> = {}
      const updates: SkillUpdate[] = []

      // Fresh scans so we compare against the repos' *current* commits.
      const scans = new Map<string, RepoScan>()
      for (const slug of config.skillRepos) {
        try {
          scans.set(slug, await scanRepo(slug, true))
        } catch (cause) {
          errors[slug] = cause instanceof Error ? cause.message : String(cause)
        }
      }

      const pinned = local.skills.filter((skill) => {
        if (skill.sourceKind !== 'Personal') return false
        const meta = ledger[dirNameOf(skill)]
        return Boolean(meta?.repo && meta.ref)
      })

      for (const skill of pinned) {
        const dirName = dirNameOf(skill)
        const meta = ledger[dirName]!
        const scan = scans.get(meta.repo)
        if (!scan) continue
        const toRef = scan.catalog.commitSha ?? scan.catalog.ref
        if (toRef === meta.ref) continue
        // The repo moved — but did this skill's folder?
        try {
          const changed = await changedFilesBetween(meta.repo, meta.path, meta.ref, toRef, fetchImpl)
          if (changed.length === 0) continue
          updates.push({
            skillId: skill.id, dirName, repo: meta.repo, path: meta.path,
            fromRef: meta.ref, toRef, changedFiles: changed, targets: meta.targets.length,
          })
        } catch (cause) {
          errors[`${meta.repo}:${dirName}`] = cause instanceof Error ? cause.message : String(cause)
        }
      }
      logger.info('updates.check', { checked: pinned.length, available: updates.length, errors: Object.keys(errors).length })
      return { updates, checked: pinned.length, errors }
    },

    async applyUpdates(skillIds) {
      const config = await configStore.load()
      const check = await this.checkUpdates()
      const wanted = skillIds ? new Set(skillIds) : null
      const updated: string[] = []
      const failed: Record<string, string> = {}
      const repushed: ApplyUpdatesResult['repushed'] = {}

      for (const update of check.updates) {
        if (wanted && !wanted.has(update.skillId)) continue
        const skill = await resolveKnown(update.skillId)
        if (!skill) { failed[update.dirName] = 'Skill vanished before update.'; continue }
        const scan = await scanRepo(update.repo)
        const catalogSkill = scan.catalog.skills.find((entry) => entry.path === update.path)
        const files = catalogSkill && scan.filesBySkill.get(catalogSkill.id)
        if (!catalogSkill || !files) { failed[update.dirName] = 'Skill no longer in the repo at its new commit.'; continue }

        // Download beside the current copy, then swap — a failed download
        // never leaves the library without the skill.
        const root = path.dirname(skill.realPath)
        const staging = path.join(root, `.${update.dirName}.updating`)
        const backup = path.join(root, `.${update.dirName}.previous`)
        try {
          await fs.rm(staging, { recursive: true, force: true })
          await downloadRepoSkill({ slug: update.repo, ref: update.toRef, dir: update.path, files, dest: staging, fetchImpl })
          await fs.rm(backup, { recursive: true, force: true })
          await fs.rename(skill.realPath, backup)
          await fs.rename(staging, skill.realPath)
          await fs.rm(backup, { recursive: true, force: true })
        } catch (cause) {
          await fs.rm(staging, { recursive: true, force: true }).catch(() => {})
          // Restore if we got as far as moving the original.
          const restored = await fs.access(backup).then(() => true).catch(() => false)
          if (restored) await fs.rename(backup, skill.realPath).catch(() => {})
          failed[update.dirName] = cause instanceof Error ? cause.message : String(cause)
          logger.warn('updates.apply.failed', { skill: update.dirName, error: failed[update.dirName] })
          continue
        }

        const meta = (await libraryStore.load())[update.dirName]!
        await libraryStore.set(update.dirName, { ...meta, ref: update.toRef })
        updated.push(update.dirName)
        logger.info('updates.applied', { skill: update.dirName, from: update.fromRef.slice(0, 7), to: update.toRef.slice(0, 7), files: update.changedFiles.length })

        // Re-push to syndicated machines at the new pin: uninstall then install
        // so the machine ends up with exactly the new files.
        const outcome = { ok: [] as string[], failed: {} as Record<string, string> }
        for (const target of meta.targets) {
          const machine = config.machines.find((entry) => entry.name === target.machine)
          if (!machine) continue
          try {
            await machines().uninstall(machine, { dirName: update.dirName, scope: target.scope, projectName: target.projectName }).catch(() => {})
            await machines().install(machine, {
              repo: update.repo, skillId: `${update.repo}:${update.path}`,
              scope: target.scope, projectName: target.projectName, ref: update.toRef,
            })
            outcome.ok.push(target.machine)
          } catch (cause) {
            outcome.failed[target.machine] = cause instanceof Error ? cause.message : String(cause)
            logger.warn('updates.repush.failed', { skill: update.dirName, machine: target.machine, error: outcome.failed[target.machine] })
          }
        }
        if (meta.targets.length) repushed[update.dirName] = outcome
      }

      logger.info('updates.apply.done', { updated: updated.length, failed: Object.keys(failed).length })
      return { workspace: await buildSnapshot(config), updated, failed, repushed }
    },

    async findOrigin(skillId) {
      const skill = await resolveKnown(skillId)
      if (!skill || skill.sourceKind !== 'Personal') throw new Error('Not a library skill.')
      const config = await configStore.load()
      const candidates = await findOriginCandidates(skill.realPath, await scanTrackedRepos(config), fetchImpl)
      logger.info('origin.search', { skill: dirNameOf(skill), candidates: candidates.map((c) => `${c.repo}:${c.confidence}`) })
      return candidates
    },

    async linkOrigin(skillId, origin) {
      const skill = await resolveKnown(skillId)
      if (!skill || skill.sourceKind !== 'Personal') throw new Error('Not a library skill.')
      const config = await configStore.load()
      if (!config.skillRepos.includes(origin.repo)) throw new Error('Unknown skill repo.')
      await pinOrigin(dirNameOf(skill), origin)
      return buildSnapshot(config)
    },

    async linkOrigins() {
      const config = await configStore.load()
      const ledger = await libraryStore.load()
      const unpinned = (await buildSnapshot(config)).skills.filter(
        (skill) => skill.sourceKind === 'Personal' && !ledger[dirNameOf(skill)]?.repo,
      )
      const scans = await scanTrackedRepos(config)
      const linked: LinkOriginsResult['linked'] = []
      const likely: LinkOriginsResult['likely'] = []
      let unmatched = 0
      for (const skill of unpinned) {
        const dirName = dirNameOf(skill)
        const top = (await findOriginCandidates(skill.realPath, scans, fetchImpl))[0]
        if (top?.confidence === 'exact') {
          await pinOrigin(dirName, top)
          linked.push({ dirName, repo: top.repo })
        } else if (top?.confidence === 'likely') {
          likely.push({ dirName, repo: top.repo })
        } else {
          unmatched += 1
        }
      }
      logger.info('origin.bulk', { scanned: unpinned.length, linked: linked.length, likely: likely.length, unmatched })
      return { workspace: await buildSnapshot(config), linked, likely, unmatched, scanned: unpinned.length }
    },

    async clearMachine(name, dirNames) {
      const machine = await findMachine(name)
      assertNotLibraryHost(machine, 'clearing it')
      const config = await configStore.load()
      const remote = await machines().snapshot(machine)
      if (!remote.snapshot) throw new Error(remote.error ?? `${name} is unreachable.`)
      const local = await buildSnapshot(config)
      const libraryNames = new Set(
        local.skills.filter((skill) => skill.sourceKind === 'Personal').map(dirNameOf),
      )
      const ledger = await libraryStore.load()

      const remotePersonal = remote.snapshot.skills.filter((skill) => skill.sourceKind === 'Personal')
      const wanted = dirNames ? new Set(dirNames) : null
      const removed: string[] = []
      const failed: Record<string, string> = {}
      const kept: string[] = []
      let snapshot: WorkspaceSnapshot | null = null

      logger.info('sync.clear.start', { machine: name, machinePersonal: remotePersonal.length, requested: dirNames?.length ?? 'all' })
      for (const skill of remotePersonal) {
        const dirName = dirNameOf(skill)
        if (wanted && !wanted.has(dirName)) continue
        // Only remove what the library can restore.
        if (!libraryNames.has(dirName)) {
          kept.push(dirName)
          logger.debug('sync.clear.kept', { machine: name, skill: dirName, reason: 'not in library' })
          continue
        }
        try {
          snapshot = await machines().uninstall(machine, { dirName, scope: 'global' })
          const meta = ledger[dirName]
          if (meta) {
            await libraryStore.set(dirName, {
              ...meta,
              targets: withoutTarget(meta.targets, { machine: name, scope: 'global' }),
            })
          }
          removed.push(dirName)
          logger.info('sync.clear.removed', { machine: name, skill: dirName })
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : String(cause)
          failed[dirName] = message
          logger.warn('sync.clear.failed', { machine: name, skill: dirName, error: message })
        }
      }
      logger.info('sync.clear.done', { machine: name, removed: removed.length, failed: Object.keys(failed).length, kept: kept.length })

      const machineState: MachineSnapshot = snapshot ? { machine, snapshot } : await machines().snapshot(machine)
      return { workspace: await buildSnapshot(config), machine: machineState, removed, failed, kept }
    },

    async categorizeLibrary(options = {}) {
      const config = await configStore.load()
      const before = await buildSnapshot(config)
      const ledger = await libraryStore.load()
      const client = classifierFactory(config)

      // Candidates: personal (library) skills, skipping manual assignments
      // always and existing assignments unless forced.
      const candidates = before.skills.filter((skill) => {
        if (skill.sourceKind !== 'Personal') return false
        const meta = ledger[dirNameOf(skill)]
        if (meta?.categorySource === 'manual') return false
        return options.force || !meta?.category
      })

      const assignments = await categorizeSkills(
        candidates.map((skill) => ({
          name: dirNameOf(skill),
          description: skill.description,
          repoPath: ledger[dirNameOf(skill)]?.path,
        })),
        client,
      )

      let categorized = 0
      // One ledger write for the whole run, not one per skill.
      await libraryStore.update((skills) => {
        for (const skill of candidates) {
          const name = dirNameOf(skill)
          const assignment = assignments.get(name)
          if (!assignment) continue
          skills[name] = {
            ...EMPTY_META,
            ...skills[name],
            category: assignment.category,
            categorySource: assignment.source,
            categoryConfidence: assignment.confidence,
          }
          categorized++
        }
      })

      return {
        workspace: await buildSnapshot(config),
        categorized,
        uncategorized: candidates.length - categorized,
        usedLlm: client !== null,
      }
    },

    async setSkillCategory(skillId, category) {
      const skill = await resolveKnown(skillId)
      if (!skill || skill.sourceKind !== 'Personal') throw new Error('Not a library skill.')
      const name = dirNameOf(skill)
      const existing = (await libraryStore.load())[name]
      // Clearing removes the category fields entirely (spread of `rest`).
      const { category: _category, categorySource: _source, categoryConfidence: _confidence, ...rest } = existing ?? {}
      const base: LibrarySkillMeta = { ...EMPTY_META, ...rest }
      await libraryStore.set(
        name,
        category ? { ...base, category, categorySource: 'manual', categoryConfidence: 1 } : base,
      )
      return buildSnapshot(await configStore.load())
    },

    async setSkillTags(skillId, tags) {
      const skill = await resolveKnown(skillId)
      if (!skill || skill.sourceKind !== 'Personal') throw new Error('Not a library skill.')
      const name = dirNameOf(skill)
      const existing = (await libraryStore.load())[name]
      await libraryStore.set(name, withTags({ ...EMPTY_META, ...existing }, normalizeTags(tags)))
      return buildSnapshot(await configStore.load())
    },

    async tagSkills(skillIds, change) {
      const add = normalizeTags(change.add ?? [])
      const remove = new Set(normalizeTags(change.remove ?? []))
      if (add.length === 0 && remove.size === 0) throw new Error('Nothing to change.')
      const skipped: string[] = []
      const dirNames: string[] = []
      for (const id of skillIds) {
        const skill = await resolveKnown(id)
        if (!skill || skill.sourceKind !== 'Personal') skipped.push(id)
        else dirNames.push(dirNameOf(skill))
      }
      await libraryStore.update((skills) => {
        for (const name of dirNames) {
          const current = skills[name]?.tags ?? []
          const next = normalizeTags([...current.filter((t) => !remove.has(t)), ...add])
          skills[name] = withTags({ ...EMPTY_META, ...skills[name] }, next)
        }
      })
      logger.info('tags.bulk', { tagged: dirNames.length, skipped: skipped.length, add, remove: [...remove] })
      return { workspace: await buildSnapshot(await configStore.load()), tagged: dirNames.length, skipped }
    },
  }
}

/** Attach a normalized tag list to a ledger entry; empty removes the field. */
function withTags(meta: LibrarySkillMeta, tags: string[]): LibrarySkillMeta {
  const { tags: _tags, ...rest } = meta
  return tags.length ? { ...rest, tags } : rest
}

const TAG_MAX_LENGTH = 32
const TAGS_MAX = 20

/**
 * Tag vocabulary is the user's own, so normalization only prevents accidental
 * forks: lowercase, trimmed, internal whitespace/underscores → '-', and any
 * character outside [a-z0-9._/:-] dropped. Empty results are discarded.
 */
export function normalizeTag(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9._/:-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, TAG_MAX_LENGTH)
}

export function normalizeTags(raw: string[]): string[] {
  const seen = new Set<string>()
  for (const value of raw) {
    const tag = normalizeTag(value)
    if (tag) seen.add(tag)
    if (seen.size >= TAGS_MAX) break
  }
  return [...seen].sort()
}

/** Canonical folder name of a skill (its realPath's basename). */
function dirNameOf(skill: SkillRecord): string {
  return path.basename(skill.realPath)
}

/** How agent-facing calls resolve a skill: exact id, or case-insensitive name / folder name. */
function matchesSkillName(needle: string): (skill: SkillRecord) => boolean {
  const lower = needle.toLowerCase()
  return (skill) =>
    skill.id === needle || skill.name.toLowerCase() === lower || dirNameOf(skill).toLowerCase() === lower
}

/**
 * Baseline for a ledger entry. Writers spread `{ ...EMPTY_META, ...existing, …changes }`
 * so optional fields (category, adoptedFrom) survive — `libraryStore.set` replaces
 * the entry, it does not merge.
 */
const EMPTY_META: LibrarySkillMeta = { repo: '', path: '', ref: '', targets: [] }

/** Concurrent agent sessions per machine during bulk sync. */
const MACHINE_CONCURRENCY = 4

function targetKey(target: SyndicationTarget): string {
  return `${target.machine}\u0000${target.scope}\u0000${target.projectName ?? ''}`
}

function withTarget(targets: SyndicationTarget[], target: SyndicationTarget): SyndicationTarget[] {
  return targets.some((existing) => targetKey(existing) === targetKey(target))
    ? targets
    : [...targets, target]
}

function withoutTarget(targets: SyndicationTarget[], target: SyndicationTarget): SyndicationTarget[] {
  return targets.filter((existing) => targetKey(existing) !== targetKey(target))
}

/** Merge one skill's provenance entry into `~/.agents/.skill-lock.json`. */
export async function writeSkillLockEntry(
  homeDir: string,
  skillDirName: string,
  entry: { source: string; sourceType: string; sourceUrl: string; skillPath: string },
): Promise<void> {
  const lockPath = path.join(homeDir, '.agents', '.skill-lock.json')
  let parsed: { skills?: Record<string, unknown> } = {}
  try {
    parsed = JSON.parse(await fs.readFile(lockPath, 'utf8'))
  } catch {
    // Missing or unparseable — start fresh.
  }
  parsed.skills = { ...(parsed.skills ?? {}), [skillDirName]: entry }
  await fs.mkdir(path.dirname(lockPath), { recursive: true })
  await fs.writeFile(lockPath, JSON.stringify(parsed, null, 2), 'utf8')
}

/**
 * Collapse skills that resolve to the same real path (e.g. a personal skill
 * symlinked into a project), keeping the first occurrence and merging the
 * projects that reference it.
 */
function dedupe(skills: SkillRecord[]): SkillRecord[] {
  const byRealPath = new Map<string, SkillRecord>()
  for (const skill of skills) {
    const existing = byRealPath.get(skill.realPath)
    if (existing) {
      existing.projects = [...new Set([...existing.projects, ...skill.projects])]
    } else {
      byRealPath.set(skill.realPath, { ...skill, projects: [...skill.projects] })
    }
  }
  return [...byRealPath.values()].sort((a, b) => a.name.localeCompare(b.name))
}
