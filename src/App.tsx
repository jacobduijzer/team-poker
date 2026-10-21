import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { ensureIdentity, request, supabase, watchSession } from './api'
import { summarize } from './results'
import type { PokerSession, ScoreOption } from './types'

function sessionFromPath() {
  return /^\/s\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i.exec(window.location.pathname)?.[1] ?? null
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.'
}

function savedName() {
  try { return localStorage.getItem('team-poker:name') ?? '' } catch { return '' }
}

export default function App() {
  const [sessionId, setSessionId] = useState(sessionFromPath)
  const [session, setSession] = useState<PokerSession | null>(null)
  const [userId, setUserId] = useState('')
  const [name, setName] = useState(savedName)
  const [loading, setLoading] = useState(Boolean(sessionId && supabase))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [connected, setConnected] = useState(false)
  const [notice, setNotice] = useState('')
  const [editing, setEditing] = useState(false)
  const activeId = useRef(sessionId)
  activeId.current = sessionId

  const accept = useCallback((data: PokerSession) => {
    if (activeId.current !== data.id) return
    setSession((previous) => previous && previous.id === data.id && previous.revision > data.revision ? previous : data)
  }, [])

  const refresh = useCallback(async (id: string) => {
    try {
      const identity = await ensureIdentity()
      const data = await request('snapshot', { sessionId: id })
      if (activeId.current !== id) return
      setUserId(identity)
      accept(data)
      setError('')
    } catch (cause) {
      if (activeId.current !== id) return
      const message = errorMessage(cause)
      if (message !== 'Join this session first.') setError(message)
    }
  }, [accept])

  useEffect(() => {
    const onPopState = () => {
      setSessionId(sessionFromPath())
      setSession(null)
      setError('')
      setEditing(false)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => {
    if (!supabase) return
    let cancelled = false
    setLoading(Boolean(sessionId))
    void (async () => {
      try {
        const identity = await ensureIdentity()
        if (cancelled) return
        setUserId(identity)
        if (sessionId) await refresh(sessionId)
      } catch (cause) {
        if (!cancelled) setError(errorMessage(cause))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [sessionId, refresh])

  const joinedId = session?.id
  useEffect(() => {
    if (!joinedId) return
    const sync = () => { void refresh(joinedId) }
    const stop = watchSession(joinedId, sync, setConnected)
    // Polling is also a safety net for missed notifications and sleeping tabs.
    const timer = window.setInterval(sync, 10_000)
    const onVisible = () => { if (document.visibilityState === 'visible') sync() }
    window.addEventListener('online', sync)
    window.addEventListener('focus', sync)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stop()
      window.clearInterval(timer)
      window.removeEventListener('online', sync)
      window.removeEventListener('focus', sync)
      document.removeEventListener('visibilitychange', onVisible)
      setConnected(false)
    }
  }, [joinedId, refresh])

  useEffect(() => { setEditing(false) }, [session?.round.id])

  async function enter(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const identity = await ensureIdentity()
      setUserId(identity)
      const data = await request(sessionId ? 'join' : 'create', { name: name.trim(), sessionId })
      try { localStorage.setItem('team-poker:name', name.trim()) } catch { /* Storage is optional. */ }
      if (!sessionId) window.history.pushState({}, '', `/s/${data.id}`)
      activeId.current = data.id
      setSessionId(data.id)
      setSession(data)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally { setBusy(false) }
  }

  async function act(action: 'vote' | 'reveal' | 'next_round', extra: Record<string, unknown> = {}) {
    if (!session || busy) return
    const id = session.id
    setBusy(true)
    setError('')
    try {
      accept(await request(action, { sessionId: id, roundId: session.round.id, ...extra }))
    } catch (cause) {
      // Fetch the latest round, but retain the actionable mutation error.
      await refresh(id)
      setError(errorMessage(cause))
    } finally { setBusy(false) }
  }

  async function copyInvitation() {
    if (!session) return
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/s/${session.id}`)
      setNotice('Invitation link copied.')
    } catch { setNotice('Copy the invitation link from the field below.') }
  }

  const presenter = session?.presenterId === userId
  const voted = session?.participants.filter((person) => person.hasVoted).length ?? 0
  const ownVote = session?.participants.find((person) => person.id === userId)?.optionId

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="/" aria-label="TeamPoker home"><span aria-hidden="true" className="brand-icon">♠</span> Team<span>Poker</span></a>
        <span className="header-note">A little less guessing. A little more together.</span>
      </header>
      <main>
        {!supabase ? <section className="panel setup">
          <p className="eyebrow">Almost ready</p><h1>Let’s set the table.</h1>
          <p>Configure your Supabase project to enable shared sessions and protected voting.</p>
          <p>Copy <code>.env.example</code> to <code>.env</code>, add your project URL and publishable key, and follow the setup steps in <code>README.md</code>.</p>
        </section> : loading ? <section className="panel" role="status"><h1>Finding your table…</h1><p>Restoring your browser identity and session.</p></section> : !session ? <div className="welcome-layout">
          <section className="welcome-copy">
            <p className="eyebrow">Planning poker, minus the fuss</p>
            <h1>Good estimates<br />start with <em>everyone.</em></h1>
            <p>A shared table for your next planning session. Pick a card, reveal together, and find your team’s next step.</p>
            <div className="sample-cards" aria-hidden="true"><span>3<small>♠</small></span><span>5<small>♠</small></span><span>8<small>♠</small></span></div>
            <div className="welcome-features"><span>No accounts</span><span>Live voting</span><span>Your team, your cards</span></div>
          </section>
          <section className="panel entry-panel">
            <p className="eyebrow">{sessionId ? 'Your seat is waiting' : 'Make room for your team'}</p>
            <h2>{sessionId ? 'Join the table' : 'Start a session'}</h2>
            <p>{sessionId ? 'Enter your name so everyone knows who’s here.' : 'You bring the team. We’ll bring the cards.'}</p>
            <form onSubmit={(event) => { void enter(event) }}>
              <label htmlFor="display-name">Your display name</label>
              <input id="display-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Alex" maxLength={60} required autoComplete="nickname" disabled={busy} />
              <button className="primary full-width" disabled={busy || !name.trim()}>{busy ? 'Getting your seat…' : sessionId ? 'Join session →' : 'Create session →'}</button>
            </form>
            <p className="fine-print">No sign-up. Your identity stays in this browser.</p>
            {sessionId && <a className="text-link" href="/">Or create your own session</a>}
          </section>
        </div> : <>
          <div className="session-heading">
            <div><p className="eyebrow">Your team’s table <span className={`connection ${connected ? 'live' : ''}`}>{connected ? 'Live' : 'Reconnecting · polling active'}</span></p><h1>Let’s find our number.</h1></div>
            <button onClick={() => { void copyInvitation() }}>↗ Invite teammates</button>
          </div>
          <div className="invitation"><label htmlFor="invitation-link">Invitation link</label><input id="invitation-link" readOnly value={`${window.location.origin}/s/${session.id}`} onFocus={(event) => event.target.select()} /></div>
          <div className="session-layout">
            <section className="panel table-panel" aria-labelledby="round-title">
              <div className="panel-heading"><div><p className="eyebrow">Round {session.round.number.toString().padStart(2, '0')}</p><h2 id="round-title">{session.round.revealed ? 'Cards on the table.' : 'What’s your estimate?'}</h2></div><span className="pill">{session.round.revealed ? 'Revealed' : `${voted} / ${session.participants.length} voted`}</span></div>
              <p>{session.round.revealed ? 'Talk through the differences. A shared understanding beats a perfect number.' : 'Choose a card below. Your estimate stays private until the presenter reveals.'}</p>
              <div className="score-cards" role="group" aria-label="Score cards">
                {session.round.options.map((option) => <button key={option.id} className={`score-card ${ownVote === option.id ? 'selected' : ''}`} aria-pressed={ownVote === option.id} disabled={busy || session.round.revealed} onClick={() => { void act('vote', { optionId: option.id }) }}><span>{option.label}</span><small aria-hidden="true">♠</small></button>)}
              </div>
              <p className="vote-hint" role="status">{session.round.revealed ? 'This round is complete. Votes are locked.' : ownVote ? 'Your card is in. You can change it until reveal.' : 'Take your time. Independent estimates make better conversations.'}</p>
              <div className="table-controls">
                {presenter ? <>
                  {!session.round.revealed ? <button className="primary" disabled={busy} onClick={() => { void act('reveal') }}>Reveal cards</button> : <button className="primary" disabled={busy} onClick={() => { void act('next_round') }}>Start next round →</button>}
                  <button disabled={busy} onClick={() => setEditing(!editing)} aria-expanded={editing}>{editing ? 'Close card settings' : 'Configure cards'}</button>
                  {!session.round.revealed && <button className="text-button" disabled={busy} onClick={() => { if (window.confirm('Start a new round? Current votes will be cleared.')) void act('next_round') }}>Reset round</button>}
                </> : <p className="fine-print">{session.round.revealed ? 'The presenter will start the next round.' : 'The presenter will reveal when everyone is ready.'}</p>}
              </div>
              {editing && presenter && <CardEditor key={session.round.id} options={session.round.options} busy={busy} onSave={(labels) => { if (window.confirm('Apply these cards and start a fresh round? Current votes will be cleared.')) void act('next_round', { labels }) }} />}
            </section>
            <aside className="panel participants-panel" aria-labelledby="team-title">
              <div className="panel-heading"><h2 id="team-title">At the table</h2><span className="participant-count">{session.participants.length}</span></div>
              <p>Everyone gets a voice.</p>
              <ul className="participants">{session.participants.map((person) => <li key={person.id}>
                <span className="avatar" aria-hidden="true">{person.name.slice(0, 1).toUpperCase()}</span>
                <div className="participant-name"><strong>{person.name}{person.id === userId && <small> (you)</small>}</strong><small>{person.id === session.presenterId ? 'Presenter' : 'Teammate'}</small></div>
                <span className={`vote-status ${person.hasVoted ? 'has-voted' : ''}`}>{session.round.revealed ? (session.round.options.find((option) => option.id === person.optionId)?.label ?? 'No vote') : person.hasVoted ? '✓ Voted' : 'Thinking'}</span>
              </li>)}</ul>
              <div className="privacy-note"><span aria-hidden="true">◇</span><p>{session.round.revealed ? 'One team. Different perspectives.' : 'Cards stay hidden until reveal. No peeking, no anchoring.'}</p></div>
            </aside>
          </div>
          {session.round.revealed && <Results session={session} />}
        </>}
        {error && <div className="error-message" role="alert"><strong>Couldn’t complete that.</strong> {error}<button className="text-button" onClick={() => { setError(''); if (sessionId) void refresh(sessionId) }}>Retry</button></div>}
        <p className="notice" role="status">{notice}</p>
      </main>
      <footer>Built because Neil does not want to pay for a license. <span>TeamPoker, created by Jacob Duijzer</span></footer>
    </div>
  )
}

function CardEditor({ options, busy, onSave }: { options: ScoreOption[]; busy: boolean; onSave: (labels: string[]) => void }) {
  const [cards, setCards] = useState(() => options.map((option) => ({ key: option.id, label: option.label })))
  const labels = cards.map(({ label }) => label.trim())
  const valid = labels.length > 0 && labels.every((label) => label.length > 0 && label.length <= 30) && new Set(labels).size === labels.length

  function move(index: number, offset: number) {
    setCards((previous) => {
      const next = [...previous]
      ;[next[index], next[index + offset]] = [next[index + offset], next[index]]
      return next
    })
  }

  return <section className="card-editor" aria-labelledby="card-settings-title">
    <h3 id="card-settings-title">Your team, your scale</h3>
    <p>Edit, add, remove, or reorder cards. Applying changes starts a fresh round and clears current votes.</p>
    <form onSubmit={(event) => { event.preventDefault(); if (valid) onSave(labels) }}>
      <fieldset disabled={busy}><legend className="sr-only">Score card settings</legend>
        {cards.map((card, index) => <div className="editor-row" key={card.key}>
          <label className="sr-only" htmlFor={`card-${card.key}`}>Card {index + 1}</label>
          <input id={`card-${card.key}`} value={card.label} maxLength={30} required onChange={(event) => setCards((previous) => previous.map((item) => item.key === card.key ? { ...item, label: event.target.value } : item))} />
          <button type="button" aria-label={`Move card ${index + 1} up`} disabled={index === 0} onClick={() => move(index, -1)}>↑</button>
          <button type="button" aria-label={`Move card ${index + 1} down`} disabled={index === cards.length - 1} onClick={() => move(index, 1)}>↓</button>
          <button type="button" aria-label={`Remove card ${index + 1}`} onClick={() => setCards((previous) => previous.filter((item) => item.key !== card.key))}>×</button>
        </div>)}
        <div className="editor-actions"><button type="button" onClick={() => setCards((previous) => [...previous, { key: crypto.randomUUID(), label: '' }])}>+ Add card</button><button className="primary" type="submit" disabled={!valid}>Apply & start new round</button></div>
      </fieldset>
      {!valid && <p className="fine-print">Add at least one card. Labels must be non-empty and unique.</p>}
    </form>
  </section>
}

function Results({ session }: { session: PokerSession }) {
  const { counts, total, finalScores } = summarize(session.round.options, session.participants)
  return <section className="panel results-panel" aria-labelledby="results-title">
    <div><p className="eyebrow">The big picture</p><h2 id="results-title">A starting point for discussion.</h2><p>{total} {total === 1 ? 'vote' : 'votes'} cast · {session.participants.length - total} didn’t vote</p></div>
    {total === 0 ? <p>No votes this round. Start another round to try again.</p> : <>
      <div className="result-summary"><div><span className="stat-value">{finalScores.map(({ label }) => label).join(' / ')}</span><span>{finalScores.length > 1 ? 'Final score · tied' : 'Final score'}</span><small>Closest card to the average. Custom labels use card order.</small></div></div>
      <ul className="distribution" aria-label="Votes per score">{counts.map(({ id, label, count }) => <li key={id}>
        <div className="distribution-score"><strong>{label}</strong><div className="bar-track"><div style={{ width: `${count / total * 100}%` }} /></div><span>{count} {count === 1 ? 'vote' : 'votes'}</span></div>
        {count > 0 && <ul className="score-voters" aria-label={`People who voted ${label}`}>{session.participants.filter((person) => person.optionId === id).map((person) => <li key={person.id}>{person.name}</li>)}</ul>}
      </li>)}</ul>
    </>}
    {session.participants.some((person) => !person.hasVoted) && <div className="non-voters"><h3>Didn’t vote</h3><ul>{session.participants.filter((person) => !person.hasVoted).map((person) => <li key={person.id}>{person.name}</li>)}</ul></div>}
  </section>
}
