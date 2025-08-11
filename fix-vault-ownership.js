/**
 * fix-vault-ownership.js - Script to fix the vault_sol_pda ownership issue
 * 
 * This script verifies and ensures that the vault_sol_pda account is owned by the System Program,
 * as required by the Solana bonding curve contract.
 */
const { 
  Connection, 
  PublicKey, 
  Keypair,
  Transaction,
  sendAndConfirmTransaction 
} = require('@solana/web3.js');
const fs = require('fs');

// Connect to the local network
const connection = new Connection('http://localhost:8899', 'confirmed');

// Load the wallet keypair
const wallet = Keypair.fromSecretKey(
  Buffer.from(JSON.parse(fs.readFileSync(require('os').homedir() + '/.config/solana/id.json', 'utf-8')))
);

// Define constants
const PROGRAM_ID = new PublicKey('CYUSvq2vmNZ4rcyhfKyfaTKvfeH3doxyqx69ifV3w3TP');
const MINT_ADDRESS = new PublicKey('2DYrK8AQrr9EyPb4F2nP16Dw5F4kTYxWGLMHPgC5Bmdb');

// Seeds for PDAs
const LAUNCH_SEED = Buffer.from('launch');
const STATE_SEED = Buffer.from('launch_state');
const VAULT_SOL_SEED = Buffer.from('vault_sol');

// Generate PDA for the vault
const [vaultSolPda, vaultSolBump] = PublicKey.findProgramAddressSync(
  [VAULT_SOL_SEED, MINT_ADDRESS.toBuffer()],
  PROGRAM_ID
);

async function main() {
  console.log("=====================================================");
  console.log("VAULT SOL PDA OWNERSHIP FIX");
  console.log("=====================================================");
  
  console.log("Wallet address:", wallet.publicKey.toString());
  console.log("Program ID:", PROGRAM_ID.toString());
  console.log("Mint Address:", MINT_ADDRESS.toString());
  console.log("Vault SOL PDA:", vaultSolPda.toString(), "(bump:", vaultSolBump, ")");
  
  try {
    // Check if the vault account exists and its owner
    const vaultAccountInfo = await connection.getAccountInfo(vaultSolPda);
    if (!vaultAccountInfo) {
      console.log("\nVault SOL PDA account does not exist yet.");
      console.log("This is normal - it will be created during initialization.");
      console.log("\nWhen created, the vault should be owned by the System Program.");
      return { success: true, exists: false };
    }
    
    const systemProgramId = new PublicKey('11111111111111111111111111111111');
    console.log("\nVault SOL PDA account exists with:");
    console.log("- Size:", vaultAccountInfo.data.length, "bytes");
    console.log("- Owner:", vaultAccountInfo.owner.toString());
    console.log("- Lamports:", vaultAccountInfo.lamports);
    
    if (vaultAccountInfo.owner.equals(systemProgramId)) {
      console.log("\n✅ Vault SOL PDA is correctly owned by the System Program.");
      return { success: true, exists: true, correctOwner: true };
    } else {
      console.log("\n❌ Vault SOL PDA is NOT owned by the System Program!");
      console.log("This will cause the 'Provided owner is not allowed' error during initialization.");
      
      // NOTE: If the account exists with a wrong owner, we can't easily change the ownership in Solana.
      // A proper solution might require creating a new transaction that:
      // 1. Transfers lamports out of the wrong account
      // 2. Closes the wrong account
      // 3. Lets the initialization process create a new account
      
      console.log("\nSOLUTION:");
      console.log("1. Since we can't directly change account ownership in Solana, we need to use a fresh address");
      console.log("2. Either create a new mint or reset your test validator");
      console.log("3. Then run the initialization script with a fresh set of PDAs");
      
      return { success: false, exists: true, correctOwner: false };
    }
  } catch (error) {
    console.error("\nError checking vault account:", error.message);
    return { success: false, error: error.message };
  }
}

// Run if executed directly
if (require.main === module) {
  main()
    .then(result => {
      if (result.success) {
        console.log("\n✅ Vault check completed successfully");
        process.exit(0);
      } else {
        console.error("\n❌ Vault check failed");
        process.exit(1);
      }
    })
    .catch(err => {
      console.error("Unhandled error:", err);
      process.exit(1);
    });
}

module.exports = { main };
