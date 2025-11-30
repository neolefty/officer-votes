import { useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { trpc, getToken, setToken, clearToken } from '../trpc';
import { useSSE } from '../hooks/useSSE';
import type { ElectionState, Participant, Round, RoundResult } from '@officer-election/shared';
import JoinForm from '../components/JoinForm';
import Lobby from '../components/Lobby';
import VotingRound from '../components/VotingRound';
import RoundResults from '../components/RoundResults';
import TellerControls from '../components/TellerControls';
import ElectionLog from '../components/ElectionLog';

export default function Election() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const [showLog, setShowLog] = useState(false);

  const hasToken = !!getToken();

  const { data: state, refetch, isLoading, error } = trpc.election.get.useQuery(undefined, {
    enabled: hasToken && !!code,
    refetchInterval: false,
  });

  const handleSSEEvent = useCallback(
    (event: string, data: unknown) => {
      console.log('SSE event:', event, data);
      // Refetch state on any event
      refetch();
    },
    [refetch]
  );

  useSSE(hasToken ? code : undefined, handleSSEEvent);

  const handleJoined = (token: string) => {
    setToken(code!, token);
    refetch();
  };

  if (!code) {
    navigate('/');
    return null;
  }

  if (!hasToken) {
    return <JoinForm code={code} onJoined={handleJoined} />;
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg text-gray-600">Loading...</div>
      </div>
    );
  }

  if (error) {
    // Token might be invalid
    if (error.data?.code === 'UNAUTHORIZED') {
      clearToken(code);
      return <JoinForm code={code} onJoined={handleJoined} />;
    }
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg text-red-600">{error.message}</div>
      </div>
    );
  }

  if (!state) {
    return null;
  }


  return (
    <div className="min-h-screen pb-20">
      <header className="bg-white shadow-sm sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div>
            <h1 className="font-semibold text-lg">{state.election.name}</h1>
            <p className="text-sm text-gray-500">Code: {state.election.code}</p>
          </div>
          <button
            onClick={() => setShowLog(!showLog)}
            className="px-3 py-1.5 text-sm bg-gray-100 rounded-lg hover:bg-gray-200 transition"
          >
            {showLog ? 'Hide Log' : 'Election Log'}
          </button>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6">
        {showLog ? (
          <ElectionLog roundLog={state.roundLog} onClose={() => setShowLog(false)} />
        ) : state.currentRound ? (
          state.hasVoted ? (
            <WaitingForResults
              state={state}
              round={state.currentRound}
              isTeller={state.isTeller}
            />
          ) : (
            <VotingRound
              round={state.currentRound}
              participants={state.participants}
              onVoted={() => refetch()}
            />
          )
        ) : state.result ? (
          <RoundResults result={state.result} />
        ) : (
          <Lobby state={state} isTeller={state.isTeller} onAction={() => refetch()} />
        )}
      </main>

      {state.isTeller && !showLog && (
        <TellerControls state={state} onAction={() => refetch()} />
      )}
    </div>
  );
}

function WaitingForResults({
  state,
  round,
  isTeller,
}: {
  state: ElectionState;
  round: Round;
  isTeller: boolean;
}) {
  return (
    <div className="text-center py-12">
      <h2 className="text-xl font-semibold mb-2">Voting: {round.office}</h2>
      {round.description && <p className="text-gray-600 mb-6">{round.description}</p>}

      <div className="bg-blue-50 rounded-xl p-6 mb-6">
        <p className="text-4xl font-bold text-blue-600 mb-2">
          {state.votedCount} / {state.totalParticipants}
        </p>
        <p className="text-gray-600">votes submitted</p>
      </div>

      <p className="text-gray-500">Your vote has been recorded. Waiting for others...</p>

      {isTeller && state.voterStatus && (
        <div className="mt-8 text-left">
          <h3 className="font-medium mb-3">Voting Status</h3>
          <div className="space-y-2">
            {state.participants.map((p) => {
              const status = state.voterStatus?.find((v) => v.participantId === p.id);
              return (
                <div
                  key={p.id}
                  className={`flex items-center justify-between p-3 rounded-lg ${
                    status?.hasVoted ? 'bg-green-50' : 'bg-gray-50'
                  }`}
                >
                  <span>{p.name}</span>
                  <span className={status?.hasVoted ? 'text-green-600' : 'text-gray-400'}>
                    {status?.hasVoted ? '✓ Voted' : 'Waiting'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
