const anchor = require('@coral-xyz/anchor');
const { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } = require('@solana/web3.js');
const { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } = require('@solana/spl-token');
const { PROGRAM_ID } = require('./config');

// Get the mint address from command line
const mintAddress = process.argv[2];
if (!mintAddress) {
  console.error("Please provide a mint address as argument");
  process.exit(1);
}

// Set up the provider
const provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);

// Load the IDL
const idl = require('../target/idl/grokpad.json');
const programId = PROGRAM_ID;
const program = new anchor.Program(idl, programId, provider);

async function main() {
  try {
    const mint = new PublicKey(mintAddress);
    console.log("Using mint:", mint.toString());
    
    // Derive PDAs
    const [authorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("launch"), mint.toBuffer()], 
      programId
    );
    console.log('Authority PDA:', authorityPda.toString());
    
    const [statePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("launch_state"), mint.toBuffer()],
      programId
    );
    console.log('State PDA:', statePda.toString());
    
    const [vaultSolPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_sol"), mint.toBuffer()],
      programId
    );
    console.log('Vault SOL PDA:', vaultSolPda.toString());
    
    // Get vault ATA
    const vaultAta = await anchor.utils.token.associatedAddress({
      mint: mint,
      owner: authorityPda
    });
    console.log('Vault ATA:', vaultAta.toString());
    
    // Launch parameters
    const basePriceLamports = new anchor.BN(1_000_000); // 0.001 SOL base price
    const slopeLamports = new anchor.BN(100_000); // 0.0001 SOL per token price increase
    const feeBps = 300; // 3.00% platform fee
    const creatorFeeBps = 100; // 1.00% creator fee
    const graduationTargetLamports = new anchor.BN(2 * 1_000_000_000); // 2 SOL graduation target
    
    console.log("Initializing launch...");
    const tx = await program.methods
      .initializeLaunch(
        basePriceLamports,
        slopeLamports,
        feeBps,
        creatorFeeBps,
        graduationTargetLamports
      )
      .accounts({
        payer: provider.wallet.publicKey,
        creator: provider.wallet.publicKey,
        platformFeeRecipient: provider.wallet.publicKey,
        mint: mint,
        authorityPda: authorityPda,
        statePda: statePda,
        vaultSolPda: vaultSolPda,
        vaultAta: vaultAta,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        rent: SYSVAR_RENT_PUBKEY
      })
      .rpc();
    
    console.log("Launch initialized! Transaction signature:", tx);
    
    // Get the state account
    const state = await program.account.launchState.fetch(statePda);
    console.log("Launch state:", {
      basePriceLamports: state.basePriceLamports.toString(),
      slopeLamports: state.slopeLamports.toString(),
      feeBps: state.feeBps,
      creatorFeeBps: state.creatorFeeBps,
      tokensSold: state.tokensSold.toString(),
      reservesLamports: state.reservesLamports.toString()
    });
    
  } catch (error) {
    console.error("Error:", error);
    if (error.logs) {
      console.error("Program logs:", error.logs);
    }
  }
}

main();
