import type { RoundResult } from '@officer-election/shared';

interface RoundResultsProps {
  result: RoundResult;
}

export default function RoundResults({ result }: RoundResultsProps) {
  const { round, tallies, totalVotes, hasMajority, majorityThreshold } = result;

  const topCount = tallies[0]?.count || 0;
  const topCandidates = tallies.filter((t) => t.count === topCount);
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
          {tallies.map((t, i) => (
            <div
              key={t.candidateId || 'abstain'}
              className={`flex items-center justify-between p-4 rounded-lg ${
                i === 0 ? `${bgColor} border-2 ${borderColor}` : 'bg-gray-50'
              }`}
            >
              <span className={i === 0 ? 'font-semibold' : ''}>
                {t.candidateName || 'Abstain'}
              </span>
              <span className={`font-bold ${i === 0 ? textColor : 'text-gray-700'}`}>
                {t.count} vote{t.count !== 1 ? 's' : ''}
              </span>
            </div>
          ))}
          <p className="text-sm text-gray-500 mt-4">
            {totalVotes} total votes cast ·{' '}
            {hasMajority ? 'Majority achieved' : `No clear majority (${majorityThreshold} required)`}
          </p>
        </div>
      )}
    </div>
  );
}
