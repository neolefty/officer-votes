import type { z } from 'zod';
import type {
  ParticipantRole as ParticipantRoleSchema,
  RoundStatus as RoundStatusSchema,
  DisclosureLevel as DisclosureLevelSchema,
  ElectionType as ElectionTypeSchema,
} from './schemas.js';
import type { WinnerSelection } from './voting.js';

// Infer types from Zod schemas
export type ParticipantRole = z.infer<typeof ParticipantRoleSchema>;
export type RoundStatus = z.infer<typeof RoundStatusSchema>;
export type DisclosureLevel = z.infer<typeof DisclosureLevelSchema>;
export type ElectionType = z.infer<typeof ElectionTypeSchema>;

interface ElectionBase {
  id: string;
  code: string;
  name: string;
  bodySize: number | null;
  createdAt: string;
  expiresAt: string;
}

export type Election =
  | (ElectionBase & {
      electionType: 'officer';
      vacancyCount: null;
    })
  | (ElectionBase & {
      electionType: 'by_election';
      vacancyCount: number;
      candidates: Candidate[];
    });

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
  electionType: ElectionType;
  eligibleCandidateIds: string[] | null;
  status: RoundStatus;
  disclosureLevel: DisclosureLevel | null;
  createdAt: string;
}

export interface Candidate {
  id: string;
  electionId: string;
  name: string;
  displayOrder: number;
  removedAt: number | null;
  createdAt: string;
}

export interface VoteTally {
  candidateId: string | null;
  candidateName: string | null;
  count: number;
}

export interface VoterStatus {
  participantId: string;
  hasVoted: boolean;
}

export interface CloseVotingResult {
  tallies: VoteTally[];
  totalVotes: number;
  majorityThreshold: number;
  hasMajority: boolean;
  bodySize: number | null;
}

interface RoundResultBase {
  round: Round;
  tallies: VoteTally[];
  totalVotes: number;
}

export type RoundResult =
  | (RoundResultBase & {
      electionType: 'officer';
      hasMajority: boolean;
      majorityThreshold: number;
    })
  | (RoundResultBase & {
      electionType: 'by_election';
      selection: WinnerSelection;
      vacancyCount: number;
    });

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
  voterStatus?: VoterStatus[];
  result?: RoundResult;
  roundLog: RoundLogEntry[];
}

export interface RoundLogEntry {
  round: Round;
  result: RoundResult | null;
}
