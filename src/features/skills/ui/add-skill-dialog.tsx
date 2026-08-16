import { useRef, useState, type DragEvent } from 'react'
import { FileArchive, Globe, Layers, Loader2, Upload, X } from 'lucide-react'
import { formatSize, type CreateSkillInput, type ImportSkillArchiveInput, type ProjectRecord } from '../model/skills'

type Mode = 'import' | 'create'

type AddSkillDialogProps = {
  projects: ProjectRecord[]
  onClose: () => void
  onImport: (input: ImportSkillArchiveInput) => Promise<void>
  onCreate: (input: CreateSkillInput) => Promise<void>
}

/**
 * Bring a skill into the library: import a zipped skill folder (the common
 * case — something you were sent or downloaded), or scaffold a blank one.
 * Rendered only while open, so state seeds fresh each time.
 */
export function AddSkillDialog({ projects, onClose, onImport, onCreate }: AddSkillDialogProps) {
  const [mode, setMode] = useState<Mode>('import')
  const [file, setFile] = useState<File | null>(null)
  const [dragging, setDragging] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [scope, setScope] = useState<'global' | 'project'>('global')
  const [projectName, setProjectName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const resolvedProject = projectName || projects[0]?.name || ''
  const canProject = projects.length > 0
  const scopeOk = scope === 'global' || Boolean(resolvedProject)
  const canSubmit =
    !submitting && scopeOk && (mode === 'import' ? file !== null : name.trim().length > 0)

  const pick = (candidate: File | null | undefined) => {
    setError(null)
    if (!candidate) return
    if (!/\.zip$/i.test(candidate.name) && candidate.type !== 'application/zip') {
      setError('Choose a .zip archive.')
      return
    }
    setFile(candidate)
  }

  const onDrop = (event: DragEvent) => {
    event.preventDefault()
    setDragging(false)
    pick(event.dataTransfer.files[0])
  }

  const submit = async () => {
    setSubmitting(true)
    setError(null)
    try {
      const target = { scope, projectName: scope === 'project' ? resolvedProject : undefined }
      if (mode === 'import') {
        if (!file) return
        await onImport({ fileName: file.name, data: await toBase64(file), ...target })
      } else {
        await onCreate({ name: name.trim(), description: description.trim(), ...target })
      }
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div onClick={onClose} className="absolute inset-0 z-20 flex items-center justify-center bg-black/60 backdrop-blur-[3px]">
      <div
        onClick={(event) => event.stopPropagation()}
        className="w-[520px] overflow-hidden rounded-2xl border border-[#2a2a30] bg-[#111114] shadow-[0_40px_100px_-20px_rgba(0,0,0,.9)]"
      >
        <div className="px-6 pt-5">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-[#fafafa]">Add Skill</h2>
            <button
              type="button"
              onClick={onClose}
              className="grid size-7 place-items-center rounded-lg text-[#71717a] transition hover:bg-[#1c1c20]"
              aria-label="Close"
            >
              <X className="size-4" />
            </button>
          </div>
          <p className="mt-1.5 text-[13px] text-[#71717a]">
            {mode === 'import'
              ? 'Import a zipped skill folder — anything with a SKILL.md inside.'
              : 'Scaffold a new agent skill folder with a SKILL.md.'}
          </p>

          <div className="mt-4 grid grid-cols-2 rounded-[10px] border border-[#27272a] bg-[#0c0c0e] p-1 text-[12.5px] font-medium">
            <ModeTab active={mode === 'import'} onClick={() => { setMode('import'); setError(null) }}>
              <Upload className="size-3.5" /> Import zip
            </ModeTab>
            <ModeTab active={mode === 'create'} onClick={() => { setMode('create'); setError(null) }}>
              Create blank
            </ModeTab>
          </div>
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (canSubmit) void submit()
          }}
        >
          <div className="flex flex-col gap-4 px-6 py-5">
            {mode === 'import' ? (
              <Field label="Archive">
                <input
                  ref={fileInput}
                  type="file"
                  accept=".zip,application/zip"
                  className="hidden"
                  onChange={(event) => {
                    pick(event.target.files?.[0])
                    event.target.value = ''
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  onDragOver={(event) => { event.preventDefault(); setDragging(true) }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={onDrop}
                  className={`flex w-full items-center gap-3 rounded-[10px] border border-dashed px-4 py-4 text-left transition ${
                    dragging
                      ? 'border-[#f97316] bg-[#1a1109]'
                      : file
                        ? 'border-[#3a3a42] bg-[#0c0c0e]'
                        : 'border-[#27272a] bg-[#0c0c0e] hover:border-[#3a3a42]'
                  }`}
                >
                  <span
                    className={`grid size-10 shrink-0 place-items-center rounded-[10px] ${
                      file ? 'bg-[#1a1109] text-[#fb923c]' : 'bg-[#18181b] text-[#71717a]'
                    }`}
                  >
                    {file ? <FileArchive className="size-[18px]" /> : <Upload className="size-[18px]" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    {file ? (
                      <>
                        <span className="block truncate text-[13.5px] font-medium text-[#e4e4e7]">{file.name}</span>
                        <span className="block text-[11.5px] text-[#71717a]">
                          {formatSize(file.size)} · click or drop to replace
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="block text-[13.5px] font-medium text-[#e4e4e7]">
                          Drop a .zip here, or click to browse
                        </span>
                        <span className="block text-[11.5px] text-[#71717a]">
                          The folder holding SKILL.md becomes the skill; extra files come along.
                        </span>
                      </>
                    )}
                  </span>
                </button>
              </Field>
            ) : (
              <>
                <Field label="Name">
                  <input
                    autoFocus
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="e.g. PDF Form Filler"
                    className="h-[38px] w-full rounded-[9px] border border-[#27272a] bg-[#0c0c0e] px-3 text-[13.5px] text-[#e4e4e7] outline-none placeholder:text-[#52525b] focus:border-[#3a3a42]"
                  />
                </Field>
                <Field label="Description">
                  <textarea
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder="What this skill does and when the agent should use it…"
                    className="h-[70px] w-full resize-none rounded-[9px] border border-[#27272a] bg-[#0c0c0e] px-3 py-2.5 text-[13.5px] leading-relaxed text-[#e4e4e7] outline-none placeholder:text-[#52525b] focus:border-[#3a3a42]"
                  />
                </Field>
              </>
            )}

            <Field label="Scope">
              <div className="grid grid-cols-2 gap-2.5">
                <ScopeOption
                  icon={<Globe className="size-[15px]" />}
                  title="Global"
                  detail="Available to every project on this machine"
                  selected={scope === 'global'}
                  onSelect={() => setScope('global')}
                />
                <ScopeOption
                  icon={<Layers className="size-[15px]" />}
                  title="Project"
                  detail={canProject ? 'Scoped to one project folder only' : 'Add a project source first'}
                  selected={scope === 'project'}
                  disabled={!canProject}
                  onSelect={() => canProject && setScope('project')}
                />
              </div>
            </Field>
            {scope === 'project' && canProject && (
              <Field label="Project">
                <select
                  value={resolvedProject}
                  onChange={(event) => setProjectName(event.target.value)}
                  className="h-[38px] w-full rounded-[9px] border border-[#27272a] bg-[#0c0c0e] px-3 text-[13.5px] text-[#e4e4e7] outline-none focus:border-[#3a3a42]"
                >
                  {projects.map((project) => (
                    <option key={project.path} value={project.name}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {error && <p className="text-[12.5px] text-[#f87171]">{error}</p>}
          </div>

          <div className="flex items-center justify-end gap-2.5 border-t border-[#1c1c20] bg-[#0c0c0e] px-6 py-4">
            <button
              type="button"
              onClick={onClose}
              className="h-9 rounded-[9px] border border-[#27272a] bg-transparent px-4 text-[13px] font-medium text-[#d4d4d8] transition hover:border-[#3a3a42]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className={`flex h-9 items-center gap-1.5 rounded-[9px] bg-[#f97316] px-[18px] text-[13px] font-semibold text-white transition ${
                canSubmit ? 'hover:bg-[#ea580c]' : 'cursor-not-allowed opacity-60'
              }`}
            >
              {submitting && <Loader2 className="size-3.5 animate-spin" />}
              {mode === 'import' ? (submitting ? 'Importing…' : 'Import skill') : 'Create skill'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function ModeTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-8 items-center justify-center gap-1.5 rounded-[7px] transition ${
        active ? 'bg-[#1c1c20] text-[#fafafa] shadow-[0_1px_2px_rgba(0,0,0,.4)]' : 'text-[#71717a] hover:text-[#a1a1aa]'
      }`}
    >
      {children}
    </button>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-[12.5px] font-medium text-[#d4d4d8]">{label}</div>
      {children}
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

/** Base64-encode a File in chunks (avoids blowing the argument limit on large archives). */
async function toBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}
