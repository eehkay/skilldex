import fs from 'node:fs/promises'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createConfigStore } from '../../electron/main/workspace/config'
import { createSkillWorkspace } from '../../electron/main/workspace/skill-workspace'
import { createApiRoutes, handleApi } from '../router'

let tmp: string
let server: http.Server
let base: string

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'skilldex-hub-'))
  const workspace = createSkillWorkspace({
    homeDir: tmp,
    configStore: createConfigStore(path.join(tmp, 'config.json')),
    // The hub tests never touch the network.
    fetchImpl: async () => ({
      ok: false,
      status: 404,
      json: async () => ({}),
      text: async () => '',
      arrayBuffer: async () => new ArrayBuffer(0),
    }),
  })
  const routes = createApiRoutes(workspace)
  server = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    void handleApi(routes, request, response, url).then((handled) => {
      if (!handled) {
        response.writeHead(404)
        response.end()
      }
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve))
  await fs.rm(tmp, { recursive: true, force: true })
})

describe('hub API', () => {
  it('serves config and snapshot', async () => {
    const config = await (await fetch(`${base}/api/config`)).json()
    expect(config.skillRepos).toEqual([])

    const snapshot = await (await fetch(`${base}/api/snapshot`)).json()
    expect(snapshot.skills).toEqual([])
    expect(snapshot.homeDir).toBe(tmp)
  })

  it('creates a skill through the API and reads it back', async () => {
    const response = await fetch(`${base}/api/create-skill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: { name: 'From HTTP', description: 'via the hub', scope: 'global' } }),
    })
    expect(response.ok).toBe(true)
    const snapshot = await response.json()
    expect(snapshot.skills.map((s: { name: string }) => s.name)).toContain('from-http')

    const id = snapshot.skills[0].id
    const readme = await (await fetch(`${base}/api/skill-readme?id=${encodeURIComponent(id)}`)).json()
    expect(readme).toContain('via the hub')
  })

  it('maps handler errors to 400 with the message', async () => {
    const response = await fetch(`${base}/api/add-repo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: 'not a repo !!!' }),
    })
    expect(response.status).toBe(400)
    const payload = await response.json()
    expect(payload.error).toMatch(/GitHub repository/)
  })

  it('rejects unknown ids without touching the filesystem', async () => {
    const response = await fetch(`${base}/api/remove-skill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: '/etc/passwd' }),
    })
    expect(response.status).toBe(400)
    expect((await response.json()).error).toBe('Unknown skill.')
  })

  it('validates directories for the browser picker', async () => {
    const good = await (
      await fetch(`${base}/api/validate-directory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: tmp }),
      })
    ).json()
    expect(good.valid).toBe(true)

    const bad = await (
      await fetch(`${base}/api/validate-directory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '/definitely/not/here' }),
      })
    ).json()
    expect(bad.valid).toBe(false)
  })
})
