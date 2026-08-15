/**
 * Renderer-side mirror of the `window.skilldex` seam contract, plus the UI view
 * model the dashboard renders. These shapes match the plain-JSON records the
 * main process sends over IPC (see electron/main/workspace/types.ts).
 */

export type SkillSourceKind = 'Personal' | 'Plugin' | 'Project'

export type OriginHost = 'github' | 'gitlab' | 'bitbucket' | 'other'

export type SkillOrigin = {
  host: OriginHost
  label: string
  repoUrl: string
  webUrl: string
}

export type SyndicationTarget = {
  machine: string
  scope: 'global' | 'project'
  projectName?: string
}

export type SkillCategory =
  | 'marketing'
  | 'content'
  | 'analytics'
  | 'design'
  | 'dev'
  | 'agents'
  | 'business'
  | 'documents'
  | 'research'

export const CATEGORY_LABELS: Record<SkillCategory, string> = {
  marketing: 'Marketing & Growth',
  content: 'Content & Writing',
  analytics: 'Analytics & Data',
  design: 'Design & Media',
  dev: 'Dev Tooling',
  agents: 'Agent Orchestration',
  business: 'Business Ops',
  documents: 'Documents & Files',
  research: 'Research & Knowledge',
}

export const CATEGORY_ORDER: SkillCategory[] = [
  'dev', 'agents', 'marketing', 'content', 'analytics', 'design', 'business', 'documents', 'research',
]

export type LibrarySkillMeta = {
  repo: string
  path: string
  ref: string
  targets: SyndicationTarget[]
  adoptedFrom?: string
  category?: SkillCategory
  categorySource?: 'llm' | 'structural' | 'manual'
  categoryConfidence?: number
}

export type CategorizeResult = {
  workspace: WorkspaceSnapshot
  categorized: number
  uncategorized: number
  usedLlm: boolean
}

export type SkillRecord = {
  id: string
  name: string
  description: string
  path: string
  realPath: string
  sourceKind: SkillSourceKind
  sourceRoot: string
  displayPath: string
  enabled: boolean
  isFavourite: boolean
  isSymlink: boolean
  fileCount: number
  projects: string[]
  origin?: SkillOrigin
  library?: LibrarySkillMeta
}

export type SkillFile = {
  relativePath: string
  sizeBytes: number
}

export type ProjectRecord = {
  name: string
  path: string
  skillCount: number
}

export type SourceRecord = {
  kind: SkillSourceKind
  root: string
  skillCount: number
  error?: string
}

export type WorkspaceSnapshot = {
  skills: SkillRecord[]
  projects: ProjectRecord[]
  sources: SourceRecord[]
  errors: string[]
  scannedAt: string
  homeDir: string
}

/**
 * Replace a leading home directory with `~` for display. Renderer twin of the
 * one in electron/main/workspace/filesystem-source.ts (the renderer can't import
 * from main); kept in parity by skills.test.ts.
 */
export function tildify(target: string, homeDir: string): string {
  if (target === homeDir) return '~'
  if (!homeDir) return target
  const prefix = homeDir.endsWith('/') ? homeDir : homeDir + '/'
  return target.startsWith(prefix) ? '~/' + target.slice(prefix.length) : target
}

export type SkillAgent = 'claude' | 'codex'

export type WorkspaceConfig = {
  includePersonal: boolean
  includePlugins: boolean
  projectRoots: string[]
  favourites: string[]
  skillRepos: string[]
  machines: MachineRecord[]
  agents: SkillAgent[]
  categorizerProvider?: 'anthropic' | 'openrouter'
  anthropicApiKey?: string
  openRouterApiKey?: string
  openRouterModel?: string
}

export type CreateSkillInput = {
  name: string
  description: string
  scope: 'global' | 'project'
  projectName?: string
}

export type ImportSkillArchiveInput = {
  fileName: string
  /** Zip bytes, base64-encoded. */
  data: string
  scope: 'global' | 'project'
  projectName?: string
}

export type RepoSkill = {
  id: string
  name: string
  description: string
  path: string
  fileCount: number
  webUrl: string
}

export type RepoCatalog = {
  slug: string
  url: string
  ref: string
  skills: RepoSkill[]
  linkedRepos: string[]
  truncated: boolean
  error?: string
}

export type InstallRepoSkillInput = {
  repo: string
  skillId: string
  scope: 'global' | 'project'
  projectName?: string
}

