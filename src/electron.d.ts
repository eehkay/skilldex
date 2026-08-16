export {}

import type {
  AdoptResult,
  ApplyUpdatesResult,
  CheckUpdatesResult,
  LinkOriginsResult,
  OriginCandidate,
  CategorizeResult,
  ClearResult,
  ConvergeResult,
  CreateSkillInput,
  ImportSkillArchiveInput,
  InstallRepoSkillInput,
  LogEntry,
  MachineDiff,
  MachineRecord,
  MachineSnapshot,
  RepoCatalog,
  SetSkillEnabledInput,
  SetSkillEnabledResult,
  SetSyndicationInput,
  SkillCategory,
  SkillFile,
  SyndicationResult,
  TagChange,
  TagSkillsResult,
  WorkspaceConfig,
  WorkspaceSnapshot,
} from '@/features/skills/model/skills'

declare global {
  interface Window {
    skilldex: {
      workspace: {
        getConfig(): Promise<WorkspaceConfig>
        getSnapshot(): Promise<WorkspaceSnapshot>
        configureSources(config: WorkspaceConfig): Promise<WorkspaceSnapshot>
        getSkillReadme(id: string): Promise<string | null>
        listSkillFiles(id: string): Promise<SkillFile[] | null>
        revealSkill(id: string): Promise<boolean>
        pickDirectory(): Promise<string | null>
        enableSkill(id: string): Promise<WorkspaceSnapshot>
        disableSkill(id: string): Promise<WorkspaceSnapshot>
        removeSkill(id: string): Promise<WorkspaceSnapshot>
        toggleFavourite(id: string): Promise<WorkspaceSnapshot>
        createSkill(input: CreateSkillInput): Promise<WorkspaceSnapshot>
        importSkillArchive(input: ImportSkillArchiveInput): Promise<WorkspaceSnapshot>
        getLogs(limit?: number): Promise<LogEntry[]>
        listRepoCatalogs(): Promise<RepoCatalog[]>
        addSkillRepo(input: string): Promise<RepoCatalog[]>
        removeSkillRepo(slug: string): Promise<RepoCatalog[]>
        refreshSkillRepo(slug: string): Promise<RepoCatalog[]>
        installRepoSkill(input: InstallRepoSkillInput): Promise<WorkspaceSnapshot>
        listMachineSnapshots(): Promise<MachineSnapshot[]>
        addMachine(machine: MachineRecord): Promise<MachineSnapshot[]>
        updateMachine(name: string, machine: MachineRecord): Promise<MachineSnapshot[]>
        removeMachine(name: string): Promise<MachineSnapshot[]>
        refreshMachine(name: string): Promise<MachineSnapshot>
        installOnMachine(name: string, input: InstallRepoSkillInput): Promise<MachineSnapshot>
        machineSkillOp(name: string, op: 'enable' | 'disable' | 'remove', id: string): Promise<MachineSnapshot>
        setSyndication(input: SetSyndicationInput): Promise<SyndicationResult>
        setSkillEnabled(input: SetSkillEnabledInput): Promise<SetSkillEnabledResult>
        machineDiff(name: string): Promise<MachineDiff>
        adoptFromMachine(name: string, skillIds: string[]): Promise<AdoptResult>
        convergeMachine(name: string, dirNames?: string[]): Promise<ConvergeResult>
        clearMachine(name: string, dirNames?: string[]): Promise<ClearResult>
        checkUpdates(): Promise<CheckUpdatesResult>
        applyUpdates(skillIds?: string[]): Promise<ApplyUpdatesResult>
        findOrigin(id: string): Promise<OriginCandidate[]>
        linkOrigin(id: string, origin: { repo: string; path: string; ref: string }): Promise<WorkspaceSnapshot>
        linkOrigins(): Promise<LinkOriginsResult>
        categorizeLibrary(options?: { force?: boolean }): Promise<CategorizeResult>
        setSkillCategory(id: string, category: SkillCategory | null): Promise<WorkspaceSnapshot>
        setSkillTags(id: string, tags: string[]): Promise<WorkspaceSnapshot>
        tagSkills(skillIds: string[], change: TagChange): Promise<TagSkillsResult>
      }
    }
  }
}
