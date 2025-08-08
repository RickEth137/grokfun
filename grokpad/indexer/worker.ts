// Placeholder indexer worker for GrokPad.  This file illustrates how
// you might set up an indexer that listens to program events using
// the Anchor client.  It is not functional as written and should be
// extended to suit your needs.

import { AnchorProvider, Program, Idl } from '@project-serum/anchor';
import { Connection, PublicKey } from '@solana/web3.js';

// Load IDL and program ID.  You will need to compile your Anchor
// program and generate the IDL JSON before this will work.
import idl from '../programs/grokpad/target/idl/grokpad.json';
const programId = new PublicKey('GrokPad11111111111111111111111111111111');

async function main() {
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  const provider = new AnchorProvider(connection, undefined as any, {});
  const program = new Program(idl as Idl, programId, provider);

  // TODO: set up listeners for accounts/events
  // Example: subscribe to all Launch accounts and log their sold amounts.
  const launchAccounts = await program.account.launch.all();
  console.log('Found', launchAccounts.length, 'launches');
  launchAccounts.forEach((acc) => {
    console.log(acc.publicKey.toBase58(), acc.account.sold.toString());
  });
}

main().catch((err) => {
  console.error(err);
});