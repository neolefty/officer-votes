import { z } from 'zod';

// Enums
export const ParticipantRole = z.enum(['teller', 'voter']);
export const RoundStatus = z.enum(['voting', 'revealed', 'cancelled']);
export const DisclosureLevel = z.enum(['top', 'all', 'none']);

// Election
export const CreateElectionSchema = z.object({
  name: z.string().min(1).max(200),
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
});

export const VoteSchema = z.object({
  roundId: z.string(),
  candidateId: z.string().nullable(), // null = abstain
});

export const EndRoundSchema = z.object({
  roundId: z.string(),
  disclosureLevel: DisclosureLevel,
});

export const CancelRoundSchema = z.object({
  roundId: z.string(),
});

// Teller actions
export const PromoteToTellerSchema = z.object({
  participantId: z.string(),
});
