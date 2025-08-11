/**
 * complete-bonding-curve-fix.js - Final solution for fixing the bonding curve contract initialization
 * 
 * This script addresses:
 * 1. The "InstructionFallbackNotFound" (Code 101) error by using the correct discriminator
 * 2. The "Provided owner is not allowed" error by ensuring correct account structure
 * 3. Uses the correct parameter structure from instructions/initialize_launch.rs
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
console.log("Successfully connected to local Solana node");
console.log("Using wallet:", wallet.publicKey.toString());

// Program ID
const PROGRAM_ID = new PublicKey('CYUSvq2vmNZ4rcyhfKyfaTKvfeH3doxyqx69ifV3w3TP');
console.log("Program ID:", PROGRAM_ID.toString());

// CORRECT Instruction discriminator for initialize_launch
// SHA-256("global:initialize_launch")[0:8]
const DISCRIMINATOR_INITIALIZE = Buffer.from([90, 201, 220, 142, 112, 253, 100, 13]);

// Configuration
const USE_EXISTING_MINT = false;
const EXISTING_MINT = "FF5Khx5KBpyZKurFM4zUe2L4C7FWzAAZ92sP7mEWqvCJ";

// Main function
async function main() {
  try {
    // Create or use existing mint
    let mint;
    if (USE_EXISTING_MINT) {
      mint = new PublicKey(EXISTING_MINT);
      console.log('Using existing mint:', mint.toString());
    } else {
      console.log('Creating a new mint...');
      mint = await createMint(
        connection,
        wallet,
        wallet.publicKey,
        null,
        9 // 9 decimals
      );
      console.log('Mint created:', mint.toString());
    }
    
    // Derive PDAs
    const mintBuffer = mint.toBuffer();
    
    // Find launch PDA (used in initialize_launch.rs)
    const [launchPda] = await PublicKey.findProgramAddress(
      [Buffer.from("launch"), mintBuffer],
      PROGRAM_ID
    );
    console.log("Launch PDA:", launchPda.toString());
    
    // Find sol_vault PDA (used in initialize_launch.rs)
    const [solVaultPda] = await PublicKey.findProgramAddress(
      [Buffer.from("sol_vault"), mintBuffer],
      PROGRAM_ID
    );
    console.log("SOL Vault PDA:", solVaultPda.toString());
    
    // Get or create vault ATA
    const vaultAta = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet,
      mint,
      launchPda,
      true
    );
    console.log('Vault ATA:', vaultAta.address.toString());
    
    // If not using existing mint, mint initial supply
    if (!USE_EXISTING_MINT) {
      console.log('Minting initial supply...');
      await mintTo(
        connection,
        wallet,
        mint,
        vaultAta.address,
        wallet.publicKey,
        1_000_000_000 // 1000 tokens with 6 decimals
      );
      console.log('Initial supply minted');
    }
    
    // Get buyer's ATA
    const buyerAta = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet,
      mint,
      wallet.publicKey
    );
    console.log('Buyer ATA:', buyerAta.address.toString());
    
    // Calculate minimum rent-exempt SOL amount
    const rentExemptAmount = await connection.getMinimumBalanceForRentExemption(0);
    console.log(`\nRent exempt amount: ${rentExemptAmount} lamports`);
    
    // Fund vault SOL PDA to be rent-exempt
    console.log("Funding SOL Vault PDA to be rent-exempt...");
    const fundVaultTx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: wallet.publicKey,
        toPubkey: solVaultPda,
        lamports: rentExemptAmount + 100000, // Add extra just to be safe
      })
    );
    
    const fundVaultSig = await sendAndConfirmTransaction(
      connection,
      fundVaultTx,
      [wallet]
    );
    console.log(`Funded SOL Vault PDA with ${rentExemptAmount + 100000} lamports. Signature: ${fundVaultSig}`);
    
    // Check vault account info
    const vaultInfo = await connection.getAccountInfo(solVaultPda);
    console.log(`SOL Vault PDA exists: ${vaultInfo !== null}`);
    if (vaultInfo) {
      console.log(`SOL Vault PDA owner: ${vaultInfo.owner.toString()}`);
      console.log(`SOL Vault PDA balance: ${vaultInfo.lamports} lamports`);
    }
    
    // Check if launch account exists
    const launchInfo = await connection.getAccountInfo(launchPda);
    
    if (launchInfo) {
      console.log('Launch account exists with size:', launchInfo.data.length);
      console.log('Launch is already initialized.');
    } else {
      console.log('Launch account does not exist, initializing launch...');
      
      // Initialize launch parameters based on instructions/initialize_launch.rs
      const name = "test_grok"; // Must end with "grok" per the code requirement
      const symbol = "TGROK";
      
      // Price state parameters
      const basePriceLamports = 1_000_000; // 0.001 SOL
      const slopeLamports = 100_000; // 0.0001 SOL per token
      const feeBps = 300; // 3.00%
      const creatorFeeBps = 100; // 1.00%
      const graduationTargetLamports = 2 * LAMPORTS_PER_SOL; // 2 SOL
      
      // Name and symbol as UTF-8 bytes
      const nameBytes = Buffer.from(name, 'utf-8');
      const symbolBytes = Buffer.from(symbol, 'utf-8');
      
      // Calculate data size for initialize_launch in instructions/initialize_launch.rs
      // 8 bytes discriminator + 
      // 4+name.length + 
      // 4+symbol.length + 
      // PriceState struct (8+8+2+2+8 = 28 bytes)
      const dataSize = 8 + 4 + nameBytes.length + 4 + symbolBytes.length + 28;
      
      // Construct initialization data
      const initData = Buffer.alloc(dataSize);
      
      // Write discriminator
      DISCRIMINATOR_INITIALIZE.copy(initData, 0);
      
      // Prepare the rest of the data based on instructions/initialize_launch.rs
      let offset = 8;
      
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
      
      // Write PriceState struct
      initData.writeBigUInt64LE(BigInt(basePriceLamports), offset); offset += 8;
      initData.writeBigUInt64LE(BigInt(slopeLamports), offset); offset += 8;
      initData.writeUInt16LE(feeBps, offset); offset += 2;
      initData.writeUInt16LE(creatorFeeBps, offset); offset += 2;
      initData.writeBigUInt64LE(BigInt(graduationTargetLamports), offset);
      
      // Create a dummy global config account for testing
      // In a real scenario, this account would need to be properly initialized
      const globalConfigPda = wallet.publicKey; // Using wallet for testing
      
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
      
      try {
        const initSig = await sendAndConfirmTransaction(
          connection, 
          initTx, 
          [wallet], 
          { commitment: 'confirmed', skipPreflight: true }
        );
        
        console.log("\n✅ SUCCESS! Initialization successful.");
        console.log(`Transaction signature: ${initSig}`);
        
        // Check if the launch account was created
        const launchAccount = await connection.getAccountInfo(launchPda);
        console.log("Launch account created:", !!launchAccount);
        if (launchAccount) {
          console.log("Launch account size:", launchAccount.data.length, "bytes");
        }
        
        // Save successful setup information to a file for future use
        const config = {
          programId: PROGRAM_ID.toString(),
          mint: mint.toString(),
          launchPda: launchPda.toString(),
          solVaultPda: solVaultPda.toString(),
          vaultAta: vaultAta.address.toString(),
          buyerAta: buyerAta.address.toString(),
          discriminator: Array.from(DISCRIMINATOR_INITIALIZE)
        };
        
        fs.writeFileSync('bonding-curve-setup.json', JSON.stringify(config, null, 2));
        console.log("Setup information saved to bonding-curve-setup.json");
        
      } catch (error) {
        console.error("\n❌ Initialization failed:");
        console.error(error);
        
        // Try to extract and display useful logs
        if (error.logs) {
          console.log("\nTransaction logs:");
          error.logs.forEach(log => console.log(log));
        }
      }
    }
  } catch (error) {
    console.error("An error occurred:", error);
  }
}

main();
