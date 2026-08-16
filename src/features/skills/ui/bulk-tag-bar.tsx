import { useId, useState } from 'react'
import { CheckSquare, Loader2, Minus, Plus, Square, X } from 'lucide-react'
import { normalizeTagInput } from './tag-editor'

type BulkTagBarProps = {
  selectedCount: number
  visibleCount: number
  suggestions: string[]
  onSelectAll: () => void
  onClearSelection: () => void
  onApply: (change: { add?: string[]; remove?: string[] }) => Promise<void>
  onDone: () => void
}

/**
 * Sticky action bar for select mode: tag (or untag) every selected library
 * skill in one round-trip. Only library (global) skills are selectable — the
 * caller filters — so the hub never has to skip anything in practice.
 */
export function BulkTagBar({ selectedCount, visibleCount, suggestions, onSelectAll, onClearSelection, onApply, onDone }: BulkTagBarProps) {
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState<'add' | 'remove' | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const listId = useId()
  const tag = normalizeTagInput(draft)

  const run = async (mode: 'add' | 'remove') => {
    if (!tag || selectedCount === 0) return
    setBusy(mode)
    setNote(null)
    try {
      await onApply(mode === 'add' ? { add: [tag] } : { remove: [tag] })
      setNote(`${mode === 'add' ? 'Tagged' : 'Untagged'} ${selectedCount} skill${selectedCount === 1 ? '' : 's'} with #${tag}.`)
      setDraft('')
    } catch (cause) {
      setNote(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(null)
    }
  }

  const allSelected = visibleCount > 0 && selectedCount >= visibleCount
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-[11px] border border-[#2a2a30] bg-[#111114] px-3 py-2">
      <button
        type="button"
        onClick={allSelected ? onClearSelection : onSelectAll}
        className="flex h-7 items-center gap-1.5 rounded-[8px] px-2 text-[12px] font-medium text-[#a1a1aa] transition hover:bg-[#1c1c20] hover:text-[#e4e4e7]"
      >
        {allSelected ? <CheckSquare className="size-3.5 text-[#fb923c]" /> : <Square className="size-3.5" />}
        {allSelected ? 'Deselect all' : `Select all ${visibleCount}`}
      </button>
      <span className="text-[12px] text-[#71717a]">
        <span className="font-semibold text-[#e4e4e7]">{selectedCount}</span> selected
      </span>
      <div className="mx-1 h-5 w-px bg-[#27272a]" />
      <input
        list={listId}
        value={draft}
        disabled={busy !== null}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            void run('add')
          }
        }}
        placeholder="tag…"
        className="h-7 w-44 rounded-[8px] border border-[#27272a] bg-[#0c0c0e] px-2.5 text-[12.5px] text-[#e4e4e7] outline-none placeholder:text-[#3f3f46] focus:border-[#3a3a42] disabled:opacity-60"
      />
      <datalist id={listId}>
        {suggestions.map((value) => (
          <option key={value} value={value} />
        ))}
      </datalist>
      <button
        type="button"
        onClick={() => void run('add')}
        disabled={!tag || selectedCount === 0 || busy !== null}
        title="Add this tag to every selected skill"
        className="flex h-7 items-center gap-1 rounded-[8px] border border-[#27272a] bg-[#18181b] px-2.5 text-[12px] font-medium text-[#e4e4e7] transition hover:border-[#3a3a42] disabled:opacity-50"
      >
        {busy === 'add' ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
        Add tag
      </button>
      <button
        type="button"
        onClick={() => void run('remove')}
        disabled={!tag || selectedCount === 0 || busy !== null}
        title="Remove this tag from every selected skill"
        className="flex h-7 items-center gap-1 rounded-[8px] border border-[#27272a] bg-[#18181b] px-2.5 text-[12px] font-medium text-[#e4e4e7] transition hover:border-[#3a3a42] disabled:opacity-50"
      >
        {busy === 'remove' ? <Loader2 className="size-3.5 animate-spin" /> : <Minus className="size-3.5" />}
        Remove tag
      </button>
      {note && <span className="text-[12px] text-[#71717a]">{note}</span>}
      <div className="flex-1" />
      <button
        type="button"
        onClick={onDone}
        className="flex h-7 items-center gap-1 rounded-[8px] px-2 text-[12px] font-medium text-[#a1a1aa] transition hover:bg-[#1c1c20] hover:text-[#e4e4e7]"
      >
        <X className="size-3.5" />
        Done
      </button>
    </div>
  )
}
