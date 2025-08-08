import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';

export default function TokenPage() {
  const router = useRouter();
  const { mint } = router.query;
  const [progress, setProgress] = useState(0);

  // Simulate progress updates for demonstration.
  useEffect(() => {
    const interval = setInterval(() => {
      setProgress((p) => (p < 100 ? p + 1 : 100));
    }, 100);
    return () => clearInterval(interval);
  }, []);

  return (
    <main className="min-h-screen p-8">
      <h1 className="text-2xl font-bold mb-2">Token {mint}</h1>
      <p className="mb-4">Bonding curve progress: {progress}%</p>
      <div className="w-full h-4 bg-gray-200 rounded">
        <div
          className="h-4 bg-blue-500 rounded"
          style={{ width: `${progress}%` }}
        ></div>
      </div>
      <p className="mt-4 text-sm text-gray-600">This is a placeholder page.  In the final
        implementation it will display live price, buy and sell panels, recent
        trades and other analytics.</p>
    </main>
  );
}