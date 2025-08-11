/**
 * fixed-owner-initialize.js - Focuses on fixing owner permissions issue
 *
 * This script uses the correct discriminator we discovered (5ac9dc8e70fd640d) and
 * addresses the "Provided owner is not allowed" error by ensuring proper token ownership.
 */
const { 
  Connection, 
  PublicKey, 
  Keypair, 
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction 
} = require('@solana/web3.js');
const { 
  TOKEN_PROGRAM_ID, 
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddress,
  getMint,
  createMint,
  mintTo
} = require('@solana/spl-token');
const fs = require('fs');
const crypto = require('crypto');
const BN = require('bn.js');

// Connect to the cluster
const connection = new Connection('http://localhost:8899', 'confirmed');

// Load the wallet keypair
const wallet = Keypair.fromSecretKey(
  Buffer.from(JSON.parse(fs.readFileSync(require('os').homedir() + '/.config/solana/id.json', 'utf-8')))
);

// Define the mint address
const mint = new PublicKey('2DYrK8AQrr9EyPb4F2nP16Dw5F4kTYxWGLMHPgC5Bmdb');

// Define the program ID
const programId = new PublicKey('CYUSvq2vmNZ4rcyhfKyfaTKvfeH3doxyqx69ifV3w3TP');

// Seeds for PDAs
const LAUNCH_SEED = Buffer.from('launch');
const STATE_SEED = Buffer.from('launch_state');
const VAULT_SOL_SEED = Buffer.from('vault_sol');

// Find PDAs
const [authorityPda] = PublicKey.findProgramAddressSync(
  [LAUNCH_SEED, mint.toBuffer()],
  programId
);
const [statePda] = PublicKey.findProgramAddressSync(
  [STATE_SEED, mint.toBuffer()],
  programId
);
const [vaultSolPda] = PublicKey.findProgramAddressSync(
  [VAULT_SOL_SEED, mint.toBuffer()],
  programId
);

// Parameters
const feeBps = 50; // 0.5% fee
const creatorFeeBps = 250; // 2.5% creator fee
const basePriceLamports = new BN(10000000); // 0.01 SOL
const slopeLamports = new BN(100000); // 0.0001 SOL per token
const graduationTargetLamports = new BN(10000000000); // 10 SOL

// Use the working discriminator we discovered
const CORRECT_DISCRIMINATOR = Buffer.from('5ac9dc8e70fd640d', 'hex');

// Function to serialize a BN to a little-endian buffer
function serializeU64(bn) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(bn.toString()));
  return buffer;
}

// Function to serialize a u16
function serializeU16(num) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(num);
  return buffer;
}

