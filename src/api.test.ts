import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  signInAnonymously: vi.fn(),
  rpc: vi.fn(),
  channel: vi.fn(),
  removeChannel: vi.fn(),
  createClient: vi.fn(),
}))

vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }))

beforeEach(() => {
  vi.resetModules()
  vi.resetAllMocks()
  vi.stubEnv('VITE_SUPABASE_URL', 'https://test.supabase.co')
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'public-test-key')
  mocks.createClient.mockReturnValue({
    auth: { getSession: mocks.getSession, signInAnonymously: mocks.signInAnonymously },
    rpc: mocks.rpc,
    channel: mocks.channel,
    removeChannel: mocks.removeChannel,
  })
  mocks.getSession.mockResolvedValue({ data: { session: null }, error: null })
  mocks.signInAnonymously.mockResolvedValue({ data: { user: { id: 'new-user' } }, error: null })
})

afterEach(() => { vi.unstubAllEnvs() })

describe('Supabase boundary', () => {
  it('restores existing browser identity instead of creating a new user', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: { user: { id: 'existing' } } }, error: null })
    const { ensureIdentity } = await import('./api')
    expect(await ensureIdentity()).toBe('existing')
    expect(mocks.signInAnonymously).not.toHaveBeenCalled()
  })

  it('deduplicates concurrent anonymous sign-ins', async () => {
    const { ensureIdentity } = await import('./api')
    expect(await Promise.all([ensureIdentity(), ensureIdentity(), ensureIdentity()])).toEqual(['new-user', 'new-user', 'new-user'])
    expect(mocks.signInAnonymously).toHaveBeenCalledTimes(1)
  })

  it('allows identity initialization to be retried after failure', async () => {
    mocks.signInAnonymously.mockResolvedValueOnce({ error: new Error('Network unavailable') })
    const { ensureIdentity } = await import('./api')
    await expect(ensureIdentity()).rejects.toThrow('Network unavailable')
    expect(await ensureIdentity()).toBe('new-user')
  })

  it('calls the authorized API and preserves database errors', async () => {
    mocks.rpc.mockResolvedValue({ error: { message: 'Only the presenter can do that.' } })
    const { request } = await import('./api')
    await expect(request('reveal', { sessionId: 'session', roundId: 'round' })).rejects.toThrow('Only the presenter')
    expect(mocks.rpc).toHaveBeenCalledWith('poker', { action: 'reveal', payload: { sessionId: 'session', roundId: 'round' } })
  })

  it('subscribes only to revision rows and refreshes on reconnect', async () => {
    const on = vi.fn().mockReturnThis()
    const subscribe = vi.fn().mockReturnThis()
    const channel = { on, subscribe }
    mocks.channel.mockReturnValue(channel)
    const { watchSession } = await import('./api')
    const change = vi.fn()
    const status = vi.fn()
    const stop = watchSession('session', change, status)
    expect(on).toHaveBeenCalledWith('postgres_changes', {
      event: 'UPDATE', schema: 'public', table: 'session_updates', filter: 'id=eq.session',
    }, change)
    const onStatus = subscribe.mock.calls[0][0]
    onStatus('SUBSCRIBED')
    onStatus('CHANNEL_ERROR')
    onStatus('SUBSCRIBED')
    expect(change).toHaveBeenCalledTimes(2)
    expect(status.mock.calls.map(([connected]) => connected)).toEqual([true, false, true])
    stop()
    expect(mocks.removeChannel).toHaveBeenCalledWith(channel)
  })

  it('does not initialize a client without public configuration', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '')
    const { supabase, ensureIdentity } = await import('./api')
    expect(supabase).toBeNull()
    expect(mocks.createClient).not.toHaveBeenCalled()
    await expect(ensureIdentity()).rejects.toThrow('Supabase is not configured')
  })
})
