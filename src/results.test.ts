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
  it('counts scores and snaps the average to an available numeric card', () => {
    const result = fixture(['1', '3', '8'], [0, 1, 1, null])
    expect(result.total).toBe(3)
    expect(result.finalScores.map(({ label }) => label)).toEqual(['3'])
    expect(result.counts.map(({ count }) => count)).toEqual([1, 2, 0])
  })

  it('returns 3 rather than a decimal for an average of 3.4', () => {
    const result = fixture(['1', '2', '3', '4', '5', '6'], [2, 2, 2, 3, 3])
    expect(result.finalScores.map(({ label }) => label)).toEqual(['3'])
  })

  it('returns both numeric cards at an exact midpoint', () => {
    const result = fixture(['1', '2', '3', '4', '5', '6'], [0, 1, 2, 3, 4, 5])
    expect(result.finalScores.map(({ label }) => label)).toEqual(['3', '4'])
  })

  it('uses actual numeric distances, not positions, on an uneven scale', () => {
    const result = fixture(['1', '2', '3', '5', '8', '13'], [0, 5])
    expect(result.finalScores.map(({ label }) => label)).toEqual(['8'])
  })

  it('can select an unvoted card as the final score', () => {
    const result = fixture(['1', '2', '3', '4', '5'], [0, 4])
    expect(result.finalScores.map(({ label }) => label)).toEqual(['3'])
    expect(result.finalScores[0].count).toBe(0)
  })

  it('ignores unused custom options when every submitted vote is numeric', () => {
    const result = fixture(['1', '?', '3', '5'], [0, 3])
    expect(result.finalScores.map(({ label }) => label)).toEqual(['3'])
  })

  it('averages S and XL to the two unvoted middle cards M / L', () => {
    const result = fixture(['S', 'M', 'L', 'XL'], [0, 3])
    expect(result.finalScores.map(({ label }) => label)).toEqual(['M', 'L'])
  })

  it('averages two S, six M and one XL to M', () => {
    const result = fixture(['S', 'M', 'L', 'XL'], [0, 0, 1, 1, 1, 1, 1, 1, 3])
    expect(result.finalScores.map(({ label }) => label)).toEqual(['M'])
  })

  it('uses the average rather than the most common custom label', () => {
    const result = fixture(['S', 'M', 'L', 'XL'], [0, 0, 3])
    expect(result.finalScores.map(({ label }) => label)).toEqual(['M'])
  })

  it('uses configured order, not alphabetical order or known label sizes', () => {
    const result = fixture(['XL', 'S', 'L', 'M'], [0, 3])
    expect(result.finalScores.map(({ label }) => label)).toEqual(['S', 'L'])
  })

  it('uses the complete configured order when custom and numeric votes are mixed', () => {
    const result = fixture(['2', '?'], [0, 1, 1])
    expect(result.finalScores.map(({ label }) => label)).toEqual(['?'])
  })

  it('excludes participants without a vote from custom averages', () => {
    const result = fixture(['S', 'M', 'L', 'XL'], [0, 3, null, null])
    expect(result.total).toBe(2)
    expect(result.finalScores.map(({ label }) => label)).toEqual(['M', 'L'])
  })

  it('handles no votes and empty decks without a spurious final score', () => {
    expect(fixture(['1', '2'], [null, null])).toMatchObject({ total: 0, finalScores: [] })
    expect(fixture([], [])).toEqual({ total: 0, counts: [], finalScores: [] })
  })

  it('accepts decimals, zero and negative scores', () => {
    const result = fixture(['-1', '0', '2.5'], [0, 1, 2])
    expect(result.finalScores.map(({ label }) => label)).toEqual(['0'])
  })

  it('preserves ties despite floating-point averaging noise', () => {
    const result = fixture(['0.1', '0.2'], [0, 0, 0, 1, 1, 1])
    expect(result.finalScores.map(({ label }) => label)).toEqual(['0.1', '0.2'])
  })

  it('does not round a near-midpoint into an exact tie', () => {
    const result = fixture(['0', '1'], [0, 0, 1])
    expect(result.finalScores.map(({ label }) => label)).toEqual(['0'])
  })

  it('returns the same card when everyone agrees', () => {
    const result = fixture(['S', 'M', 'L', 'XL'], [2, 2, 2])
    expect(result.finalScores.map(({ label }) => label)).toEqual(['L'])
  })

  it('handles a single-card deck', () => {
    expect(fixture(['M'], [0]).finalScores.map(({ label }) => label)).toEqual(['M'])
  })

  it.each(['Infinity', 'NaN', '0xff', '1e3', '12 points'])('treats %s as a custom label', (label) => {
    const result = fixture([label, 'middle', 'last'], [0, 2])
    expect(result.finalScores.map(({ label }) => label)).toEqual(['middle'])
  })
})
