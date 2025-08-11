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

// Amount to buy (in token units)
const amountToBuy = new anchor.BN(5_000_000); // 5 tokens (assuming 6 decimals)
const maxCostLamports = new anchor.BN(10_000_000_000); // 10 SOL (max willing to pay)

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
    
    const [statePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("launch_state"), mint.toBuffer()],
      programId
    );
    
    const [vaultSolPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_sol"), mint.toBuffer()],
      programId
    );
    
    // Get vault ATA
    const vaultAta = await anchor.utils.token.associatedAddress({
      mint: mint,
      owner: authorityPda
    });
    
    // Get buyer ATA
    const buyerAta = await anchor.utils.token.associatedAddress({
      mint: mint,
      owner: provider.wallet.publicKey
    });
    
    console.log("Buying tokens...");
    console.log("Amount:", amountToBuy.toString());
    console.log("Max cost:", maxCostLamports.toString(), "lamports");
    
    const tx = await program.methods
      .buy(
        amountToBuy,
        maxCostLamports
      )
      .accounts({
        buyer: provider.wallet.publicKey,
        mint: mint,
        statePda: statePda,
        authorityPda: authorityPda,
        vaultSolPda: vaultSolPda,
        vaultAta: vaultAta,
        buyerAta: buyerAta,
        platformFeeRecipient: provider.wallet.publicKey,
        creator: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        rent: SYSVAR_RENT_PUBKEY
      })
      .rpc();
    
    console.log("Buy transaction successful! Signature:", tx);
    
    // Get the state account after purchase
    const state = await program.account.launchState.fetch(statePda);
    console.log("Updated launch state:", {
      tokensSold: state.tokensSold.toString(),
      reservesLamports: state.reservesLamports.toString(),
      platformFeeAccrued: state.platformFeeAccrued.toString(),
      creatorFeeAccrued: state.creatorFeeAccrued.toString()
    });
    
  } catch (error) {
    console.error("Error:", error);
    if (error.logs) {
      console.error("Program logs:", error.logs);
    }
  }
}

main();
