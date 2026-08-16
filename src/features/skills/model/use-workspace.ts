import { useCallback, useEffect, useState } from 'react'
import { createHttpBridge } from './http-bridge'
import {
  emptySnapshot,
  toSkill,
  type CreateSkillInput,
  type ImportSkillArchiveInput,
  type InstallRepoSkillInput,
  type CheckUpdatesResult,
  type LogEntry,
  type MachineRecord,
  type LinkOriginsResult,
  type OriginCandidate,
  type MachineSnapshot,
  type RepoCatalog,
  type MachineDiff,
  type SetSkillEnabledInput,
  type SetSyndicationInput,
  type SkillCategory,
  type Skill,
  type SkillFile,
  type WorkspaceConfig,
  type WorkspaceSnapshot,
} from './skills'

export type WorkspaceState = {
  skills: Skill[]
  snapshot: WorkspaceSnapshot
  config: WorkspaceConfig | null
  loading: boolean
  error: string | null
  rescan: () => Promise<void>
  configure: (config: WorkspaceConfig) => Promise<void>
  pickDirectory: () => Promise<string | null>
  getReadme: (id: string) => Promise<string | null>
  listFiles: (id: string) => Promise<SkillFile[] | null>
  reveal: (id: string) => Promise<boolean>
  enable: (id: string) => Promise<WorkspaceSnapshot | null>
  disable: (id: string) => Promise<WorkspaceSnapshot | null>
  remove: (id: string) => Promise<WorkspaceSnapshot | null>
  toggleFavourite: (id: string) => Promise<WorkspaceSnapshot | null>
  create: (input: CreateSkillInput) => Promise<WorkspaceSnapshot | null>
  importArchive: (input: ImportSkillArchiveInput) => Promise<WorkspaceSnapshot | null>
  repoCatalogs: RepoCatalog[]
  reposLoading: boolean
  addRepo: (input: string) => Promise<void>
  removeRepo: (slug: string) => Promise<void>
  refreshRepo: (slug: string) => Promise<void>
  installRepoSkill: (input: InstallRepoSkillInput) => Promise<WorkspaceSnapshot | null>
  machineSnapshots: MachineSnapshot[]
  machinesLoading: boolean
  addMachine: (machine: MachineRecord) => Promise<void>
  updateMachine: (name: string, machine: MachineRecord) => Promise<void>
  removeMachine: (name: string) => Promise<void>
  refreshMachine: (name: string) => Promise<void>
  installOnMachine: (name: string, input: InstallRepoSkillInput) => Promise<void>
  machineSkillOp: (name: string, op: 'enable' | 'disable' | 'remove', id: string) => Promise<void>
  setSyndication: (input: SetSyndicationInput) => Promise<void>
  setSkillEnabled: (input: SetSkillEnabledInput) => Promise<WorkspaceSnapshot | null>
  machineDiff: (name: string) => Promise<MachineDiff | null>
  adoptFromMachine: (name: string, skillIds: string[]) => Promise<{ adopted: string[]; failed: Record<string, string> } | null>
  convergeMachine: (name: string, dirNames?: string[]) => Promise<{ installed: string[]; failed: Record<string, string> } | null>
  clearMachine: (name: string, dirNames?: string[]) => Promise<{ removed: string[]; failed: Record<string, string>; kept: string[] } | null>
  checkUpdates: () => Promise<CheckUpdatesResult | null>
  applyUpdates: (skillIds?: string[]) => Promise<{ updated: string[]; failed: Record<string, string>; repushed: Record<string, { ok: string[]; failed: Record<string, string> }> } | null>
  findOrigin: (id: string) => Promise<OriginCandidate[]>
  linkOrigin: (id: string, origin: { repo: string; path: string; ref: string }) => Promise<WorkspaceSnapshot | null>
  linkOrigins: () => Promise<Omit<LinkOriginsResult, 'workspace'> | null>
  categorizeLibrary: (options?: { force?: boolean }) => Promise<{ categorized: number; uncategorized: number; usedLlm: boolean } | null>
  getLogs: (limit?: number) => Promise<LogEntry[]>
  setSkillCategory: (id: string, category: SkillCategory | null) => Promise<WorkspaceSnapshot | null>
}

