/**
 * Hub HTTP API — the same `SkillWorkspace` contract the Electron preload
 * exposes, mapped 1:1 onto HTTP so the renderer's http-bridge can implement
 * `window.skilldex.workspace` with fetch calls.
 *
 * Hand-rolled on node:http (matching the repo's no-extra-deps ethos): reads
 * are GET with query params, mutations are POST with a JSON body. Handler
 * errors become `400 {"error": message}`, which the http-bridge re-throws so
 * dialogs behave exactly as they do over IPC.
 */

import { existsSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { logger, recentLogs } from '../electron/main/workspace/log'
import { CATEGORY_IDS } from '../electron/main/workspace/categorizer'
import type { SkillWorkspace } from '../electron/main/workspace/skill-workspace'
import type { SkillCategory, WorkspaceConfig } from '../electron/main/workspace/types'

type Handler = (query: URLSearchParams, body: Record<string, unknown>) => Promise<unknown>

export function createApiRoutes(workspace: SkillWorkspace): Map<string, Handler> {
  const id = (query: URLSearchParams, body: Record<string, unknown>) => {
    const value = query.get('id') ?? body.id
    if (typeof value !== 'string' || !value) throw new Error('Missing skill id.')
    return value
  }

  return new Map<string, Handler>([
    ['GET /api/logs', async (q) => recentLogs(Number(q.get('limit')) || 200)],
    // API keys are write-only over HTTP: reads get a masked marker, and a
    // masked marker sent back on save keeps the stored key. The hub is
    // tailnet-only, but a plaintext key on an unauthenticated route is still
    // one curl away from every peer.
    ['GET /api/config', async () => redactSecrets(await workspace.getConfig())],
    ['GET /api/snapshot', async () => workspace.getSnapshot()],
    ['POST /api/configure-sources', async (_q, body) =>
      workspace.configureSources(restoreSecrets(body.config as WorkspaceConfig, await workspace.getConfig()))],
    ['GET /api/skill-readme', async (q, b) => workspace.getSkillReadme(id(q, b))],
    ['GET /api/skill-files', async (q, b) => workspace.listSkillFiles(id(q, b))],
    ['POST /api/enable-skill', async (q, b) => workspace.enableSkill(id(q, b))],
    ['POST /api/disable-skill', async (q, b) => workspace.disableSkill(id(q, b))],
    ['POST /api/remove-skill', async (q, b) => workspace.removeSkill(id(q, b))],
    ['POST /api/toggle-favourite', async (q, b) => workspace.toggleFavourite(id(q, b))],
    ['POST /api/create-skill', async (_q, body) => workspace.createSkill(body.input as never)],
    ['POST /api/import-skill-archive', async (_q, body) => workspace.importSkillArchive(body.input as never)],
    // Agent-facing: upload a skill as loose files, look one up by name, push it to machines.
    ['POST /api/import-skill-files', async (_q, body) => workspace.importSkillFiles((body.input ?? body) as never)],
    ['GET /api/skill', async (q) => {
      const name = q.get('name') ?? q.get('id')
      if (!name) throw new Error('Missing skill name (?name=).')
      const flag = q.get('machines')
      return workspace.findSkill(name, { machines: !(flag === '0' || flag === 'false') })
    }],
    ['POST /api/distribute', async (_q, body) => workspace.distributeSkill((body.input ?? body) as never)],
    ['GET /api/repos', async () => workspace.listRepoCatalogs()],
    ['POST /api/add-repo', async (_q, body) => {
      if (typeof body.input !== 'string') throw new Error('Missing repo input.')
      return workspace.addSkillRepo(body.input)
    }],
    ['POST /api/remove-repo', async (_q, body) => {
      if (typeof body.slug !== 'string') throw new Error('Missing repo slug.')
      return workspace.removeSkillRepo(body.slug)
    }],
    ['POST /api/refresh-repo', async (_q, body) => {
      if (typeof body.slug !== 'string') throw new Error('Missing repo slug.')
      return workspace.refreshSkillRepo(body.slug)
    }],
    ['POST /api/install-repo-skill', async (_q, body) => workspace.installRepoSkill(body.input as never)],
    // Browser mode has no native directory picker; the UI sends a typed path
    // and we confirm it exists on the hub before it is added as a source.
    ['POST /api/validate-directory', async (_q, body) => {
      const dir = typeof body.path === 'string' ? body.path : ''
      return { valid: dir.startsWith('/') && existsSync(dir) }
    }],
    ['GET /api/machines', async () => workspace.listMachineSnapshots()],
    ['POST /api/add-machine', async (_q, body) => workspace.addMachine(body.machine as never)],
    ['POST /api/update-machine', async (_q, body) => {
      if (typeof body.name !== 'string') throw new Error('Missing machine name.')
      return workspace.updateMachine(body.name, body.machine as never)
    }],
    ['POST /api/remove-machine', async (_q, body) => {
      if (typeof body.name !== 'string') throw new Error('Missing machine name.')
      return workspace.removeMachine(body.name)
    }],
    ['POST /api/refresh-machine', async (_q, body) => {
      if (typeof body.name !== 'string') throw new Error('Missing machine name.')
      return workspace.refreshMachine(body.name)
    }],
    ['POST /api/machine-install', async (_q, body) => {
      if (typeof body.name !== 'string') throw new Error('Missing machine name.')
      return workspace.installOnMachine(body.name, body.input as never)
    }],
    ['POST /api/set-syndication', async (_q, body) => workspace.setSyndication(body.input as never)],
    ['POST /api/set-skill-enabled', async (_q, body) => workspace.setSkillEnabled(body.input as never)],
    ['GET /api/machine-diff', async (q) => {
      const name = q.get('name')
      if (!name) throw new Error('Missing machine name.')
      return workspace.machineDiff(name)
    }],
    ['POST /api/adopt-from-machine', async (_q, body) => {
      if (typeof body.name !== 'string' || !Array.isArray(body.skillIds)) throw new Error('Missing name or skillIds.')
      return workspace.adoptFromMachine(body.name, body.skillIds as string[])
    }],
    ['POST /api/categorize-library', async (_q, body) =>
      workspace.categorizeLibrary({ force: body.force === true })],
    ['POST /api/set-skill-category', async (_q, body) => {
      const id = typeof body.id === 'string' ? body.id : ''
      if (!id) throw new Error('Missing skill id.')
      const category = body.category ?? null
      if (category !== null && !CATEGORY_IDS.includes(category as SkillCategory))
        throw new Error(`Unknown category "${String(category)}". One of: ${CATEGORY_IDS.join(', ')}.`)
      return workspace.setSkillCategory(id, category as SkillCategory | null)
    }],
    ['POST /api/clear-machine', async (_q, body) => {
      if (typeof body.name !== 'string') throw new Error('Missing machine name.')
      return workspace.clearMachine(body.name, Array.isArray(body.dirNames) ? (body.dirNames as string[]) : undefined)
    }],
    ['POST /api/converge-machine', async (_q, body) => {
      if (typeof body.name !== 'string') throw new Error('Missing machine name.')
      return workspace.convergeMachine(body.name, Array.isArray(body.dirNames) ? (body.dirNames as string[]) : undefined)
    }],
    ['POST /api/machine-skill-op', async (_q, body) => {
      const { name, op } = body
      if (typeof name !== 'string') throw new Error('Missing machine name.')
      if (op !== 'enable' && op !== 'disable' && op !== 'remove') throw new Error('Invalid op.')
      return workspace.machineSkillOp(name, op, id(new URLSearchParams(), body))
    }],
  ])
}

export async function handleApi(
  routes: Map<string, Handler>,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<boolean> {
  const handler = routes.get(`${request.method} ${url.pathname}`)
  if (!handler) return false

  let body: Record<string, unknown> = {}
  if (request.method === 'POST') {
    try {
      const raw = await readBody(request, LARGE_BODY_ROUTES.has(url.pathname) ? LARGE_BODY_LIMIT : BODY_LIMIT)
      body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
    } catch {
      respond(response, 400, { error: 'Invalid JSON body.' })
      return true
    }
  }

  const started = Date.now()
  try {
    const result = await handler(url.searchParams, body)
    respond(response, 200, result ?? null)
    if (url.pathname !== '/api/logs') logger.debug('http', { method: request.method, path: url.pathname, status: 200, ms: Date.now() - started })
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    logger.warn('http.error', { method: request.method, path: url.pathname, status: 400, ms: Date.now() - started, error: message })
    respond(response, 400, { error: message })
  }
  return true
}

function respond(response: ServerResponse, status: number, payload: unknown): void {
  const data = JSON.stringify(payload)
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  response.end(data)
}

/** Default request-body cap; only the upload routes get the large one. */
const BODY_LIMIT = 1_000_000
/** Base64 skill archives / file bundles (see MAX_ARCHIVE_BYTES). */
const LARGE_BODY_LIMIT = 48_000_000
const LARGE_BODY_ROUTES = new Set(['/api/import-skill-archive', '/api/import-skill-files'])

const SECRET_KEYS = ['anthropicApiKey', 'openRouterApiKey'] as const
const MASK = '••••'

function redactSecrets(config: WorkspaceConfig): WorkspaceConfig {
  const out = { ...config }
  for (const key of SECRET_KEYS) {
    const value = out[key]
    if (value) out[key] = `${MASK}${value.slice(-4)}`
  }
  return out
}

function restoreSecrets(incoming: WorkspaceConfig, stored: WorkspaceConfig): WorkspaceConfig {
  const out = { ...incoming }
  for (const key of SECRET_KEYS) {
    const value = out[key]
    if (typeof value === 'string' && value.startsWith(MASK)) out[key] = stored[key]
  }
  return out
}

function readBody(request: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('Body too large'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}
