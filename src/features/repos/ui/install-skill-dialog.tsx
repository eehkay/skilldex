import { useMemo, useState } from 'react'
import { Globe, Layers, Loader2, Monitor, Server, X } from 'lucide-react'
import type { ProjectRecord, RepoSkill } from '@/features/skills/model/skills'

/** An installable destination: this app's own machine, or a remote one. */
export type InstallTarget = {
  /** 'local' for this machine; otherwise the machine name. */
  key: string
  label: string
  projects: ProjectRecord[]
}

type InstallSkillDialogProps = {
  /** The catalog skill being imported, or null when the dialog is closed. */
  skill: RepoSkill | null
  repoSlug: string
  /** First entry is the local machine; any further entries are remote machines. */
  targets: InstallTarget[]
  onClose: () => void
  onInstall: (input: {
    /** Target keys to install onto (may be empty — import only). */
    targetKeys: string[]
    scope: 'global' | 'project'
    projectName?: string
  }) => Promise<void>
}

/**
 * Import & install. Importing to the library always happens — it's what makes
 * the skill yours, pinned at the repo's current version. Machines (including
 * this one, for project placement) are optional multi-select install targets
 * on top.
 */
export function InstallSkillDialog({ skill, repoSlug, targets, onClose, onInstall }: InstallSkillDialogProps) {
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [scope, setScope] = useState<'global' | 'project'>('global')
  const [projectName, setProjectName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Projects offered for project scope: everything the checked targets know
  // about (matched by folder name on each machine at install time).
  const projects = useMemo(() => {
    const pool = targets.filter((target) => checked.has(target.key))
    const byName = new Map<string, ProjectRecord>()
    for (const target of pool) for (const project of target.projects) byName.set(project.name, project)
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [targets, checked])

  if (!skill) return null

  const resolvedProject =
    projectName && projects.some((project) => project.name === projectName)
      ? projectName
      : projects[0]?.name || ''
  const scopeReady = checked.size === 0 || scope === 'global' || Boolean(resolvedProject)
  const canSubmit = !submitting && scopeReady

  const close = () => {
    setChecked(new Set())
    setScope('global')
    setProjectName('')
    setError(null)
    onClose()
  }

  const toggleTarget = (key: string) => {
    setChecked((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const submit = async () => {
    setSubmitting(true)
    setError(null)
    try {
      await onInstall({
        targetKeys: [...checked],
        scope,
        projectName: scope === 'project' ? resolvedProject : undefined,
      })
      close()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div onClick={close} className="absolute inset-0 z-20 flex items-center justify-center bg-black/60 backdrop-blur-[3px]">
      <div
        onClick={(event) => event.stopPropagation()}
        className="w-[520px] overflow-hidden rounded-2xl border border-[#2a2a30] bg-[#111114] shadow-[0_40px_100px_-20px_rgba(0,0,0,.9)]"
      >
        <div className="px-6 pt-5">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-[#fafafa]">Import “{skill.name}”</h2>
            <button
              type="button"
              onClick={close}
              className="grid size-7 place-items-center rounded-lg text-[#71717a] transition hover:bg-[#1c1c20]"
              aria-label="Close"
            >
              <X className="size-4" />
            </button>
          </div>
          <p className="mt-1.5 text-[13px] leading-relaxed text-[#71717a]">
            Adds this skill to your library, pinned at the repo's current version —{' '}
            {skill.fileCount} {skill.fileCount === 1 ? 'file' : 'files'} from{' '}
            <span className="font-mono text-[12px]">{repoSlug}</span>.
          </p>
        </div>

        <div className="flex flex-col gap-4 px-6 py-5">
          <div>
            <div className="mb-1.5 text-[12.5px] font-medium text-[#d4d4d8]">
              Also install on <span className="font-normal text-[#71717a]">(optional)</span>
            </div>
            <div className="flex flex-col gap-1.5">
              {targets.map((target) => {
                const isLocal = target.key === 'local'
                const Icon = isLocal ? Monitor : Server
                return (
                  <label
                    key={target.key}
                    className="flex cursor-pointer items-center gap-2.5 rounded-[9px] border border-[#27272a] bg-[#0c0c0e] px-3 py-2.5 transition hover:border-[#3a3a42]"
                  >
                    <input
                      type="checkbox"
                      checked={checked.has(target.key)}
                      onChange={() => toggleTarget(target.key)}
                      className="size-3.5 shrink-0 accent-[#f97316]"
                    />
                    <Icon className="size-3.5 shrink-0 text-[#52525b]" />
                    <span className="flex-1 truncate text-[13px] text-[#e4e4e7]">{target.label}</span>
                  </label>
                )
              })}
            </div>
          </div>

          {checked.size > 0 && (
            <div>
              <div className="mb-1.5 text-[12.5px] font-medium text-[#d4d4d8]">Scope</div>
              <div className="grid grid-cols-2 gap-2.5">
                <ScopeOption
                  icon={<Globe className="size-[15px]" />}
                  title="Global"
                  detail="Available to every project on the selected machines"
                  selected={scope === 'global'}
                  onSelect={() => setScope('global')}
                />
                <ScopeOption
                  icon={<Layers className="size-[15px]" />}
                  title="Project"
                  detail={projects.length > 0 ? 'Scoped to one project folder only' : 'No projects on the selected machines'}
                  selected={scope === 'project'}
                  disabled={projects.length === 0}
                  onSelect={() => projects.length > 0 && setScope('project')}
                />
              </div>
            </div>
          )}
          {checked.size > 0 && scope === 'project' && projects.length > 0 && (
            <div>
              <div className="mb-1.5 text-[12.5px] font-medium text-[#d4d4d8]">Project</div>
              <select
                value={resolvedProject}
                onChange={(event) => setProjectName(event.target.value)}
                className="h-[38px] w-full rounded-[9px] border border-[#27272a] bg-[#0c0c0e] px-3 text-[13.5px] text-[#e4e4e7] outline-none focus:border-[#3a3a42]"
              >
                {projects.map((project) => (
                  <option key={project.name} value={project.name}>
                    {project.name}
                  </option>
                ))}
              </select>
              <p className="mt-1.5 text-[11.5px] leading-snug text-[#71717a]">
                Matched by folder name on each selected machine.
              </p>
            </div>
          )}
          {error && <p className="text-[12.5px] text-[#f87171]">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2.5 border-t border-[#1c1c20] bg-[#0c0c0e] px-6 py-4">
          <button
            type="button"
            onClick={close}
            className="h-9 rounded-[9px] border border-[#27272a] bg-transparent px-4 text-[13px] font-medium text-[#d4d4d8] transition hover:border-[#3a3a42]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!canSubmit}
            className={`flex h-9 items-center gap-1.5 rounded-[9px] bg-[#f97316] px-[18px] text-[13px] font-semibold text-white transition ${
              canSubmit ? 'hover:bg-[#ea580c]' : 'cursor-not-allowed opacity-60'
            }`}
          >
            {submitting && <Loader2 className="size-3.5 animate-spin" />}
            {submitting
              ? 'Importing…'
              : checked.size === 0
                ? 'Import to library'
                : `Import & install (${checked.size})`}
          </button>
        </div>
      </div>
    </div>
  )
}

function ScopeOption({
  icon,
  title,
  detail,
  selected,
  disabled = false,
  onSelect,
}: {
  icon: React.ReactNode
  title: string
  detail: string
  selected: boolean
  disabled?: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className={`rounded-[10px] border p-3 text-left transition ${
        selected ? 'border-[#f97316] bg-[#1a1109]' : 'border-[#27272a] bg-[#0c0c0e] hover:border-[#3a3a42]'
      } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
    >
      <div className="flex items-center gap-2">
        <span style={{ color: selected ? '#f97316' : '#a1a1aa' }}>{icon}</span>
        <span className="text-[13px] font-semibold text-[#e4e4e7]">{title}</span>
      </div>
      <div className="mt-1.5 text-[11.5px] leading-snug text-[#71717a]">{detail}</div>
    </button>
  )
}
