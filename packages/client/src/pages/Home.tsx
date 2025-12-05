import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { trpc, setToken } from '../trpc';

export default function Home() {
  const [electionName, setElectionName] = useState('');
  const [yourName, setYourName] = useState('');
  const [bodySize, setBodySize] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [mode, setMode] = useState<'create' | 'join' | null>(null);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const createMutation = trpc.election.create.useMutation({
    onSuccess: (data) => {
      setToken(data.code, data.token);
      navigate(`/e/${data.code}`);
    },
    onError: (err) => setError(err.message),
  });

  const joinMutation = trpc.election.join.useMutation({
    onSuccess: (data, variables) => {
      setToken(variables.code, data.token);
      navigate(`/e/${variables.code}`);
    },
    onError: (err) => setError(err.message),
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!electionName.trim() || !yourName.trim()) return;
    const size = bodySize.trim() ? parseInt(bodySize, 10) : undefined;
    createMutation.mutate({
      name: electionName.trim(),
      tellerName: yourName.trim(),
      bodySize: size && size >= 1 && size <= 100 ? size : undefined,
    });
  };

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!yourName.trim() || !joinCode.trim()) return;
    joinMutation.mutate({ code: joinCode.trim().toUpperCase(), name: yourName.trim() });
  };

  const resetForm = () => {
    setMode(null);
    setError('');
    setElectionName('');
    setYourName('');
    setBodySize('');
    setJoinCode('');
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4">
      <div className="w-full max-w-md">
        <h1 className="text-3xl font-bold text-center mb-8">Officer Election</h1>

        {mode === null && (
          <div className="space-y-4">
            <button
              onClick={() => setMode('create')}
              className="w-full py-3 px-4 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition"
            >
              Create New Meeting
            </button>
            <button
              onClick={() => setMode('join')}
              className="w-full py-3 px-4 bg-gray-200 text-gray-800 rounded-lg font-medium hover:bg-gray-300 transition"
            >
              Join Existing Meeting
            </button>
          </div>
        )}

        {mode === 'create' && (
          <form onSubmit={handleCreate} className="space-y-4">
            <p className="text-sm text-gray-600 mb-4">
              A meeting is a session where you&apos;ll elect one or more officers (Chair, Secretary, etc.) You can designate additional tellers and hold multiple rounds of voting.
            </p>
            <div>
              <label htmlFor="election-name" className="block text-sm font-medium mb-1">
                Meeting Name
              </label>
              <input
                id="election-name"
                type="text"
                value={electionName}
                onChange={(e) => setElectionName(e.target.value)}
                placeholder="e.g., LSA Officers 2024"
                className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                autoFocus
              />
            </div>
            <div>
              <label htmlFor="your-name-create" className="block text-sm font-medium mb-1">
                Your Name
              </label>
              <input
                id="your-name-create"
                type="text"
                value={yourName}
                onChange={(e) => setYourName(e.target.value)}
                placeholder="Enter your name"
                className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <label htmlFor="body-size" className="block text-sm font-medium mb-1">
                Body Size <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                id="body-size"
                type="number"
                value={bodySize}
                onChange={(e) => setBodySize(e.target.value)}
                placeholder="e.g., 9 for LSA"
                min="1"
                max="100"
                className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <p className="text-xs text-gray-500 mt-1">
                Used to calculate majority. Leave blank to use participants count.
              </p>
            </div>
            {error && <p role="alert" className="text-red-600 text-sm">{error}</p>}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={resetForm}
                className="flex-1 py-3 px-4 bg-gray-200 text-gray-800 rounded-lg font-medium hover:bg-gray-300 transition"
              >
                Back
              </button>
              <button
                type="submit"
                disabled={createMutation.isPending || !electionName.trim() || !yourName.trim()}
                className="flex-1 py-3 px-4 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50"
              >
                {createMutation.isPending ? 'Creating...' : 'Create'}
              </button>
            </div>
          </form>
        )}

        {mode === 'join' && (
          <form onSubmit={handleJoin} className="space-y-4">
            <div>
              <label htmlFor="join-code" className="block text-sm font-medium mb-1">
                Meeting Code
              </label>
              <input
                id="join-code"
                type="text"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                placeholder="ABC123"
                maxLength={6}
                className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent uppercase text-center text-2xl tracking-widest"
                autoFocus
              />
            </div>
            <div>
              <label htmlFor="your-name-join" className="block text-sm font-medium mb-1">
                Your Name
              </label>
              <input
                id="your-name-join"
                type="text"
                value={yourName}
                onChange={(e) => setYourName(e.target.value)}
                placeholder="Enter your name"
                className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            {error && <p role="alert" className="text-red-600 text-sm">{error}</p>}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={resetForm}
                className="flex-1 py-3 px-4 bg-gray-200 text-gray-800 rounded-lg font-medium hover:bg-gray-300 transition"
              >
                Back
              </button>
              <button
                type="submit"
                disabled={joinMutation.isPending || !yourName.trim() || joinCode.length !== 6}
                className="flex-1 py-3 px-4 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50"
              >
                {joinMutation.isPending ? 'Joining...' : 'Join'}
              </button>
            </div>
          </form>
        )}
      </div>

      <div className="w-full max-w-md mt-12 pt-6 border-t border-gray-200">
        <h2 className="text-sm font-medium text-gray-500 mb-4">Guidance & Resources</h2>

        <div className="space-y-4 text-sm">
          <div>
            <h3 className="font-medium text-gray-700 mb-1">Bahá&apos;í World Centre</h3>
            <ul className="list-disc list-inside space-y-1 text-gray-600 ml-1">
              <li>
                <a
                  href="https://www.bahai.org/library/authoritative-texts/compilations/sanctity-nature-bahai-elections/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:text-blue-800 hover:underline"
                >
                  The Sanctity and Nature of Bahá&apos;í Elections
                </a>
                <span className="text-gray-400 ml-1">(compilation)</span>
              </li>
              <li>
                <a
                  href="https://www.bahai.org/documents/the-universal-house-of-justice/regional-bahai-councils"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:text-blue-800 hover:underline"
                >
                  Regional Bahá&apos;í Councils
                </a>
                <span className="text-gray-400 ml-1">(1997)</span>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="font-medium text-gray-700 mb-1">US National Spiritual Assembly</h3>
            <ul className="list-disc list-inside space-y-1 text-gray-600 ml-1">
              <li>
                <a
                  href="https://www.bahai.us/community/glsa"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:text-blue-800 hover:underline"
                >
                  Guidelines for Local Spiritual Assemblies
                </a>
                <span className="text-gray-400 ml-1">(login required)</span>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="font-medium text-gray-700 mb-1">TallyJ Election App</h3>
            <ul className="list-disc list-inside space-y-1 text-gray-600 ml-1">
              <li>
                <a
                  href="https://officers.tallyj.com/guidance"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:text-blue-800 hover:underline"
                >
                  Officer Election Guidance
                </a>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
