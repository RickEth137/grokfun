/**
 * better-initialization-fix.js - Fixed initialization with correct account structure
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
  mintTo
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

// Discriminators from test-fixed.js
const DISCRIMINATOR_INITIALIZE = Buffer.from([30, 120, 39, 212, 120, 168, 29, 81]); // "global:initializeLaunch"
const DISCRIMINATOR_BUY = Buffer.from([103, 17, 200, 25, 118, 95, 125, 61]); // "global:buy"

// Generate discriminator
function generateDiscriminator(namespace, name) {
  const preimage = namespace ? `${namespace}:${name}` : name;
  console.log(`Generating discriminator for "${preimage}"`);
  const hash = crypto.createHash('sha256').update(preimage).digest();
  return hash.slice(0, 8);
}

async function main() {
  console.log("=== IMPROVED BONDING CURVE INITIALIZATION ===");
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
  
  // Use the known working discriminator from test-fixed.js
  console.log("\nUsing discriminator from test-fixed.js");
  console.log(`Discriminator: [${Array.from(DISCRIMINATOR_INITIALIZE)}]`);
  
  try {
    // Launch parameters matching lib.rs
    const basePriceLamports = 10_000_000; // 0.01 SOL
    const slopeLamports = 100_000; // 0.0001 SOL per token
    const feeBps = 50; // 0.5%
    const creatorFeeBps = 250; // 2.5%
    const graduationTargetLamports = 10_000_000_000; // 10 SOL
    
    // Construct initialization data
    const initData = Buffer.alloc(8 + 8 + 8 + 2 + 2 + 8);
    DISCRIMINATOR_INITIALIZE.copy(initData, 0);
    
    // Write parameters
    let offset = 8;
    initData.writeBigUInt64LE(BigInt(basePriceLamports), offset); offset += 8;
    initData.writeBigUInt64LE(BigInt(slopeLamports), offset); offset += 8;
    initData.writeUInt16LE(feeBps, offset); offset += 2;
    initData.writeUInt16LE(creatorFeeBps, offset); offset += 2;
    initData.writeBigUInt64LE(BigInt(graduationTargetLamports), offset);
    
    // Use account structure from lib.rs
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
    
    console.log("\nSending initialization transaction...");
    const initTx = new Transaction().add(initIx);
    
    const initSig = await sendAndConfirmTransaction(
      connection, 
      initTx, 
      [wallet], 
      { commitment: 'confirmed', skipPreflight: true }
    );
    
    console.log("\n✅ SUCCESS!");
    console.log(`Transaction signature: ${initSig}`);
    
    // Verify state account
    console.log("\nVerifying state account...");
    const stateAccount = await connection.getAccountInfo(statePda);
    if (!stateAccount) {
      console.log("❌ State account not created!");
    } else {
      console.log("✅ State account created successfully with size:", stateAccount.data.length, "bytes");
    }
    
    // Check vault ownership
    console.log("\nVerifying vault SOL PDA ownership...");
    const vaultAccount = await connection.getAccountInfo(vaultSolPda);
    if (!vaultAccount) {
      console.log("❌ Vault account not created!");
    } else {
      console.log("Vault SOL PDA owner:", vaultAccount.owner.toString());
      console.log("Vault SOL PDA lamports:", vaultAccount.lamports);
      
      if (vaultAccount.owner.equals(SystemProgram.programId)) {
        console.log("✅ Vault SOL PDA correctly owned by System Program!");
      } else {
        console.log("⚠️ Unexpected vault owner:", vaultAccount.owner.toString());
      }
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
    if (error.logs) {
      console.log("\nProgram logs:");
      error.logs
        .filter(log => log.includes("Program log:") || log.includes("Program failed"))
        .forEach(log => console.log("  " + log));
    }
    
    // If IllegalOwner error, provide more context
    if (error.message && error.message.includes("IllegalOwner")) {
      console.log("\n⚠️ IllegalOwner error details:");
      console.log("This error suggests that the vault account doesn't have the expected owner.");
      console.log("Make sure the vault account is either not pre-created or is owned by SystemProgram.");
    }
    
    // If InstructionFallbackNotFound, provide more context
    if (error.message && (error.message.includes("Custom program error: 0x65") || 
                         error.message.includes("Custom(101)"))) {
      console.log("\n⚠️ InstructionFallbackNotFound (Error 101) details:");
      console.log("This means the program couldn't find a function matching the discriminator we provided.");
      console.log("We need to ensure the discriminator and parameter structure match the deployed program.");
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
