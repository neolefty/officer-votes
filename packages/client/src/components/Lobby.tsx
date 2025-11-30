import type { ElectionState } from '@officer-election/shared';

interface LobbyProps {
  state: ElectionState;
  isTeller: boolean;
}

export default function Lobby({ state, isTeller }: LobbyProps) {
  const shareUrl = `${window.location.origin}/e/${state.election.code}`;

  const copyLink = async () => {
    await navigator.clipboard.writeText(shareUrl);
    alert('Link copied!');
  };

  return (
    <div>
      <div className="text-center mb-8">
        <h2 className="text-xl font-semibold mb-2">Waiting Room</h2>
        <p className="text-gray-600">
          {state.currentRound
            ? 'A voting round is in progress'
            : 'Waiting for the teller to start a voting round'}
        </p>
      </div>

      <div className="bg-gray-50 rounded-xl p-4 mb-6">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-medium">Invite Link</h3>
          <button
            onClick={copyLink}
            className="text-sm text-blue-600 hover:text-blue-800"
          >
            Copy
          </button>
        </div>
        <p className="text-sm text-gray-600 break-all">{shareUrl}</p>
      </div>

      <div>
        <h3 className="font-medium mb-3">
          Participants ({state.participants.length})
        </h3>
        <div className="space-y-2">
          {state.participants.map((p) => (
            <div
              key={p.id}
              className="flex items-center justify-between p-3 bg-white rounded-lg border"
            >
              <span>{p.name}</span>
              {p.role === 'teller' && (
                <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
                  Teller
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {isTeller && (
        <p className="text-center text-gray-500 mt-8">
          Use the controls below to start a voting round
        </p>
      )}
    </div>
  );
}
