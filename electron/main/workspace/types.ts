/**
 * The serialized contract that crosses the preload seam (`window.skilldex`).
 *
 * These are plain-JSON shapes: the renderer receives exactly these records over
 * IPC and never touches Node. Absolute `path` / `realPath` are kept for future
 * management writes; `sourceRoot` is a display-friendly (tilde) label.
 */

export type SkillSourceKind = 'Personal' | 'Plugin' | 'Project'

export type SkillRecord = {
  /** Stable identity across scans and across the roots a skill is surfaced from. */
  id: string
  name: string
  description: string
  /** Absolute path to the skill directory as discovered (may be a symlink). */
  path: string
  /** Symlinks resolved — the canonical on-disk location. */
  realPath: string
  sourceKind: SkillSourceKind
  /** Display-friendly root label, e.g. `~/.claude/skills`. */
  sourceRoot: string
  /** Display-friendly full path to this skill's directory, e.g. `~/.claude/skills/tdd`. */
  displayPath: string
  enabled: boolean
  /** Whether the user has favourited this skill (persisted in config). */
  isFavourite: boolean
  isSymlink: boolean
  /** Number of files inside the skill directory. */
  fileCount: number
  /** Project names that reference this skill (Project skills only). */
  projects: string[]
  /** Upstream provenance, when the skill's manifest records where it came from. */
  origin?: SkillOrigin
  /** Library metadata (import provenance + syndication), for library-managed skills. */
  library?: LibrarySkillMeta
}

/** Where a library skill is syndicated to. */
export type SyndicationTarget = {
  /** Machine name (from WorkspaceConfig.machines). */
  machine: string
  scope: 'global' | 'project'
  projectName?: string
}

/** A library entry: where a skill was imported from and where it goes. */
export type LibrarySkillMeta = {
  /**
   * `owner/repo` slug the skill was imported from. Empty for skills adopted
   * from a machine with no known origin — they have no repo to update from.
   */
  repo: string
  /** Directory path within the repo ('' for a root-level skill). */
  path: string
  /** Pinned ref (commit sha when available) the library copy was taken at. */
  ref: string
  targets: SyndicationTarget[]
  /** Machine the skill was adopted from, when it entered the library that way. */
  adoptedFrom?: string
  /** Library category; absent until categorized. */
  category?: SkillCategory
  /** Where the category came from — 'manual' is never overwritten by re-runs. */
  categorySource?: 'llm' | 'structural' | 'manual'
  categoryConfidence?: number
}

/** One machine's library compared against the hub library, by folder name. */
export type MachineDiff = {
  machine: MachineRecord
  /** On the machine but not in the library — candidates to adopt. */
  onlyOnMachine: SkillRecord[]
  /** In the library but not on the machine — candidates to install. */
  onlyInLibrary: SkillRecord[]
  /** Present in both (by folder name). */
  inSync: number
  error?: string
}

export type SkillFile = {
  /** Path relative to the skill directory, e.g. `SKILL.md` or `scripts/run.sh`. */
  relativePath: string
  sizeBytes: number
}

/** Which git host a skill's upstream lives on (drives the deep-link URL shape). */
export type OriginHost = 'github' | 'gitlab' | 'bitbucket' | 'other'

/**
 * Where a skill came from — resolved from the manifest that records provenance
 * for its source kind (personal → `.skill-lock.json`, plugin → `marketplace.json`,
 * project → `.git/config`). Absent on locally-authored skills with no upstream.
 */
export type SkillOrigin = {
  host: OriginHost
  /** Human label, e.g. `vercel-labs/skills`. */
  label: string
  /** Browsable repository root, e.g. `https://github.com/vercel-labs/skills`. */
  repoUrl: string
  /** Deep link to this skill's folder within the repo, e.g. `.../tree/HEAD/skills/find-skills`. */
  webUrl: string
}

export type ProjectRecord = {
  name: string
  /** Display-friendly project path. */
  path: string
  skillCount: number
}

export type SourceRecord = {
  kind: SkillSourceKind
  /** Display-friendly root label. */
  root: string
  skillCount: number
  /** Present when this source could not be scanned. */
  error?: string
}

export type WorkspaceSnapshot = {
  skills: SkillRecord[]
  projects: ProjectRecord[]
  sources: SourceRecord[]
  errors: string[]
  /** ISO timestamp of the scan. */
  scannedAt: string
  /** Absolute home directory, so the renderer can tildify absolute paths. */
  homeDir: string
}

export type WorkspaceConfig = {
  includePersonal: boolean
  includePlugins: boolean
  /**
   * Absolute directories to scan for project skills. Each root is either a
   * project itself (contains `.claude/skills`) or a workspace whose immediate
   * children are projects.
   */
  projectRoots: string[]
  /**
   * Favourited skills, stored as `.disabled/`-normalized real paths (see
   * favourite-key.ts) so a favourite survives a skill being enabled/disabled.
   */
  favourites: string[]
  /** User-added GitHub skill repos, stored as normalized `owner/repo` slugs. */
  skillRepos: string[]
  /** Remote machines managed over SSH (hub mode). */
  machines: MachineRecord[]
  /**
   * Coding agents whose skill directories Skilldex maintains. 'claude' is
   * always present (its dirs are the canonical copies); every other agent
   * gets symlinks into its own layout (e.g. codex → `~/.codex/skills`).
   */
  agents: SkillAgent[]
  /** LLM categorization provider; keys may also come from env (ANTHROPIC_API_KEY / OPENROUTER_API_KEY). */
  categorizerProvider?: 'anthropic' | 'openrouter'
  anthropicApiKey?: string
  openRouterApiKey?: string
  /** OpenRouter model id; defaults to anthropic/claude-haiku-4.5. */
  openRouterModel?: string
}

