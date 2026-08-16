import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, AlertTriangle, Bug, Info, Pause, Play, RefreshCw, ScrollText } from 'lucide-react'
import type { LogEntry } from '@/features/skills/model/skills'

type LogsViewProps = {
  getLogs: (limit?: number) => Promise<LogEntry[]>
}

type Level = LogEntry['level']
const LEVELS: Level[] = ['debug', 'info', 'warn', 'error']
const LEVEL_RANK: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 }

const LEVEL_STYLE: Record<Level, { text: string; icon: React.ComponentType<{ className?: string }> }> = {
  debug: { text: 'text-[#52525b]', icon: Bug },
  info: { text: 'text-[#38bdf8]', icon: Info },
  warn: { text: 'text-[#fb923c]', icon: AlertTriangle },
  error: { text: 'text-[#f87171]', icon: AlertCircle },
}

/**
 * The hub's structured log, rendered readably: level-colored rows, event
 * name, and the field bag flattened to key=value pills. Filters by minimum
 * level and free text; auto-refreshes every few seconds unless paused.
 * Newest first — the thing you're debugging is at the top.
 */
export function LogsView({ getLogs }: LogsViewProps) {
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [minLevel, setMinLevel] = useState<Level>('info')
  const [query, setQuery] = useState('')
  const [live, setLive] = useState(true)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())

  const refresh = async () => {
    try {
      setEntries(await getLogs(500))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
    if (!live) return
    const timer = setInterval(() => void refresh(), 4000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live])

  const visible = useMemo(() => {
    const value = query.trim().toLowerCase()
    return entries
      .filter((entry) => LEVEL_RANK[entry.level] >= LEVEL_RANK[minLevel])
      .filter((entry) => !value || JSON.stringify(entry).toLowerCase().includes(value))
      .slice()
      .reverse()
  }, [entries, minLevel, query])

  const counts = useMemo(() => {
    const result: Record<Level, number> = { debug: 0, info: 0, warn: 0, error: 0 }
    for (const entry of entries) result[entry.level]++
    return result
  }, [entries])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-7 pt-5">
        <div className="flex items-start gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-2.5">
              <h1 className="text-[22px] font-semibold tracking-tight text-[#fafafa]">Logs</h1>
              <span className="rounded-[7px] border border-[#27272a] bg-[#18181b] px-2.5 py-1 text-[11px] font-medium text-[#a1a1aa]">
                Last {entries.length}
              </span>
            </div>
            <p className="mt-1.5 max-w-[620px] text-[13.5px] leading-relaxed text-[#71717a]">
              What the hub did and why — SSH calls, agent pushes, snapshots, and every sync decision. Newest first.
              Set <span className="font-mono text-[12px]">SKILLDEX_LOG=debug</span> in the hub's environment for per-call detail.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setLive((current) => !current)}
            className={`flex h-[34px] items-center gap-1.5 rounded-[9px] border px-3 text-[12.5px] font-medium transition ${
              live ? 'border-[#1f3a24] bg-[#0f1a11] text-[#4ade80]' : 'border-[#27272a] bg-[#18181b] text-[#a1a1aa] hover:border-[#3a3a42]'
            }`}
          >
            {live ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
            {live ? 'Live' : 'Paused'}
          </button>
          <button
            type="button"
            onClick={() => void refresh()}
            className="flex h-[34px] items-center gap-1.5 rounded-[9px] border border-[#27272a] bg-[#18181b] px-3 text-[12.5px] font-medium text-[#e4e4e7] transition hover:border-[#3a3a42]"
          >
            <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        <div className="mt-5 flex items-center gap-2 border-b border-[#1c1c20] pb-3">
          {LEVELS.map((level) => {
            const style = LEVEL_STYLE[level]
            const active = minLevel === level
            return (
              <button
                key={level}
                type="button"
                onClick={() => setMinLevel(level)}
                title={`Show ${level} and above`}
                className={`flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-medium transition ${
                  active ? 'border-[#f97316] bg-[#1a1109] text-[#fb923c]' : 'border-[#27272a] bg-[#111114] text-[#a1a1aa] hover:border-[#3a3a42]'
                }`}
              >
                <span className={active ? '' : style.text}>{level}</span>
                <span className="font-mono text-[10.5px] opacity-70">{counts[level]}</span>
              </button>
            )
          })}
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter (event, machine, skill, error…)"
            className="ml-2 h-[30px] w-[280px] rounded-[9px] border border-[#27272a] bg-[#111114] px-3 text-[13px] text-[#e4e4e7] outline-none placeholder:text-[#52525b] focus:border-[#3a3a42]"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-7 pb-7 pt-4">
        {visible.length === 0 ? (
          <div className="flex items-center gap-2 rounded-xl border border-dashed border-[#27272a] px-6 py-14 text-[13px] text-[#71717a]">
            <ScrollText className="size-4" />
            {entries.length === 0 ? 'No log entries yet.' : 'Nothing matches the current filter.'}
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-[#1c1c20] bg-[#0c0c0e] font-mono text-[12px]">
            {visible.map((entry, index) => {
              const style = LEVEL_STYLE[entry.level]
              const Icon = style.icon
              const { ts, level, event, ...fields } = entry
              const isOpen = expanded.has(index)
              const pills = Object.entries(fields).filter(([, value]) => value !== undefined && value !== null)
              const primary = pills.filter(([key]) => ['machine', 'skill', 'error', 'command', 'code', 'ms', 'transport'].includes(key))
              const rest = pills.filter(([key]) => !primary.some(([primaryKey]) => primaryKey === key))
              const emphasize = level === 'error' || level === 'warn'
              return (
                <div
                  key={`${ts}-${index}`}
                  onClick={() =>
                    setExpanded((current) => {
                      const next = new Set(current)
                      if (next.has(index)) next.delete(index)
                      else next.add(index)
                      return next
                    })
                  }
                  className={`cursor-pointer border-b border-[#141417] px-3.5 py-2 last:border-b-0 hover:bg-[#111114] ${
                    emphasize ? 'bg-[#120c0c]' : ''
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 shrink-0 text-[#3f3f46]">{formatTime(ts)}</span>
                    <span className={`flex w-[52px] shrink-0 items-center gap-1 ${style.text}`}>
                      <Icon className="size-3" />
                      {level}
                    </span>
                    <span className="shrink-0 font-semibold text-[#e4e4e7]">{event}</span>
                    <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                      {primary.map(([key, value]) => (
                        <Pill key={key} name={key} value={value} highlight={key === 'error'} />
                      ))}
                      {!isOpen && rest.length > 0 && (
                        <span className="text-[#52525b]">+{rest.length} more</span>
                      )}
                    </span>
                  </div>
                  {isOpen && rest.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5 pl-[7.5rem]">
                      {rest.map(([key, value]) => (
                        <Pill key={key} name={key} value={value} />
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function Pill({ name, value, highlight = false }: { name: string; value: unknown; highlight?: boolean }) {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return (
    <span
      className={`inline-flex max-w-[520px] items-baseline gap-1 rounded-md border px-1.5 py-0.5 ${
        highlight ? 'border-[#3f2020] bg-[#1a0f0f] text-[#f87171]' : 'border-[#1f1f24] bg-[#111114] text-[#a1a1aa]'
      }`}
      title={text}
    >
      <span className="text-[#52525b]">{name}=</span>
      <span className="truncate">{text}</span>
    </span>
  )
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleTimeString([], { hour12: false }) + '.' + String(date.getMilliseconds()).padStart(3, '0')
}
