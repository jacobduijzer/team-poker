import { describe, expect, it } from 'vitest'
import { summarize } from './results'
import type { Participant, ScoreOption } from './types'

function fixture(labels: string[], votes: (number | null)[]) {
  const options: ScoreOption[] = labels.map((label, index) => ({ id: String(index), label }))
  const participants: Participant[] = votes.map((vote, index) => ({
    id: String(index), name: `Person ${index}`, hasVoted: vote !== null,
    optionId: vote === null ? null : String(vote),
  }))
  return summarize(options, participants)
}

describe('results', () => {
  it('counts numeric scores and averages only submitted votes', () => {
    const result = fixture(['1', '3', '8'], [0, 1, 1, null])
    expect(result.total).toBe(3)
    expect(result.average).toBeCloseTo(7 / 3)
    expect(result.counts.map(({ count }) => count)).toEqual([1, 2, 0])
  })

  it('does not let unused nonnumeric options suppress a numeric average', () => {
    expect(fixture(['1', '3', '?'], [0, 1]).average).toBe(2)
  })

  it('summarizes custom labels with ties in card order', () => {
    const result = fixture(['S', 'M', 'L', 'XL'], [1, 1, 2, 2, 0])
    expect(result.average).toBeNull()
    expect(result.modes.map(({ label }) => label)).toEqual(['M', 'L'])
  })

  it('uses modes for mixed numeric and nonnumeric votes', () => {
    const result = fixture(['2', '?'], [0, 1, 1])
    expect(result.average).toBeNull()
    expect(result.modes[0].label).toBe('?')
  })

  it('handles no votes without NaN or spurious modes', () => {
    expect(fixture(['1', '2'], [null, null])).toMatchObject({ total: 0, average: null, modes: [] })
  })

  it('accepts decimals, zero and negative scores', () => {
    expect(fixture(['-1', '0', '2.5'], [0, 1, 2]).average).toBeCloseTo(0.5)
  })

  it.each(['Infinity', 'NaN', '0xff', '1e3', '12 points'])('treats %s as a custom label', (label) => {
    expect(fixture([label], [0]).average).toBeNull()
  })
})
