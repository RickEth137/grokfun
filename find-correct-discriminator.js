/**
 * find-correct-discriminator.js - Try multiple instruction names to find the correct one
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
  console.log(`  Generating discriminator for "${preimage}"`);
  const hash = crypto.createHash('sha256').update(preimage).digest();
  return hash.slice(0, 8);
}

// Function to test an initialization with a specific discriminator
async function testDiscriminator(discriminator, label) {
  console.log(`\n=== Testing Discriminator: ${label} ===`);
  console.log(`Discriminator bytes: [${Array.from(discriminator)}]`);
  
  try {
    // Create a mint for this test
    const mint = await createMint(
      connection,
      wallet,
      wallet.publicKey,
      null,
      9
    );
    console.log(`Mint created: ${mint.toString()}`);
    
    // Derive PDAs
    const [authorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("launch"), mint.toBuffer()], 
      PROGRAM_ID
    );
    
    const [statePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("launch_state"), mint.toBuffer()],
      PROGRAM_ID
    );
    
    const [vaultSolPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_sol"), mint.toBuffer()],
      PROGRAM_ID
    );
    
    // Create vault ATA
    const vaultAta = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet,
      mint,
      authorityPda,
      true
    );
    
    // Launch parameters (using values from test-fixed.js)
    const basePriceLamports = 1_000_000; // 0.001 SOL
    const slopeLamports = 100_000; // 0.0001 SOL per token
    const feeBps = 300; // 3.00%
    const creatorFeeBps = 100; // 1.00%
    const graduationTargetLamports = 2 * 1_000_000_000; // 2 SOL
    
    // Construct initialization data with the test discriminator
    const initData = Buffer.alloc(8 + 8 + 8 + 2 + 2 + 8);
    discriminator.copy(initData, 0);
    
    // Write parameters
    let offset = 8;
    initData.writeBigUInt64LE(BigInt(basePriceLamports), offset); offset += 8;
    initData.writeBigUInt64LE(BigInt(slopeLamports), offset); offset += 8;
    initData.writeUInt16LE(feeBps, offset); offset += 2;
    initData.writeUInt16LE(creatorFeeBps, offset); offset += 2;
    initData.writeBigUInt64LE(BigInt(graduationTargetLamports), offset);
    
    // Create initialization instruction
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
    console.log('Sending initialization transaction...');
    const initTx = new Transaction().add(initIx);
    
    try {
      const initSig = await sendAndConfirmTransaction(
        connection, 
        initTx, 
        [wallet], 
        { commitment: 'confirmed', skipPreflight: true }
      );
      
      console.log(`\n✅ SUCCESS with "${label}"!`);
      console.log(`Transaction signature: ${initSig}`);
      
      // Save the successful discriminator info
      const result = {
        discriminatorName: label,
        discriminatorBytes: Array.from(discriminator),
        mint: mint.toString(),
        signature: initSig,
        timestamp: new Date().toISOString()
      };
      
      fs.writeFileSync('successful-discriminator.json', JSON.stringify(result, null, 2));
      console.log("\nSuccessful discriminator saved to successful-discriminator.json");
      
      return { success: true, signature: initSig, mint: mint.toString() };
    } catch (error) {
      if (error.message.includes('Custom program error: 0x65') || 
          error.message.includes('Custom(101)')) {
        console.log(`❌ Failed with InstructionFallbackNotFound (error 101)`);
      } else {
        console.log(`❓ Failed with different error: ${error.message}`);
        if (error.logs) {
          console.log("Program logs:");
          error.logs
            .filter(log => log.includes("Program log:") || log.includes("Program failed"))
            .forEach(log => console.log("  " + log));
        }
      }
      return { success: false, error: error.message };
    }
  } catch (error) {
    console.log(`❌ Setup error: ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function main() {
  console.log("=== FINDING CORRECT ANCHOR DISCRIMINATOR ===");
  console.log("Program ID:", PROGRAM_ID.toString());
  console.log("Wallet:", wallet.publicKey.toString());
  
  // List of common initialization function names to try
  const initNames = [
    // Basic names
    { namespace: "global", name: "initialize" },
    { namespace: "global", name: "init" },
    { namespace: "global", name: "create" },
    
    // Bonding curve specific
    { namespace: "global", name: "create_bonding_curve" },
    { namespace: "global", name: "init_bonding_curve" },
    { namespace: "global", name: "initialize_bonding_curve" },
    { namespace: "global", name: "create_curve" },
    
    // Launch specific
    { namespace: "global", name: "initialize_launch" }, // Previously tried, got error 101
    { namespace: "global", name: "init_launch" },
    { namespace: "global", name: "create_launch" },
    
    // Without namespace prefix
    { namespace: "", name: "initialize" },
    { namespace: "", name: "init" },
    { namespace: "", name: "create" },
    
    // Other namespaces
    { namespace: "instruction", name: "initialize" },
    { namespace: "ix", name: "initialize" },
    { namespace: "program", name: "initialize" }
  ];
  
  // Also try the hardcoded discriminator from test-fixed.js
  const knownDiscriminators = [
    { 
      name: "Test-fixed.js value",
      bytes: Buffer.from([30, 120, 39, 212, 120, 168, 29, 81])
    }
  ];
  
  // Test known discriminators
  for (const disc of knownDiscriminators) {
    const result = await testDiscriminator(disc.bytes, disc.name);
    if (result.success) {
      return result;
    }
  }
  
  // Generate and test anchor discriminators
  for (const init of initNames) {
    const discriminator = generateAnchorDiscriminator(init.namespace, init.name);
    const label = init.namespace ? `${init.namespace}:${init.name}` : init.name;
    
    const result = await testDiscriminator(discriminator, label);
    if (result.success) {
      return result;
    }
  }
  
  console.log("\n❌ All discriminators failed.");
  return { success: false };
}

// Run the main function
main()
  .then(result => {
    if (result.success) {
      console.log("\n✅ Found working discriminator!");
      process.exit(0);
    } else {
      console.log("\n❌ Could not find working discriminator.");
      process.exit(1);
    }
  })
  .catch(err => {
    console.error("\nUnhandled error:", err);
    process.exit(1);
  });
