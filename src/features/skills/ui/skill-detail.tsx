import { useEffect, useState } from 'react'
import { ArrowLeft, Check, Copy, ExternalLink, FolderOpen, Loader2, Pencil, Server } from 'lucide-react'
import { CATEGORY_LABELS, CATEGORY_ORDER, scopePillClass, shortRef, type MachineSnapshot, type SetSkillEnabledInput, type SetSyndicationInput, type Skill, type SkillCategory, type SkillFile } from '../model/skills'
import { FavouriteButton } from './favourite-button'
import { SkillToggle } from './skill-toggle'

type SkillDetailProps = {
  skill: Skill
  /** Configured machines, for the syndication panel on library skills. */
  machines: MachineSnapshot[]
  getReadme: (id: string) => Promise<string | null>
  listFiles: (id: string) => Promise<SkillFile[] | null>
  reveal: (id: string) => Promise<boolean>
  onToggle: () => void
  onToggleFavourite: () => void
  onRemove: () => void
  onSetSyndication: (input: SetSyndicationInput) => Promise<void>
  onSetSkillEnabled: (input: SetSkillEnabledInput) => Promise<void>
  onSetCategory: (category: SkillCategory | null) => Promise<void>
  onBack: () => void
}

type Tab = 'instructions' | 'files' | 'activity'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function SkillDetail({ skill, machines, getReadme, listFiles, reveal, onToggle, onToggleFavourite, onRemove, onSetSyndication, onSetSkillEnabled, onSetCategory, onBack }: SkillDetailProps) {
  const [tab, setTab] = useState<Tab>('instructions')
  const [readme, setReadme] = useState<string | null>(null)
  const [files, setFiles] = useState<SkillFile[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [confirmingRemove, setConfirmingRemove] = useState(false)
  const [copied, setCopied] = useState(false)
  const manageable = skill.scope !== 'plugin'

  const copyOrigin = () => {
    if (!skill.origin) return
    void navigator.clipboard.writeText(skill.origin.webUrl).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  useEffect(() => {
    let active = true
    setLoading(true)
    setReadme(null)
    setFiles(null)
    Promise.all([getReadme(skill.id), listFiles(skill.id)]).then(([md, list]) => {
      if (!active) return
      setReadme(md)
      setFiles(list)
      setLoading(false)
    })
    return () => {
      active = false
    }
  }, [skill.id, getReadme, listFiles])

  const totalSize = files?.reduce((sum, file) => sum + file.sizeBytes, 0) ?? 0
  const meta: Array<{ label: string; value: string }> = [
    { label: 'Scope', value: skill.scope },
    { label: 'Files', value: String(skill.fileCount) },
    { label: 'Size', value: formatSize(totalSize) },
    { label: 'Symlink', value: skill.isSymlink ? 'yes' : 'no' },
    { label: 'Projects', value: skill.projects.length ? skill.projects.join(', ') : '—' },
    ...(skill.library
      ? [
          { label: 'Imported from', value: skill.library.repo },
          { label: 'Version', value: shortRef(skill.library.ref) ?? skill.library.ref },
        ]
      : []),
  ]

  return (
    <div className="flex min-h-0 flex-1">
      <div className="min-w-0 flex-1 overflow-y-auto px-8 py-5">
        <button
          type="button"
          onClick={onBack}
          className="mb-4 inline-flex items-center gap-1.5 text-[12.5px] text-[#71717a] transition hover:text-[#a1a1aa]"
        >
          <ArrowLeft className="size-[15px]" />
          All skills
        </button>

        <div className="flex items-start gap-4">
          <div
            className="grid size-14 shrink-0 place-items-center rounded-[15px] font-mono text-[21px] font-semibold"
            style={{ background: skill.iconBg, color: skill.iconFg }}
          >
            {skill.mono}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2.5">
              <h1 className="text-2xl font-semibold tracking-tight text-[#fafafa]">{skill.name}</h1>
              <span
                className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide ${scopePillClass(skill.scope)}`}
              >
                {skill.scope}
              </span>
            </div>
            <p className="mt-1.5 max-w-[620px] text-[14px] leading-relaxed text-[#a1a1aa]">{skill.summary}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <span className="grid h-9 w-9 place-items-center rounded-[9px] border border-[#27272a] bg-[#18181b]">
              <FavouriteButton favourite={skill.isFavourite} size="lg" onToggle={onToggleFavourite} />
            </span>
            <button
              type="button"
              disabled
              title="Editing skills is coming soon"
              className="flex h-9 cursor-not-allowed items-center gap-1.5 rounded-[9px] border border-[#27272a] bg-[#18181b] px-3.5 text-[12.5px] font-medium text-[#e4e4e7] opacity-60"
            >
              <Pencil className="size-3.5" />
              Edit
            </button>
          </div>
        </div>

        <div className="mt-5 flex gap-2 border-b border-[#1c1c20]">
          {(['instructions', 'files', 'activity'] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`-mb-px border-b-2 px-1 pb-2.5 text-[13px] capitalize transition ${
                tab === key ? 'border-[#f97316] font-semibold text-[#fafafa]' : 'border-transparent text-[#71717a]'
              }`}
            >
              {key}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="mt-6 flex items-center gap-2 text-[13px] text-[#71717a]">
            <Loader2 className="size-4 animate-spin" /> Loading…
          </div>
        ) : (
          <div className="mt-5">
            {tab === 'instructions' &&
              (readme ? (
                <div className="overflow-hidden rounded-xl border border-[#1c1c20] bg-[#0c0c0e]">
                  <div className="flex items-center gap-2 border-b border-[#1c1c20] bg-[#111114] px-3.5 py-2.5">
                    <span className="font-mono text-[12px] text-[#a1a1aa]">SKILL.md</span>
                    <span className="ml-auto font-mono text-[11px] text-[#52525b]">markdown</span>
                  </div>
                  <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap px-4 py-4 font-mono text-[12.5px] leading-relaxed text-[#d4d4d8]">
                    {readme}
                  </pre>
                </div>
              ) : (
                <p className="text-[13px] text-[#71717a]">No SKILL.md content found.</p>
              ))}

            {tab === 'files' &&
              (files && files.length > 0 ? (
                <div className="divide-y divide-[#17171a] overflow-hidden rounded-xl border border-[#1c1c20] bg-[#0c0c0e]">
                  {files.map((file) => (
                    <div key={file.relativePath} className="flex items-center justify-between px-4 py-2.5">
                      <span className="truncate font-mono text-[12.5px] text-[#d4d4d8]">{file.relativePath}</span>
                      <span className="shrink-0 font-mono text-[11px] text-[#52525b]">{formatSize(file.sizeBytes)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[13px] text-[#71717a]">No files found.</p>
              ))}

            {tab === 'activity' && (
              <p className="text-[13px] text-[#71717a]">Usage activity will appear here once tracking lands.</p>
            )}
          </div>
        )}
      </div>

      <aside className="w-[280px] shrink-0 overflow-y-auto border-l border-[#1c1c20] bg-[#0b0b0d] px-5 py-5">
        <div className="mb-4 rounded-[11px] border border-[#232328] bg-[#101013] px-3.5 py-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[12px] text-[#71717a]">Status</div>
              <div
                className="mt-0.5 text-[14px] font-semibold"
                style={{ color: skill.enabled ? '#22c55e' : '#a1a1aa' }}
              >
                {skill.enabled ? 'Enabled' : 'Disabled'}
              </div>
            </div>
            <SkillToggle enabled={skill.enabled} size="lg" onToggle={onToggle} disabled={!manageable} />
          </div>
          {(skill.library?.targets.length ?? 0) > 0 && (
            <div className="mt-2 border-t border-[#1c1c20] pt-2 text-[11px] leading-relaxed text-[#52525b]">
              Applies here and on all {skill.library?.targets.length} syndicated{' '}
              {skill.library?.targets.length === 1 ? 'machine' : 'machines'}. Use the per-machine toggles
              below for one machine only.
            </div>
          )}
        </div>

        <div className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#52525b]">Details</div>
        {meta.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-3 border-b border-[#17171a] py-2.5">
            <span className="text-[12.5px] text-[#71717a]">{row.label}</span>
            <span className="truncate text-right font-mono text-[12.5px] text-[#e4e4e7]">{row.value}</span>
          </div>
        ))}

        {skill.scope === 'global' && (
          <>
            <div className="mb-2.5 mt-5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#52525b]">
              Category
            </div>
            <select
              value={skill.library?.category ?? ''}
              onChange={(event) => void onSetCategory((event.target.value || null) as SkillCategory | null)}
              className="h-9 w-full rounded-[9px] border border-[#27272a] bg-[#0c0c0e] px-3 text-[12.5px] text-[#e4e4e7] outline-none focus:border-[#3a3a42]"
            >
              <option value="">Uncategorized</option>
              {CATEGORY_ORDER.map((key) => (
                <option key={key} value={key}>
                  {CATEGORY_LABELS[key]}
                </option>
              ))}
            </select>
            {skill.library?.category && skill.library.categorySource && (
              <div className="mt-1.5 text-[11px] text-[#52525b]">
                {skill.library.categorySource === 'manual'
                  ? 'Set by you — auto-categorize will not change it.'
                  : `Assigned ${skill.library.categorySource === 'llm' ? 'by Claude' : 'from repo structure'}${
                      typeof skill.library.categoryConfidence === 'number'
                        ? ` (${Math.round(skill.library.categoryConfidence * 100)}% confident)`
                        : ''
                    }. Choose one to lock it in.`}
              </div>
            )}
          </>
        )}

        <div className="mb-2.5 mt-5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#52525b]">
          Installed at
        </div>
        <div className="break-all rounded-[9px] border border-[#1c1c20] bg-[#0c0c0e] px-3 py-2.5 font-mono text-[11.5px] leading-relaxed text-[#a1a1aa]">
          {skill.source}
        </div>

        {skill.origin && (
          <>
            <div className="mb-2.5 mt-5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#52525b]">
              Source
            </div>
            <div className="rounded-[9px] border border-[#1c1c20] bg-[#0c0c0e] px-3 py-2.5">
              <div className="flex items-center gap-1.5 text-[12.5px] text-[#e4e4e7]">
                <ExternalLink className="size-3.5 shrink-0 text-[#71717a]" />
                <span className="truncate font-medium">{skill.origin.label}</span>
              </div>
              <div className="mt-1.5 break-all font-mono text-[11px] leading-relaxed text-[#71717a]">
                {skill.origin.webUrl}
              </div>
            </div>
            <button
              type="button"
              onClick={copyOrigin}
              className="mt-2 flex h-9 w-full items-center justify-center gap-1.5 rounded-[9px] border border-[#27272a] bg-[#18181b] text-[12.5px] font-medium text-[#e4e4e7] transition hover:border-[#3a3a42]"
            >
              {copied ? <Check className="size-3.5 text-[#22c55e]" /> : <Copy className="size-3.5" />}
              {copied ? 'Copied' : 'Copy link'}
            </button>
          </>
        )}

        {skill.library && machines.length > 0 && (
          <SyndicationPanel
            skill={skill}
            machines={machines}
            onSetSyndication={onSetSyndication}
            onSetSkillEnabled={onSetSkillEnabled}
          />
        )}

        <button
          type="button"
          onClick={() => void reveal(skill.id)}
          className="mt-4 flex h-9 w-full items-center justify-center gap-1.5 rounded-[9px] border border-[#27272a] bg-[#18181b] text-[12.5px] font-medium text-[#e4e4e7] transition hover:border-[#3a3a42]"
        >
          <FolderOpen className="size-3.5" />
          Reveal in Finder
        </button>
        <button
          type="button"
          disabled={!manageable}
          onClick={() => setConfirmingRemove(true)}
          title={manageable ? 'Uninstall this skill' : 'Plugin skills are managed by their plugin'}
          className={`mt-2 h-9 w-full rounded-[9px] border border-[#3f2020] bg-transparent text-[12.5px] font-medium text-[#f87171] transition ${
            manageable ? 'hover:bg-[#1e1010]' : 'cursor-not-allowed opacity-60'
          }`}
        >
          Uninstall
        </button>
      </aside>

      {confirmingRemove && (
        <ConfirmRemove
          name={skill.name}
          machineCount={skill.library?.targets.length ?? 0}
          onCancel={() => setConfirmingRemove(false)}
          onConfirm={() => {
            setConfirmingRemove(false)
            onRemove()
          }}
        />
      )}
    </div>
  )
}

/**
 * Per-machine syndication for a library skill. The checkbox controls
 * presence: checking installs the library's pinned version, unchecking
 * uninstalls from just that machine. The mini toggle controls enabled state
 * on that machine alone (global scope — project placement happens via the
 * install dialog).
 */
function SyndicationPanel({
  skill,
  machines,
  onSetSyndication,
  onSetSkillEnabled,
}: {
  skill: Skill
  machines: MachineSnapshot[]
  onSetSyndication: (input: SetSyndicationInput) => Promise<void>
  onSetSkillEnabled: (input: SetSkillEnabledInput) => Promise<void>
}) {
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const targets = skill.library?.targets ?? []
  const dirName = skill.realPath.split('/').filter(Boolean).pop() ?? ''

  const run = async (machineName: string, op: () => Promise<void>) => {
    setPending(machineName)
    setError(null)
    try {
      await op()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPending(null)
    }
  }

  return (
    <>
      <div className="mb-2.5 mt-5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#52525b]">
        Machines
      </div>
      <div className="flex flex-col gap-1.5">
        {machines.map((entry) => {
          const name = entry.machine.name
          const syndicated = targets.some((target) => target.machine === name && target.scope === 'global')
          // That machine's copy, for its enabled state (matched by folder name).
          const remoteCopy = entry.snapshot?.skills.find(
            (remote) =>
              remote.sourceKind === 'Personal' &&
              (remote.realPath.split('/').filter(Boolean).pop() ?? '') === dirName,
          )
          const busy = pending !== null
          return (
            <div
              key={name}
              className={`flex items-center gap-2.5 rounded-[9px] border border-[#1c1c20] bg-[#0c0c0e] px-3 py-2 ${
                busy ? 'opacity-70' : 'hover:border-[#2e2e34]'
              }`}
            >
              <input
                type="checkbox"
                checked={syndicated}
                disabled={busy}
                onChange={() =>
                  void run(name, () =>
                    onSetSyndication({ skillId: skill.id, machine: name, enabled: !syndicated, scope: 'global' }),
                  )
                }
                className="size-3.5 shrink-0 cursor-pointer accent-[#f97316]"
              />
              <Server className="size-3.5 shrink-0 text-[#52525b]" />
              <span className="flex-1 truncate text-[12.5px] text-[#e4e4e7]">{name}</span>
              {pending === name ? (
                <Loader2 className="size-3.5 animate-spin text-[#71717a]" />
              ) : (
                syndicated &&
                remoteCopy && (
                  <SkillToggle
                    enabled={remoteCopy.enabled}
                    disabled={busy}
                    onToggle={() =>
                      void run(name, () =>
                        onSetSkillEnabled({
                          skillId: skill.id,
                          enabled: !remoteCopy.enabled,
                          target: { machine: name, scope: 'global' },
                        }),
                      )
                    }
                  />
                )
              )}
            </div>
          )
        })}
      </div>
      {error && <p className="mt-2 text-[12px] text-[#f87171]">{error}</p>}
    </>
  )
}

function ConfirmRemove({
  name,
  machineCount,
  onConfirm,
  onCancel,
}: {
  name: string
  machineCount: number
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div
      onClick={onCancel}
      className="absolute inset-0 z-20 flex items-center justify-center bg-black/60 backdrop-blur-[3px]"
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="w-[440px] overflow-hidden rounded-2xl border border-[#2a2a30] bg-[#111114] shadow-[0_40px_100px_-20px_rgba(0,0,0,.9)]"
      >
        <div className="px-6 pt-5">
          <h2 className="text-lg font-semibold text-[#fafafa]">Uninstall “{name}”?</h2>
          <p className="mt-1.5 text-[13px] leading-relaxed text-[#a1a1aa]">
            {machineCount > 0
              ? `This uninstalls the skill from ${machineCount} syndicated ${
                  machineCount === 1 ? 'machine' : 'machines'
                } and deletes it from the library. This cannot be undone.`
              : 'This deletes the skill directory from disk. This cannot be undone.'}
          </p>
        </div>
        <div className="mt-5 flex justify-end gap-2.5 border-t border-[#1c1c20] bg-[#0c0c0e] px-6 py-4">
          <button
            type="button"
            onClick={onCancel}
            className="h-9 rounded-[9px] border border-[#27272a] bg-transparent px-4 text-[13px] font-medium text-[#d4d4d8] transition hover:border-[#3a3a42]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="h-9 rounded-[9px] bg-[#dc2626] px-[18px] text-[13px] font-semibold text-white transition hover:bg-[#b91c1c]"
          >
            Uninstall
          </button>
        </div>
      </div>
    </div>
  )
}
