import Link from 'next/link';

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8">
      <h1 className="text-3xl font-bold mb-4">Welcome to GrokPad</h1>
      <p className="mb-6 text-center max-w-md">
        This is a proof‑of‑concept token launch platform inspired by Pump.fun.  All
        tokens created here end with <code>grok</code> in both their name and
        mint address.  Use the form below to launch your own meme token!
      </p>
      <Link href="/create" className="bg-blue-600 text-white px-4 py-2 rounded">
        Create a Token
      </Link>
    </main>
  );
}