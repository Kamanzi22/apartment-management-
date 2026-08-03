// Rwandan Francs have no commonly used subunit, so amounts are shown and
// stored as whole numbers with thousands separators (e.g. "1,000,000 RWF").
export function formatRWF(amount: number): string {
  return `${new Intl.NumberFormat('en-US').format(Math.round(amount))} RWF`
}

// Accepts comma-grouped input like "1,000,000" or "1000000" from a text
// field and returns a plain number, safe against empty/invalid input.
export function parseAmountInput(value: string | null | undefined): number {
  if (!value) return 0
  const cleaned = value.replace(/,/g, '').trim()
  const n = parseFloat(cleaned)
  return Number.isFinite(n) ? n : 0
}
