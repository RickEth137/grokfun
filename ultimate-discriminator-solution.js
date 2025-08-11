/**
 * ultimate-discriminator-solution.js - Try all possible discriminator combinations
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

// Connect to local Solana node
const connection = new Connection('http://localhost:8899', 'confirmed');

// Load wallet
const walletPath = process.env.ANCHOR_WALLET || path.join(process.env.HOME, '.config', 'solana', 'id.json');
const secretKeyString = fs.readFileSync(walletPath, { encoding: 'utf8' });
const secretKey = Uint8Array.from(JSON.parse(secretKeyString));
const wallet = Keypair.fromSecretKey(secretKey);

// Program ID
const PROGRAM_ID = new PublicKey('CYUSvq2vmNZ4rcyhfKyfaTKvfeH3doxyqx69ifV3w3TP');

// All possible discriminators to try
const ALL_DISCRIMINATORS = [
  // Snake case with namespace
  {
    name: "global:initialize_launch",
    value: Buffer.from([90, 201, 220, 142, 112, 253, 100, 13])
  },
  {
    name: "instruction:initialize_launch",
    value: Buffer.from([155, 134, 187, 141, 192, 152, 38, 149])
  },
  {
    name: "ix:initialize_launch",
    value: Buffer.from([145, 217, 141, 47, 145, 203, 38, 229])
  },
  {
    name: "(no namespace):initialize_launch",
    value: Buffer.from([221, 70, 114, 116, 252, 79, 81, 113])
  },
  
  // Camel case with namespace
  {
    name: "global:initializeLaunch",
    value: Buffer.from([121, 216, 212, 88, 151, 155, 212, 28])
  },
  {
    name: "instruction:initializeLaunch",
    value: Buffer.from([54, 99, 252, 163, 35, 218, 193, 158])
  },
  {
    name: "ix:initializeLaunch",
    value: Buffer.from([221, 29, 95, 249, 16, 201, 114, 171])
  },
  {
    name: "(no namespace):initializeLaunch",
    value: Buffer.from([201, 162, 246, 224, 199, 30, 202, 196])
  },
  
  // From test-fixed.js
  {
    name: "From test-fixed.js",
    value: Buffer.from([30, 120, 39, 212, 120, 168, 29, 81])
  },
  
  // Binary values
  {
    name: "Instruction 0",
    value: Buffer.concat([Buffer.from([0]), Buffer.alloc(7)])
  },
  {
    name: "Instruction 1",
    value: Buffer.concat([Buffer.from([1]), Buffer.alloc(7)])
  }
];

async function main() {
  console.log("=== BONDING CURVE INITIALIZATION WITH ALL DISCRIMINATORS ===");
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
  
  // Initialize launch parameters
  const basePriceLamports = 1_000_000; // 0.001 SOL
  const slopeLamports = 100_000; // 0.0001 SOL per token
  const feeBps = 300; // 3.00%
  const creatorFeeBps = 100; // 1.00%
  const graduationTargetLamports = 2 * 1_000_000_000; // 2 SOL
  
  // Try each discriminator until one works
  for (const disc of ALL_DISCRIMINATORS) {
    console.log(`\n=== TRYING DISCRIMINATOR: ${disc.name} [${Array.from(disc.value)}] ===`);
    
    try {
      // Construct initialization data with current discriminator
      const initData = Buffer.alloc(8 + 8 + 8 + 2 + 2 + 8);
      disc.value.copy(initData, 0);
      
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
      
      const initSig = await sendAndConfirmTransaction(
        connection, 
        initTx, 
        [wallet], 
        { commitment: 'confirmed', skipPreflight: true }
      );
      
      console.log("\n✅ SUCCESS! Discriminator worked!");
      console.log(`Transaction signature: ${initSig}`);
      
      // Verify state account
      console.log("\nVerifying state account...");
      const stateAccount = await connection.getAccountInfo(statePda);
      if (!stateAccount) {
        console.log("❌ State account not created!");
      } else {
        console.log("✅ State account created with size:", stateAccount.data.length, "bytes");
      }
      
      // Save the successful setup
      const config = {
        programId: PROGRAM_ID.toString(),
        mint: mint.toString(),
        authorityPda: authorityPda.toString(),
        statePda: statePda.toString(),
        vaultSolPda: vaultSolPda.toString(),
        vaultAta: vaultAta.address.toString(),
        discriminatorName: disc.name,
        discriminatorValue: Array.from(disc.value),
        signature: initSig,
        timestamp: new Date().toISOString()
      };
      
      fs.writeFileSync('successful-setup.json', JSON.stringify(config, null, 2));
      console.log("\nConfig saved to successful-setup.json");
      
      return true;
    } catch (error) {
      console.log("\n❌ Discriminator failed:");
      console.log("Error:", error.message);
      
      // Try to get detailed logs
      if (error.logs) {
        error.logs
          .filter(log => log.includes("Program log:") || log.includes("Program failed"))
          .forEach(log => console.log("  " + log));
      }
      
      // Continue to next discriminator
      console.log("\nTrying next discriminator...");
    }
  }
  
  console.log("\n❌ All discriminators failed.");
  return false;
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
