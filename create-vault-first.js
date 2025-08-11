/**
 * create-vault-first.js - Manually creates the vault account with System Program ownership
 * 
 * This script creates the vault_sol_pda account first with System Program ownership
 * before attempting to initialize the bonding curve.
 */
const { 
  Connection, 
  PublicKey, 
  Keypair, 
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction 
} = require('@solana/web3.js');
const {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount
} = require('@solana/spl-token');
const fs = require('fs');
const BN = require('bn.js');

// Connect to the local network
const connection = new Connection('http://localhost:8899', 'confirmed');

// Load the wallet keypair
const wallet = Keypair.fromSecretKey(
  Buffer.from(JSON.parse(fs.readFileSync(require('os').homedir() + '/.config/solana/id.json', 'utf-8')))
);

// Define constants
const PROGRAM_ID = new PublicKey('CYUSvq2vmNZ4rcyhfKyfaTKvfeH3doxyqx69ifV3w3TP');
const MINT_ADDRESS = new PublicKey('E5v4HtR78Sh4sh1MxRhugRQnTnfSuhaJ437oJdtq7Z6o');

// Seeds for PDAs
const LAUNCH_SEED = Buffer.from('launch');
const STATE_SEED = Buffer.from('launch_state');
const VAULT_SOL_SEED = Buffer.from('vault_sol');

// Generate PDAs
const [authorityPda, authorityBump] = PublicKey.findProgramAddressSync(
  [LAUNCH_SEED, MINT_ADDRESS.toBuffer()],
  PROGRAM_ID
);

const [statePda, stateBump] = PublicKey.findProgramAddressSync(
  [STATE_SEED, MINT_ADDRESS.toBuffer()],
  PROGRAM_ID
);

const [vaultSolPda, vaultSolBump] = PublicKey.findProgramAddressSync(
  [VAULT_SOL_SEED, MINT_ADDRESS.toBuffer()],
  PROGRAM_ID
);

async function createVaultAccount() {
  console.log("=====================================================");
  console.log("CREATING VAULT SOL PDA ACCOUNT");
  console.log("=====================================================");
  
  console.log("Wallet:", wallet.publicKey.toString());
  console.log("Program ID:", PROGRAM_ID.toString());
  console.log("Mint Address:", MINT_ADDRESS.toString());
  
  console.log("\nPDAs:");
  console.log("Authority PDA:", authorityPda.toString());
  console.log("State PDA:", statePda.toString());
  console.log("Vault SOL PDA:", vaultSolPda.toString());
  
  try {
    // Check if vault account already exists
    console.log("\nChecking if vault SOL PDA already exists...");
    const vaultAccount = await connection.getAccountInfo(vaultSolPda);
    
    if (vaultAccount) {
      console.log("Vault SOL PDA already exists with:");
      console.log("- Owner:", vaultAccount.owner.toString());
      console.log("- Size:", vaultAccount.data.length);
      console.log("- Lamports:", vaultAccount.lamports);
      
      const isSystemOwned = vaultAccount.owner.equals(SystemProgram.programId);
      if (isSystemOwned) {
        console.log("\n✅ Vault already has correct ownership (System Program)");
        return { success: true, alreadyExists: true };
      } else {
        console.log("\n❌ Vault has incorrect ownership");
        console.log("Current owner:", vaultAccount.owner.toString());
        console.log("Expected owner: System Program");
        console.log("\nRecommended action: Reset validator and try again with a fresh mint");
        return { success: false, alreadyExists: true };
      }
    }
    
    // Create a transaction to create an empty account owned by System Program
    console.log("\nCreating vault SOL PDA account with System Program ownership...");
    
    // Calculate rent exemption
    const lamports = await connection.getMinimumBalanceForRentExemption(0);
    console.log("Required lamports for rent exemption:", lamports);
    
    // Create a transaction to allocate the vault
    const transaction = new Transaction().add(
      SystemProgram.createAccountWithSeed({
        fromPubkey: wallet.publicKey,
        newAccountPubkey: vaultSolPda,
        basePubkey: wallet.publicKey,
        seed: vaultSolPda.toString().slice(0, 32),
        lamports,
        space: 0,
        programId: SystemProgram.programId
      })
    );
    
    console.log("\nSending transaction to create vault...");
    
    try {
      const signature = await sendAndConfirmTransaction(
        connection, 
        transaction, 
        [wallet]
      );
      console.log("\n✅ Transaction successful!");
      console.log("Signature:", signature);
      
      // Verify the vault was created with correct ownership
      const vaultAfter = await connection.getAccountInfo(vaultSolPda);
      if (vaultAfter) {
        console.log("\nVault SOL PDA account created with:");
        console.log("- Owner:", vaultAfter.owner.toString());
        console.log("- Size:", vaultAfter.data.length);
        console.log("- Lamports:", vaultAfter.lamports);
        
        const isSystemOwned = vaultAfter.owner.equals(SystemProgram.programId);
        if (isSystemOwned) {
          console.log("\n✅ Vault has correct ownership (System Program)");
          return { success: true, created: true };
        } else {
          console.log("\n❌ Vault created but has incorrect ownership");
          return { success: false, created: true };
        }
      } else {
        console.log("\n❌ Failed to create vault account");
        return { success: false, created: false };
      }
    } catch (error) {
      console.error("\n❌ Failed to create vault account:", error.message);
      
      if (error.message.includes("would result in a PDA with a different address than expected")) {
        console.log("\nThis is expected for PDA accounts. Let's try using pre-initialization.");
        console.log("Running anchor-initialize.js should initialize the account with the correct owner.");
        return { success: false, reason: "PDA address mismatch" };
      }
      
      return { success: false, error: error.message };
    }
  } catch (error) {
    console.error("\n❌ Error:", error.message);
    return { success: false, error: error.message };
  }
}

// Run if executed directly
if (require.main === module) {
  createVaultAccount()
    .then(result => {
      if (result.success) {
        console.log("\n✅ Vault setup completed successfully");
        console.log("Now proceed with initialization using anchor-initialize.js");
        process.exit(0);
      } else {
        console.error("\n❌ Vault setup failed");
        console.log("Please try resetting the validator and creating a fresh mint");
        process.exit(1);
      }
    })
    .catch(err => {
      console.error("\nUnhandled error:", err);
      process.exit(1);
    });
}

module.exports = { createVaultAccount };
