import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { request, watchSession } from './api'
import type { PokerSession } from './types'

vi.mock('./api', () => ({
  supabase: {},
  ensureIdentity: vi.fn().mockResolvedValue('presenter'),
  request: vi.fn(),
  watchSession: vi.fn((_id, _change, status) => { status(true); return vi.fn() }),
}))

const id = '11111111-1111-4111-8111-111111111111'
let game: PokerSession

beforeEach(() => {
  window.history.replaceState({}, '', '/')
  localStorage.clear()
  game = {
    id, presenterId: 'presenter', revision: 1,
    round: { id: 'round-1', number: 1, revealed: false, options: [{ id: 'one', label: '1' }, { id: 'three', label: '3' }] },
    participants: [{ id: 'presenter', name: 'Alex', hasVoted: false, optionId: null }, { id: 'other', name: 'Sam', hasVoted: true, optionId: null }],
  }
  vi.mocked(request).mockReset()
  vi.mocked(request).mockImplementation(async (action, payload = {}) => {
    if (action === 'vote') game = { ...game, revision: game.revision + 1, participants: game.participants.map((person) => person.id === 'presenter' ? { ...person, hasVoted: true, optionId: String(payload.optionId) } : person) }
    if (action === 'reveal') game = { ...game, revision: game.revision + 1, round: { ...game.round, revealed: true }, participants: game.participants.map((person) => person.id === 'other' ? { ...person, optionId: 'three' } : person) }
    if (action === 'next_round') game = { ...game, revision: game.revision + 1, round: { ...game.round, id: 'round-2', number: 2, revealed: false }, participants: game.participants.map((person) => ({ ...person, hasVoted: false, optionId: null })) }
    return structuredClone(game)
  })
})

async function openSession() {
  window.history.replaceState({}, '', `/s/${id}`)
  render(<App />)
  await screen.findByRole('heading', { name: 'What’s your estimate?' })
}

