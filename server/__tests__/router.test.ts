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

  it('imports loose files, looks a skill up by name, and rejects distribute with no machines', async () => {
    const imported = await fetch(`${base}/api/import-skill-files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: {
          scope: 'global',
          files: [{ path: 'SKILL.md', content: '---\nname: api-made\ndescription: via API\n---\n' }],
        },
      }),
    })
    expect(imported.status).toBe(200)
    expect((await imported.json()).dirName).toBe('api-made')

    const lookup = await (await fetch(`${base}/api/skill?name=api-made`)).json()
    expect(lookup.library.map((skill: { name: string }) => skill.name)).toEqual(['api-made'])
    expect(lookup.machines).toEqual([])

    const missing = await fetch(`${base}/api/skill`)
    expect(missing.status).toBe(400)

    const distribute = await fetch(`${base}/api/distribute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'api-made' }),
    })
    expect(distribute.status).toBe(400)
    expect((await distribute.json()).error).toMatch(/machine/i)
  })

  it('masks API keys on read and keeps the stored key when the mask is sent back', async () => {
    const config = await (await fetch(`${base}/api/config`)).json()
    await fetch(`${base}/api/configure-sources`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: { ...config, anthropicApiKey: 'sk-ant-secret-1234' } }),
    })
    const masked = await (await fetch(`${base}/api/config`)).json()
    expect(masked.anthropicApiKey).toBe('••••1234')
    // Saving the masked value back must not overwrite the real key.
    await fetch(`${base}/api/configure-sources`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: { ...masked, includePlugins: false } }),
    })
    const again = await (await fetch(`${base}/api/config`)).json()
    expect(again.anthropicApiKey).toBe('••••1234')
    expect(again.includePlugins).toBe(false)
    // Clearing works: an empty value drops the key.
    await fetch(`${base}/api/configure-sources`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: { ...again, anthropicApiKey: '' } }),
    })
    expect((await (await fetch(`${base}/api/config`)).json()).anthropicApiKey).toBeUndefined()
  })

  it('validates categories and caps ordinary request bodies at 1 MB', async () => {
    const bad = await fetch(`${base}/api/set-skill-category`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'x', category: 'not-a-shelf' }),
    })
    expect(bad.status).toBe(400)
    expect((await bad.json()).error).toMatch(/Unknown category/)

    const big = JSON.stringify({ id: 'x'.repeat(2_000_000) })
    const tooLarge = await fetch(`${base}/api/toggle-favourite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: big,
    }).then((r) => r.status).catch(() => 'closed')
    expect([400, 'closed']).toContain(tooLarge)
  })
})
