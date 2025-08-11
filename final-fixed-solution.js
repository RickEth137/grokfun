/**
 * final-fixed-solution.js - Using exact initialization parameters from test-fixed.js
 */
const { 
  Connection, 
  PublicKey, 
  Keypair,
  SystemProgram, 
  SYSVAR_RENT_PUBKEY,
  Transaction,
  sendAndConfirmTransaction
} = require('@solana/web3.js');
const { 
  TOKEN_PROGRAM_ID, 
  ASSOCIATED_TOKEN_PROGRAM_ID, 
  getOrCreateAssociatedTokenAccount,
  createMint,
  mintTo
} = require('@solana/spl-token');
const fs = require('fs');
const path = require('path');
const { PROGRAM_ID: CONFIG_PROGRAM_ID } = require('./config');

// Connect to local Solana node
const connection = new Connection('http://localhost:8899', 'confirmed');

// Load wallet
const walletPath = process.env.ANCHOR_WALLET || path.join(process.env.HOME, '.config', 'solana', 'id.json');
const secretKeyString = fs.readFileSync(walletPath, { encoding: 'utf8' });
const secretKey = Uint8Array.from(JSON.parse(secretKeyString));
const wallet = Keypair.fromSecretKey(secretKey);

// Program ID - use from config to ensure consistency
const PROGRAM_ID = CONFIG_PROGRAM_ID;

// Use EXACT discriminators from test-fixed.js
const DISCRIMINATOR_INITIALIZE = Buffer.from([30, 120, 39, 212, 120, 168, 29, 81]); // anchor.sighash("global:initializeLaunch")
const DISCRIMINATOR_BUY = Buffer.from([103, 17, 200, 25, 118, 95, 125, 61]); // anchor.sighash("global:buy")

