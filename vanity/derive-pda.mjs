import { PublicKey } from '@solana/web3.js';

const pid  = new PublicKey(process.env.PROGRAM_ID.trim());
const mint = new PublicKey(process.env.MINT.trim());

const [pda] = PublicKey.findProgramAddressSync(
  [Buffer.from('launch'), mint.toBuffer()],
  pid
);

console.log(pda.toBase58());
