import { useState } from 'react';
import { useRouter } from 'next/router';

export default function Create() {
  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [status, setStatus] = useState('');
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Ensure the name ends with "grok".  If not, append it automatically.
    let finalName = name;
    if (!finalName.toLowerCase().endsWith('grok')) {
      finalName = `${finalName}grok`;
    }
    setStatus('Generating vanity mint and deploying...');
    // In a full implementation this would call the vanity API and
    // Anchor program to initialize a launch.  Here we simply wait a
    // moment and navigate to a placeholder token page.
    await new Promise((res) => setTimeout(res, 2000));
    setStatus('Done! Redirecting...');
    router.push('/');
  };

  return (
    <main className="min-h-screen flex flex-col items-center p-8">
      <h1 className="text-2xl font-semibold mb-4">Create a Grok Token</h1>
      <form onSubmit={handleSubmit} className="w-full max-w-md flex flex-col gap-4">
        <label className="flex flex-col">
          <span className="mb-1">Token Name (must end with grok)</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="border p-2 rounded"
            required
          />
        </label>
        <label className="flex flex-col">
          <span className="mb-1">Token Symbol</span>
          <input
            type="text"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            className="border p-2 rounded"
            required
          />
        </label>
        <button type="submit" className="bg-green-600 text-white px-4 py-2 rounded">
          Launch Token
        </button>
      </form>
      {status && <p className="mt-4 text-sm text-gray-600">{status}</p>}
    </main>
  );
}