async function main() {
  console.log("=== FINAL BONDING CURVE INITIALIZATION ===");
  console.log("Program ID:", PROGRAM_ID.toString());
  console.log("Wallet:", wallet.publicKey.toString());
  
  // Create new mint or use existing
  const USE_EXISTING_MINT = false; // Set to true to use an existing mint
  const EXISTING_MINT = "FF5Khx5KBpyZKurFM4zUe2L4C7FWzAAZ92sP7mEWqvCJ"; // From test-fixed.js
  
  let mint;
  if (USE_EXISTING_MINT) {
    mint = new PublicKey(EXISTING_MINT);
    console.log('Using existing mint:', mint.toString());
  } else {
    console.log("\nCreating new mint...");
    mint = await createMint(
      connection,
      wallet,
      wallet.publicKey,
      null,
      9
    );
    console.log("Mint created:", mint.toString());
  }
  
  // Derive PDAs - EXACT SAME as test-fixed.js
  const [authorityPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("launch"), mint.toBuffer()], 
    PROGRAM_ID
  );
  console.log("Authority PDA:", authorityPda.toString());
  
  const [statePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("launch_state"), mint.toBuffer()],
    PROGRAM_ID
  );
  console.log("State PDA:", statePda.toString());
  
  const [vaultSolPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_sol"), mint.toBuffer()],
    PROGRAM_ID
  );
  console.log("Vault SOL PDA:", vaultSolPda.toString());
  
  // Create vault ATA
  console.log("\nCreating vault ATA...");
  const vaultAta = await getOrCreateAssociatedTokenAccount(
    connection,
    wallet,
    mint,
    authorityPda,
    true
  );
  console.log("Vault ATA:", vaultAta.address.toString());
  
  // Mint initial supply if using new mint
  if (!USE_EXISTING_MINT) {
    console.log('\nMinting initial supply...');
    await mintTo(
      connection,
      wallet,
      mint,
      vaultAta.address,
      wallet.publicKey,
      1000000000000 // 1000 tokens with 9 decimals - EXACT SAME as test-fixed.js
    );
    console.log('Initial supply minted');
  }
  
  // Check if state account already exists
  const stateInfo = await connection.getAccountInfo(statePda);
  
  if (stateInfo) {
    console.log('State account exists with size:', stateInfo.data.length);
    console.log('Launch is already initialized.');
    
    // Save the successful setup info
    const config = {
      programId: PROGRAM_ID.toString(),
      mint: mint.toString(),
      authorityPda: authorityPda.toString(),
      statePda: statePda.toString(),
      vaultSolPda: vaultSolPda.toString(),
      vaultAta: vaultAta.address.toString(),
      discriminator: Array.from(DISCRIMINATOR_INITIALIZE),
      timestamp: new Date().toISOString(),
      status: "Already initialized"
    };
    
    fs.writeFileSync('successful-setup.json', JSON.stringify(config, null, 2));
    console.log("Config saved to successful-setup.json");
    
    return true;
  }
  
  try {
    // Initialize launch parameters - EXACT SAME as test-fixed.js
    const basePriceLamports = 1_000_000; // 0.001 SOL
    const slopeLamports = 100_000; // 0.0001 SOL per token
    const feeBps = 300; // 3.00%
    const creatorFeeBps = 100; // 1.00%
    const graduationTargetLamports = 2 * 1_000_000_000; // 2 SOL
    
    // Construct initialization data - EXACTLY as test-fixed.js does it
    const initData = Buffer.alloc(8 + 8 + 8 + 2 + 2 + 8);
    
    // Write discriminator
    DISCRIMINATOR_INITIALIZE.copy(initData, 0);
    
    // Write params
    let offset = 8;
    initData.writeBigUInt64LE(BigInt(basePriceLamports), offset); offset += 8;
    initData.writeBigUInt64LE(BigInt(slopeLamports), offset); offset += 8;
    initData.writeUInt16LE(feeBps, offset); offset += 2;
    initData.writeUInt16LE(creatorFeeBps, offset); offset += 2;
    initData.writeBigUInt64LE(BigInt(graduationTargetLamports), offset);
    
    // Create instruction - EXACTLY as test-fixed.js does it
    const initIx = {
      programId: PROGRAM_ID,
      keys: [
        { pubkey: wallet.publicKey, isSigner: true, isWritable: true }, // payer
        { pubkey: wallet.publicKey, isSigner: false, isWritable: false }, // creator
        { pubkey: wallet.publicKey, isSigner: false, isWritable: false }, // platform_fee_recipient
        { pubkey: mint, isSigner: false, isWritable: false }, // mint
        { pubkey: authorityPda, isSigner: false, isWritable: false }, // authority_pda
        { pubkey: statePda, isSigner: false, isWritable: true }, // state_pda
        { pubkey: vaultSolPda, isSigner: false, isWritable: true }, // vault_sol_pda
        { pubkey: vaultAta.address, isSigner: false, isWritable: true }, // vault_ata
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // system_program
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // token_program
        { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // associated_token_program
        { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false } // rent
      ],
      data: initData
    };
    
    // Send transaction
    console.log('Sending initialization transaction...');
    const initTx = new Transaction().add(initIx);
    const initSig = await sendAndConfirmTransaction(
      connection, 
      initTx, 
      [wallet], 
      { commitment: 'confirmed', skipPreflight: true }
    );
    console.log('Initialization transaction sent! Signature:', initSig);
    
    // Verify state account
    console.log("\nVerifying state account...");
    const stateAccount = await connection.getAccountInfo(statePda);
    if (!stateAccount) {
      console.log("❌ State account not created!");
      return false;
    } else {
      console.log("✅ State account created with size:", stateAccount.data.length, "bytes");
    }
    
    // Check vault ownership
    console.log("\nVerifying vault SOL PDA ownership...");
    const vaultAccount = await connection.getAccountInfo(vaultSolPda);
    if (!vaultAccount) {
      console.log("❌ Vault account not created!");
      return false;
    }
    
    console.log("Vault SOL PDA owner:", vaultAccount.owner.toString());
    console.log("Vault SOL PDA lamports:", vaultAccount.lamports);
    
    if (vaultAccount.owner.equals(SystemProgram.programId)) {
      console.log("✅ Vault SOL PDA correctly owned by System Program!");
    } else {
      console.log("⚠️ Unexpected vault owner:", vaultAccount.owner.toString());
    }
    
    // Save the successful config
    const config = {
      programId: PROGRAM_ID.toString(),
      mint: mint.toString(),
      authorityPda: authorityPda.toString(),
      statePda: statePda.toString(),
      vaultSolPda: vaultSolPda.toString(),
      vaultAta: vaultAta.address.toString(),
      discriminator: Array.from(DISCRIMINATOR_INITIALIZE),
      signature: initSig,
      timestamp: new Date().toISOString()
    };
    
    fs.writeFileSync('successful-setup.json', JSON.stringify(config, null, 2));
    console.log("\nConfig saved to successful-setup.json");
    
    return true;
  } catch (error) {
    console.log("\n❌ Initialization failed:");
    console.log("Error:", error.message);
    
    // Try to get detailed logs
    try {
      const logs = await connection.getTransaction(error.signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0
      });
      if (logs && logs.meta && logs.meta.logMessages) {
        console.log("\nDetailed logs:");
        logs.meta.logMessages.forEach(log => console.log("  " + log));
      }
    } catch (logError) {
      console.log("Could not fetch detailed logs:", logError.message);
      if (error.logs) {
        console.log("\nTransaction logs:");
        error.logs
          .filter(log => log.includes("Program log:") || log.includes("Program failed"))
          .forEach(log => console.log("  " + log));
      }
    }
    
    return false;
  }
}

// Run the main function
main()
  .then(success => {
    if (success) {
      console.log("\n✅ Bonding curve initialized successfully!");
      process.exit(0);
    } else {
      console.log("\n❌ Failed to initialize bonding curve.");
      process.exit(1);
    }
  })
  .catch(err => {
    console.error("\nUnhandled error:", err);
    process.exit(1);
  });
