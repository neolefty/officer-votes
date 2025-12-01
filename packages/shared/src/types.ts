import type { z } from 'zod';
import type {
  ParticipantRole as ParticipantRoleSchema,
  RoundStatus as RoundStatusSchema,
  DisclosureLevel as DisclosureLevelSchema,
} from './schemas.js';

// Infer types from Zod schemas
export type ParticipantRole = z.infer<typeof ParticipantRoleSchema>;
export type RoundStatus = z.infer<typeof RoundStatusSchema>;
export type DisclosureLevel = z.infer<typeof DisclosureLevelSchema>;

export interface Election {
  id: string;
  code: string;
  name: string;
  bodySize: number | null;
  createdAt: string;
  expiresAt: string;
}

export interface Participant {
  id: string;
  name: string;
  role: ParticipantRole;
  joinedAt: string;
}

export interface Round {
  id: string;
  office: string;
  description: string | null;
  status: RoundStatus;
  disclosureLevel: DisclosureLevel | null;
  createdAt: string;
}

export interface VoteTally {
  candidateId: string | null;
  candidateName: string | null;
  count: number;
}

export interface RoundResult {
  round: Round;
  tallies: VoteTally[];
  totalVotes: number;
}

export interface ElectionState {
  election: Election;
  participants: Participant[];
  currentParticipantId: string;
  isTeller: boolean;
  currentRound: Round | null;
  pendingRound: Round | null; // Round where voting closed but results not yet shared
  votedCount: number;
  totalParticipants: number;
  hasVoted: boolean;
  voterStatus?: { participantId: string; hasVoted: boolean }[];
  result?: RoundResult;
  roundLog: RoundLogEntry[];
}

export interface RoundLogEntry {
  round: Round;
  result: RoundResult | null;
}
