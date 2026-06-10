import { useState } from 'react';
import { trpc } from '../trpc';
import type { ElectionState, Round } from '@officer-election/shared';

interface VotingRoundProps {
  state: ElectionState;
  round: Round;
  onVoted: () => void;
  // 'change' re-points an already-cast ballot via round.changeVote; default
  // 'vote' casts a first ballot. onCancel, when provided, offers a way back to
  // the waiting view without altering the ballot.
  mode?: 'vote' | 'change';
  onCancel?: () => void;
}

interface CandidateOption {
  id: string;
  name: string;
  badge?: string;
}

function byName<T extends { name: string }>(a: T, b: T) {
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
}

function getCandidateOptions(state: ElectionState, round: Round): CandidateOption[] {
  if (state.election.electionType === 'by_election') {
    let options = state.election.candidates
      .filter((c) => c.removedAt === null)
      .map((c) => ({ id: c.id, name: c.name }));
    if (round.eligibleCandidateIds && round.eligibleCandidateIds.length > 0) {
      const eligible = new Set(round.eligibleCandidateIds);
      options = options.filter((o) => eligible.has(o.id));
    }
    return options.sort(byName);
  }
  return state.participants
    .map((p) => ({
      id: p.id,
      name: p.name,
      badge: p.role === 'teller' ? 'Teller' : undefined,
    }))
    .sort(byName);
}

export default function VotingRound({
  state,
  round,
  onVoted,
  mode = 'vote',
  onCancel,
}: VotingRoundProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [isAbstain, setIsAbstain] = useState(false);
  const isChange = mode === 'change';

  const voteMutation = trpc.round.vote.useMutation({
    onSuccess: () => onVoted(),
  });
  const changeMutation = trpc.round.changeVote.useMutation({
    onSuccess: () => onVoted(),
  });
  const activeMutation = isChange ? changeMutation : voteMutation;

  const options = getCandidateOptions(state, round);
  const isByElection = state.election.electionType === 'by_election';
  const isRunoff =
    isByElection && round.eligibleCandidateIds && round.eligibleCandidateIds.length > 0;

  const handleVote = () => {
    if (!isAbstain && !selected) return;
    activeMutation.mutate({
      roundId: round.id,
      candidateId: isAbstain ? null : selected,
    });
  };

  const handleSelect = (id: string) => {
    setSelected(id);
    setIsAbstain(false);
  };

  const handleAbstain = () => {
    setIsAbstain(true);
    setSelected(null);
  };

  const selectedName = isAbstain
    ? 'Abstain'
    : options.find((o) => o.id === selected)?.name;

  const heading = isByElection ? round.office : `Vote for ${round.office}`;

  return (
    <div role="form" aria-labelledby="vote-heading">
      <div className="text-center mb-6">
        <h2 id="vote-heading" className="text-xl font-semibold mb-1">
          {heading}
        </h2>
        {round.description && (
          <p className="text-gray-600" id="vote-description">
            {round.description}
          </p>
        )}
        {isRunoff && (
          <p className="text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2 mt-3 inline-block">
            Runoff round — only listed candidates are eligible
          </p>
        )}
        {isChange && (
          <p className="text-sm text-blue-700 bg-blue-50 rounded-lg px-3 py-2 mt-3 inline-block">
            Changing your vote — your previous choice will be replaced
          </p>
        )}
      </div>

      <fieldset className="space-y-2 mb-6">
        <legend className="sr-only">Select a candidate</legend>
        {options.length === 0 && (
          <p className="text-sm text-gray-500 italic p-3">
            No eligible candidates. Ask a teller to add some to the roster.
          </p>
        )}
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => handleSelect(o.id)}
            aria-pressed={selected === o.id}
            className={`w-full p-4 text-left rounded-lg border-2 transition ${
              selected === o.id
                ? 'border-blue-500 bg-blue-50'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <span className="font-medium">{o.name}</span>
            {o.badge && (
              <span className="ml-2 text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                {o.badge}
              </span>
            )}
          </button>
        ))}

        <button
          type="button"
          onClick={handleAbstain}
          aria-pressed={isAbstain}
          className={`w-full p-4 text-left rounded-lg border-2 transition ${
            isAbstain
              ? 'border-gray-500 bg-gray-50'
              : 'border-gray-200 hover:border-gray-300'
          }`}
        >
          <span className="text-gray-600">Abstain</span>
        </button>
      </fieldset>

      <button
        type="submit"
        onClick={handleVote}
        disabled={activeMutation.isPending || (!selected && !isAbstain)}
        aria-describedby={selectedName ? 'vote-selection' : undefined}
        className="w-full py-3 px-4 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {activeMutation.isPending
          ? 'Submitting...'
          : isChange
            ? 'Update Vote'
            : 'Submit Vote'}
      </button>

      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          disabled={activeMutation.isPending}
          className="w-full mt-3 py-2 px-4 text-gray-600 rounded-lg font-medium hover:bg-gray-100 transition disabled:opacity-50"
        >
          Cancel
        </button>
      )}

      {selectedName && (
        <p id="vote-selection" className="sr-only">
          You have selected {selectedName}
        </p>
      )}

      {activeMutation.error && (
        <p role="alert" className="text-red-600 text-sm mt-2">
          {activeMutation.error.message}
        </p>
      )}
    </div>
  );
}
