// ~/Desktop/fun.grok/vanity/vanity-mint.mjs
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import fs from 'fs';
import os from 'os';
import path from 'path';

const SUFFIX = 'grok';           // lowercase, as requested
const OUTDIR = path.join(os.homedir(), 'Desktop', 'fun.grok', 'mints');
fs.mkdirSync(OUTDIR, { recursive: true });

let tries = 0;
let start = Date.now();

function saveKeypair(kp) {
  const outPath = path.join(OUTDIR, `${kp.publicKey.toBase58()}.json`);
  // Solana CLI accepts a raw 64-byte secret key JSON array
  fs.writeFileSync(outPath, JSON.stringify(Array.from(kp.secretKey)));
  return outPath;
}

function logRate() {
  const secs = (Date.now() - start) / 1000;
  const rate = (tries / Math.max(secs, 0.001)).toFixed(0);
  process.stdout.write(`\rTried: ${tries.toLocaleString()} | ~${rate}/sec`);
}

(function grind() {
  const timer = setInterval(logRate, 500);
  while (true) {
    const kp = Keypair.generate();
    const pub = kp.publicKey.toBase58();
    tries++;
    if (pub.endsWith(SUFFIX)) {
      clearInterval(timer);
      logRate();
      console.log(`\nFOUND: ${pub}`);
      const file = saveKeypair(kp);
      console.log(`Saved keypair: ${file}`);
      process.exit(0);
    }
  }
})();

