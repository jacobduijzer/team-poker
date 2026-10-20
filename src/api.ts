import { createClient } from '@supabase/supabase-js'
import type { PokerSession } from './types'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

export const supabase = url && key ? createClient(url, key) : null
let identityPromise: Promise<string> | undefined

export function ensureIdentity(): Promise<string> {
  if (!identityPromise) {
    identityPromise = (async () => {
      if (!supabase) throw new Error('Supabase is not configured.')
      const { data, error } = await supabase.auth.getSession()
      if (error) throw error
      if (data.session) return data.session.user.id
      const result = await supabase.auth.signInAnonymously()
      if (result.error) throw result.error
      return result.data.user!.id
    })().catch((error: unknown) => {
      identityPromise = undefined
      throw error
    })
  }
  return identityPromise
}

type Action = 'create' | 'join' | 'snapshot' | 'vote' | 'reveal' | 'next_round'

export async function request(action: Action, payload: Record<string, unknown> = {}) {
  if (!supabase) throw new Error('Supabase is not configured.')
  await ensureIdentity()
  const { data, error } = await supabase.rpc('poker', { action, payload })
  if (error) throw new Error(error.message)
  return data as PokerSession
}

export function watchSession(id: string, onChange: () => void, onStatus: (connected: boolean) => void) {
  if (!supabase) return () => {}
  const client = supabase
  const channel = client.channel(`session:${id}`)
    .on('postgres_changes', {
      event: 'UPDATE', schema: 'public', table: 'session_updates', filter: `id=eq.${id}`,
    }, onChange)
    .subscribe((status) => {
      const connected = status === 'SUBSCRIBED'
      onStatus(connected)
      if (connected) onChange() // Recover anything missed during connection/reconnection.
    })
  return () => { void client.removeChannel(channel) }
}
