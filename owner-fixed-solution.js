/**
 * owner-fixed-solution.js - Fixed ownership solution for bonding curve initialization
 * 
 * This script modifies our approach to ensure the vault account has the correct ownership.
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
  ComputeBudgetProgram
} = require('@solana/web3.js');
const { 
  TOKEN_PROGRAM_ID, 
  ASSOCIATED_TOKEN_PROGRAM_ID, 
  getOrCreateAssociatedTokenAccount,
  createMint,
  getAccount
} = require('@solana/spl-token');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Connect to local Solana node
const connection = new Connection('http://localhost:8899', 'confirmed');

// Load wallet
const walletPath = process.env.ANCHOR_WALLET || path.join(process.env.HOME, '.config', 'solana', 'id.json');
const secretKeyString = fs.readFileSync(walletPath, { encoding: 'utf8' });
const secretKey = Uint8Array.from(JSON.parse(secretKeyString));
const wallet = Keypair.fromSecretKey(secretKey);

// Program ID
const PROGRAM_ID = new PublicKey('CYUSvq2vmNZ4rcyhfKyfaTKvfeH3doxyqx69ifV3w3TP');

// Generate standard Anchor discriminator (SHA256 hash of namespace:name)
function generateDiscriminator(namespace, name) {
  const preimage = `${namespace}:${name}`;
  const hash = crypto.createHash('sha256').update(preimage).digest();
  return hash.slice(0, 8);
}

// Function to check account owner
async function checkAccountOwner(pubkey) {
  try {
    const accountInfo = await connection.getAccountInfo(pubkey);
    if (!accountInfo) {
      return { exists: false, owner: null };
    }
    return { 
      exists: true, 
      owner: accountInfo.owner.toString(),
      lamports: accountInfo.lamports,
      data: accountInfo.data
    };
  } catch (error) {
    console.error("Error checking account owner:", error);
    return { exists: false, error: error.message };
  }
}

// Function to pretty print a transaction result
function printTransactionResult(signature, message) {
  console.log(`\n✅ ${message}`);
  console.log(`Transaction signature: ${signature}`);
  console.log(`Explorer URL: https://explorer.solana.com/tx/${signature}?cluster=custom`);
}

// Step 1: Create vault account with correct ownership
async function createVaultAccount(mint) {
  console.log("\n=== STEP 1: CREATE VAULT ACCOUNT WITH CORRECT OWNERSHIP ===");
  
  // Derive PDAs
  const [vaultSolPda, vaultSolBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_sol"), mint.toBuffer()],
    PROGRAM_ID
  );
  console.log("Vault SOL PDA:", vaultSolPda.toString(), "(bump:", vaultSolBump, ")");
  
  // Check if vault already exists
  const vaultInfo = await checkAccountOwner(vaultSolPda);
  if (vaultInfo.exists) {
    console.log("\n⚠️ Vault SOL PDA already exists!");
    console.log(`Owner: ${vaultInfo.owner}`);
    
    // If owner is already System Program, we're good
    if (vaultInfo.owner === SystemProgram.programId.toString()) {
      console.log("✅ Vault already has correct ownership (System Program)");
      return { success: true, vaultSolPda };
    } else {
      console.log("❌ Vault has incorrect ownership");
      console.log("This is likely causing the 'IllegalOwner' error");
      console.log("Please use a different mint or reset the validator");
      return { success: false };
    }
  }
  
  console.log("\nVault account does not exist yet, which is good.");
  console.log("We'll create it with a simple transfer to give it System Program ownership.");
  
  try {
    // Create a transaction to transfer just enough lamports to make the account exist
    const rentExemptAmount = await connection.getMinimumBalanceForRentExemption(0);
    console.log(`Required lamports for rent exemption: ${rentExemptAmount}`);
    
    const transferIx = SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: vaultSolPda,
      lamports: rentExemptAmount + 100_000 // Extra lamports for operations
    });
    
    // Send transaction
    const tx = new Transaction().add(transferIx);
    const sig = await sendAndConfirmTransaction(connection, tx, [wallet]);
    
    console.log("\n✅ Transferred lamports to vault SOL PDA");
    console.log("Transaction signature:", sig);
    
    // Check ownership again
    const vaultInfoAfter = await checkAccountOwner(vaultSolPda);
    if (!vaultInfoAfter.exists) {
      console.log("❌ Failed to create vault SOL PDA account");
      return { success: false };
    }
    
    console.log("\nVault SOL PDA created with:");
    console.log(`Owner: ${vaultInfoAfter.owner}`);
    console.log(`Lamports: ${vaultInfoAfter.lamports}`);
    
    // Verify it's owned by System Program
    const systemProgramId = SystemProgram.programId.toString();
    if (vaultInfoAfter.owner !== systemProgramId) {
      console.log(`❌ Vault has wrong owner: ${vaultInfoAfter.owner}`);
      console.log(`Expected: ${systemProgramId}`);
      return { success: false };
    }
    
    console.log("\n✅ Vault SOL PDA created successfully with System Program ownership!");
    return { success: true, vaultSolPda };
  } catch (error) {
    console.log("\n❌ Failed to create vault SOL PDA:");
    console.log("Error:", error.message);
    return { success: false, error };
  }
}

// Step 2: Initialize the bonding curve
async function initializeBondingCurve(mint, vaultSolPda) {
  console.log("\n=== STEP 2: INITIALIZE BONDING CURVE ===");
  
  // Derive remaining PDAs
  const [authorityPda, authorityBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("launch"), mint.toBuffer()], 
    PROGRAM_ID
  );
  console.log("Authority PDA:", authorityPda.toString(), "(bump:", authorityBump, ")");
  
  const [statePda, stateBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("launch_state"), mint.toBuffer()],
    PROGRAM_ID
  );
  console.log("State PDA:", statePda.toString(), "(bump:", stateBump, ")");
  
  // Create or get vault ATA
  console.log("\nCreating vault ATA...");
  const vaultAta = await getOrCreateAssociatedTokenAccount(
    connection,
    wallet,
    mint,
    authorityPda,
    true  // allowOwnerOffCurve = true because PDA is not a valid ed25519 key
  );
  console.log("Vault ATA:", vaultAta.address.toString());
  
  // Initialize bonding curve parameters
  const basePriceLamports = 10_000_000; // 0.01 SOL
  const slopeLamports = 100_000; // 0.0001 SOL per token
  const feeBps = 50; // 0.5%
  const creatorFeeBps = 250; // 2.5%
  const graduationTargetLamports = 10_000_000_000; // 10 SOL
  
  console.log("\nBonding curve parameters:");
  console.log(`Base price: ${basePriceLamports / LAMPORTS_PER_SOL} SOL`);
  console.log(`Slope: ${slopeLamports / LAMPORTS_PER_SOL} SOL/token`);
  console.log(`Fee: ${feeBps / 100}%`);
  console.log(`Creator fee: ${creatorFeeBps / 100}%`);
  console.log(`Graduation target: ${graduationTargetLamports / LAMPORTS_PER_SOL} SOL`);
  
  // The correct discriminator from our previous tests
  const discriminator = generateDiscriminator("global", "initialize_launch");
  console.log("\nUsing discriminator: global:initialize_launch");
  console.log("Discriminator bytes:", Array.from(discriminator));
  
  try {
    // Construct initialization data with discriminator
    const initData = Buffer.alloc(8 + 8 + 8 + 2 + 2 + 8);
    
    // Write discriminator
    discriminator.copy(initData, 0);
    
    // Write parameters
    let offset = 8;
    initData.writeBigUInt64LE(BigInt(basePriceLamports), offset); offset += 8;
    initData.writeBigUInt64LE(BigInt(slopeLamports), offset); offset += 8;
    initData.writeUInt16LE(feeBps, offset); offset += 2;
    initData.writeUInt16LE(creatorFeeBps, offset); offset += 2;
    initData.writeBigUInt64LE(BigInt(graduationTargetLamports), offset);
    
    // Create instruction to increase compute budget (to handle complex initialization)
    const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({
      units: 1_000_000
    });
    
    // Create initialization instruction with proper account structure
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
    console.log("\nSending initialization transaction...");
    const initTx = new Transaction()
      .add(computeBudgetIx)
      .add(initIx);
    
    const initSig = await sendAndConfirmTransaction(
      connection, 
      initTx, 
      [wallet], 
      { commitment: 'confirmed', skipPreflight: true }
    );
    
    printTransactionResult(initSig, "Initialization successful!");
    
    // Verify account states after initialization
    console.log("\nVerifying state account after initialization...");
    const stateInfoAfter = await checkAccountOwner(statePda);
    
    if (!stateInfoAfter.exists) {
      console.log("❌ State account was not created!");
      return { success: false };
    }
    
    console.log("✅ State account created successfully");
    console.log(`Size: ${stateInfoAfter.data.length} bytes`);
    console.log(`Owner: ${stateInfoAfter.owner}`);
    
    // Save the successful config
    const config = {
      programId: PROGRAM_ID.toString(),
      mint: mint.toString(),
      authorityPda: authorityPda.toString(),
      statePda: statePda.toString(),
      vaultSolPda: vaultSolPda.toString(),
      vaultAta: vaultAta.address.toString(),
      discriminatorName: "global:initialize_launch",
      discriminatorBytes: Array.from(discriminator),
      discriminatorBuy: Array.from(generateDiscriminator("global", "buy")),
      discriminatorSell: Array.from(generateDiscriminator("global", "sell")),
      discriminatorWithdrawFees: Array.from(generateDiscriminator("global", "withdraw_fees")),
      discriminatorGraduate: Array.from(generateDiscriminator("global", "graduate")),
      signature: initSig,
      timestamp: new Date().toISOString()
    };
    
    fs.writeFileSync('successful-setup.json', JSON.stringify(config, null, 2));
    console.log("\nConfig saved to successful-setup.json");
    
    return { success: true, config };
  } catch (error) {
    console.log("\n❌ Initialization failed:");
    console.log("Error:", error.message);
    if (error.logs) {
      console.log("\nProgram logs:");
      error.logs
        .filter(log => log.includes("Program log:") || log.includes("Program failed"))
        .forEach(log => console.log("  " + log));
    }
    return { success: false, error };
  }
}

// Main function
async function main() {
  console.log("\n=== OWNER-FIXED BONDING CURVE INITIALIZATION SOLUTION ===");
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
    wallet.publicKey,  // mint authority
    null,              // freeze authority (none)
    9                  // decimals
  );
  console.log("Mint created:", mint.toString());
  
  // Step 1: Create vault account with correct ownership
  const vaultResult = await createVaultAccount(mint);
  if (!vaultResult.success) {
    console.log("\n❌ Failed to create vault account with correct ownership.");
    return false;
  }
  
  // Step 2: Initialize the bonding curve
  const initResult = await initializeBondingCurve(mint, vaultResult.vaultSolPda);
  if (!initResult.success) {
    console.log("\n❌ Failed to initialize bonding curve.");
    return false;
  }
  
  console.log("\n✅ Successfully created and initialized the bonding curve!");
  return true;
}

// Run the main function
if (require.main === module) {
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
}
