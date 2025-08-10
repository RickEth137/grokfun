/**
 * fixed-ownership-discriminator-solution.js - Using the correctly computed discriminator and fixing vault ownership
 */
const { 
  Connection, 
  PublicKey, 
  Keypair,
  SystemProgram, 
  SYSVAR_RENT_PUBKEY,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
  TransactionInstruction
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

// CORRECTLY computed discriminator for initialize_launch
// This is SHA-256("global:initialize_launch")[0:8]
const DISCRIMINATOR_INITIALIZE = Buffer.from([90, 201, 220, 142, 112, 253, 100, 13]);

// Helper function to check if an account exists
async function accountExists(pubkey) {
  const account = await connection.getAccountInfo(pubkey);
  return account !== null;
}

async function main() {
  console.log("=== BONDING CURVE INITIALIZATION WITH CORRECT DISCRIMINATOR ===");
  console.log("Program ID:", PROGRAM_ID.toString());
  console.log("Wallet:", wallet.publicKey.toString());
  
  // Get wallet balance
  const balance = await connection.getBalance(wallet.publicKey);
  console.log(`Wallet balance: ${balance / LAMPORTS_PER_SOL} SOL`);
  
  // Create new mint
  console.log("\nCreating new mint...");
  const mint = await createMint(
    connection,
    wallet,
    wallet.publicKey,
    null,
    9
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
    authorityPda,
    true
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
  
  try {
    // Important: Check if the vault SOL PDA needs to be created
    // It should be a system-owned account
    const vaultExists = await accountExists(vaultSolPda);
    
    if (!vaultExists) {
      console.log("\nCreating vault SOL PDA as system-owned account...");
      // Create a transaction to allocate space for the vault SOL PDA
      // This ensures it's owned by the System Program
      const createVaultIx = SystemProgram.createAccountWithSeed({
        fromPubkey: wallet.publicKey,
        newAccountPubkey: vaultSolPda,
        basePubkey: wallet.publicKey,
        seed: "vault_sol_" + mint.toString().substring(0, 8),
        lamports: await connection.getMinimumBalanceForRentExemption(0),
        space: 0,
        programId: SystemProgram.programId
      });
      
      // Send the create vault transaction
      try {
        const createVaultTx = new Transaction().add(createVaultIx);
        const vaultSig = await sendAndConfirmTransaction(
          connection,
          createVaultTx,
          [wallet]
        );
        console.log("✅ Vault SOL PDA created! Signature:", vaultSig);
      } catch (error) {
        // If this fails, it might be because the account already exists or is a PDA
        // We can proceed anyway and let the program handle it
        console.log("Note: Could not explicitly create vault SOL PDA, but this might be normal if it's a proper PDA");
        console.log("Error:", error.message);
      }
    } else {
      console.log("Vault SOL PDA already exists");
    }
    
    console.log("\nInitializing bonding curve with correct discriminator...");
    console.log(`Using discriminator: [${Array.from(DISCRIMINATOR_INITIALIZE)}]`);
    
    // Initialize launch parameters - same as in lib.rs
    const basePriceLamports = 1_000_000; // 0.001 SOL
    const slopeLamports = 100_000; // 0.0001 SOL per token
    const feeBps = 300; // 3.00%
    const creatorFeeBps = 100; // 1.00%
    const graduationTargetLamports = 2 * 1_000_000_000; // 2 SOL
    
    // Construct initialization data with CORRECT discriminator
    const initData = Buffer.alloc(8 + 8 + 8 + 2 + 2 + 8); // 8 bytes for each u64, 2 bytes for each u16
    DISCRIMINATOR_INITIALIZE.copy(initData, 0);
    
    // Write parameters in the exact order as defined in lib.rs
    let offset = 8; // Start after discriminator
    initData.writeBigUInt64LE(BigInt(basePriceLamports), offset); offset += 8;
    initData.writeBigUInt64LE(BigInt(slopeLamports), offset); offset += 8;
    initData.writeUInt16LE(feeBps, offset); offset += 2;
    initData.writeUInt16LE(creatorFeeBps, offset); offset += 2;
    initData.writeBigUInt64LE(BigInt(graduationTargetLamports), offset);
    
    // Create initialization instruction with account structure from lib.rs
    const initIx = {
      programId: PROGRAM_ID,
      keys: [
        { pubkey: wallet.publicKey, isSigner: true, isWritable: true }, // payer
        { pubkey: wallet.publicKey, isSigner: false, isWritable: false }, // creator
        { pubkey: wallet.publicKey, isSigner: false, isWritable: false }, // platform_fee_recipient
        { pubkey: mint, isSigner: false, isWritable: false }, // mint
        { pubkey: authorityPda, isSigner: false, isWritable: false }, // authority_pda
        { pubkey: statePda, isSigner: false, isWritable: true }, // state_pda
        { pubkey: vaultSolPda, isSigner: false, isWritable: true }, // vault_sol_pda - must be system-owned
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
    
    console.log("\n✅ SUCCESS! Initialization successful!");
    console.log(`Transaction signature: ${initSig}`);
    
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
    } else {
      console.log("Vault SOL PDA owner:", vaultAccount.owner.toString());
      console.log("Vault SOL PDA lamports:", vaultAccount.lamports);
      
      if (vaultAccount.owner.equals(SystemProgram.programId)) {
        console.log("✅ Vault SOL PDA correctly owned by System Program!");
      } else {
        console.log("⚠️ Unexpected vault owner:", vaultAccount.owner.toString());
      }
    }
    
    // Save the successful setup
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
