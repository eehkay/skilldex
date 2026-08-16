import { useId, useState } from 'react'
import { Plus, X } from 'lucide-react'

type TagEditorProps = {
  tags: string[]
  /** Every tag in use across the library — offered as autocomplete. */
  suggestions: string[]
  onChange: (tags: string[]) => Promise<void>
  disabled?: boolean
}

/**
 * Renderer-side twin of the hub's tag normalization, so what the user sees
 * added is what the ledger stores. The hub still normalizes authoritatively.
 */
export function normalizeTagInput(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9._/:-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 32)
}

/** Chip list + input with datalist autocomplete. Enter or comma adds; × removes. */
export function TagEditor({ tags, suggestions, onChange, disabled = false }: TagEditorProps) {
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const listId = useId()
  const unused = suggestions.filter((tag) => !tags.includes(tag))

  const commit = async (next: string[]) => {
    setBusy(true)
    try {
      await onChange(next)
    } finally {
      setBusy(false)
    }
  }
  const add = async () => {
    const tag = normalizeTagInput(draft)
    setDraft('')
    if (!tag || tags.includes(tag)) return
    await commit([...tags, tag].sort())
  }
  const remove = (tag: string) => commit(tags.filter((t) => t !== tag))

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        {tags.map((tag) => (
          <span
            key={tag}
            className="flex items-center gap-1 rounded-md border border-[#2a2a30] bg-[#15151a] py-0.5 pl-2 pr-1 text-[11.5px] text-[#c4c4cc]"
          >
            #{tag}
            <button
              type="button"
              aria-label={`Remove tag ${tag}`}
              disabled={disabled || busy}
              onClick={() => void remove(tag)}
              className="grid size-4 place-items-center rounded text-[#71717a] transition hover:bg-[#27272a] hover:text-[#fafafa] disabled:opacity-50"
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        {tags.length === 0 && <span className="text-[12px] text-[#52525b]">No tags yet.</span>}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <input
          list={listId}
          value={draft}
          disabled={disabled || busy}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ',') {
              event.preventDefault()
              void add()
            }
          }}
          placeholder="Add a tag… (Enter)"
          className="h-8 flex-1 rounded-[8px] border border-[#27272a] bg-[#0c0c0e] px-2.5 text-[12.5px] text-[#e4e4e7] outline-none placeholder:text-[#3f3f46] focus:border-[#3a3a42] disabled:opacity-60"
        />
        <datalist id={listId}>
          {unused.map((tag) => (
            <option key={tag} value={tag} />
          ))}
        </datalist>
        <button
          type="button"
          onClick={() => void add()}
          disabled={disabled || busy || !normalizeTagInput(draft)}
          className="flex h-8 items-center gap-1 rounded-[8px] border border-[#27272a] bg-[#18181b] px-2.5 text-[12px] font-medium text-[#e4e4e7] transition hover:border-[#3a3a42] disabled:opacity-50"
        >
          <Plus className="size-3.5" />
          Add
        </button>
      </div>
      {unused.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          <span className="mr-1 text-[11px] text-[#52525b]">In use:</span>
          {unused.slice(0, 12).map((tag) => (
            <button
              key={tag}
              type="button"
              disabled={disabled || busy}
              onClick={() => void commit([...tags, tag].sort())}
              className="rounded-md border border-dashed border-[#27272a] px-1.5 py-0.5 text-[11px] text-[#71717a] transition hover:border-[#3a3a42] hover:text-[#e4e4e7] disabled:opacity-50"
            >
              #{tag}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
