/**
 * Persists the user's `WorkspaceConfig` as JSON. The file path is injected so
 * the app wires it to `app.getPath('userData')` while tests use a temp file.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { defaultConfig, type WorkspaceConfig } from './types'

export type ConfigStore = {
  load(): Promise<WorkspaceConfig>
  save(config: WorkspaceConfig): Promise<WorkspaceConfig>
}

export function createConfigStore(filePath: string): ConfigStore {
  return {
    async load() {
      try {
        const raw = await fs.readFile(filePath, 'utf8')
        return normalize(JSON.parse(raw))
      } catch {
        return { ...defaultConfig }
      }
    },
    async save(config) {
      const normalized = normalize(config)
      await fs.mkdir(path.dirname(filePath), { recursive: true })
      // Write to a temp file then rename over the target so a crash mid-write
      // can never leave a truncated config.json. Favourites toggle often, so
      // this file is written far more than it used to be.
      const tmp = `${filePath}.${process.pid}.tmp`
      await fs.writeFile(tmp, JSON.stringify(normalized, null, 2), 'utf8')
      await fs.rename(tmp, filePath)
      return normalized
    },
  }
}

function normalize(value: unknown): WorkspaceConfig {
  const input = (value ?? {}) as Partial<WorkspaceConfig>
  return {
    includePersonal: input.includePersonal ?? defaultConfig.includePersonal,
    includePlugins: input.includePlugins ?? defaultConfig.includePlugins,
    projectRoots: Array.isArray(input.projectRoots)
      ? [...new Set(input.projectRoots.filter((root): root is string => typeof root === 'string'))]
      : [],
    favourites: Array.isArray(input.favourites)
      ? [...new Set(input.favourites.filter((key): key is string => typeof key === 'string'))]
      : [],
    skillRepos: Array.isArray(input.skillRepos)
      ? [...new Set(input.skillRepos.filter((slug): slug is string => typeof slug === 'string'))]
      : [],
    agents: [
      'claude',
      ...(Array.isArray(input.agents)
        ? [...new Set(input.agents.filter((agent): agent is 'codex' => agent === 'codex'))]
        : []),
    ],
    ...(typeof input.anthropicApiKey === 'string' && input.anthropicApiKey.trim()
      ? { anthropicApiKey: input.anthropicApiKey.trim() }
      : {}),
    ...(input.categorizerProvider === 'anthropic' || input.categorizerProvider === 'openrouter'
      ? { categorizerProvider: input.categorizerProvider }
      : {}),
    ...(typeof input.openRouterApiKey === 'string' && input.openRouterApiKey.trim()
      ? { openRouterApiKey: input.openRouterApiKey.trim() }
      : {}),
    ...(typeof input.openRouterModel === 'string' && input.openRouterModel.trim()
      ? { openRouterModel: input.openRouterModel.trim() }
      : {}),
    machines: Array.isArray(input.machines)
      ? input.machines.filter(
          (machine): machine is WorkspaceConfig['machines'][number] =>
            typeof machine === 'object' &&
            machine !== null &&
            typeof (machine as { name?: unknown }).name === 'string' &&
            typeof (machine as { host?: unknown }).host === 'string' &&
            typeof (machine as { user?: unknown }).user === 'string',
        )
      : [],
  }
}
