/**
 * fix-discriminator.js - Tries multiple initialization function signatures to find the correct discriminator
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

// Define possible initialization functions
const initFunctions = [
  // From lib.rs (first function signature)
  {
    name: "initialize_launch",
    namespace: "instruction", // Try various namespaces
    args: {
      basePriceLamports: 10_000_000, // 0.01 SOL
      slopeLamports: 100_000, // 0.0001 SOL per token
      feeBps: 50, // 0.5%
      creatorFeeBps: 250, // 2.5%
      graduationTargetLamports: 10_000_000_000 // 10 SOL
    },
    encodeForLibRs: (args, discriminator) => {
      // Create buffer for discriminator + args
      const buffer = Buffer.alloc(8 + 8 + 8 + 2 + 2 + 8);
      
      // Write discriminator
      discriminator.copy(buffer, 0);
      
      // Write parameters
      let offset = 8;
      buffer.writeBigUInt64LE(BigInt(args.basePriceLamports), offset); offset += 8;
      buffer.writeBigUInt64LE(BigInt(args.slopeLamports), offset); offset += 8;
      buffer.writeUInt16LE(args.feeBps, offset); offset += 2;
      buffer.writeUInt16LE(args.creatorFeeBps, offset); offset += 2;
      buffer.writeBigUInt64LE(BigInt(args.graduationTargetLamports), offset);
      
      return buffer;
    }
  },
  // From instructions/initialize_launch.rs (second function signature)
  {
    name: "initialize_launch",
    namespace: "global", // Try various namespaces
    args: {
      name: "funtoken.grok",
      symbol: "FUN",
      priceState: {
        trancheSize: 1_000_000_000,
        basePriceLamports: 10_000_000,
        stepBps: 200 
      }
    },
    encodeForInstructionsRs: (args, discriminator) => {
      // Calculate buffer size
      const nameBytes = Buffer.from(args.name);
      const symbolBytes = Buffer.from(args.symbol);
      const bufferSize = 8 + // discriminator
                        4 + nameBytes.length + // string length + bytes
                        4 + symbolBytes.length + // string length + bytes
                        8 + 8 + 2; // PriceState (trancheSize, basePriceLamports, stepBps)
      
      const buffer = Buffer.alloc(bufferSize);
      
      // Write discriminator
      discriminator.copy(buffer, 0);
      
      // Write name (Rust String = 4-byte length + bytes)
      let offset = 8;
      buffer.writeUInt32LE(nameBytes.length, offset); offset += 4;
      nameBytes.copy(buffer, offset); offset += nameBytes.length;
      
      // Write symbol
      buffer.writeUInt32LE(symbolBytes.length, offset); offset += 4;
      symbolBytes.copy(buffer, offset); offset += symbolBytes.length;
      
      // Write PriceState
      buffer.writeBigUInt64LE(BigInt(args.priceState.trancheSize), offset); offset += 8;
      buffer.writeBigUInt64LE(BigInt(args.priceState.basePriceLamports), offset); offset += 8;
      buffer.writeUInt16LE(args.priceState.stepBps, offset);
      
      return buffer;
    }
  }
];

// Generate Anchor discriminator (SHA256 hash of namespace:name)
function generateAnchorDiscriminator(namespace, name) {
  const preimage = namespace ? `${namespace}:${name}` : name;
  console.log(`  Generating discriminator for "${preimage}"`);
  const hash = crypto.createHash('sha256').update(preimage).digest();
  return hash.slice(0, 8);
}

// Try multiple namespace combinations
const namespaces = [
  "global",      // Most common in Anchor
  "instruction", // Another common one
  "ix",          // Shorter version
  "",            // No namespace
  "program"      // Less common
];

// Create test cases with different namespaces
const testCases = [];
initFunctions.forEach(func => {
  namespaces.forEach(namespace => {
    const discriminator = generateAnchorDiscriminator(namespace, func.name);
    testCases.push({
      label: `${namespace ? namespace + ':' : ''}${func.name} (lib.rs style)`,
      discriminator,
      data: func.encodeForLibRs(func.args, discriminator)
    });
    
    if (func.encodeForInstructionsRs) {
      testCases.push({
        label: `${namespace ? namespace + ':' : ''}${func.name} (instructions/rs style)`,
        discriminator,
        data: func.encodeForInstructionsRs(func.args, discriminator)
      });
    }
  });
});

// Also test hardcoded discriminator from test-fixed.js
testCases.push({
  label: "Hardcoded from test-fixed.js",
  discriminator: Buffer.from([30, 120, 39, 212, 120, 168, 29, 81]),
  data: initFunctions[0].encodeForLibRs(
    initFunctions[0].args, 
    Buffer.from([30, 120, 39, 212, 120, 168, 29, 81])
  )
});

// Function to test an initialization with a specific discriminator
async function testInitialization(testCase) {
  console.log(`\n=== Testing: ${testCase.label} ===`);
  console.log(`Discriminator bytes: [${Array.from(testCase.discriminator)}]`);
  
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
    
    // Create initialization instruction using the test case data
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
      data: testCase.data
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
      
      console.log(`\n✅ SUCCESS with "${testCase.label}"!`);
      console.log(`Transaction signature: ${initSig}`);
      
      // Verify state account
      console.log("\nVerifying state account...");
      const stateAccount = await connection.getAccountInfo(statePda);
      if (!stateAccount) {
        console.log("❌ State account not created!");
      } else {
        console.log("✅ State account created successfully with size:", stateAccount.data.length);
      }
      
      // Save the successful discriminator info
      const result = {
        discriminatorLabel: testCase.label,
        discriminatorBytes: Array.from(testCase.discriminator),
        mint: mint.toString(),
        authorityPda: authorityPda.toString(),
        statePda: statePda.toString(),
        vaultSolPda: vaultSolPda.toString(),
        vaultAta: vaultAta.address.toString(),
        signature: initSig,
        timestamp: new Date().toISOString()
      };
      
      fs.writeFileSync('successful-setup.json', JSON.stringify(result, null, 2));
      console.log("\nSuccessful setup saved to successful-setup.json");
      
      return { success: true, signature: initSig, mint: mint.toString() };
    } catch (error) {
      if (error.message && (error.message.includes('Custom program error: 0x65') || 
                        error.message.includes('Custom(101)'))) {
        console.log(`❌ Failed with InstructionFallbackNotFound (error 101)`);
      } else if (error.message && error.message.includes('IllegalOwner')) {
        console.log(`❓ Failed with IllegalOwner error - might be close to correct!`);
        if (error.logs) {
          error.logs
            .filter(log => log.includes("Program log:") || log.includes("Program failed"))
            .forEach(log => console.log("  " + log));
        }
      } else {
        console.log(`❓ Failed with error: ${error.message}`);
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
  console.log("=== TESTING MULTIPLE DISCRIMINATORS AND FUNCTION SIGNATURES ===");
  console.log("Program ID:", PROGRAM_ID.toString());
  console.log("Wallet:", wallet.publicKey.toString());
  
  // Get wallet balance
  const balance = await connection.getBalance(wallet.publicKey);
  console.log(`Wallet balance: ${balance / LAMPORTS_PER_SOL} SOL\n`);
  
  // Test each case until we find a working one
  for (const testCase of testCases) {
    const result = await testInitialization(testCase);
    if (result.success) {
      console.log("\n✅ Found working discriminator and function signature!");
      return result;
    }
    // Brief pause between tests
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log("\n❌ All test cases failed.");
  return { success: false };
}

// Run the main function
main()
  .then(result => {
    if (result.success) {
      console.log("\n✅ Found working initialization method!");
      process.exit(0);
    } else {
      console.log("\n❌ Could not find working initialization method.");
      process.exit(1);
    }
  })
  .catch(err => {
    console.error("\nUnhandled error:", err);
    process.exit(1);
  });
