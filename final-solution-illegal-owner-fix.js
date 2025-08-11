/**
 * final-solution-illegal-owner-fix.js - Addressing the IllegalOwner error
 * 
 * This script focuses on the global:initialize_launch discriminator that gave us
 * a different error (IllegalOwner) instead of Custom Error 101
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
  createMint,
  mintTo,
  getMint
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

// Use the discriminator that gave us IllegalOwner error
const INITIALIZE_DISCRIMINATOR = Buffer.from([90, 201, 220, 142, 112, 253, 100, 13]); // global:initialize_launch

async function main() {
  console.log("=== BONDING CURVE INITIALIZATION WITH FIXED ACCOUNT STRUCTURE ===");
  console.log("Program ID:", PROGRAM_ID.toString());
  console.log("Wallet:", wallet.publicKey.toString());
  
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

  // Get mint info
  const mintInfo = await getMint(connection, mint);
  console.log("Mint decimals:", mintInfo.decimals);
  
  // Derive PDAs based on instructions/initialize_launch.rs account structure
  const [launchPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("launch"), mint.toBuffer()], 
    PROGRAM_ID
  );
  console.log("Launch PDA:", launchPda.toString());
  
  // For compatibility with both versions
  const [statePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("launch_state"), mint.toBuffer()],
    PROGRAM_ID
  );
  console.log("State PDA (if needed):", statePda.toString());
  
  const [solVaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_sol"), mint.toBuffer()],
    PROGRAM_ID
  );
  console.log("SOL Vault PDA:", solVaultPda.toString());
  
  // Create vault ATA
  console.log("\nCreating vault ATA...");
  const vaultAta = await getOrCreateAssociatedTokenAccount(
    connection,
    wallet,
    mint,
    launchPda,
    true
  );
  console.log("Vault ATA:", vaultAta.address.toString());
  
  // Mint initial supply to vault
  console.log("\nMinting initial supply to vault...");
  const initialSupply = 1_000_000_000; // 1000 tokens with 6 decimals
  try {
    await mintTo(
      connection,
      wallet,
      mint,
      vaultAta.address,
      wallet.publicKey,
      initialSupply
    );
    console.log(`Minted ${initialSupply} tokens to vault`);
  } catch (error) {
    console.log("Error minting tokens:", error.message);
    // Continue anyway
  }

  try {
    // Initialize launch parameters based on instructions/initialize_launch.rs
    // This matches the PriceState struct in the Rust code
    const name = "FunGrok"; // Must end with "grok"
    const symbol = "FGROK";
    
    // Calculate data size for initialize_launch in instructions/initialize_launch.rs
    // We need: discriminator (8) + name string (4+len) + symbol string (4+len) + PriceState struct
    const nameBytes = Buffer.from(name);
    const symbolBytes = Buffer.from(symbol);
    
    // Simplified PriceState struct - this is a guess based on the error
    const basePriceLamports = 1_000_000; // 0.001 SOL
    const slopeLamports = 100_000; // 0.0001 SOL per token
    const feeBps = 300; // 3.00%
    const creatorFeeBps = 100; // 1.00%
    const graduationTargetLamports = 2 * 1_000_000_000; // 2 SOL

    // Create initialization data
    const initDataSize = 8 + // discriminator
                         4 + nameBytes.length + // name string
                         4 + symbolBytes.length + // symbol string 
                         8 + 8 + 2 + 2 + 8; // basePriceLamports + slopeLamports + feeBps + creatorFeeBps + graduationTargetLamports
    
    const initData = Buffer.alloc(initDataSize);
    let offset = 0;
    
    // Write discriminator
    INITIALIZE_DISCRIMINATOR.copy(initData, offset);
    offset += 8;
    
    // Write name string (Borsh format: size as u32 LE + bytes)
    initData.writeUInt32LE(nameBytes.length, offset);
    offset += 4;
    nameBytes.copy(initData, offset);
    offset += nameBytes.length;
    
    // Write symbol string (Borsh format: size as u32 LE + bytes)
    initData.writeUInt32LE(symbolBytes.length, offset);
    offset += 4;
    symbolBytes.copy(initData, offset);
    offset += symbolBytes.length;
    
    // Write PriceState struct (based on found values)
    initData.writeBigUInt64LE(BigInt(basePriceLamports), offset); offset += 8;
    initData.writeBigUInt64LE(BigInt(slopeLamports), offset); offset += 8;
    initData.writeUInt16LE(feeBps, offset); offset += 2;
    initData.writeUInt16LE(creatorFeeBps, offset); offset += 2;
    initData.writeBigUInt64LE(BigInt(graduationTargetLamports), offset);
    
    // Create a dummy global config account for now
    const globalConfigPda = wallet.publicKey; // We'll just use wallet key for now
    
    console.log("\nBuilding account structure based on instructions/initialize_launch.rs...");
    
    // Create instruction with account structure from instructions/initialize_launch.rs
    const initIx = {
      programId: PROGRAM_ID,
      keys: [
        { pubkey: globalConfigPda, isSigner: false, isWritable: true }, // global_config
        { pubkey: wallet.publicKey, isSigner: true, isWritable: false }, // admin
        { pubkey: launchPda, isSigner: false, isWritable: true }, // launch
        { pubkey: wallet.publicKey, isSigner: true, isWritable: true }, // creator
        { pubkey: mint, isSigner: false, isWritable: true }, // mint
        { pubkey: vaultAta.address, isSigner: false, isWritable: true }, // curve_vault
        { pubkey: solVaultPda, isSigner: false, isWritable: true }, // sol_vault
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // token_program
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false } // system_program
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
    
    console.log("\n✅ SUCCESS!");
    console.log(`Transaction signature: ${initSig}`);
    
    // Check if the launch account was created
    const launchAccount = await connection.getAccountInfo(launchPda);
    console.log("Launch account created:", !!launchAccount);
    if (launchAccount) {
      console.log("Launch account size:", launchAccount.data.length, "bytes");
      console.log("Launch account owner:", launchAccount.owner.toString());
    }
    
    // Save the successful setup
    const config = {
      programId: PROGRAM_ID.toString(),
      mint: mint.toString(),
      launchPda: launchPda.toString(),
      statePda: statePda.toString(),
      solVaultPda: solVaultPda.toString(),
      vaultAta: vaultAta.address.toString(),
      discriminator: Array.from(INITIALIZE_DISCRIMINATOR),
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
