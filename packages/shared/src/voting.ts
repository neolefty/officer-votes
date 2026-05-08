import type { VoteTally } from './types.js';

/**
 * Count votes by candidate, returning a Map of candidateId -> count.
 * `null` represents an abstention.
 */
export function countVotes(votes: { candidateId: string | null }[]): Map<string | null, number> {
  const counts = new Map<string | null, number>();
  for (const vote of votes) {
    counts.set(vote.candidateId, (counts.get(vote.candidateId) ?? 0) + 1);
  }
  return counts;
}

/**
 * Build sorted vote tallies from vote counts. Caller supplies a name lookup
 * so this is mode-agnostic (officer participants vs by-election candidates).
 */
export function buildTallies(
  voteCounts: Map<string | null, number>,
  nameById: ReadonlyMap<string, string>
): VoteTally[] {
  return Array.from(voteCounts.entries())
    .map(([candidateId, count]) => ({
      candidateId,
      candidateName: candidateId ? (nameById.get(candidateId) ?? 'Unknown') : null,
      count,
    }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Check if the top vote count constitutes a majority (> 50% of base).
 * Officer-mode only.
 */
export function hasMajority(topCount: number, majorityBase: number): boolean {
  return topCount > majorityBase / 2;
}

/**
 * Minimum votes needed for a majority. Officer-mode only.
 */
export function getMajorityThreshold(majorityBase: number): number {
  return Math.floor(majorityBase / 2) + 1;
}

/**
 * Filter tallies to candidates tied for the top count, excluding abstentions.
 * Officer-mode helper.
 */
export function getTopCandidates(tallies: VoteTally[]): VoteTally[] {
  const actualVotes = tallies.filter((t) => t.candidateId !== null);
  if (actualVotes.length === 0) return [];
  const topCount = actualVotes[0].count;
  return actualVotes.filter((t) => t.count === topCount);
}

/**
 * Outcome of a by-election round.
 *
 * - `decisive`: clean win, `winners.length === vacancyCount`.
 * - `tie`: at least the cutoff seat is contested. Some seats may be decided
 *   outright (`decisiveWinners`); the remaining `seatsContested` seats are
 *   fought over by `tiedCandidates` (length >= 2). Triggers a runoff.
 * - `no_votes`: zero non-abstain votes were cast.
 */
export type WinnerSelection =
  | { outcome: 'decisive'; winners: VoteTally[] }
  | {
      outcome: 'tie';
      decisiveWinners: VoteTally[];
      tiedCandidates: VoteTally[];
      seatsContested: number;
    }
  | { outcome: 'no_votes' };

/**
 * Select winners for a by-election round.
 *
 * Algorithm: rank non-abstention tallies by count desc; take the top
 * `vacancyCount`. If the count at the cutoff equals the count just outside
 * it, the cutoff seat(s) are tied — return a `tie` outcome enumerating who
 * already won outright vs. who is competing in the runoff.
 *
 * Tallies are not assumed to be pre-sorted or pre-filtered.
 */
export function selectWinners(tallies: VoteTally[], vacancyCount: number): WinnerSelection {
  if (vacancyCount < 1) {
    throw new Error(`vacancyCount must be >= 1, got ${vacancyCount}`);
  }

  const ranked = tallies
    .filter((t) => t.candidateId !== null && t.count > 0)
    .slice()
    .sort((a, b) => b.count - a.count);

  if (ranked.length === 0) {
    return { outcome: 'no_votes' };
  }

  // Fewer candidates with votes than seats: everyone with votes wins outright.
  if (ranked.length <= vacancyCount) {
    return { outcome: 'decisive', winners: ranked };
  }

  const cutoffCount = ranked[vacancyCount - 1].count;
  const nextOutCount = ranked[vacancyCount].count;

  if (cutoffCount > nextOutCount) {
    return { outcome: 'decisive', winners: ranked.slice(0, vacancyCount) };
  }

  const decisiveWinners = ranked.filter((t) => t.count > cutoffCount);
  const tiedCandidates = ranked.filter((t) => t.count === cutoffCount);
  const seatsContested = vacancyCount - decisiveWinners.length;

  return {
    outcome: 'tie',
    decisiveWinners,
    tiedCandidates,
    seatsContested,
  };
}
