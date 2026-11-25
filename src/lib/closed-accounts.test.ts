import { describe, expect, it, vi } from 'vitest'
import { loadClosedAccounts } from './closed-accounts'

function fake(result: { data: unknown; error: unknown }) {
  const chain = { select: vi.fn(() => chain), in: vi.fn(() => chain), not: vi.fn(async () => result) }
  return { client: { from: vi.fn(() => chain) }, chain }
}

describe('loadClosedAccounts', () => {
  it('returns closed profiles only, keyed by id', async () => {
    const { client, chain } = fake({ data: [{ id: 'a', phone: '0788', deleted_at: '2026-11-25T00:00:00Z' }], error: null })
    const m = await loadClosedAccounts(client, ['a', 'b', 'a'])
    expect([...m.keys()]).toEqual(['a'])
    expect(m.get('a')).toEqual({ phone: '0788', closedAt: '2026-11-25T00:00:00Z' })
    expect(chain.in).toHaveBeenCalledWith('id', ['a', 'b'])
  })
  it('before migration 17 (no column) nobody is closed', async () => {
    const { client } = fake({ data: null, error: { message: 'column profiles.deleted_at does not exist' } })
    expect((await loadClosedAccounts(client, ['a'])).size).toBe(0)
  })
  it('no ids, no query', async () => {
    const { client } = fake({ data: [], error: null })
    expect((await loadClosedAccounts(client, [])).size).toBe(0)
    expect(client.from).not.toHaveBeenCalled()
  })
})
