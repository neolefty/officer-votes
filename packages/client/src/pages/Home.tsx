import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { trpc, setToken } from '../trpc';

export default function Home() {
  const [electionName, setElectionName] = useState('');
  const [yourName, setYourName] = useState('');
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
    createMutation.mutate({ name: electionName.trim(), tellerName: yourName.trim() });
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
              Create New Election
            </button>
            <button
              onClick={() => setMode('join')}
              className="w-full py-3 px-4 bg-gray-200 text-gray-800 rounded-lg font-medium hover:bg-gray-300 transition"
            >
              Join Existing Election
            </button>
          </div>
        )}

        {mode === 'create' && (
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label htmlFor="election-name" className="block text-sm font-medium mb-1">
                Election Name
              </label>
              <input
                id="election-name"
                type="text"
                value={electionName}
                onChange={(e) => setElectionName(e.target.value)}
                placeholder="e.g., Local Spiritual Assembly 2024"
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
                Election Code
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
    </div>
  );
}
