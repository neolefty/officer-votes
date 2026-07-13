import { z } from 'zod';

// Enums
export const ParticipantRole = z.enum(['teller', 'voter']);
export const RoundStatus = z.enum(['voting', 'closed', 'revealed', 'cancelled']);
export const DisclosureLevel = z.enum(['top', 'top_no_count', 'all', 'none']);
export const ElectionType = z.enum(['officer', 'by_election']);

// Election
export const CreateElectionSchema = z.object({
  name: z.string().min(1).max(200),
  tellerName: z.string().min(1).max(100),
  bodySize: z.number().int().min(1).max(100).optional(),
  electionType: ElectionType.default('officer'),
  vacancyCount: z.number().int().min(1).max(20).optional(),
});

export const JoinElectionSchema = z.object({
  code: z.string().length(6),
  name: z.string().min(1).max(100),
});

export const GetElectionSchema = z.object({
  code: z.string().length(6),
  token: z.string(),
});

// Round
export const StartRoundSchema = z.object({
  office: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  eligibleCandidateIds: z.array(z.string()).optional(),
});

export const VoteSchema = z.object({
  roundId: z.string(),
  candidateId: z.string().nullable(), // null = abstain
});

// Change an already-cast ballot to a different candidate (or abstain).
export const ChangeVoteSchema = z.object({
  roundId: z.string(),
  candidateId: z.string().nullable(), // null = abstain
});

// Withdraw an already-cast ballot, returning the voter to not-voted.
export const RetractVoteSchema = z.object({
  roundId: z.string(),
});

export const EndRoundSchema = z.object({
  roundId: z.string(),
  disclosureLevel: DisclosureLevel,
});

export const CancelRoundSchema = z.object({
  roundId: z.string(),
});

export const CloseVotingSchema = z.object({
  roundId: z.string(),
});

// Set, extend, or clear (null) a round's soft closing time (unix ms).
// "Lock now" = closesAt set to the current server time.
export const SetRoundClosesAtSchema = z.object({
  roundId: z.string(),
  closesAt: z.number().int().positive().nullable(),
});

// Teller actions
export const PromoteToTellerSchema = z.object({
  participantId: z.string(),
});

// Disqualify a voter (mid-round capable: retracts any open-round ballot).
export const DisqualifyVoterSchema = z.object({
  participantId: z.string(),
});

// Clear a disqualification; the voter may vote fresh if a round is open.
export const ReinstateVoterSchema = z.object({
  participantId: z.string(),
});

export const SetBodySizeSchema = z.object({
  bodySize: z.number().int().min(1).max(100).nullable(),
});

// Candidates (by-election roster)
export const AddCandidateSchema = z.object({
  name: z.string().min(1).max(100),
});

export const UpdateCandidateSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(100),
});

export const RemoveCandidateSchema = z.object({
  id: z.string(),
});