// Electron injects window.skilldex via preload; served by the hub instead,
// fall back to the fetch-based twin of the same contract. Lazily created and
// cached so every caller shares one instance.
let httpBridge: ReturnType<typeof createHttpBridge> | undefined
const bridge = () => {
  if (typeof window === 'undefined') return undefined
  if (window.skilldex?.workspace) return window.skilldex.workspace
  httpBridge ??= createHttpBridge()
  return httpBridge
}

export function useWorkspace(): WorkspaceState {
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot>(emptySnapshot)
  const [config, setConfig] = useState<WorkspaceConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [repoCatalogs, setRepoCatalogs] = useState<RepoCatalog[]>([])
  const [reposLoading, setReposLoading] = useState(false)
  const [machineSnapshots, setMachineSnapshots] = useState<MachineSnapshot[]>([])
  const [machinesLoading, setMachinesLoading] = useState(false)

  const run = useCallback(async (task: () => Promise<WorkspaceSnapshot>) => {
    setLoading(true)
    setError(null)
    try {
      setSnapshot(await task())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }, [])

  const rescan = useCallback(async () => {
    const workspace = bridge()
    if (!workspace) {
      setLoading(false)
      setError('Skilldex must run in the desktop app to read your skills.')
      return
    }
    void workspace.getConfig().then(setConfig)
    await run(() => workspace.getSnapshot())
  }, [run])

  // A mutation that surfaces its failure to the caller so the UI can react
  // (e.g. keep a confirmation dialog open) rather than only setting error state.
  const mutate = useCallback(
    async (
      op: (workspace: NonNullable<ReturnType<typeof bridge>>) => Promise<WorkspaceSnapshot>,
    ): Promise<WorkspaceSnapshot | null> => {
      const workspace = bridge()
      if (!workspace) return null
      try {
        const next = await op(workspace)
        setSnapshot(next)
        setError(null)
        return next
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause)
        setError(message)
        throw new Error(message)
      }
    },
    [],
  )

  const configure = useCallback(async (next: WorkspaceConfig) => {
    const workspace = bridge()
    if (!workspace) return
    setLoading(true)
    setError(null)
    try {
      setSnapshot(await workspace.configureSources(next))
      setConfig(next) // only after the write succeeds, so state can't diverge
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setError(message)
      throw new Error(message)
    } finally {
      setLoading(false)
    }
  }, [])

  const pickDirectory = useCallback(() => bridge()?.pickDirectory() ?? Promise.resolve(null), [])

  const getReadme = useCallback((id: string) => bridge()?.getSkillReadme(id) ?? Promise.resolve(null), [])
  const listFiles = useCallback((id: string) => bridge()?.listSkillFiles(id) ?? Promise.resolve(null), [])
  const reveal = useCallback((id: string) => bridge()?.revealSkill(id) ?? Promise.resolve(false), [])
  const enable = useCallback((id: string) => mutate((w) => w.enableSkill(id)), [mutate])
  const disable = useCallback((id: string) => mutate((w) => w.disableSkill(id)), [mutate])
  const remove = useCallback((id: string) => mutate((w) => w.removeSkill(id)), [mutate])
  const toggleFavourite = useCallback((id: string) => mutate((w) => w.toggleFavourite(id)), [mutate])
  const create = useCallback((input: CreateSkillInput) => mutate((w) => w.createSkill(input)), [mutate])
  const importArchive = useCallback(
    (input: ImportSkillArchiveInput) => mutate((w) => w.importSkillArchive(input)),
    [mutate],
  )

  // A repo mutation that surfaces its failure to the caller (dialogs keep
  // their error inline) while keeping the catalog list in sync on success.
  const mutateRepos = useCallback(async (op: () => Promise<RepoCatalog[]> | undefined) => {
    setReposLoading(true)
    try {
      const next = await op()
      if (next) setRepoCatalogs(next)
    } finally {
      setReposLoading(false)
    }
  }, [])

  const addRepo = useCallback(
    (input: string) => mutateRepos(() => bridge()?.addSkillRepo(input)),
    [mutateRepos],
  )
  const removeRepo = useCallback(
    (slug: string) => mutateRepos(() => bridge()?.removeSkillRepo(slug)),
    [mutateRepos],
  )
  const refreshRepo = useCallback(
    (slug: string) => mutateRepos(() => bridge()?.refreshSkillRepo(slug)),
    [mutateRepos],
  )
  const installRepoSkill = useCallback(
    (input: InstallRepoSkillInput) => mutate((w) => w.installRepoSkill(input)),
    [mutate],
  )

  // Machine mutations mirror the repo ones: full-list ops replace the list,
  // single-machine ops patch that machine's entry in place. Errors rethrow
  // for the calling dialog/pane to display.
  const mutateMachines = useCallback(async (op: () => Promise<MachineSnapshot[]> | undefined) => {
    setMachinesLoading(true)
    try {
      const next = await op()
      if (next) setMachineSnapshots(next)
    } finally {
      setMachinesLoading(false)
    }
  }, [])

  /** Swap one machine's entry in place (by name). */
  const replaceMachine = useCallback((next: MachineSnapshot) => {
    setMachineSnapshots((current) => current.map((entry) => (entry.machine.name === next.machine.name ? next : entry)))
  }, [])

  const patchMachine = useCallback(
    async (op: () => Promise<MachineSnapshot> | undefined) => {
      setMachinesLoading(true)
      try {
        const next = await op()
        if (next) replaceMachine(next)
      } finally {
        setMachinesLoading(false)
      }
    },
    [replaceMachine],
  )

  const addMachine = useCallback(
    (machine: MachineRecord) => mutateMachines(() => bridge()?.addMachine(machine)),
    [mutateMachines],
  )
  const updateMachine = useCallback(
    (name: string, machine: MachineRecord) => mutateMachines(() => bridge()?.updateMachine(name, machine)),
    [mutateMachines],
  )
  const removeMachine = useCallback(
    (name: string) => mutateMachines(() => bridge()?.removeMachine(name)),
    [mutateMachines],
  )
  const refreshMachine = useCallback(
    (name: string) => patchMachine(() => bridge()?.refreshMachine(name)),
    [patchMachine],
  )
  const installOnMachine = useCallback(
    (name: string, input: InstallRepoSkillInput) =>
      patchMachine(() => bridge()?.installOnMachine(name, input)),
    [patchMachine],
  )
  const machineSkillOp = useCallback(
    (name: string, op: 'enable' | 'disable' | 'remove', id: string) =>
      patchMachine(() => bridge()?.machineSkillOp(name, op, id)),
    [patchMachine],
  )

  const setSkillEnabled = useCallback(async (input: SetSkillEnabledInput) => {
    setMachinesLoading(true)
    try {
      const result = await bridge()?.setSkillEnabled(input)
      if (!result) return null
      setSnapshot(result.workspace)
      setError(null)
      if (result.machines.length > 0)
        setMachineSnapshots((current) =>
          current.map(
            (entry) =>
              result.machines.find((touched) => touched.machine.name === entry.machine.name) ?? entry,
          ),
        )
      return result.workspace
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setError(message)
      throw new Error(message)
    } finally {
      setMachinesLoading(false)
    }
  }, [])

  const machineDiff = useCallback((name: string) => bridge()?.machineDiff(name) ?? Promise.resolve(null), [])

  const adoptFromMachine = useCallback(async (name: string, skillIds: string[]) => {
    setMachinesLoading(true)
    try {
      const result = await bridge()?.adoptFromMachine(name, skillIds)
      if (!result) return null
      setSnapshot(result.workspace)
      return { adopted: result.adopted, failed: result.failed }
    } finally {
      setMachinesLoading(false)
    }
  }, [])

  const convergeMachine = useCallback(async (name: string, dirNames?: string[]) => {
    setMachinesLoading(true)
    try {
      const result = await bridge()?.convergeMachine(name, dirNames)
      if (!result) return null
      setSnapshot(result.workspace)
      replaceMachine(result.machine)
      return { installed: result.installed, failed: result.failed }
    } finally {
      setMachinesLoading(false)
    }
  }, [replaceMachine])

  const getLogs = useCallback(async (limit?: number) => (await bridge()?.getLogs(limit)) ?? [], [])

  const clearMachine = useCallback(async (name: string, dirNames?: string[]) => {
    setMachinesLoading(true)
    try {
      const result = await bridge()?.clearMachine(name, dirNames)
      if (!result) return null
      setSnapshot(result.workspace)
      replaceMachine(result.machine)
      return { removed: result.removed, failed: result.failed, kept: result.kept }
    } finally {
      setMachinesLoading(false)
    }
  }, [replaceMachine])

  const checkUpdates = useCallback(async () => (await bridge()?.checkUpdates()) ?? null, [])

  const applyUpdates = useCallback(async (skillIds?: string[]) => {
    setLoading(true)
    try {
      const result = await bridge()?.applyUpdates(skillIds)
      if (!result) return null
      setSnapshot(result.workspace)
      setError(null)
      return { updated: result.updated, failed: result.failed, repushed: result.repushed }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setError(message)
      throw new Error(message)
    } finally {
      setLoading(false)
    }
  }, [])

  const findOrigin = useCallback(async (id: string) => (await bridge()?.findOrigin(id)) ?? [], [])
  const linkOrigin = useCallback(
    (id: string, origin: { repo: string; path: string; ref: string }) => mutate((w) => w.linkOrigin(id, origin)),
    [mutate],
  )

  const linkOrigins = useCallback(async () => {
    setLoading(true)
    try {
      const result = await bridge()?.linkOrigins()
      if (!result) return null
      setSnapshot(result.workspace)
      setError(null)
      const { workspace: _workspace, ...summary } = result
      return summary
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setError(message)
      throw new Error(message)
    } finally {
      setLoading(false)
    }
  }, [])

  const categorizeLibrary = useCallback(async (options?: { force?: boolean }) => {
    setLoading(true)
    try {
      const result = await bridge()?.categorizeLibrary(options)
      if (!result) return null
      setSnapshot(result.workspace)
      setError(null)
      return { categorized: result.categorized, uncategorized: result.uncategorized, usedLlm: result.usedLlm }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setError(message)
      throw new Error(message)
    } finally {
      setLoading(false)
    }
  }, [])

  const setSkillCategory = useCallback(
    (id: string, category: SkillCategory | null) => mutate((w) => w.setSkillCategory(id, category)),
    [mutate],
  )

  const setSyndication = useCallback(async (input: SetSyndicationInput) => {
    setMachinesLoading(true)
    try {
      const result = await bridge()?.setSyndication(input)
      if (result) {
        setSnapshot(result.workspace)
        replaceMachine(result.machine)
      }
    } finally {
      setMachinesLoading(false)
    }
  }, [replaceMachine])

  useEffect(() => {
    void rescan()
    // Repo catalogs and machine snapshots load independently of the local
    // scan — both hit the network, so neither blocks the local library.
    setReposLoading(true)
    bridge()
      ?.listRepoCatalogs()
      .then(setRepoCatalogs)
      .catch(() => {})
      .finally(() => setReposLoading(false))
    setMachinesLoading(true)
    bridge()
      ?.listMachineSnapshots()
      .then(setMachineSnapshots)
      .catch(() => {})
      .finally(() => setMachinesLoading(false))
  }, [rescan])

  return {
    skills: snapshot.skills.map(toSkill),
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
  }
}
