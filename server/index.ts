/**
 * `skilldex serve` — the hub entrypoint.
 *
 * Runs the exact same SkillWorkspace that powers the desktop app, but behind
 * a plain HTTP server: JSON API under /api/*, the built renderer as a static
 * SPA for everything else. No auth here by design — the hub is published
 * only onto the tailnet (see deploy/), so the tailnet is the front door.
 *
 * Environment:
 *   SKILLDEX_DATA_DIR  where config.json and the hub's own skill library live
 *                      (default ~/.skilldex; /data in the container)
 *   SKILLDEX_PORT      listen port (default 8654)
 *   SKILLDEX_HOST      bind address (default 0.0.0.0 — the container shares
 *                      the tailscale sidecar's network namespace, so this is
 *                      still tailnet-only)
 */

import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { createConfigStore } from '../electron/main/workspace/config'
import { createLibraryStore } from '../electron/main/workspace/library-store'
import { createSkillWorkspace } from '../electron/main/workspace/skill-workspace'
import { logger } from '../electron/main/workspace/log'
import { createApiRoutes, handleApi } from './router'
import { serveStatic } from './static'

const dataDir = process.env.SKILLDEX_DATA_DIR || path.join(os.homedir(), '.skilldex')
const port = Number(process.env.SKILLDEX_PORT) || 8654
const host = process.env.SKILLDEX_HOST || '0.0.0.0'

// The hub's "home" lives under the data volume: its ~/.claude/skills acts as
// the hub's own library (and, later, the staging area for fleet pushes).
const homeDir = path.join(dataDir, 'home')

// The built SPA sits next to the bundled server in the image; in a source
// checkout it's the electron-vite renderer output.
const staticRoot = process.env.SKILLDEX_STATIC_DIR || path.join(__dirname, '..', 'renderer')

async function main(): Promise<void> {
  await fs.mkdir(homeDir, { recursive: true })

  const workspace = createSkillWorkspace({
    homeDir,
    configStore: createConfigStore(path.join(dataDir, 'config.json')),
    // The bundled machine agent ships next to the server in the image.
    agentPath: process.env.SKILLDEX_AGENT_PATH || path.join(__dirname, '..', 'agent', 'skilldex-agent.js'),
    knownHostsFile: path.join(dataDir, 'known_hosts'),
    libraryStore: createLibraryStore(path.join(dataDir, 'library.json')),
  })
  const routes = createApiRoutes(workspace)

  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
    void handleApi(routes, request, response, url).then((handled) => {
      if (!handled) return serveStatic(staticRoot, url.pathname, response)
    })
  })

  server.listen(port, host, () => {
    logger.info('hub.listening', { url: `http://${host}:${port}`, dataDir, staticRoot, logLevel: process.env.SKILLDEX_LOG || 'info' })
  })
}

void main()
