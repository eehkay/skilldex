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
const RECENT_MAX = 500
const recent: Array<{ ts: string; level: LogLevel; event: string } & LogFields> = []

export function recentLogs(limit = 200): typeof recent {
  return recent.slice(-limit)
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
  const entry = { ts: new Date().toISOString(), level, event, ...serialize(fields) }
  recent.push(entry)
  if (recent.length > RECENT_MAX) recent.splice(0, recent.length - RECENT_MAX)
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

/** Time an async operation, logging start/end with duration and outcome. */
export async function timed<T>(event: string, fields: LogFields, run: () => Promise<T>): Promise<T> {
  const started = Date.now()
  try {
    const result = await run()
    logger.debug(`${event}.ok`, { ...fields, ms: Date.now() - started })
    return result
  } catch (cause) {
    logger.warn(`${event}.fail`, { ...fields, ms: Date.now() - started, error: cause instanceof Error ? cause.message : String(cause) })
    throw cause
  }
}