describe('session interface', () => {
  it('requires a display name and creates an invitation', async () => {
    const user = userEvent.setup()
    render(<App />)
    expect(screen.getByRole('button', { name: 'Create session →' })).toBeDisabled()
    await user.type(screen.getByLabelText('Your display name'), 'Alex')
    await user.click(screen.getByRole('button', { name: 'Create session →' }))
    expect(request).toHaveBeenCalledWith('create', { name: 'Alex', sessionId: null })
    expect(await screen.findByLabelText('Invitation link')).toHaveValue(`${window.location.origin}/s/${id}`)
    expect(window.location.pathname).toBe(`/s/${id}`)
  })

  it('votes, changes vote, reveals results and clears votes in a new round', async () => {
    const user = userEvent.setup()
    await openSession()
    const cards = screen.getByRole('group', { name: 'Score cards' })
    await user.click(within(cards).getByRole('button', { name: '1' }))
    expect(await screen.findByText('Your card is in. You can change it until reveal.')).toBeVisible()
    await user.click(within(cards).getByRole('button', { name: '3' }))
    expect(request).toHaveBeenLastCalledWith('vote', { sessionId: id, roundId: 'round-1', optionId: 'three' })
    await user.click(screen.getByRole('button', { name: 'Reveal cards' }))
    expect(await screen.findByRole('heading', { name: 'Cards on the table.' })).toBeVisible()
    expect(within(cards).getByRole('button', { name: '3' })).toBeDisabled()
    expect(screen.getByText('Final score')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Start next round →' }))
    expect(await screen.findByText('Round 02')).toBeVisible()
    expect(screen.queryByText('Final score')).not.toBeInTheDocument()
    expect(screen.getByText('0 / 2 voted')).toBeVisible()
  })

  it('shows status, not other people’s hidden values', async () => {
    await openSession()
    const team = screen.getByRole('complementary', { name: 'At the table' })
    expect(within(team).getByText('✓ Voted')).toBeVisible()
    expect(within(team).queryByText('3')).not.toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'People who voted 3' })).not.toBeInTheDocument()
  })

  it.each(['presenter', 'other'])('lists every voter under their revealed score with presenter %s', async (presenterId) => {
    game.presenterId = presenterId
    game.round.revealed = true
    game.participants = [
      { id: 'presenter', name: 'Alex', hasVoted: true, optionId: 'one' },
      { id: 'other', name: 'Sam', hasVoted: true, optionId: 'three' },
      { id: 'third', name: 'Taylor', hasVoted: true, optionId: 'three' },
      { id: 'fourth', name: 'Robin', hasVoted: false, optionId: null },
    ]
    window.history.replaceState({}, '', `/s/${id}`)
    render(<App />)
    const ones = await screen.findByRole('list', { name: 'People who voted 1' })
    expect(within(ones).getByText('Alex')).toBeVisible()
    const threes = screen.getByRole('list', { name: 'People who voted 3' })
    expect(within(threes).getByText('Sam')).toBeVisible()
    expect(within(threes).getByText('Taylor')).toBeVisible()
    const results = screen.getByRole('region', { name: 'A starting point for discussion.' })
    expect(within(results).getByText('Didn’t vote')).toBeVisible()
    expect(within(results).getByText('Robin')).toBeVisible()
  })

  it.each(['notification', 'focus', 'poll'])('shows all votes to a non-presenter after reveal via %s', async (trigger) => {
    const interval = vi.spyOn(window, 'setInterval')
    game.presenterId = 'other'
    await openSession()
    expect(screen.queryByRole('button', { name: 'Reveal cards' })).not.toBeInTheDocument()
    game = {
      ...game, revision: game.revision + 1, round: { ...game.round, revealed: true },
      participants: game.participants.map((person) => ({ ...person, hasVoted: true, optionId: person.id === 'presenter' ? 'one' : 'three' })),
    }
    await act(async () => {
      if (trigger === 'notification') {
        const calls = vi.mocked(watchSession).mock.calls
        calls[calls.length - 1][1]()
      } else if (trigger === 'focus') {
        window.dispatchEvent(new Event('focus'))
      } else {
        const poll = interval.mock.calls.find(([, delay]) => delay === 10_000)![0] as () => void
        poll()
      }
    })
    expect(within(await screen.findByRole('list', { name: 'People who voted 1' })).getByText('Alex')).toBeVisible()
    expect(within(screen.getByRole('list', { name: 'People who voted 3' })).getByText('Sam')).toBeVisible()
    interval.mockRestore()
  })

  it('shows the nearest numeric card rather than the decimal average', async () => {
    game.round.revealed = true
    game.round.options = [{ id: 'one', label: '1' }, { id: 'two', label: '2' }, { id: 'four', label: '4' }]
    game.participants = game.participants.map((person, index) => ({ ...person, hasVoted: true, optionId: index === 0 ? 'one' : 'four' }))
    window.history.replaceState({}, '', `/s/${id}`)
    render(<App />)
    await screen.findByText('Final score')
    const results = screen.getByRole('region', { name: 'A starting point for discussion.' })
    expect(results.querySelector('.stat-value')).toHaveTextContent(/^2$/)
    expect(within(results).queryByText('2.5')).not.toBeInTheDocument()
  })

  it('shows both closest custom cards for a tied final score', async () => {
    game.round.revealed = true
    game.round.options = ['S', 'M', 'L', 'XL'].map((label) => ({ id: label, label }))
    game.participants = game.participants.map((person, index) => ({ ...person, hasVoted: true, optionId: index === 0 ? 'S' : 'XL' }))
    window.history.replaceState({}, '', `/s/${id}`)
    render(<App />)
    await screen.findByText('Final score · tied')
    const results = screen.getByRole('region', { name: 'A starting point for discussion.' })
    expect(results.querySelector('.stat-value')).toHaveTextContent('M / L')
  })

  it('does not show presenter controls to another browser identity', async () => {
    game.presenterId = 'other'
    await openSession()
    expect(screen.queryByRole('button', { name: 'Reveal cards' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Configure cards' })).not.toBeInTheDocument()
  })

  it('asks a nonmember to join the invitation', async () => {
    const user = userEvent.setup()
    vi.mocked(request).mockRejectedValueOnce(new Error('Join this session first.'))
    window.history.replaceState({}, '', `/s/${id}`)
    render(<App />)
    await screen.findByRole('heading', { name: 'Join the table' })
    await user.type(screen.getByLabelText('Your display name'), 'Alex')
    await user.click(screen.getByRole('button', { name: 'Join session →' }))
    expect(request).toHaveBeenCalledWith('join', { sessionId: id, name: 'Alex' })
    expect(await screen.findByRole('heading', { name: 'What’s your estimate?' })).toBeVisible()
  })

  it('edits, reorders, adds and removes score cards before applying', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await openSession()
    await user.click(screen.getByRole('button', { name: 'Configure cards' }))
    const first = screen.getByLabelText('Card 1')
    await user.clear(first)
    await user.type(first, 'S')
    await user.click(screen.getByRole('button', { name: 'Move card 1 down' }))
    await user.click(screen.getByRole('button', { name: '+ Add card' }))
    await user.type(screen.getByLabelText('Card 3'), 'XL')
    await user.click(screen.getByRole('button', { name: 'Remove card 1' }))
    await user.click(screen.getByRole('button', { name: 'Apply & start new round' }))
    expect(request).toHaveBeenCalledWith('next_round', { sessionId: id, roundId: 'round-1', labels: ['S', 'XL'] })
  })

  it('rejects duplicate card labels in the editor', async () => {
    const user = userEvent.setup()
    await openSession()
    await user.click(screen.getByRole('button', { name: 'Configure cards' }))
    fireEvent.change(screen.getByLabelText('Card 2'), { target: { value: '1' } })
    expect(screen.getByRole('button', { name: 'Apply & start new round' })).toBeDisabled()
  })

  it('surfaces failed writes without claiming success', async () => {
    const user = userEvent.setup()
    await openSession()
    vi.mocked(request).mockRejectedValueOnce(new Error('Votes are locked after reveal.'))
    await user.click(within(screen.getByRole('group', { name: 'Score cards' })).getByRole('button', { name: '1' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Votes are locked after reveal.')
  })

  it('refreshes after a real-time notification', async () => {
    await openSession()
    const callbacks = vi.mocked(watchSession).mock.calls
    const change = callbacks[callbacks.length - 1][1]
    game = { ...game, revision: 2, round: { ...game.round, revealed: true } }
    change()
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Cards on the table.' })).toBeVisible())
  })
})
