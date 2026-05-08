import type { RoundResult } from '@officer-election/shared';

interface RoundResultsProps {
  result: RoundResult;
}

export default function RoundResults({ result }: RoundResultsProps) {
  if (result.electionType === 'by_election') {
    return <ByElectionResults result={result} />;
  }
  return <OfficerResults result={result} />;
}

function OfficerResults({
  result,
}: {
  result: Extract<RoundResult, { electionType: 'officer' }>;
}) {
  const { round, tallies, totalVotes, hasMajority, majorityThreshold } = result;

  // Exclude abstentions when determining top candidates (abstentions can't "win")
  const actualVotes = tallies.filter((t) => t.candidateId !== null);
  const topCount = actualVotes[0]?.count || 0;
  const topCandidates = actualVotes.filter((t) => t.count === topCount);
  const isTie = topCandidates.length > 1;

  // Color scheme based on majority status
  const bgColor = hasMajority ? 'bg-green-50' : 'bg-yellow-50';
  const textColor = hasMajority ? 'text-green-700' : 'text-yellow-700';
  const borderColor = hasMajority ? 'border-green-200' : 'border-yellow-200';

  return (
    <div className="text-center">
      <h2 className="text-xl font-semibold mb-2">Results: {round.office}</h2>
      {round.description && <p className="text-gray-600 mb-6">{round.description}</p>}

      {round.disclosureLevel === 'none' ? (
        <div className="bg-gray-50 rounded-xl p-6">
          <p className="text-gray-600">The teller has chosen not to disclose vote totals.</p>
          <p className="text-sm text-gray-500 mt-2">{totalVotes} total votes cast</p>
        </div>
      ) : round.disclosureLevel === 'top' || round.disclosureLevel === 'top_no_count' ? (
        <div className={`${bgColor} rounded-xl p-6`}>
          {isTie ? (
            <>
              <p className="text-lg mb-4">Tie between:</p>
              <div className="space-y-2">
                {topCandidates.map((t) => (
                  <div key={t.candidateId} className={`text-2xl font-bold ${textColor}`}>
                    {t.candidateName || 'Abstain'}
                  </div>
                ))}
              </div>
              {round.disclosureLevel === 'top' && (
                <p className="text-gray-600 mt-4">Each with {topCount} votes</p>
              )}
            </>
          ) : topCandidates[0] ? (
            <>
              <p className="text-lg mb-2">Top vote recipient:</p>
              <p className={`text-3xl font-bold ${textColor}`}>
                {topCandidates[0].candidateName || 'Abstain'}
              </p>
              {round.disclosureLevel === 'top' && (
                <p className="text-gray-600 mt-2">{topCandidates[0].count} votes</p>
              )}
            </>
          ) : (
            <p className="text-gray-600">No votes cast</p>
          )}
          <p className="text-gray-500 mt-4 text-sm">
            {hasMajority ? 'Majority achieved' : `No clear majority (${majorityThreshold} required)`}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {tallies.map((t) => {
            const isTop = t.candidateId !== null && t.count === topCount;
            return (
              <div
                key={t.candidateId || 'abstain'}
                className={`flex items-center justify-between p-4 rounded-lg ${
                  isTop ? `${bgColor} border-2 ${borderColor}` : 'bg-gray-50'
                }`}
              >
                <span className={isTop ? 'font-semibold' : ''}>
                  {t.candidateName || 'Abstain'}
                </span>
                <span className={`font-bold ${isTop ? textColor : 'text-gray-700'}`}>
                  {t.count} vote{t.count !== 1 ? 's' : ''}
                </span>
              </div>
            );
          })}
          <p className="text-sm text-gray-500 mt-4">
            {totalVotes} total votes cast ·{' '}
            {hasMajority ? 'Majority achieved' : `No clear majority (${majorityThreshold} required)`}
          </p>
        </div>
      )}
    </div>
  );
}

