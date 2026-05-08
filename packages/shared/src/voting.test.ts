import { describe, it, expect } from 'vitest';
import {
  countVotes,
  buildTallies,
  hasMajority,
  getMajorityThreshold,
  getTopCandidates,
  selectWinners,
} from './voting.js';

describe('countVotes', () => {
  it('returns an empty map for no votes', () => {
    expect(countVotes([])).toEqual(new Map());
  });

  it('counts votes per candidate', () => {
    const counts = countVotes([
      { candidateId: 'a' },
      { candidateId: 'b' },
      { candidateId: 'a' },
    ]);
    expect(counts.get('a')).toBe(2);
    expect(counts.get('b')).toBe(1);
  });

  it('counts abstentions under the null key', () => {
    const counts = countVotes([
      { candidateId: null },
      { candidateId: 'a' },
      { candidateId: null },
    ]);
    expect(counts.get(null)).toBe(2);
    expect(counts.get('a')).toBe(1);
  });
});

describe('buildTallies', () => {
  const names = new Map([
    ['a', 'Alice'],
    ['b', 'Bob'],
  ]);

  it('returns tallies sorted by count descending', () => {
    const counts = new Map<string | null, number>([
      ['a', 1],
      ['b', 3],
    ]);
    const tallies = buildTallies(counts, names);
    expect(tallies.map((t) => t.candidateId)).toEqual(['b', 'a']);
  });

  it('resolves candidate names from the lookup map', () => {
    const counts = new Map<string | null, number>([['a', 1]]);
    const tallies = buildTallies(counts, names);
    expect(tallies[0].candidateName).toBe('Alice');
  });

  it('uses "Unknown" for candidate IDs not in the lookup', () => {
    const counts = new Map<string | null, number>([['ghost', 1]]);
    const tallies = buildTallies(counts, names);
    expect(tallies[0].candidateName).toBe('Unknown');
  });

  it('represents abstentions with a null candidateName', () => {
    const counts = new Map<string | null, number>([[null, 2]]);
    const tallies = buildTallies(counts, names);
    expect(tallies[0]).toEqual({ candidateId: null, candidateName: null, count: 2 });
  });
});

describe('hasMajority', () => {
  it('is false at exactly half', () => {
    expect(hasMajority(5, 10)).toBe(false);
  });

  it('is true above half', () => {
    expect(hasMajority(6, 10)).toBe(true);
  });

  it('handles odd bases (5/9 is majority)', () => {
    expect(hasMajority(5, 9)).toBe(true);
    expect(hasMajority(4, 9)).toBe(false);
  });
});

describe('getMajorityThreshold', () => {
  it('returns half + 1 for even bases', () => {
    expect(getMajorityThreshold(10)).toBe(6);
  });

  it('returns ceil-half for odd bases', () => {
    expect(getMajorityThreshold(9)).toBe(5);
  });
});