export type MachineRecord = {
  name: string
  host: string
  user: string
}

export type MachineSnapshot = {
  machine: MachineRecord
  snapshot: WorkspaceSnapshot | null
  error?: string
}

export type SetSyndicationInput = {
  skillId: string
  machine: string
  enabled: boolean
  scope: 'global' | 'project'
  projectName?: string
}

export type SyndicationResult = {
  workspace: WorkspaceSnapshot
  machine: MachineSnapshot
}

export type SetSkillEnabledInput = {
  skillId: string
  enabled: boolean
  target: 'local' | 'everywhere' | { machine: string; scope: 'global' | 'project'; projectName?: string }
}

export type SetSkillEnabledResult = {
  workspace: WorkspaceSnapshot
  machines: MachineSnapshot[]
}

export type MachineDiff = {
  machine: MachineRecord
  onlyOnMachine: SkillRecord[]
  onlyInLibrary: SkillRecord[]
  inSync: number
  error?: string
}

export type AdoptResult = {
  workspace: WorkspaceSnapshot
  adopted: string[]
  failed: Record<string, string>
}

export type ConvergeResult = {
  workspace: WorkspaceSnapshot
  machine: MachineSnapshot
  installed: string[]
  failed: Record<string, string>
}

/**
 * UI scope shown on cards and filters. The mockup uses two scopes; we map our
 * three source kinds onto them: Personal → "global", Plugin → "plugin",
 * Project → "project".
 */
export type SkillScope = 'global' | 'plugin' | 'project'

/** UI view model: a record enriched with presentation-only fields. */
export type Skill = SkillRecord & {
  summary: string
  source: string
  scope: SkillScope
  /** Two-letter monogram for the icon badge. */
  mono: string
  iconBg: string
  iconFg: string
}

/** Shared accent palette (icon foreground + project dots) from the mockup. */
export const ACCENT_PALETTE = ['#fb923c', '#38bdf8', '#4ade80', '#c084fc', '#fb7185', '#2dd4bf']

// Icon badge background tints paired to each accent foreground above.
const ICON_BG = ['#2a1c0e', '#0e1f2a', '#131f12', '#1e0e2a', '#2a0e17', '#0e2a24']

function hash(value: string): number {
  let h = 0
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) | 0
  return Math.abs(h)
}

/** Stable colour pair per skill so a given skill always looks the same. */
export function iconColorsFor(id: string): { bg: string; fg: string } {
  const index = hash(id) % ACCENT_PALETTE.length
  return { bg: ICON_BG[index], fg: ACCENT_PALETTE[index] }
}

/** Short display form of a pinned ref: 7 chars for a sha, as-is otherwise. */
export function shortRef(ref: string | undefined): string | undefined {
  if (!ref) return undefined
  return /^[0-9a-f]{40}$/i.test(ref) ? ref.slice(0, 7) : ref
}

/** Two-letter monogram from a skill name (e.g. "pdf-form-filler" → "PD"). */
export function monoFor(name: string): string {
  const words = name.split(/[\s._-]+/).filter(Boolean)
  const letters = words.length >= 2 ? words[0][0] + words[1][0] : name.slice(0, 2)
  return letters.toUpperCase()
}

export function scopeFor(kind: SkillSourceKind): SkillScope {
  if (kind === 'Personal') return 'global'
  if (kind === 'Plugin') return 'plugin'
  return 'project'
}

/** Tailwind classes for the coloured scope pill shown on cards and detail. */
export function scopePillClass(scope: SkillScope): string {
  switch (scope) {
    case 'global':
      return 'text-[#fb923c] bg-[#2a1709] border-[#4a2a10]'
    case 'plugin':
      return 'text-[#38bdf8] bg-[#0e1f2a] border-[#123244]'
    default:
      return 'text-[#a1a1aa] bg-[#1a1a1e] border-[#2e2e34]'
  }
}

export function toSkill(record: SkillRecord): Skill {
  const colors = iconColorsFor(record.id)
  return {
    ...record,
    summary: record.description || 'No description provided.',
    source: record.displayPath,
    scope: scopeFor(record.sourceKind),
    mono: monoFor(record.name),
    iconBg: colors.bg,
    iconFg: colors.fg,
  }
}

export const emptySnapshot: WorkspaceSnapshot = {
  skills: [],
  projects: [],
  sources: [],
  errors: [],
  scannedAt: '',
  homeDir: '',
}
