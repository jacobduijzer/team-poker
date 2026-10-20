import type { Participant, ScoreOption } from './types'

const numericScore = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/

export function summarize(options: ScoreOption[], participants: Participant[]) {
  const counts = options.map((option) => ({
    ...option,
    count: participants.filter((person) => person.optionId === option.id).length,
  }))
  const submitted = counts.filter((score) => score.count > 0)
  const total = submitted.reduce((sum, score) => sum + score.count, 0)
  const allNumeric = submitted.every(
    ({ label }) => numericScore.test(label) && Number.isFinite(Number(label)),
  )
  // Divide before summing to avoid overflowing with otherwise finite scores.
  const average = total > 0 && allNumeric
    ? submitted.reduce((sum, { label, count }) => sum + Number(label) * (count / total), 0)
    : null
  const highestCount = Math.max(0, ...counts.map(({ count }) => count))
  const modes = counts.filter(({ count }) => count > 0 && count === highestCount)
  return { counts, total, average, modes }
}
