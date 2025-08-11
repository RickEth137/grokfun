/**
 * ultimate-fix-solution.js - Final attempt integrating all discovered fixes
 */
const { 
  Connection, 
  PublicKey, 
  Keypair,
  SystemProgram, 
  SYSVAR_RENT_PUBKEY,
  Transaction,
  sendAndConfirmTransaction,
  TransactionInstruction,
  LAMPORTS_PER_SOL
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

// Connect to local Solana node
const connection = new Connection('http://localhost:8899', 'confirmed');

// Load wallet
const walletPath = process.env.ANCHOR_WALLET || path.join(process.env.HOME, '.config', 'solana', 'id.json');
const secretKeyString = fs.readFileSync(walletPath, { encoding: 'utf8' });
const secretKey = Uint8Array.from(JSON.parse(secretKeyString));
const wallet = Keypair.fromSecretKey(secretKey);

// Program ID
const PROGRAM_ID = new PublicKey('CYUSvq2vmNZ4rcyhfKyfaTKvfeH3doxyqx69ifV3w3TP');

// Known working discriminator from test-fixed.js
const INITIALIZE_DISCRIMINATOR = Buffer.from([30, 120, 39, 212, 120, 168, 29, 81]);

async function main() {
  console.log("=== ULTIMATE BONDING CURVE INITIALIZATION FIX ===");
  console.log("Program ID:", PROGRAM_ID.toString());
  console.log("Wallet:", wallet.publicKey.toString());
  
  // Create new mint
  console.log("\nCreating new mint...");
  const mint = await createMint(
    connection,
    wallet,
    wallet.publicKey,
    null,
    9 // 9 decimals - ensure this matches what the contract expects
  );
  console.log("Mint created:", mint.toString());
  
  // Derive PDAs
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
    authorityPda, // Owner is the authority PDA
    true // Allow off-curve
  );
  console.log("Vault ATA:", vaultAta.address.toString());
  
  // Mint initial supply to vault
  console.log("\nMinting initial supply to vault...");
  const initialSupply = 1_000_000_000_000; // 1000 tokens with 9 decimals
  await mintTo(
    connection,
    wallet,
    mint,
    vaultAta.address,
    wallet.publicKey,
    initialSupply
  );
  console.log(`Minted ${initialSupply} tokens to vault`);
  
  // Pre-create and fund the vault SOL PDA to ensure it's system-owned
  console.log("\nPre-creating and funding vault SOL PDA...");
  
  const vaultSolAccount = await connection.getAccountInfo(vaultSolPda);
  if (!vaultSolAccount) {
    const fundVaultIx = SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: vaultSolPda,
      lamports: 10_000_000 // Transfer 0.01 SOL to ensure it's well-funded
    });
    
    const fundTx = new Transaction().add(fundVaultIx);
    const fundSig = await sendAndConfirmTransaction(
      connection,
      fundTx,
      [wallet],
      { commitment: 'confirmed' }
    );
    console.log("Vault SOL PDA funded:", fundSig);
    
    // Verify the vault account exists and is system-owned
    const vaultAccountAfterFunding = await connection.getAccountInfo(vaultSolPda);
    if (vaultAccountAfterFunding) {
      console.log("Vault SOL PDA owner:", vaultAccountAfterFunding.owner.toString());
      console.log("Vault SOL PDA balance:", vaultAccountAfterFunding.lamports, "lamports");
      
      if (!vaultAccountAfterFunding.owner.equals(SystemProgram.programId)) {
        console.log("❌ Vault SOL PDA is not owned by System Program!");
        return false;
      }
    } else {
      console.log("❌ Vault SOL PDA was not created!");
      return false;
    }
  } else {
    console.log("Vault SOL PDA already exists with owner:", vaultSolAccount.owner.toString());
    console.log("Vault SOL PDA balance:", vaultSolAccount.lamports, "lamports");
    
    if (!vaultSolAccount.owner.equals(SystemProgram.programId)) {
      console.log("❌ Vault SOL PDA is not owned by System Program!");
      return false;
    }
  }
  
  try {
    // Initialize launch parameters - EXACT values from test-fixed.js
    const basePriceLamports = 1_000_000; // 0.001 SOL
    const slopeLamports = 100_000; // 0.0001 SOL per token
    const feeBps = 300; // 3.00%
    const creatorFeeBps = 100; // 1.00%
    const graduationTargetLamports = 2 * 1_000_000_000; // 2 SOL
    
    // Construct initialization data with KNOWN working discriminator
    const initData = Buffer.alloc(8 + 8 + 8 + 2 + 2 + 8);
    INITIALIZE_DISCRIMINATOR.copy(initData, 0);
    
    // Write parameters EXACTLY as in test-fixed.js
    let offset = 8;
    initData.writeBigUInt64LE(BigInt(basePriceLamports), offset); offset += 8;
    initData.writeBigUInt64LE(BigInt(slopeLamports), offset); offset += 8;
    initData.writeUInt16LE(feeBps, offset); offset += 2;
    initData.writeUInt16LE(creatorFeeBps, offset); offset += 2;
    initData.writeBigUInt64LE(BigInt(graduationTargetLamports), offset);
    
    // Create initialization instruction with EXACT same account structure as in test-fixed.js
    const initIx = new TransactionInstruction({
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
    });
    
    // Send transaction with SKIP_PREFLIGHT to avoid client-side validation
    console.log('\nSending initialization transaction...');
    const initTx = new Transaction().add(initIx);
    
    const initSig = await sendAndConfirmTransaction(
      connection, 
      initTx, 
      [wallet], 
      { commitment: 'confirmed', skipPreflight: true }
    );
    
    console.log("\n✅ SUCCESS! Transaction signature:", initSig);
    
    // Verify state account
    console.log("\nVerifying state account...");
    const stateAccount = await connection.getAccountInfo(statePda);
    if (!stateAccount) {
      console.log("❌ State account not created!");
    } else {
      console.log("✅ State account created with size:", stateAccount.data.length, "bytes");
      console.log("State account owner:", stateAccount.owner.toString());
    }
    
    // Check vault SOL PDA
    console.log("\nVerifying vault SOL PDA...");
    const vaultAfterInit = await connection.getAccountInfo(vaultSolPda);
    console.log("Vault SOL PDA owner:", vaultAfterInit.owner.toString());
    console.log("Vault SOL PDA balance:", vaultAfterInit.lamports, "lamports");
    
    // Save the successful setup
    const config = {
      programId: PROGRAM_ID.toString(),
      mint: mint.toString(),
      authorityPda: authorityPda.toString(),
      statePda: statePda.toString(),
      vaultSolPda: vaultSolPda.toString(),
      vaultAta: vaultAta.address.toString(),
      discriminator: Array.from(INITIALIZE_DISCRIMINATOR),
      parameters: {
        basePriceLamports,
        slopeLamports,
        feeBps,
        creatorFeeBps,
        graduationTargetLamports
      },
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
    if (error.logs) {
      console.log("\nProgram logs:");
      error.logs
        .filter(log => log.includes("Program log:") || log.includes("Program failed"))
        .forEach(log => console.log("  " + log));
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
