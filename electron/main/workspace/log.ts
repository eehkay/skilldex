/**
 * Structured logging for the hub and machine layer.
 *
 * One JSON object per line on stderr — greppable, and Coolify/docker log
 * viewers show it as-is. Every entry carries a level, an event name, and a
 * flat bag of fields; errors are serialized to their message. Verbosity is
 * controlled by SKILLDEX_LOG (debug|info|warn|error, default info); machine
 * operations log at debug on success and warn/error on failure so the
 * default output stays quiet unless something is wrong.
 *
 * The desktop app gets the same logger writing to the Electron main-process
 * console — nothing here depends on the hub.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

function threshold(): number {
  const raw = (process.env.SKILLDEX_LOG || 'info').toLowerCase() as LogLevel
  return ORDER[raw] ?? ORDER.info
}

export type LogFields = Record<string, unknown>

/** Ring buffer of recent entries so the API can expose them (e.g. /api/logs). */
const RECENT_MAX = 2000
type Entry = { ts: string; level: LogLevel; event: string } & LogFields
const recent: Entry[] = []

export function recentLogs(limit = 200): Entry[] {
  return recent.slice(-limit)
}

/**
 * Optional on-disk persistence so the log survives restarts and redeploys.
 * `enableLogPersistence(file)` replays the tail of an existing file into the
 * ring buffer, then appends every new entry (JSONL) and trims the file when
 * it grows past ~2× the buffer so it can't grow unbounded on the volume.
 */
let persistFile: string | null = null
let pending: Promise<void> = Promise.resolve()

export async function enableLogPersistence(file: string): Promise<void> {
  const fs = await import('node:fs/promises')
  const path = await import('node:path')
  persistFile = file
  await fs.mkdir(path.dirname(file), { recursive: true })
  try {
    const raw = await fs.readFile(file, 'utf8')
    const lines = raw.split('\n').filter(Boolean).slice(-RECENT_MAX)
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as Entry
        if (entry && typeof entry.ts === 'string' && typeof entry.event === 'string') recent.push(entry)
      } catch {
        // skip a torn line
      }
    }
  } catch {
    // no file yet
  }
}

function persist(entry: Entry): void {
  if (!persistFile) return
  const file = persistFile
  pending = pending
    .then(async () => {
      const fs = await import('node:fs/promises')
      await fs.appendFile(file, JSON.stringify(entry) + '\n', 'utf8')
      // Trim occasionally: rewrite from the in-memory buffer when the file is large.
      if (recent.length >= RECENT_MAX && Math.random() < 0.01) {
        const tmp = `${file}.${process.pid}.tmp`
        await fs.writeFile(tmp, recent.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8')
        await fs.rename(tmp, file)
      }
    })
    .catch(() => {})
}

function serialize(fields: LogFields): LogFields {
  const out: LogFields = {}
  for (const [key, value] of Object.entries(fields)) {
    if (value instanceof Error) out[key] = value.message
    else if (value !== undefined) out[key] = value
  }
  return out
}

export function log(level: LogLevel, event: string, fields: LogFields = {}): void {
  const entry: Entry = { ts: new Date().toISOString(), level, event, ...serialize(fields) }
  recent.push(entry)
  if (recent.length > RECENT_MAX) recent.splice(0, recent.length - RECENT_MAX)
  persist(entry)
  if (ORDER[level] < threshold()) return
  const line = JSON.stringify(entry)
  if (level === 'error' || level === 'warn') process.stderr.write(line + '\n')
  else process.stdout.write(line + '\n')
}

export const logger = {
  debug: (event: string, fields?: LogFields) => log('debug', event, fields),
  info: (event: string, fields?: LogFields) => log('info', event, fields),
  warn: (event: string, fields?: LogFields) => log('warn', event, fields),
  error: (event: string, fields?: LogFields) => log('error', event, fields),
}
