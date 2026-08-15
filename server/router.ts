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
import type { SkillWorkspace } from '../electron/main/workspace/skill-workspace'

type Handler = (query: URLSearchParams, body: Record<string, unknown>) => Promise<unknown>

export function createApiRoutes(workspace: SkillWorkspace): Map<string, Handler> {
  const id = (query: URLSearchParams, body: Record<string, unknown>) => {
    const value = query.get('id') ?? body.id
    if (typeof value !== 'string' || !value) throw new Error('Missing skill id.')
    return value
  }

  return new Map<string, Handler>([
    ['GET /api/config', async () => workspace.getConfig()],
    ['GET /api/snapshot', async () => workspace.getSnapshot()],
    ['POST /api/configure-sources', async (_q, body) => workspace.configureSources(body.config as never)],
    ['GET /api/skill-readme', async (q, b) => workspace.getSkillReadme(id(q, b))],
    ['GET /api/skill-files', async (q, b) => workspace.listSkillFiles(id(q, b))],
    ['POST /api/enable-skill', async (q, b) => workspace.enableSkill(id(q, b))],
    ['POST /api/disable-skill', async (q, b) => workspace.disableSkill(id(q, b))],
    ['POST /api/remove-skill', async (q, b) => workspace.removeSkill(id(q, b))],
    ['POST /api/toggle-favourite', async (q, b) => workspace.toggleFavourite(id(q, b))],
    ['POST /api/create-skill', async (_q, body) => workspace.createSkill(body.input as never)],
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
      const raw = await readBody(request)
      body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
    } catch {
      respond(response, 400, { error: 'Invalid JSON body.' })
      return true
    }
  }

  try {
    const result = await handler(url.searchParams, body)
    respond(response, 200, result ?? null)
  } catch (cause) {
    respond(response, 400, { error: cause instanceof Error ? cause.message : String(cause) })
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

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 1_000_000) {
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
