/**
 * test-fixed-with-correct-discriminator.js
 * Based on test-fixed.js but with the correct discriminator
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
  getAccount,
  createAssociatedTokenAccount,
  createMint,
  mintTo
} = require('@solana/spl-token');
const fs = require('fs');
const path = require('path');

// Program ID
const PROGRAM_ID = new PublicKey('CYUSvq2vmNZ4rcyhfKyfaTKvfeH3doxyqx69ifV3w3TP');

// Configure constants
const USE_EXISTING_MINT = false;
const EXISTING_MINT = "FF5Khx5KBpyZKurFM4zUe2L4C7FWzAAZ92sP7mEWqvCJ";

// CORRECTED Instruction discriminator for initialize_launch
// SHA-256("global:initialize_launch")[0:8]
const DISCRIMINATOR_INITIALIZE = Buffer.from([90, 201, 220, 142, 112, 253, 100, 13]);

// Original discriminators from test-fixed.js (for buy/sell)
const DISCRIMINATOR_BUY = Buffer.from([103, 17, 200, 25, 118, 95, 125, 61]);
const DISCRIMINATOR_SELL = Buffer.from([168, 86, 144, 193, 84, 236, 124, 112]);
const DISCRIMINATOR_WITHDRAW_FEES = Buffer.from([249, 77, 180, 202, 241, 88, 221, 124]);
const DISCRIMINATOR_GRADUATE = Buffer.from([175, 69, 176, 246, 204, 41, 172, 222]);

async function main() {
  try {
    // Setup connection
    const connection = new Connection('http://localhost:8899', 'confirmed');
    console.log('Successfully connected to local Solana node');
    
    // Load wallet
    const walletPath = process.env.ANCHOR_WALLET || path.join(process.env.HOME, '.config', 'solana', 'id.json');
    const secretKeyString = fs.readFileSync(walletPath, { encoding: 'utf8' });
    const secretKey = Uint8Array.from(JSON.parse(secretKeyString));
    const wallet = Keypair.fromSecretKey(secretKey);
    console.log('Using wallet:', wallet.publicKey.toString());
    
    // Program ID
    const programId = PROGRAM_ID;
    console.log('Program ID:', programId.toString());
    
    // Get mint
    let mint;
    if (USE_EXISTING_MINT) {
      mint = new PublicKey(EXISTING_MINT);
      console.log('Using existing mint:', mint.toString());
    } else {
      // Create a new mint
      console.log('Creating a new mint...');
      mint = await createMint(
        connection,
        wallet,
        wallet.publicKey,
        null,
        9
      );
      console.log('Mint created:', mint.toString());
    }
    
    // Derive PDAs
    const [authorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("launch"), mint.toBuffer()], 
      programId
    );
    console.log('Authority PDA:', authorityPda.toString());
    
    const [statePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("launch_state"), mint.toBuffer()],
      programId
    );
    console.log('State PDA:', statePda.toString());
    
    const [vaultSolPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_sol"), mint.toBuffer()],
      programId
    );
    console.log('Vault SOL PDA:', vaultSolPda.toString());
    
    // Get vault ATA
    const vaultAta = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet,
      mint,
      authorityPda,
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
        1000000000000 // 1000 tokens with 9 decimals
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
    console.log("Funding vault SOL PDA to be rent-exempt...");
    const fundVaultTx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: wallet.publicKey,
        toPubkey: vaultSolPda,
        lamports: rentExemptAmount + 10000, // Add some extra just to be safe
      })
    );
    
    const fundVaultSig = await sendAndConfirmTransaction(
      connection,
      fundVaultTx,
      [wallet]
    );
    console.log(`Funded vault SOL PDA with ${rentExemptAmount + 10000} lamports. Signature: ${fundVaultSig}`);
    
    // Check vault account info
    const vaultInfo = await connection.getAccountInfo(vaultSolPda);
    console.log(`Vault SOL PDA exists: ${vaultInfo !== null}`);
    if (vaultInfo) {
      console.log(`Vault SOL PDA owner: ${vaultInfo.owner.toString()}`);
      console.log(`Vault SOL PDA balance: ${vaultInfo.lamports} lamports`);
    }
    
    // Check if state account exists
    const stateInfo = await connection.getAccountInfo(statePda);
    
    if (stateInfo) {
      console.log('State account exists with size:', stateInfo.data.length);
      console.log('Launch is already initialized.');
    } else {
      console.log('State account does not exist, initializing launch...');
      
      // Initialize launch parameters
      const basePriceLamports = 1_000_000; // 0.001 SOL
      const slopeLamports = 100_000; // 0.0001 SOL per token
      const feeBps = 300; // 3.00%
      const creatorFeeBps = 100; // 1.00%
      const graduationTargetLamports = 2 * 1_000_000_000; // 2 SOL
      
      // Construct initialization data
      const initData = Buffer.alloc(8 + 8 + 8 + 2 + 2 + 8);
      
      // Write CORRECTED discriminator
      DISCRIMINATOR_INITIALIZE.copy(initData, 0);
      
      // Write params
      let offset = 8;
      initData.writeBigUInt64LE(BigInt(basePriceLamports), offset); offset += 8;
      initData.writeBigUInt64LE(BigInt(slopeLamports), offset); offset += 8;
      initData.writeUInt16LE(feeBps, offset); offset += 2;
      initData.writeUInt16LE(creatorFeeBps, offset); offset += 2;
      initData.writeBigUInt64LE(BigInt(graduationTargetLamports), offset);
      
      // Create instruction
      const initIx = {
        programId,
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
      const initSig = await sendAndConfirmTransaction(connection, initTx, [wallet]);
      console.log('Initialization transaction sent! Signature:', initSig);
      
      // Save successful setup information
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
      console.log("Config saved to successful-setup.json");
    }
    
    // The rest of the test-fixed.js script (buy, sell, etc.) would go here
    // We're skipping it for now since we're focusing on the initialization
    
    console.log('\nInitialization test completed!');
    
  } catch (error) {
    console.error('Error:', error);
    if (error.logs) {
      console.error('Transaction logs:');
      error.logs.forEach(log => console.error(log));
    }
    process.exit(1);
  }
}

main();