export type SkillAgent = 'claude' | 'codex'

/** Fixed library taxonomy — see categorizer.ts for labels and hints. */
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

/** A remote machine the hub manages over (Tailscale) SSH. */
export type MachineRecord = {
  /** Display name, unique among machines (e.g. `tower`). */
  name: string
  /** SSH host — MagicDNS name or address. */
  host: string
  /** Remote login user (differs per OS in mixed fleets). */
  user: string
}

/** A remote machine's library, as reported by the agent. */
export type MachineSnapshot = {
  machine: MachineRecord
  snapshot: WorkspaceSnapshot | null
  /** Present when the machine could not be reached or the agent failed. */
  error?: string
}

export type CreateSkillInput = {
  name: string
  description: string
  scope: 'global' | 'project'
  /** Project directory name (from a ProjectRecord); required when scope is 'project'. */
  projectName?: string
}

/** Where a named skill lives: library copies plus per-machine presence. */
export type SkillLookup = {
  name: string
  /** Library skills whose name or folder matches (usually 0 or 1; project copies can add more). */
  library: SkillRecord[]
  machines: Array<{
    machine: string
    present: boolean
    /** The machine's own record, when present (its `id` drives machine-skill-op). */
    skill?: SkillRecord
    /** Set when the machine could not be reached. */
    error?: string
  }>
}

/** A skill uploaded as loose files (no zip) — what an agent that just wrote one sends. */
export type ImportSkillFilesInput = {
  /** Paths relative to the skill folder (or under one wrapping folder); one must be SKILL.md. */
  files: Array<{ path: string; content?: string; base64?: string }>
  /** Folder name override; defaults to the SKILL.md frontmatter name. */
  name?: string
  scope: 'global' | 'project'
  projectName?: string
  /** Replace an existing skill of the same name instead of failing. */
  replace?: boolean
}

export type ImportSkillFilesResult = {
  dirName: string
  path: string
  workspace: WorkspaceSnapshot
}

/** Push one library skill to machines (all configured by default). */
export type DistributeSkillInput = {
  /** Library skill by name/folder — or `skillId` for an exact record. */
  name?: string
  skillId?: string
  machines?: string[]
  /** Re-push where the machine already has the skill (remove, then install). */
  replace?: boolean
}

export type DistributeSkillResult = {
  dirName: string
  results: Record<string, { status: 'installed' | 'replaced' | 'present' | 'failed'; error?: string }>
  workspace: WorkspaceSnapshot
}

/** A zipped skill uploaded from the UI, to be unpacked into a skills root. */
export type ImportSkillArchiveInput = {
  /** Original filename (names a root-level skill with no frontmatter `name`). */
  fileName: string
  /** Archive bytes, base64-encoded (rides the same JSON path over IPC and HTTP). */
  data: string
  scope: 'global' | 'project'
  projectName?: string
}

/** A skill discovered inside a remote GitHub repo (not yet on disk). */
export type RepoSkill = {
  /** Catalog id: `<owner>/<repo>:<dir-within-repo>` (dir is '' for a root-level skill). */
  id: string
  name: string
  description: string
  /** Directory path within the repo, '' when SKILL.md sits at the repo root. */
  path: string
  /** Number of files inside the skill's folder, per the repo tree. */
  fileCount: number
  /** Deep link to the skill's folder on github.com. */
  webUrl: string
}

/** The scanned contents of one user-added GitHub skill repo. */
export type RepoCatalog = {
  /** Normalized `owner/repo`. */
  slug: string
  /** Browsable repository root, e.g. `https://github.com/owner/repo`. */
  url: string
  /** The branch the catalog was scanned at. */
  ref: string
  /** Exact commit behind `ref` at scan time; imports pin to this. */
  commitSha?: string
  skills: RepoSkill[]
  /**
   * When the repo contains no skills but its README links to other GitHub
   * repos (an "awesome list"), those `owner/repo` slugs — offered as one-click
   * additions instead of a dead-end empty catalog.
   */
  linkedRepos: string[]
  /** True when the listing was cut off (huge repo tree or skill cap reached). */
  truncated: boolean
  /** Present when the repo could not be scanned (network, rate limit, 404). */
  error?: string
}

/** An available upstream update for a repo-pinned library skill. */
export type SkillUpdate = {
  /** Library skill id (canonical path). */
  skillId: string
  /** Folder name in the library. */
  dirName: string
  repo: string
  /** Directory within the repo. */
  path: string
  /** Pinned commit the library copy is at. */
  fromRef: string
  /** Current commit in the repo. */
  toRef: string
  /** Files in the skill folder that differ between the two commits. */
  changedFiles: string[]
  /** Machines this skill is syndicated to (they'll be re-pushed on update). */
  targets: number
}

export type CheckUpdatesResult = {
  updates: SkillUpdate[]
  /** Repo-pinned skills that were checked. */
  checked: number
  /** Repos that could not be scanned (name → message). */
  errors: Record<string, string>
}

export type ApplyUpdatesResult = {
  workspace: WorkspaceSnapshot
  updated: string[]
  failed: Record<string, string>
  /** Per-skill machine re-push outcomes. */
  repushed: Record<string, { ok: string[]; failed: Record<string, string> }>
}

export type InstallRepoSkillInput = {
  /** `owner/repo` slug of a configured skill repo. */
  repo: string
  /** RepoSkill catalog id within that repo. */
  skillId: string
  scope: 'global' | 'project'
  /** Project directory name (from a ProjectRecord); required when scope is 'project'. */
  projectName?: string
}

export const defaultConfig: WorkspaceConfig = {
  includePersonal: true,
  includePlugins: true,
  projectRoots: [],
  favourites: [],
  skillRepos: [],
  machines: [],
  agents: ['claude'],
}