function ByElectionResults({
  result,
}: {
  result: Extract<RoundResult, { electionType: 'by_election' }>;
}) {
  const { round, tallies, totalVotes, selection } = result;
  const isRunoff = round.eligibleCandidateIds && round.eligibleCandidateIds.length > 0;

  const winnerIds = new Set<string>();
  const tiedIds = new Set<string>();
  if (selection.outcome === 'decisive') {
    for (const w of selection.winners) {
      if (w.candidateId) winnerIds.add(w.candidateId);
    }
  } else if (selection.outcome === 'tie') {
    for (const w of selection.decisiveWinners) {
      if (w.candidateId) winnerIds.add(w.candidateId);
    }
    for (const t of selection.tiedCandidates) {
      if (t.candidateId) tiedIds.add(t.candidateId);
    }
  }

  return (
    <div className="text-center">
      <h2 className="text-xl font-semibold mb-2">Results: {round.office}</h2>
      {round.description && <p className="text-gray-600 mb-2">{round.description}</p>}
      {isRunoff && (
        <p className="text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2 mb-6 inline-block">
          Runoff round
        </p>
      )}

      {round.disclosureLevel === 'none' ? (
        <div className="bg-gray-50 rounded-xl p-6">
          <p className="text-gray-600">The teller has chosen not to disclose vote totals.</p>
          <p className="text-sm text-gray-500 mt-2">{totalVotes} total votes cast</p>
        </div>
      ) : selection.outcome === 'no_votes' ? (
        <div className="bg-gray-50 rounded-xl p-6">
          <p className="text-gray-600">No votes cast.</p>
        </div>
      ) : round.disclosureLevel === 'top' || round.disclosureLevel === 'top_no_count' ? (
        <ByElectionTopBlock
          selection={selection}
          showCounts={round.disclosureLevel === 'top'}
        />
      ) : (
        <div className="space-y-3">
          {tallies.map((t) => {
            const isWinner = t.candidateId !== null && winnerIds.has(t.candidateId);
            const isTied = t.candidateId !== null && tiedIds.has(t.candidateId);
            const rowClass = isWinner
              ? 'bg-green-50 border-2 border-green-200'
              : isTied
                ? 'bg-amber-50 border-2 border-amber-200'
                : 'bg-gray-50';
            const countClass = isWinner
              ? 'text-green-700'
              : isTied
                ? 'text-amber-700'
                : 'text-gray-700';
            return (
              <div
                key={t.candidateId || 'abstain'}
                className={`flex items-center justify-between p-4 rounded-lg ${rowClass}`}
              >
                <span className={isWinner || isTied ? 'font-semibold' : ''}>
                  {t.candidateName || 'Abstain'}
                </span>
                <span className={`font-bold ${countClass}`}>
                  {t.count} vote{t.count !== 1 ? 's' : ''}
                </span>
              </div>
            );
          })}
          <p className="text-sm text-gray-500 mt-4">
            {totalVotes} total votes cast
            {selection.outcome === 'tie' && ' · runoff required'}
          </p>
        </div>
      )}
    </div>
  );
}

function ByElectionTopBlock({
  selection,
  showCounts,
}: {
  selection: Extract<RoundResult, { electionType: 'by_election' }>['selection'];
  showCounts: boolean;
}) {
  if (selection.outcome === 'decisive') {
    return (
      <div className="bg-green-50 rounded-xl p-6">
        <p className="text-lg mb-2">Elected:</p>
        <div className="space-y-2">
          {selection.winners.map((w) => (
            <div key={w.candidateId} className="text-2xl font-bold text-green-700">
              {w.candidateName}
              {showCounts && (
                <span className="ml-2 text-base font-normal text-gray-600">
                  ({w.count} vote{w.count !== 1 ? 's' : ''})
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (selection.outcome === 'tie') {
    return (
      <div className="bg-amber-50 rounded-xl p-6">
        {selection.decisiveWinners.length > 0 && (
          <>
            <p className="text-lg mb-2">Elected:</p>
            <div className="space-y-1 mb-4">
              {selection.decisiveWinners.map((w) => (
                <div key={w.candidateId} className="text-xl font-bold text-green-700">
                  {w.candidateName}
                  {showCounts && (
                    <span className="ml-2 text-base font-normal text-gray-600">
                      ({w.count} vote{w.count !== 1 ? 's' : ''})
                    </span>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
        <p className="text-lg mb-2">
          Tied — runoff required for {selection.seatsContested} seat
          {selection.seatsContested === 1 ? '' : 's'}:
        </p>
        <div className="space-y-1">
          {selection.tiedCandidates.map((t) => (
            <div key={t.candidateId} className="text-xl font-bold text-amber-700">
              {t.candidateName}
              {showCounts && (
                <span className="ml-2 text-base font-normal text-gray-600">
                  ({t.count} vote{t.count !== 1 ? 's' : ''})
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }
  return null;
}
