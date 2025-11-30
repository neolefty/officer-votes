import { useState } from 'react';
import { trpc } from '../trpc';
import type { Participant, Round } from '@officer-election/shared';

interface VotingRoundProps {
  round: Round;
  participants: Participant[];
  onVoted: () => void;
}

export default function VotingRound({ round, participants, onVoted }: VotingRoundProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [isAbstain, setIsAbstain] = useState(false);

  const voteMutation = trpc.round.vote.useMutation({
    onSuccess: () => onVoted(),
  });

  const handleVote = () => {
    if (!isAbstain && !selected) return;
    voteMutation.mutate({
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
    : participants.find((p) => p.id === selected)?.name;

  return (
    <div role="form" aria-labelledby="vote-heading">
      <div className="text-center mb-6">
        <h2 id="vote-heading" className="text-xl font-semibold mb-1">
          Vote for {round.office}
        </h2>
        {round.description && (
          <p className="text-gray-600" id="vote-description">
            {round.description}
          </p>
        )}
      </div>

      <fieldset className="space-y-2 mb-6">
        <legend className="sr-only">Select a candidate for {round.office}</legend>
        {participants.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => handleSelect(p.id)}
            aria-pressed={selected === p.id}
            className={`w-full p-4 text-left rounded-lg border-2 transition ${
              selected === p.id
                ? 'border-blue-500 bg-blue-50'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <span className="font-medium">{p.name}</span>
            {p.role === 'teller' && (
              <span className="ml-2 text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                Teller
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
        disabled={voteMutation.isPending || (!selected && !isAbstain)}
        aria-describedby={selectedName ? 'vote-selection' : undefined}
        className="w-full py-3 px-4 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {voteMutation.isPending ? 'Submitting...' : 'Submit Vote'}
      </button>

      {selectedName && (
        <p id="vote-selection" className="sr-only">
          You have selected {selectedName}
        </p>
      )}

      {voteMutation.error && (
        <p role="alert" className="text-red-600 text-sm mt-2">
          {voteMutation.error.message}
        </p>
      )}
    </div>
  );
}
