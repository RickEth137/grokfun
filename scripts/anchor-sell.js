const anchor = require('@coral-xyz/anchor');
const { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } = require('@solana/web3.js');
const { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAccount } = require('@solana/spl-token');
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
    
    // Get seller ATA
    const sellerAta = await anchor.utils.token.associatedAddress({
      mint: mint,
      owner: provider.wallet.publicKey
    });
    
    // Get current token balance
    const connection = provider.connection;
    const tokenAccount = await getAccount(connection, sellerAta);
    console.log("Current token balance:", tokenAccount.amount.toString());
    
    // Calculate amount to sell (half of current balance)
    const sellAmount = new anchor.BN(Math.floor(Number(tokenAccount.amount) / 2));
    const minPayoutLamports = new anchor.BN(100_000); // 0.0001 SOL minimum payout
    
    if (sellAmount.lte(new anchor.BN(0))) {
      console.log("No tokens to sell");
      return;
    }
    
    console.log("Selling tokens...");
    console.log("Amount to sell:", sellAmount.toString());
    console.log("Min payout:", minPayoutLamports.toString(), "lamports");
    
    const tx = await program.methods
      .sell(
        sellAmount,
        minPayoutLamports
      )
      .accounts({
        seller: provider.wallet.publicKey,
        mint: mint,
        statePda: statePda,
        authorityPda: authorityPda,
        vaultSolPda: vaultSolPda,
        vaultAta: vaultAta,
        sellerAta: sellerAta,
        platformFeeRecipient: provider.wallet.publicKey,
        creator: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        rent: SYSVAR_RENT_PUBKEY
      })
      .rpc();
    
    console.log("Sell transaction successful! Signature:", tx);
    
    // Get the state account after sale
    const state = await program.account.launchState.fetch(statePda);
    console.log("Updated launch state:", {
      tokensSold: state.tokensSold.toString(),
      reservesLamports: state.reservesLamports.toString(),
      platformFeeAccrued: state.platformFeeAccrued.toString(),
      creatorFeeAccrued: state.creatorFeeAccrued.toString()
    });
    
    // Check new token balance
    const newTokenAccount = await getAccount(connection, sellerAta);
    console.log("New token balance:", newTokenAccount.amount.toString());
    
  } catch (error) {
    console.error("Error:", error);
    if (error.logs) {
      console.error("Program logs:", error.logs);
    }
  }
}

main();
