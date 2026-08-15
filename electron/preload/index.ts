import { contextBridge, ipcRenderer } from 'electron'
import type {
  AdoptResult,
  CategorizeResult,
  ConvergeResult,
  SetSkillEnabledInput,
  SetSkillEnabledResult,
  SetSyndicationInput,
  SyndicationResult,
} from '../main/workspace/skill-workspace'
import type {
  CreateSkillInput,
  ImportSkillArchiveInput,
  InstallRepoSkillInput,
  MachineDiff,
  MachineRecord,
  MachineSnapshot,
  RepoCatalog,
  SkillCategory,
  SkillFile,
  WorkspaceConfig,
  WorkspaceSnapshot,
} from '../main/workspace/types'

contextBridge.exposeInMainWorld('skilldex', {
  workspace: {
    getConfig: (): Promise<WorkspaceConfig> => ipcRenderer.invoke('skilldex:get-config'),
    getSnapshot: (): Promise<WorkspaceSnapshot> => ipcRenderer.invoke('skilldex:get-snapshot'),
    configureSources: (config: WorkspaceConfig): Promise<WorkspaceSnapshot> =>
      ipcRenderer.invoke('skilldex:configure-sources', config),
    getSkillReadme: (id: string): Promise<string | null> =>
      ipcRenderer.invoke('skilldex:get-skill-readme', id),
    listSkillFiles: (id: string): Promise<SkillFile[] | null> =>
      ipcRenderer.invoke('skilldex:list-skill-files', id),
    revealSkill: (id: string): Promise<boolean> => ipcRenderer.invoke('skilldex:reveal-skill', id),
    pickDirectory: (): Promise<string | null> => ipcRenderer.invoke('skilldex:pick-directory'),
    enableSkill: (id: string): Promise<WorkspaceSnapshot> => ipcRenderer.invoke('skilldex:enable-skill', id),
    disableSkill: (id: string): Promise<WorkspaceSnapshot> => ipcRenderer.invoke('skilldex:disable-skill', id),
    removeSkill: (id: string): Promise<WorkspaceSnapshot> => ipcRenderer.invoke('skilldex:remove-skill', id),
    toggleFavourite: (id: string): Promise<WorkspaceSnapshot> =>
      ipcRenderer.invoke('skilldex:toggle-favourite', id),
    createSkill: (input: CreateSkillInput): Promise<WorkspaceSnapshot> =>
      ipcRenderer.invoke('skilldex:create-skill', input),
    importSkillArchive: (input: ImportSkillArchiveInput): Promise<WorkspaceSnapshot> =>
      ipcRenderer.invoke('skilldex:import-skill-archive', input),
    listRepoCatalogs: (): Promise<RepoCatalog[]> => ipcRenderer.invoke('skilldex:list-repo-catalogs'),
    addSkillRepo: (input: string): Promise<RepoCatalog[]> =>
      ipcRenderer.invoke('skilldex:add-skill-repo', input),
    removeSkillRepo: (slug: string): Promise<RepoCatalog[]> =>
      ipcRenderer.invoke('skilldex:remove-skill-repo', slug),
    refreshSkillRepo: (slug: string): Promise<RepoCatalog[]> =>
      ipcRenderer.invoke('skilldex:refresh-skill-repo', slug),
    installRepoSkill: (input: InstallRepoSkillInput): Promise<WorkspaceSnapshot> =>
      ipcRenderer.invoke('skilldex:install-repo-skill', input),
    listMachineSnapshots: (): Promise<MachineSnapshot[]> => ipcRenderer.invoke('skilldex:list-machines'),
    addMachine: (machine: MachineRecord): Promise<MachineSnapshot[]> =>
      ipcRenderer.invoke('skilldex:add-machine', machine),
    updateMachine: (name: string, machine: MachineRecord): Promise<MachineSnapshot[]> =>
      ipcRenderer.invoke('skilldex:update-machine', name, machine),
    removeMachine: (name: string): Promise<MachineSnapshot[]> =>
      ipcRenderer.invoke('skilldex:remove-machine', name),
    refreshMachine: (name: string): Promise<MachineSnapshot> =>
      ipcRenderer.invoke('skilldex:refresh-machine', name),
    installOnMachine: (name: string, input: InstallRepoSkillInput): Promise<MachineSnapshot> =>
      ipcRenderer.invoke('skilldex:machine-install', name, input),
    machineSkillOp: (name: string, op: 'enable' | 'disable' | 'remove', id: string): Promise<MachineSnapshot> =>
      ipcRenderer.invoke('skilldex:machine-skill-op', name, op, id),
    setSyndication: (input: SetSyndicationInput): Promise<SyndicationResult> =>
      ipcRenderer.invoke('skilldex:set-syndication', input),
    setSkillEnabled: (input: SetSkillEnabledInput): Promise<SetSkillEnabledResult> =>
      ipcRenderer.invoke('skilldex:set-skill-enabled', input),
    machineDiff: (name: string): Promise<MachineDiff> => ipcRenderer.invoke('skilldex:machine-diff', name),
    adoptFromMachine: (name: string, skillIds: string[]): Promise<AdoptResult> =>
      ipcRenderer.invoke('skilldex:adopt-from-machine', name, skillIds),
    convergeMachine: (name: string, dirNames?: string[]): Promise<ConvergeResult> =>
      ipcRenderer.invoke('skilldex:converge-machine', name, dirNames),
    categorizeLibrary: (options?: { force?: boolean }): Promise<CategorizeResult> =>
      ipcRenderer.invoke('skilldex:categorize-library', options),
    setSkillCategory: (id: string, category: SkillCategory | null): Promise<WorkspaceSnapshot> =>
      ipcRenderer.invoke('skilldex:set-skill-category', id, category),
  },
})
