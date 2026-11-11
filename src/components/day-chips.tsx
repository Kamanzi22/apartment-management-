'use client'

import { useState } from 'react'
import { Plus, X } from 'lucide-react'

/** Add/remove chips for a list of day numbers (0–31). */
export function DayChips({ id, label, value, onChange, suffix }: {
  id: string
  label: string
  value: number[]
  onChange: (days: number[]) => void
  suffix: string
}) {
  const [draft, setDraft] = useState('')

  function add() {
    const n = Number(draft)
    if (!Number.isInteger(n) || n < 0 || n > 31 || value.includes(n)) return
    onChange([...value, n].sort((a, b) => a - b))
    setDraft('')
  }

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-semibold text-[var(--ink)]">{label}</legend>
      <div className="flex flex-wrap items-center gap-2">
        {value.length === 0 && <span className="text-xs text-[var(--muted)]">None</span>}
        {value.map(d => (
          <span key={d} className="inline-flex items-center gap-1 rounded-full bg-[var(--ink)] text-[var(--on-dark)] pl-3 pr-1 min-h-9 text-sm font-semibold">
            {d} {suffix}
            <button
              type="button"
              onClick={() => onChange(value.filter(x => x !== d))}
              aria-label={`Remove ${d} ${suffix}`}
              className="h-7 w-7 inline-flex items-center justify-center rounded-full hover:bg-white/15"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </span>
        ))}
        <span className="inline-flex items-center gap-1">
          <label htmlFor={id} className="sr-only">Add a day to {label}</label>
          <input
            id={id}
            type="number"
            min={0}
            max={31}
            inputMode="numeric"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
            placeholder="0–31"
            className="glass-input text-sm w-20! min-h-9!"
          />
          <button
            type="button"
            onClick={add}
            aria-label={`Add to ${label}`}
            className="h-9 w-9 inline-flex items-center justify-center rounded-full bg-white/80 border border-white hover:bg-white"
          >
            <Plus className="h-4 w-4" />
          </button>
        </span>
      </div>
    </fieldset>
  )
}
