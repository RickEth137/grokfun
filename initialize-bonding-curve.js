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
  getOrCreateAssociatedTokenAccount
} = require('@solana/spl-token');
const fs = require('fs');
const BN = require('bn.js');
const crypto = require('crypto');

// Connect to the cluster
const connection = new Connection('http://localhost:8899', 'confirmed');

// Load the wallet keypair from the default solana config file
const wallet = Keypair.fromSecretKey(
  Buffer.from(JSON.parse(fs.readFileSync(require('os').homedir() + '/.config/solana/id.json', 'utf-8')))
);

// Define the mint address from our created mint
const mint = new PublicKey('2DYrK8AQrr9EyPb4F2nP16Dw5F4kTYxWGLMHPgC5Bmdb');

// Define the program ID (matches what's in the Rust code)
const programId = new PublicKey('CYUSvq2vmNZ4rcyhfKyfaTKvfeH3doxyqx69ifV3w3TP');

// Seeds for PDAs
const LAUNCH_SEED = Buffer.from('launch');
const STATE_SEED = Buffer.from('launch_state');
const VAULT_SOL_SEED = Buffer.from('vault_sol');

// Find PDAs using the seeds
const findPDA = (seeds) => {
  return PublicKey.findProgramAddressSync(seeds, programId);
};

// Calculate the PDAs
const [authorityPda, _authorityBump] = findPDA([LAUNCH_SEED, mint.toBuffer()]);
const [statePda, _stateBump] = findPDA([STATE_SEED, mint.toBuffer()]);
const [vaultSolPda, _vaultSolBump] = findPDA([VAULT_SOL_SEED, mint.toBuffer()]);

// Define the platform fee recipient and creator as the wallet for testing purposes
const platformFeeRecipient = wallet.publicKey;
const creator = wallet.publicKey;

// Define launch parameters
const feeBps = 50; // 0.5% fee
const creatorFeeBps = 250; // 2.5% creator fee
const basePriceLamports = new BN(10000000); // 0.01 SOL
const slopeLamports = new BN(100000); // 0.0001 SOL per token
const graduationTargetLamports = new BN(10000000000); // 10 SOL graduation target

// Anchor sighash function implementation
function sighash(nameSpace, name) {
  // Use the same namespace as the successful script: "global"
  const preimage = `${nameSpace}:${name}`;
  const preimageBuffer = Buffer.from(preimage, 'utf8');
  const hash = crypto.createHash('sha256').update(preimageBuffer).digest();
  return hash.slice(0, 8);
}

// Borsh serialization for BN (u64) - little-endian 8-byte
function serializeU64(bn) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(bn.toString()), 0);
  return buffer;
}

// Borsh serialization for u16 - little-endian 2-byte
function serializeU16(n) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(n, 0);
  return buffer;
}

// Manual borsh encoding for the initializeLaunch arguments
function encodeInitializeArgs() {
  // Use the hardcoded working discriminator from direct-initialize-fixed.js
  const discriminator = Buffer.from([121, 216, 212, 88, 151, 155, 212, 28]);
  
  // Allocate buffer for the instruction data:
  // 8 (discriminator) + 8 (basePriceLamports) + 8 (slopeLamports) + 2 (feeBps) + 2 (creatorFeeBps) + 8 (graduationTargetLamports)
  const buffer = Buffer.alloc(8 + 8 + 8 + 2 + 2 + 8);
  
  // Write discriminator
  discriminator.copy(buffer, 0);
  
  // Write basePriceLamports
  serializeU64(basePriceLamports).copy(buffer, 8);
  
  // Write slopeLamports
  serializeU64(slopeLamports).copy(buffer, 16);
  
  // Write feeBps
  serializeU16(feeBps).copy(buffer, 24);
  
  // Write creatorFeeBps
  serializeU16(creatorFeeBps).copy(buffer, 26);
  
  // Write graduationTargetLamports
  serializeU64(graduationTargetLamports).copy(buffer, 28);
  
  return buffer;
}

async function main() {
  try {
    console.log('Starting initialization of the bonding curve...');
    console.log('Using wallet:', wallet.publicKey.toBase58());
    console.log('Using mint:', mint.toBase58());
    console.log('Program ID:', programId.toBase58());
    
    console.log('\nPDA addresses:');
    console.log('Authority PDA:', authorityPda.toBase58());
    console.log('State PDA:', statePda.toBase58());
    console.log('Vault SOL PDA:', vaultSolPda.toBase58());
    
    // Get or create the vault ATA with the PDA as owner
    console.log('\nSetting up vault ATA...');
    const vaultAta = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet, // payer
      mint,
      authorityPda,
      true // allowOwnerOffCurve - critical for using a PDA as owner
    );
    console.log('Vault ATA created at:', vaultAta.address.toBase58());
    
    console.log('\nLaunch parameters:');
    console.log('Base Price:', basePriceLamports.toString(), 'lamports');
    console.log('Slope:', slopeLamports.toString(), 'lamports');
    console.log('Fee BPS:', feeBps);
    console.log('Creator Fee BPS:', creatorFeeBps);
    console.log('Graduation Target:', graduationTargetLamports.toString(), 'lamports');
    
    // Create the instruction data
    const instructionData = encodeInitializeArgs();
    const discriminator = sighash("instruction", "initializeLaunch");
    console.log('\nUsing discriminator:', Buffer.from(discriminator).toString('hex'));
    
    // Create the initialize launch instruction
    const instruction = new TransactionInstruction({
      programId,
      keys: [
        { pubkey: wallet.publicKey, isSigner: true, isWritable: true }, // payer

        { pubkey: creator, isSigner: false, isWritable: false }, // creator
        { pubkey: platformFeeRecipient, isSigner: false, isWritable: false }, // platformFeeRecipient
        { pubkey: mint, isSigner: false, isWritable: false }, // mint
        { pubkey: authorityPda, isSigner: false, isWritable: false }, // authorityPda
        { pubkey: statePda, isSigner: false, isWritable: true }, // statePda
        { pubkey: vaultSolPda, isSigner: false, isWritable: true }, // vaultSolPda
        { pubkey: vaultAta.address, isSigner: false, isWritable: true }, // vaultAta - use .address from the returned account
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // systemProgram
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // tokenProgram
        { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // associatedTokenProgram
        { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false }, // rent
      ],
      data: instructionData
    });
    
    // Create and send the transaction
    console.log('\nSending transaction...');
    const transaction = new Transaction().add(instruction);
    const signature = await sendAndConfirmTransaction(connection, transaction, [wallet]);
    console.log('Transaction signature:', signature);
    console.log('Initialization successful!');
    
    // Fetch the state account to verify
    const stateAccount = await connection.getAccountInfo(statePda);
    console.log('\nVerification:');
    console.log('State account exists:', !!stateAccount);
    console.log('State account size:', stateAccount ? stateAccount.data.length : 0);
    
    console.log('\nBonding curve initialized successfully! Ready for trading operations.');
  } catch (error) {
    console.error('Error:', error);
    if (error.logs) {
      console.error('Program logs:', error.logs);
    }
  }
}

main();
