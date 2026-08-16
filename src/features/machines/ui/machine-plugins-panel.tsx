import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, AlertTriangle, Download, Loader2, Package, Plug, RefreshCw, Search, Store, Trash2 } from 'lucide-react'
import type { AvailablePlugin, InstalledPlugin, MachinePlugins, PluginOpInput, Skill } from '@/features/skills/model/skills'
import { SkillToggle } from '@/features/skills/ui/skill-toggle'

type MachinePluginsPanelProps = {
  machineName: string
  /** This machine's skills (to spot library copies duplicating plugin skills). */
  skills: Skill[]
  loadPlugins: (name: string) => Promise<MachinePlugins | null>
  loadFleet: () => Promise<MachinePlugins[]>
  loadAvailable: (name: string) => Promise<AvailablePlugin[]>
  onOp: (name: string, input: PluginOpInput) => Promise<MachinePlugins | null>
  onRemoveSkill: (id: string) => void
}

/**
 * Claude Code plugins on one machine: what's installed (toggle / uninstall),
 * what the rest of the fleet has that this machine lacks (install here), and
 * an install picker over the machine's marketplaces. The hub drives the
 * machine's own `claude plugin` CLI — it never copies plugin files.
 */
export function MachinePluginsPanel({ machineName, skills, loadPlugins, loadFleet, loadAvailable, onOp, onRemoveSkill }: MachinePluginsPanelProps) {
  const [inventory, setInventory] = useState<MachinePlugins | null>(null)
  const [fleet, setFleet] = useState<MachinePlugins[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [showInstall, setShowInstall] = useState(false)

  const refresh = async () => {
    setLoading(true)
    setNote(null)
    try {
      const [own, all] = await Promise.all([loadPlugins(machineName), loadFleet()])
      setInventory(own)
      setFleet(all)
    } catch (cause) {
      setNote(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machineName])

  const run = async (input: PluginOpInput, label: string) => {
    setBusy(input.plugin + input.op)
    setNote(null)
    try {
      const next = await onOp(machineName, input)
      if (next) setInventory(next)
      setNote(label)
      // Fleet view changes too (this machine is part of it).
      setFleet(await loadFleet())
    } catch (cause) {
      setNote(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(null)
    }
  }

  const installedIds = useMemo(() => new Set(inventory?.plugins.map((p) => p.id) ?? []), [inventory])

  // Plugins installed elsewhere in the fleet but not here, with the source
  // marketplace copied from a machine that has it (so install is one click).
  const elsewhere = useMemo(() => {
    if (!fleet || !inventory) return []
    const seen = new Map<string, { plugin: InstalledPlugin; machines: string[]; marketplaceSource?: string }>()
    for (const entry of fleet) {
      if (entry.machine.name === machineName || !entry.available) continue
      for (const plugin of entry.plugins) {
        if (installedIds.has(plugin.id)) continue
        const market = entry.marketplaces.find((m) => m.name === plugin.marketplace)
        const current = seen.get(plugin.id) ?? { plugin, machines: [], marketplaceSource: market?.location }
        current.machines.push(entry.machine.name)
        seen.set(plugin.id, current)
      }
    }
    return [...seen.values()].sort((a, b) => a.plugin.name.localeCompare(b.plugin.name))
  }, [fleet, inventory, installedIds, machineName])

  // Plugin-provided skills that also exist as a library (Personal) copy on
  // this machine — Claude loads both, so one is redundant.
  const duplicates = useMemo(() => {
    const personal = new Map(skills.filter((s) => s.scope === 'global').map((s) => [s.name, s]))
    return skills
      .filter((s) => s.scope === 'plugin' && personal.has(s.name))
      .map((pluginSkill) => ({ pluginSkill, librarySkill: personal.get(pluginSkill.name)! }))
  }, [skills])

  const pluginSkillsFor = (plugin: InstalledPlugin) =>
    skills.filter((s) => s.scope === 'plugin' && (s.id.includes(`/plugins/${plugin.name}/`) || s.source.includes(`/${plugin.name}/`)))

  if (loading && !inventory) {
    return (
      <div className="flex items-center gap-2 text-[13px] text-[#71717a]">
        <Loader2 className="size-4 animate-spin" /> Asking {machineName} for its plugins…
      </div>
    )
  }
  if (!inventory) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-[#3f2020] bg-[#1a0f0f] px-4 py-3 text-[13px] text-[#f87171]">
        <AlertCircle className="size-4 shrink-0" /> {note ?? `Could not read plugins from ${machineName}.`}
      </div>
    )
  }
  if (!inventory.available) {
    return (
      <div className="rounded-xl border border-dashed border-[#27272a] px-6 py-10 text-center text-[13px] text-[#71717a]">
        <Plug className="mx-auto mb-2 size-5 text-[#52525b]" />
        {inventory.error ?? 'Claude Code CLI not found on this machine, so plugins cannot be managed here.'}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-[13px] text-[#a1a1aa]">
          <span className="font-semibold text-[#e4e4e7]">{inventory.plugins.length}</span> plugin{inventory.plugins.length === 1 ? '' : 's'} installed ·{' '}
          <span className="font-semibold text-[#e4e4e7]">{inventory.marketplaces.length}</span> marketplace{inventory.marketplaces.length === 1 ? '' : 's'}
        </div>
        {note && <span className="text-[12px] text-[#71717a]">{note}</span>}
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading || busy !== null}
          className="flex h-8 items-center gap-1.5 rounded-[8px] border border-[#27272a] bg-[#18181b] px-2.5 text-[12px] font-medium text-[#e4e4e7] transition hover:border-[#3a3a42] disabled:opacity-60"
        >
          <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
        <button
          type="button"
          onClick={() => setShowInstall((v) => !v)}
          className="flex h-8 items-center gap-1.5 rounded-[8px] border border-[#f97316]/40 bg-[#1a1109] px-2.5 text-[12px] font-medium text-[#fb923c] transition hover:border-[#f97316]"
        >
          <Download className="size-3.5" /> Install plugin…
        </button>
      </div>

      {showInstall && (
        <InstallPicker
          machineName={machineName}
          installedIds={installedIds}
          loadAvailable={loadAvailable}
          busy={busy}
          onInstall={(plugin) => run({ op: 'install', plugin: plugin.id }, `Installed ${plugin.name}.`)}
          onClose={() => setShowInstall(false)}
        />
      )}

      {duplicates.length > 0 && (
        <div className="rounded-[11px] border border-[#3f2f14] bg-[#171207] px-4 py-3">
          <div className="flex items-center gap-2 text-[12.5px] font-semibold text-[#fbbf24]">
            <AlertTriangle className="size-4" /> {duplicates.length} skill{duplicates.length === 1 ? ' is' : 's are'} provided twice on this machine
          </div>
          <p className="mt-1 text-[12px] text-[#a1a1aa]">
            A plugin ships the skill and the library also installed a copy. Claude loads both. Keep the plugin (it updates itself) and drop the library copy here — the library keeps its own copy.
          </p>
          <div className="mt-2 flex flex-col gap-1.5">
            {duplicates.map(({ pluginSkill, librarySkill }) => (
              <div key={librarySkill.id} className="flex items-center gap-3 text-[12.5px]">
                <span className="font-semibold text-[#e4e4e7]">{librarySkill.name}</span>
                <span className="truncate font-mono text-[11px] text-[#71717a]">{pluginSkill.source}</span>
                <div className="flex-1" />
                <button
                  type="button"
                  onClick={() => onRemoveSkill(librarySkill.id)}
                  className="flex h-7 items-center gap-1 rounded-[8px] border border-[#27272a] bg-[#18181b] px-2 text-[12px] font-medium text-[#e4e4e7] transition hover:border-[#4a2020] hover:text-[#f87171]"
                >
                  <Trash2 className="size-3.5" /> Remove library copy here
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <section>
        <div className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#52525b]">Installed</div>
        {inventory.plugins.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[#27272a] px-6 py-8 text-center text-[13px] text-[#71717a]">
            No plugins installed on {machineName}.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {inventory.plugins.map((plugin) => {
              const provided = pluginSkillsFor(plugin)
              return (
                <div key={plugin.id} className="flex flex-col gap-2.5 rounded-[13px] border border-[#232328] bg-[#101013] p-4">
                  <div className="flex items-start gap-3">
                    <div className="grid size-10 shrink-0 place-items-center rounded-[11px] bg-[#1a1a1e] text-[#a1a1aa]">
                      <Package className="size-4.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[14.5px] font-semibold text-[#fafafa]">{plugin.name}</span>
                        {plugin.version !== 'unknown' && <span className="font-mono text-[11px] text-[#71717a]">v{plugin.version}</span>}
                        {!plugin.enabled && <span className="rounded-md border border-[#27272a] px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-[#71717a]">disabled</span>}
                      </div>
                      <div className="mt-0.5 flex items-center gap-1 truncate font-mono text-[11px] text-[#52525b]">
                        <Store className="size-3" /> {plugin.marketplace}
                      </div>
                    </div>
                    <span className="mt-0.5 flex shrink-0 items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => run({ op: 'uninstall', plugin: plugin.id }, `Uninstalled ${plugin.name}.`)}
                        disabled={busy !== null}
                        aria-label={`Uninstall ${plugin.name}`}
                        className="grid size-7 place-items-center rounded-lg text-[#52525b] transition hover:bg-[#1e1010] hover:text-[#f87171] disabled:opacity-40"
                      >
                        {busy === plugin.id + 'uninstall' ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                      </button>
                      <SkillToggle
                        enabled={plugin.enabled}
                        disabled={busy !== null}
                        onToggle={
                          busy !== null
                            ? undefined
                            : () => run({ op: plugin.enabled ? 'disable' : 'enable', plugin: plugin.id }, `${plugin.enabled ? 'Disabled' : 'Enabled'} ${plugin.name}.`)
                        }
                      />
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[#71717a]">
                    {provided.length > 0 && <span>{provided.length} skill{provided.length === 1 ? '' : 's'}: {provided.map((s) => s.name).join(', ')}</span>}
                    {plugin.mcpServers?.length ? <span>MCP: {plugin.mcpServers.join(', ')}</span> : null}
                    {plugin.lastUpdated && <span className="ml-auto font-mono">updated {plugin.lastUpdated.slice(0, 10)}</span>}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {fleet && (
        <section>
          <div className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#52525b]">Elsewhere in the fleet</div>
          {elsewhere.length === 0 ? (
            <div className="text-[12.5px] text-[#71717a]">
              {fleet.filter((e) => e.available && e.machine.name !== machineName).length === 0
                ? 'No other machine reported plugins.'
                : `${machineName} has every plugin the other machines have.`}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {elsewhere.map(({ plugin, machines, marketplaceSource }) => (
                <div key={plugin.id} className="flex items-center gap-3 rounded-[11px] border border-[#232328] bg-[#101013] px-4 py-2.5">
                  <Package className="size-4 shrink-0 text-[#71717a]" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-[13px]">
                      <span className="font-semibold text-[#e4e4e7]">{plugin.name}</span>
                      <span className="font-mono text-[11px] text-[#52525b]">@{plugin.marketplace}</span>
                    </div>
                    <div className="text-[11.5px] text-[#71717a]">on {machines.join(', ')}</div>
                  </div>
                  <button
                    type="button"
                    disabled={busy !== null || !marketplaceSource}
                    title={marketplaceSource ? `Adds the ${plugin.marketplace} marketplace here if needed, then installs.` : 'Marketplace source unknown — add it on this machine first.'}
                    onClick={() =>
                      run(
                        { op: 'install', plugin: plugin.id, marketplaceName: plugin.marketplace, marketplaceSource },
                        `Installed ${plugin.name} on ${machineName}.`,
                      )
                    }
                    className="flex h-7 items-center gap-1 rounded-[8px] border border-[#27272a] bg-[#18181b] px-2.5 text-[12px] font-medium text-[#e4e4e7] transition hover:border-[#3a3a42] disabled:opacity-50"
                  >
                    {busy === plugin.id + 'install' ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
                    Install here
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <section>
        <div className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#52525b]">Marketplaces</div>
        <div className="flex flex-wrap gap-2">
          {inventory.marketplaces.map((market) => (
            <span key={market.name} title={market.location} className="flex items-center gap-1.5 rounded-md border border-[#27272a] bg-[#111114] px-2 py-1 text-[12px] text-[#a1a1aa]">
              <Store className="size-3 text-[#52525b]" /> {market.name}
              <span className="font-mono text-[10.5px] text-[#52525b]">{market.source}</span>
            </span>
          ))}
          {inventory.marketplaces.length === 0 && <span className="text-[12.5px] text-[#71717a]">None configured.</span>}
        </div>
      </section>
    </div>
  )
}

function InstallPicker({
  machineName,
  installedIds,
  loadAvailable,
  busy,
  onInstall,
  onClose,
}: {
  machineName: string
  installedIds: Set<string>
  loadAvailable: (name: string) => Promise<AvailablePlugin[]>
  busy: string | null
  onInstall: (plugin: AvailablePlugin) => Promise<void>
  onClose: () => void
}) {
  const [available, setAvailable] = useState<AvailablePlugin[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  useEffect(() => {
    let cancelled = false
    loadAvailable(machineName)
      .then((list) => { if (!cancelled) setAvailable(list) })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause)) })
    return () => { cancelled = true }
  }, [machineName, loadAvailable])

  const matches = useMemo(() => {
    if (!available) return []
    const q = query.trim().toLowerCase()
    const pool = q ? available.filter((p) => `${p.name} ${p.description} ${p.marketplace}`.toLowerCase().includes(q)) : available
    return [...pool].sort((a, b) => (b.installCount ?? 0) - (a.installCount ?? 0)).slice(0, q ? 40 : 20)
  }, [available, query])

  return (
    <div className="rounded-[13px] border border-[#2a2a30] bg-[#0f0f12] p-4">
      <div className="flex items-center gap-2">
        <Search className="size-4 text-[#52525b]" />
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={available ? `Search ${available.length} plugins across ${machineName}'s marketplaces…` : 'Loading marketplaces…'}
          className="h-8 flex-1 rounded-[8px] border border-[#27272a] bg-[#0c0c0e] px-2.5 text-[12.5px] text-[#e4e4e7] outline-none placeholder:text-[#3f3f46] focus:border-[#3a3a42]"
        />
        <button type="button" onClick={onClose} className="text-[12px] text-[#71717a] hover:text-[#e4e4e7]">Close</button>
      </div>
      {error && <div className="mt-3 text-[12.5px] text-[#f87171]">{error}</div>}
      {!available && !error && (
        <div className="mt-3 flex items-center gap-2 text-[12.5px] text-[#71717a]"><Loader2 className="size-3.5 animate-spin" /> Reading marketplaces on {machineName}…</div>
      )}
      {available && (
        <div className="mt-3 flex max-h-[360px] flex-col gap-1.5 overflow-y-auto pr-1">
          {matches.map((plugin) => {
            const installed = installedIds.has(plugin.id)
            return (
              <div key={plugin.id} className="flex items-start gap-3 rounded-[10px] border border-[#1c1c20] px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[13px]">
                    <span className="font-semibold text-[#e4e4e7]">{plugin.name}</span>
                    <span className="font-mono text-[11px] text-[#52525b]">@{plugin.marketplace}</span>
                    {typeof plugin.installCount === 'number' && <span className="text-[11px] text-[#52525b]">{plugin.installCount.toLocaleString()} installs</span>}
                  </div>
                  <p className="line-clamp-2 text-[11.5px] leading-relaxed text-[#71717a]">{plugin.description}</p>
                </div>
                <button
                  type="button"
                  disabled={installed || busy !== null}
                  onClick={() => void onInstall(plugin)}
                  className="flex h-7 shrink-0 items-center gap-1 rounded-[8px] border border-[#27272a] bg-[#18181b] px-2.5 text-[12px] font-medium text-[#e4e4e7] transition hover:border-[#3a3a42] disabled:opacity-50"
                >
                  {busy === plugin.id + 'install' ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
                  {installed ? 'Installed' : 'Install'}
                </button>
              </div>
            )
          })}
          {matches.length === 0 && <div className="py-4 text-center text-[12.5px] text-[#71717a]">No plugins match “{query}”.</div>}
        </div>
      )}
    </div>
  )
}
