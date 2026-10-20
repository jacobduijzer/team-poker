import type { Participant, ScoreOption } from './types'

const numericScore = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/

export function summarize(options: ScoreOption[], participants: Participant[]) {
  const counts = options.map((option) => ({
    ...option,
    count: participants.filter((person) => person.optionId === option.id).length,
  }))
  const submitted = counts.filter((score) => score.count > 0)
  const total = submitted.reduce((sum, score) => sum + score.count, 0)
  if (total === 0) return { counts, total, finalScores: [] }

  const isNumeric = (label: string) => numericScore.test(label) && Number.isFinite(Number(label))
  const useNumericValues = submitted.every(({ label }) => isNumeric(label))
  // Numeric votes use actual values, ignoring unused custom cards (e.g. '?').
  // Otherwise, configured card order is an evenly spaced scale, including any
  // numeric labels in a mixed deck. Unvoted cards can still be the final score.
  const scale = counts.flatMap((score, index) => {
    if (useNumericValues && !isNumeric(score.label)) return []
    return [{ score, value: useNumericValues ? Number(score.label) : index }]
  })
  const average = scale.reduce((sum, { score, value }) => sum + value * (score.count / total), 0)
  const nearestDistance = scale.reduce((closest, { value }) => Math.min(closest, Math.abs(value - average)), Infinity)
  const finalScores = scale.filter(({ value }) => {
    const distance = Math.abs(value - average)
    // Preserve mathematical ties despite floating-point averaging noise.
    const tolerance = Number.EPSILON * Math.max(Math.abs(average), Math.abs(value), nearestDistance) * 8
    return Math.abs(distance - nearestDistance) <= tolerance
  }).map(({ score }) => score)

  return { counts, total, finalScores }
}
