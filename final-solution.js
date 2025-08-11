/**
 * final-solution.js - Complete bonding curve initialization solution
 * 
 * This script implements a comprehensive solution to initialize the bonding curve contract,
 * addressing both the discriminator issue and the vault ownership problem.
 * 
 * Key improvements:
 * 1. Uses proper account parsing functions based on Pump curve examples
 * 2. Implements the correct discriminator format for all operations
 * 3. Ensures the vault_sol_pda has the correct ownership (System Program)
 * 4. Provides validation of accounts before and after initialization
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

// Constants for account parsing
const BONDING_CURVE_STATE_SIZE = 72; // Estimated based on expected fields

// Account offset definitions (estimated, may need adjustment)
const STATE_OFFSETS = {
  BASE_PRICE: 8,  // after discriminator (8 bytes)
  SLOPE: 16,
  FEE_BPS: 24,
  CREATOR_FEE_BPS: 26,
  GRADUATION_TARGET: 28,
  SUPPLY: 36,
  FUNDS: 44,
  FEES_COLLECTED: 52,
  CREATOR_FEES_COLLECTED: 60,
  IS_GRADUATED: 68
};

// Helper functions for reading account data
function readBigUInt64LE(buffer, offset) {
  return buffer.readBigUInt64LE(offset);
}

function readUInt16LE(buffer, offset) {
  return buffer.readUInt16LE(offset);
}

function readBoolean(buffer, offset) {
  return buffer[offset] !== 0;
}

// Helper function to parse state account
async function parseStateAccount(statePda) {
  try {
    const accountInfo = await connection.getAccountInfo(statePda);
    if (!accountInfo) {
      return null;
    }

    return {
      basePrice: Number(readBigUInt64LE(accountInfo.data, STATE_OFFSETS.BASE_PRICE)),
      slope: Number(readBigUInt64LE(accountInfo.data, STATE_OFFSETS.SLOPE)),
      feeBps: readUInt16LE(accountInfo.data, STATE_OFFSETS.FEE_BPS),
      creatorFeeBps: readUInt16LE(accountInfo.data, STATE_OFFSETS.CREATOR_FEE_BPS),
      graduationTarget: Number(readBigUInt64LE(accountInfo.data, STATE_OFFSETS.GRADUATION_TARGET)),
      supply: Number(readBigUInt64LE(accountInfo.data, STATE_OFFSETS.SUPPLY)),
      funds: Number(readBigUInt64LE(accountInfo.data, STATE_OFFSETS.FUNDS)),
      feesCollected: Number(readBigUInt64LE(accountInfo.data, STATE_OFFSETS.FEES_COLLECTED)),
      creatorFeesCollected: Number(readBigUInt64LE(accountInfo.data, STATE_OFFSETS.CREATOR_FEES_COLLECTED)),
      isGraduated: readBoolean(accountInfo.data, STATE_OFFSETS.IS_GRADUATED)
    };
  } catch (error) {
    console.error("Error parsing state account:", error);
    return null;
  }
}

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

// Main function
async function main() {
  console.log("\n=== COMPLETE BONDING CURVE INITIALIZATION SOLUTION ===");
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
  
  // Generate all required PDAs
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
  
  const [vaultSolPda, vaultSolBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_sol"), mint.toBuffer()],
    PROGRAM_ID
  );
  console.log("Vault SOL PDA:", vaultSolPda.toString(), "(bump:", vaultSolBump, ")");
  
  // Check if any of the PDAs already exist
  console.log("\nChecking PDAs...");
  const authorityInfo = await checkAccountOwner(authorityPda);
  const stateInfo = await checkAccountOwner(statePda);
  const vaultInfo = await checkAccountOwner(vaultSolPda);
  
  console.log(`Authority PDA: ${authorityInfo.exists ? 'Exists' : 'Does not exist'}`);
  console.log(`State PDA: ${stateInfo.exists ? 'Exists' : 'Does not exist'}`);
  console.log(`Vault SOL PDA: ${vaultInfo.exists ? 'Exists' : 'Does not exist'}`);
  
  // If vault exists with wrong owner, we need to recreate it
  if (vaultInfo.exists && vaultInfo.owner !== SystemProgram.programId.toString()) {
    console.log("\n⚠️ Vault SOL PDA exists with wrong owner!");
    console.log(`Current owner: ${vaultInfo.owner}`);
    console.log("Expected owner: System Program");
    console.log("This will cause the 'Provided owner is not allowed' error.");
    
    // The best approach is to reset the validator, but we can also try to create a new mint
    console.log("\nPlease reset the validator or use a different mint address.");
    return false;
  }
  
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
  
  // Prepare instruction data
  console.log("\nPreparing initialization data...");
  
  // The correct discriminator from our previous tests
  const discriminator = generateDiscriminator("global", "initialize_launch");
  console.log("Using discriminator: global:initialize_launch");
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
    
    // Setting preflight commitment and skipPreflight to improve transaction success
    const initSig = await sendAndConfirmTransaction(
      connection, 
      initTx, 
      [wallet], 
      { 
        commitment: 'confirmed',
        skipPreflight: true,
        preflightCommitment: 'processed' 
      }
    );
    
    printTransactionResult(initSig, "Initialization successful!");
    
    // Verify account states after initialization
    console.log("\nVerifying account states after initialization...");
    
    // Check state account
    const stateInfoAfter = await checkAccountOwner(statePda);
    if (!stateInfoAfter.exists) {
      console.log("❌ State account was not created!");
      return false;
    }
    console.log("✅ State account created successfully");
    console.log(`Size: ${stateInfoAfter.data.length} bytes`);
    console.log(`Owner: ${stateInfoAfter.owner}`);
    
    // Check vault account
    const vaultInfoAfter = await checkAccountOwner(vaultSolPda);
    if (!vaultInfoAfter.exists) {
      console.log("❌ Vault SOL account was not created!");
      return false;
    }
    console.log("✅ Vault SOL account created successfully");
    console.log(`Owner: ${vaultInfoAfter.owner}`);
    
    // Parse state account
    console.log("\nParsing state account...");
    const stateData = await parseStateAccount(statePda);
    if (stateData) {
      console.log("State account data:");
      console.log(`Base price: ${stateData.basePrice / LAMPORTS_PER_SOL} SOL`);
      console.log(`Slope: ${stateData.slope / LAMPORTS_PER_SOL} SOL/token`);
      console.log(`Fee: ${stateData.feeBps / 100}%`);
      console.log(`Creator fee: ${stateData.creatorFeeBps / 100}%`);
      console.log(`Graduation target: ${stateData.graduationTarget / LAMPORTS_PER_SOL} SOL`);
    } else {
      console.log("❌ Could not parse state account data");
    }
    
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
    
    return true;
  } catch (error) {
    console.log("\n❌ Initialization failed:");
    console.log("Error:", error.message);
    if (error.logs) {
      console.log("\nProgram logs:");
      error.logs
        .filter(log => log.includes("Program log:") || log.includes("Program failed"))
        .forEach(log => console.log("  " + log));
      
      // Check if the issue is related to the discriminator
      if (error.logs.some(log => log.includes("InstructionFallbackNotFound"))) {
        console.log("\n⚠️ Discriminator issue detected!");
        console.log("Try these alternative namespace/name combinations:");
        
        const alternatives = [
          ["ix", "initialize_launch"],
          ["", "initialize_launch"],
          ["global", "initializeLaunch"],
          ["ix", "initializeLaunch"],
          ["", "initializeLaunch"],
          ["global", "initialize"]
        ];
        
        alternatives.forEach(([namespace, name]) => {
          const altDiscriminator = generateDiscriminator(namespace, name);
          console.log(`${namespace}:${name}: ${Array.from(altDiscriminator)}`);
        });
      }
      
      // Check for the owner issue
      if (error.logs.some(log => log.includes("Provided owner is not allowed"))) {
        console.log("\n⚠️ Vault ownership issue detected!");
        console.log("The vault_sol_pda needs to be owned by the System Program");
        console.log("Please reset the validator or try with a different mint address");
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