async function main() {
  try {
    console.log("==================================================");
    console.log("FIXED OWNER PERMISSIONS INITIALIZATION APPROACH");
    console.log("==================================================");
    console.log("Using mint:", mint.toBase58());
    console.log("Program ID:", programId.toBase58());
    console.log("Authority PDA:", authorityPda.toBase58());
    console.log("State PDA:", statePda.toBase58());
    console.log("Vault SOL PDA:", vaultSolPda.toBase58());
    
    // Check mint details
    console.log("\nVerifying mint details...");
    let mintInfo;
    try {
      mintInfo = await getMint(connection, mint);
      console.log("Mint exists with the following details:");
      console.log("- Supply:", mintInfo.supply.toString());
      console.log("- Decimals:", mintInfo.decimals);
      console.log("- Mint authority:", mintInfo.mintAuthority?.toBase58() || "None");
    } catch (err) {
      console.log("Error getting mint info:", err.message);
      console.log("The mint might not exist or there might be connection issues.");
      return { success: false };
    }
    
    // Check if the mint authority is the wallet
    const isMintAuthority = mintInfo.mintAuthority?.equals(wallet.publicKey) || false;
    console.log("Wallet is mint authority:", isMintAuthority);
    
    // Check if state account already exists
    const stateAccountInfo = await connection.getAccountInfo(statePda);
    if (stateAccountInfo) {
      console.log(`\n⚠️ State account already exists with ${stateAccountInfo.data.length} bytes.`);
      console.log(`The bonding curve is likely already initialized.`);
      return { success: true, alreadyInitialized: true };
    }
    
    // Create vault ATA if it doesn't exist
    console.log("\nGetting vault ATA address...");
    const vaultAtaAddress = await getAssociatedTokenAddress(
      mint,
      authorityPda,
      true // allowOwnerOffCurve
    );
    console.log("Vault ATA address:", vaultAtaAddress.toBase58());
    
    // Check if the vault ATA already exists
    const vaultAtaInfo = await connection.getAccountInfo(vaultAtaAddress);
    
    // Setup transaction
    const transaction = new Transaction();
    
    // If vault ATA doesn't exist, create it
    if (!vaultAtaInfo) {
      console.log("Vault ATA doesn't exist, adding creation instruction...");
      transaction.add(
        createAssociatedTokenAccountInstruction(
          wallet.publicKey, // payer
          vaultAtaAddress, // ata
          authorityPda, // owner
          mint // mint
        )
      );
    } else {
      console.log("Vault ATA already exists");
    }
    
    // Mint some initial tokens to the vault if it's empty
    if (!vaultAtaInfo || vaultAtaInfo.data.length === 0) {
      if (isMintAuthority) {
        console.log("Adding instruction to mint initial tokens to vault...");
        const mintAmount = 1000n * 1000000000n; // 1000 tokens with 9 decimals
        // We only add this if we have the authority
        transaction.add(
          mintTo(
            connection,
            wallet.payer,
            mint,
            vaultAtaAddress,
            wallet.publicKey,
            mintAmount
          )
        );
      }
    }
    
    // Create initialization instruction data
    console.log("\nCreating initialization instruction with correct discriminator...");
    const data = Buffer.alloc(8 + 8 + 8 + 2 + 2 + 8);
    CORRECT_DISCRIMINATOR.copy(data, 0);
    serializeU64(basePriceLamports).copy(data, 8);
    serializeU64(slopeLamports).copy(data, 16);
    serializeU16(feeBps).copy(data, 24);
    serializeU16(creatorFeeBps).copy(data, 26);
    serializeU64(graduationTargetLamports).copy(data, 28);
    
    // Create initialize instruction
    const initInstruction = new TransactionInstruction({
      programId,
      keys: [
        { pubkey: wallet.publicKey, isSigner: true, isWritable: true }, // payer
        { pubkey: wallet.publicKey, isSigner: false, isWritable: false }, // creator
        { pubkey: wallet.publicKey, isSigner: false, isWritable: false }, // platformFeeRecipient
        { pubkey: mint, isSigner: false, isWritable: false }, // mint
        { pubkey: authorityPda, isSigner: false, isWritable: false }, // authorityPda
        { pubkey: statePda, isSigner: false, isWritable: true }, // statePda
        { pubkey: vaultSolPda, isSigner: false, isWritable: true }, // vaultSolPda
        { pubkey: vaultAtaAddress, isSigner: false, isWritable: true }, // vaultAta
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // systemProgram
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // tokenProgram
        { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // associatedTokenProgram
        { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false }, // rent
      ],
      data
    });
    
    // Add initialization instruction
    transaction.add(initInstruction);
    
    // Send transaction
    console.log("\nSending transaction with init instruction...");
    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [wallet],
      { commitment: 'confirmed' }
    );
    
    console.log(`\n✅ Transaction successful!`);
    console.log(`Signature: ${signature}`);
    
    // Verify state account was created
    const stateAccountAfter = await connection.getAccountInfo(statePda);
    if (stateAccountAfter) {
      console.log(`\n✅ State account created with ${stateAccountAfter.data.length} bytes`);
      return { success: true };
    } else {
      console.log(`\n❌ Transaction succeeded but state account was not created`);
      return { success: false, error: 'State account not created' };
    }
    
  } catch (error) {
    console.error(`\n❌ Initialization failed:`, error.message);
    
    if (error.logs) {
      console.log("\nProgram logs:");
      error.logs.forEach(log => {
        if (log.includes("Program log:") || log.includes("Program failed") || log.includes("Error")) {
          console.log(`  ${log}`);
        }
      });
    }
    return { success: false, error: error.message };
  }
}

// Run if executed directly
if (require.main === module) {
  main()
    .then(result => {
      if (result.success) {
        console.log("\n✅ Initialization process completed successfully");
        process.exit(0);
      } else {
        console.error("\n❌ Initialization failed");
        process.exit(1);
      }
    })
    .catch(err => {
      console.error("Unhandled error:", err);
      process.exit(1);
    });
}

module.exports = { main };