describe('getTopCandidates', () => {
  it('returns the candidates tied at the highest count', () => {
    const top = getTopCandidates([
      { candidateId: 'a', candidateName: 'A', count: 3 },
      { candidateId: 'b', candidateName: 'B', count: 3 },
      { candidateId: 'c', candidateName: 'C', count: 1 },
    ]);
    expect(top.map((t) => t.candidateId)).toEqual(['a', 'b']);
  });

  it('excludes abstentions from being "top"', () => {
    const top = getTopCandidates([
      { candidateId: null, candidateName: null, count: 5 },
      { candidateId: 'a', candidateName: 'A', count: 1 },
    ]);
    expect(top).toEqual([{ candidateId: 'a', candidateName: 'A', count: 1 }]);
  });

  it('returns [] when there are no non-abstention votes', () => {
    const top = getTopCandidates([{ candidateId: null, candidateName: null, count: 3 }]);
    expect(top).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// selectWinners — by-election winner selection
// ---------------------------------------------------------------------------

describe('selectWinners', () => {
  const tally = (id: string, count: number) => ({
    candidateId: id,
    candidateName: id.toUpperCase(),
    count,
  });
  const abstain = (count: number) => ({
    candidateId: null,
    candidateName: null,
    count,
  });

  it('throws if vacancyCount < 1', () => {
    expect(() => selectWinners([], 0)).toThrow();
  });

  describe('no_votes outcome', () => {
    it('returns no_votes for an empty tallies array', () => {
      expect(selectWinners([], 1)).toEqual({ outcome: 'no_votes' });
    });

    it('returns no_votes when only abstentions were cast', () => {
      expect(selectWinners([abstain(5)], 1)).toEqual({ outcome: 'no_votes' });
    });

    it('returns no_votes when all candidate counts are zero', () => {
      // Defensive: shouldn't normally happen, but cover the input.
      expect(selectWinners([tally('a', 0), tally('b', 0)], 1)).toEqual({ outcome: 'no_votes' });
    });
  });

  describe('single vacancy (v1)', () => {
    it('returns decisive when the top candidate is alone', () => {
      const result = selectWinners([tally('a', 5), tally('b', 3)], 1);
      expect(result).toEqual({
        outcome: 'decisive',
        winners: [tally('a', 5)],
      });
    });

    it('ignores abstentions when picking the winner', () => {
      const result = selectWinners([abstain(10), tally('a', 5), tally('b', 3)], 1);
      expect(result).toEqual({
        outcome: 'decisive',
        winners: [tally('a', 5)],
      });
    });

    it('does not assume input is pre-sorted', () => {
      const result = selectWinners([tally('a', 1), tally('b', 7), tally('c', 4)], 1);
      expect(result).toEqual({
        outcome: 'decisive',
        winners: [tally('b', 7)],
      });
    });

    it('returns a tie when the top is shared by 2+ candidates', () => {
      const result = selectWinners([tally('a', 4), tally('b', 4), tally('c', 1)], 1);
      expect(result).toEqual({
        outcome: 'tie',
        decisiveWinners: [],
        tiedCandidates: [tally('a', 4), tally('b', 4)],
        seatsContested: 1,
      });
    });

    it('returns a tie across 3-way top', () => {
      const result = selectWinners([tally('a', 2), tally('b', 2), tally('c', 2)], 1);
      expect(result.outcome).toBe('tie');
      if (result.outcome === 'tie') {
        expect(result.tiedCandidates).toHaveLength(3);
        expect(result.decisiveWinners).toEqual([]);
        expect(result.seatsContested).toBe(1);
      }
    });
  });

  describe('multi-vacancy (v2-ready)', () => {
    it('returns decisive when the top N are all clear', () => {
      const result = selectWinners(
        [tally('a', 9), tally('b', 7), tally('c', 5), tally('d', 1)],
        3
      );
      expect(result).toEqual({
        outcome: 'decisive',
        winners: [tally('a', 9), tally('b', 7), tally('c', 5)],
      });
    });

    it('returns decisive when there are exactly N candidates with votes', () => {
      const result = selectWinners([tally('a', 3), tally('b', 1)], 2);
      expect(result).toEqual({
        outcome: 'decisive',
        winners: [tally('a', 3), tally('b', 1)],
      });
    });

    it('returns decisive when fewer candidates than seats received votes', () => {
      const result = selectWinners([tally('a', 3)], 3);
      expect(result).toEqual({
        outcome: 'decisive',
        winners: [tally('a', 3)],
      });
    });

    it('returns a tie at the cutoff with some seats already decided', () => {
      // 2 seats; A wins outright (5); B, C tied at 3 for the second seat.
      const result = selectWinners([tally('a', 5), tally('b', 3), tally('c', 3)], 2);
      expect(result).toEqual({
        outcome: 'tie',
        decisiveWinners: [tally('a', 5)],
        tiedCandidates: [tally('b', 3), tally('c', 3)],
        seatsContested: 1,
      });
    });

    it('returns a tie covering multiple contested seats', () => {
      // 3 seats; A wins (10); B, C, D tied at 4 for the remaining 2 seats.
      const result = selectWinners(
        [tally('a', 10), tally('b', 4), tally('c', 4), tally('d', 4), tally('e', 1)],
        3
      );
      expect(result).toEqual({
        outcome: 'tie',
        decisiveWinners: [tally('a', 10)],
        tiedCandidates: [tally('b', 4), tally('c', 4), tally('d', 4)],
        seatsContested: 2,
      });
    });

    it('returns a tie with zero decisive winners (everyone tied)', () => {
      const result = selectWinners([tally('a', 3), tally('b', 3), tally('c', 3)], 2);
      expect(result).toEqual({
        outcome: 'tie',
        decisiveWinners: [],
        tiedCandidates: [tally('a', 3), tally('b', 3), tally('c', 3)],
        seatsContested: 2,
      });
    });
  });
});
