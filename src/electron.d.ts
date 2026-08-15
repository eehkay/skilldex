export {}

import type {
  CreateSkillInput,
  InstallRepoSkillInput,
  MachineRecord,
  MachineSnapshot,
  RepoCatalog,
  SetSkillEnabledInput,
  SetSkillEnabledResult,
  SetSyndicationInput,
  SkillFile,
  SyndicationResult,
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
      }
    }
  }
}
