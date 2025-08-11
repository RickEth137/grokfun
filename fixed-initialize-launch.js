/**
 * fixed-initialize-launch.js - Correct initialization using the proper function parameters
 * 
 * This script fixes the Custom Error 101 (InstructionFallbackNotFound) by:
 * 1. Using the correct parameter structure from initialize_launch.rs
 * 2. NOT pre-creating the vault account (fixed from previous work)
 */
const { 
  Connection, 
  PublicKey, 
  Keypair,
  SystemProgram, 
  SYSVAR_RENT_PUBKEY,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL
} = require('@solana/web3.js');
const { 
  TOKEN_PROGRAM_ID, 
  ASSOCIATED_TOKEN_PROGRAM_ID, 
  getOrCreateAssociatedTokenAccount,
  createMint
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
function generateAnchorDiscriminator(namespace, name) {
  const preimage = `${namespace}:${name}`;
  console.log(`Generating discriminator for "${preimage}"`);
  const hash = crypto.createHash('sha256').update(preimage).digest();
  return hash.slice(0, 8);
}

// The discriminator from test-fixed.js
const DISCRIMINATOR_INITIALIZE = Buffer.from([30, 120, 39, 212, 120, 168, 29, 81]);

// Function to encode a string for serialization
function encodeString(str) {
  const bytes = Buffer.from(str, 'utf8');
  const len = Buffer.alloc(4);
  len.writeUInt32LE(bytes.length, 0);
  return Buffer.concat([len, bytes]);
}

async function main() {
  console.log("=== FIXED BONDING CURVE INITIALIZATION ===");
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
  
  // Derive PDAs
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
  
  // Get vault ATA
  console.log("\nCreating vault ATA...");
  const vaultAta = await getOrCreateAssociatedTokenAccount(
    connection,
    wallet,
    mint,
    authorityPda,
    true
  );
  console.log("Vault ATA:", vaultAta.address.toString());
  
  // Fixed parameters based on initialize_launch.rs
  const name = "mygrok"; // Must end with "grok" per the code requirement
  const symbol = "GROK";
  
  // PriceState struct from state.rs:
  // pub struct PriceState {
  //   pub tranche_size: u64,
  //   pub base_price_lamports: u64,
  //   pub step_bps: u16,
  // }
  const trancheSize = 1_000_000_000; // 1 billion tokens in smallest units
  const basePriceLamports = 10_000_000; // 0.01 SOL
  const stepBps = 500; // 5.00% increase per tranche
  
  try {
    // Calculate correct discriminator
    let discriminator;
    
    // Try different discriminator options
    const discriminatorOptions = [
      // From test-fixed.js - the standard one tried before
      { name: "test-fixed.js", buffer: DISCRIMINATOR_INITIALIZE },
      // Try different namespaces with initialize_launch
      { name: "global:initialize_launch", buffer: generateAnchorDiscriminator("global", "initialize_launch") },
      { name: "instruction:initialize_launch", buffer: generateAnchorDiscriminator("instruction", "initialize_launch") },
      { name: "", buffer: generateAnchorDiscriminator("", "initialize_launch") },
    ];
    
    // Start with the standard one
    discriminator = discriminatorOptions[0].buffer;
    console.log(`Using discriminator: ${discriminatorOptions[0].name}`);
    
    // IMPORTANT: Construct initialization data with the CORRECT PARAMETER FORMAT
    // Per initialize_launch.rs: (name: String, _symbol: String, price_state: PriceState)
    
    // 1. Allocate buffer: 
    //    8 bytes discriminator + 
    //    name string (4 bytes len + variable) + 
    //    symbol string (4 bytes len + variable) +
    //    price_state struct (8 + 8 + 2 = 18 bytes)
    const nameEncoded = encodeString(name);
    const symbolEncoded = encodeString(symbol);
    const priceStateSize = 8 + 8 + 2; // tranche_size (u64) + base_price_lamports (u64) + step_bps (u16)
    
    const initDataSize = 8 + nameEncoded.length + symbolEncoded.length + priceStateSize;
    const initData = Buffer.alloc(initDataSize);
    
    // 2. Write discriminator
    discriminator.copy(initData, 0);
    
    // 3. Write parameters
    let offset = 8;
    
    // Write name string
    nameEncoded.copy(initData, offset);
    offset += nameEncoded.length;
    
    // Write symbol string
    symbolEncoded.copy(initData, offset);
    offset += symbolEncoded.length;
    
    // Write PriceState struct
    initData.writeBigUInt64LE(BigInt(trancheSize), offset); offset += 8;
    initData.writeBigUInt64LE(BigInt(basePriceLamports), offset); offset += 8;
    initData.writeUInt16LE(stepBps, offset);
    
    console.log("\nInitialization data:");
    console.log("- Name:", name);
    console.log("- Symbol:", symbol);
    console.log("- Tranche Size:", trancheSize);
    console.log("- Base Price (lamports):", basePriceLamports);
    console.log("- Step BPS:", stepBps);
    
    // Create initialization instruction
    const initIx = {
      programId: PROGRAM_ID,
      keys: [
        // Use the accounts based on initialize_launch.rs AccountsStruct
        { pubkey: wallet.publicKey, isSigner: true, isWritable: true }, // global_config 
        { pubkey: wallet.publicKey, isSigner: true, isWritable: false }, // admin
        { pubkey: statePda, isSigner: false, isWritable: true }, // launch (not authorityPda)
        { pubkey: wallet.publicKey, isSigner: true, isWritable: true }, // creator
        { pubkey: mint, isSigner: false, isWritable: true }, // mint
        { pubkey: vaultAta.address, isSigner: false, isWritable: true }, // curve_vault
        { pubkey: vaultSolPda, isSigner: false, isWritable: true }, // sol_vault
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // token_program
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // system_program
      ],
      data: initData
    };
    
    // Send transaction
    console.log("\nSending initialization transaction...");
    const initTx = new Transaction().add(initIx);
    
    // For better debugging, use skipPreflight to see the real error
    const initSig = await sendAndConfirmTransaction(
      connection, 
      initTx, 
      [wallet], 
      { commitment: 'confirmed', skipPreflight: true }
    );
    
    console.log("\n✅ Initialization successful!");
    console.log("Transaction signature:", initSig);
    console.log(`Explorer URL: https://explorer.solana.com/tx/${initSig}?cluster=custom`);
    
    // Verify state account
    console.log("\nVerifying launch account...");
    const launchAccount = await connection.getAccountInfo(statePda);
    if (!launchAccount) {
      console.log("❌ Launch account not created!");
      return false;
    }
    console.log("✅ Launch account created successfully");
    console.log("Launch account size:", launchAccount.data.length, "bytes");
    
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
    } else if (vaultAccount.owner.equals(PROGRAM_ID)) {
      console.log("⚠️ Vault SOL PDA owned by the program - this might be expected in some designs.");
    } else {
      console.log("❓ Vault SOL PDA has unexpected owner.");
    }
    
    // Save the successful config
    const config = {
      programId: PROGRAM_ID.toString(),
      mint: mint.toString(),
      authorityPda: authorityPda.toString(),
      statePda: statePda.toString(),
      vaultSolPda: vaultSolPda.toString(),
      vaultAta: vaultAta.address.toString(),
      discriminator: Array.from(discriminator),
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
    }
    
    // Try to get more detailed transaction info
    try {
      if (error.signature) {
        console.log("\nAttempting to get detailed transaction logs...");
        
        const logs = await connection.getTransaction(error.signature, {
          commitment: 'confirmed',
          maxSupportedTransactionVersion: 0
        });
        
        if (logs && logs.meta && logs.meta.logMessages) {
          console.log("\nDetailed logs:");
          logs.meta.logMessages.forEach(log => console.log("  " + log));
        }
      }
    } catch (logError) {
      console.log("Could not fetch detailed logs:", logError.message);
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
