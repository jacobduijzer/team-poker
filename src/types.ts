export interface ScoreOption {
  id: string
  label: string
}

export interface Participant {
  id: string
  name: string
  hasVoted: boolean
  // The server only supplies others' values after reveal.
  optionId: string | null
}

export interface PokerSession {
  id: string
  presenterId: string
  revision: number
  round: {
    id: string
    number: number
    revealed: boolean
    options: ScoreOption[]
  }
  participants: Participant[]
}
