/**
 * Browser-mode implementation of the `window.skilldex.workspace` contract.
 *
 * When the renderer is served by the hub (`skilldex serve`) instead of
 * Electron, this fetch-based twin stands in for the preload bridge — same
 * methods, same error behaviour (a failed call throws Error(message), which
 * is what ipcRenderer.invoke does), so the rest of the app cannot tell the
 * difference.
 *
 * Two native affordances degrade deliberately:
 *  - pickDirectory: no OS dialog in a browser — prompt for an absolute path
 *    and let the hub confirm it exists before accepting it.
 *  - revealSkill: meaningless for a remote machine — resolves false.
 */

import type {
  CreateSkillInput,
  InstallRepoSkillInput,
  RepoCatalog,
  SkillFile,
  WorkspaceConfig,
  WorkspaceSnapshot,
} from './skills'

type WorkspaceBridge = NonNullable<Window['skilldex']>['workspace']

async function call<T>(method: 'GET' | 'POST', route: string, body?: Record<string, unknown>): Promise<T> {
  const response = await fetch(`/api/${route}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'error' in payload
        ? String((payload as { error: unknown }).error)
        : `Request failed (${response.status}).`
    throw new Error(message)
  }
  return payload as T
}

export function createHttpBridge(): WorkspaceBridge {
  return {
    getConfig: () => call<WorkspaceConfig>('GET', 'config'),
    getSnapshot: () => call<WorkspaceSnapshot>('GET', 'snapshot'),
    configureSources: (config: WorkspaceConfig) =>
      call<WorkspaceSnapshot>('POST', 'configure-sources', { config }),
    getSkillReadme: (id: string) => call<string | null>('GET', `skill-readme?id=${encodeURIComponent(id)}`),
    listSkillFiles: (id: string) => call<SkillFile[] | null>('GET', `skill-files?id=${encodeURIComponent(id)}`),
    revealSkill: () => Promise.resolve(false),
    pickDirectory: async () => {
      const picked = window.prompt('Absolute path to a project folder on the hub machine:')
      if (!picked?.trim()) return null
      const { valid } = await call<{ valid: boolean }>('POST', 'validate-directory', { path: picked.trim() })
      if (!valid) throw new Error(`No such directory on the hub: ${picked.trim()}`)
      return picked.trim()
    },
    enableSkill: (id: string) => call<WorkspaceSnapshot>('POST', 'enable-skill', { id }),
    disableSkill: (id: string) => call<WorkspaceSnapshot>('POST', 'disable-skill', { id }),
    removeSkill: (id: string) => call<WorkspaceSnapshot>('POST', 'remove-skill', { id }),
    toggleFavourite: (id: string) => call<WorkspaceSnapshot>('POST', 'toggle-favourite', { id }),
    createSkill: (input: CreateSkillInput) => call<WorkspaceSnapshot>('POST', 'create-skill', { input }),
    listRepoCatalogs: () => call<RepoCatalog[]>('GET', 'repos'),
    addSkillRepo: (input: string) => call<RepoCatalog[]>('POST', 'add-repo', { input }),
    removeSkillRepo: (slug: string) => call<RepoCatalog[]>('POST', 'remove-repo', { slug }),
    refreshSkillRepo: (slug: string) => call<RepoCatalog[]>('POST', 'refresh-repo', { slug }),
    installRepoSkill: (input: InstallRepoSkillInput) =>
      call<WorkspaceSnapshot>('POST', 'install-repo-skill', { input }),
  }
}
