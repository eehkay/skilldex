import { useCallback, useEffect, useState } from 'react'
import { createHttpBridge } from './http-bridge'
import {
  emptySnapshot,
  toSkill,
  type CreateSkillInput,
  type InstallRepoSkillInput,
  type MachineRecord,
  type MachineSnapshot,
  type RepoCatalog,
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
  repoCatalogs: RepoCatalog[]
  reposLoading: boolean
  addRepo: (input: string) => Promise<void>
  removeRepo: (slug: string) => Promise<void>
  refreshRepo: (slug: string) => Promise<void>
  installRepoSkill: (input: InstallRepoSkillInput) => Promise<WorkspaceSnapshot | null>
  machineSnapshots: MachineSnapshot[]
  machinesLoading: boolean
  addMachine: (machine: MachineRecord) => Promise<void>
  removeMachine: (name: string) => Promise<void>
  refreshMachine: (name: string) => Promise<void>
  installOnMachine: (name: string, input: InstallRepoSkillInput) => Promise<void>
  machineSkillOp: (name: string, op: 'enable' | 'disable' | 'remove', id: string) => Promise<void>
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

  const patchMachine = useCallback(async (op: () => Promise<MachineSnapshot> | undefined) => {
    setMachinesLoading(true)
    try {
      const next = await op()
      if (next)
        setMachineSnapshots((current) =>
          current.map((entry) => (entry.machine.name === next.machine.name ? next : entry)),
        )
    } finally {
      setMachinesLoading(false)
    }
  }, [])

  const addMachine = useCallback(
    (machine: MachineRecord) => mutateMachines(() => bridge()?.addMachine(machine)),
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
    repoCatalogs,
    reposLoading,
    addRepo,
    removeRepo,
    refreshRepo,
    installRepoSkill,
    machineSnapshots,
    machinesLoading,
    addMachine,
    removeMachine,
    refreshMachine,
    installOnMachine,
    machineSkillOp,
  }
}
