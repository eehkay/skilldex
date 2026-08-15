/**
 * Static file serving for the built renderer SPA. Unknown paths fall back to
 * index.html (the app is client-routed); traversal outside the root is
 * rejected before any filesystem access.
 */

import { createReadStream } from 'node:fs'
import fs from 'node:fs/promises'
import type { ServerResponse } from 'node:http'
import path from 'node:path'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.map': 'application/json',
}

export async function serveStatic(root: string, pathname: string, response: ServerResponse): Promise<void> {
  const resolvedRoot = path.resolve(root)
  const requested = path.resolve(resolvedRoot, '.' + path.posix.normalize('/' + decodeURIComponent(pathname)))
  const target =
    requested.startsWith(resolvedRoot) && (await isFile(requested))
      ? requested
      : path.join(resolvedRoot, 'index.html')

  try {
    const extension = path.extname(target).toLowerCase()
    const immutable = target.includes(`${path.sep}assets${path.sep}`)
    response.writeHead(200, {
      'Content-Type': MIME[extension] ?? 'application/octet-stream',
      // Vite emits content-hashed filenames under assets/ — safe to cache hard.
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    })
    createReadStream(target).pipe(response)
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain' })
    response.end('Not found')
  }
}

async function isFile(target: string): Promise<boolean> {
  try {
    return (await fs.stat(target)).isFile()
  } catch {
    return false
  }
}
