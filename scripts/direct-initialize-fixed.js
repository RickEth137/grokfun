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
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddress,
  getAccount
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

// Define the mint address from our newly created mint
const mint = new PublicKey('2DYrK8AQrr9EyPb4F2nP16Dw5F4kTYxWGLMHPgC5Bmdb');

// Define the program ID (this should match what's in the Rust code)
const programId = new PublicKey('CYUSvq2vmNZ4rcyhfKyfaTKvfeH3doxyqx69ifV3w3TP');

// Seeds for PDAs
const LAUNCH_SEED = Buffer.from('launch');
const STATE_SEED = Buffer.from('launch_state');
const VAULT_SOL_SEED = Buffer.from('vault_sol');

// Find PDAs using the seeds
const findPDA = (seeds) => {
  return PublicKey.findProgramAddressSync(seeds, programId);
};

const [authorityPda, _authorityBump] = findPDA([LAUNCH_SEED, mint.toBuffer()]);
const [statePda, _stateBump] = findPDA([STATE_SEED, mint.toBuffer()]);
const [vaultSolPda, _vaultSolBump] = findPDA([VAULT_SOL_SEED, mint.toBuffer()]);

// Get the vault ATA
const getVaultAta = async () => {
  return getAssociatedTokenAddress(
    mint,
    authorityPda,
    true // allowOwnerOffCurve
  );
};

// Define the platform fee recipient and creator as the wallet for testing purposes
const platformFeeRecipient = wallet.publicKey;
const creator = wallet.publicKey;

// Define launch parameters
const feeBps = 50; // 0.5% fee
const creatorFeeBps = 250; // 2.5% creator fee
const basePriceLamports = new BN(10000000); // 0.01 SOL
const slopeLamports = new BN(100000); // 0.0001 SOL per token
const graduationTargetLamports = new BN(10000000000); // 10 SOL graduation target

// Compute the initialize_launch instruction discriminator using keccak256
function computeInitializeDiscriminator() {
  const hash = crypto.createHash('sha256');
  hash.update('global:initialize_launch');
  const result = hash.digest();
  return result.slice(0, 8);
}

// Create a function to serialize a big number to a little-endian 8-byte array
function serializeU64(bn) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(bn.toString()), 0);
  return buffer;
}

// Create a function to serialize a number to a little-endian 2-byte array
function serializeU16(n) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(n, 0);
  return buffer;
}

// Create a function to construct the initialize launch instruction data
const createInitializeInstructionData = () => {
  // Get the correct discriminator
  const discriminator = computeInitializeDiscriminator();
  console.log('Using discriminator:', discriminator.toString('hex'));
  
  // Prepare all parts of the instruction data
  const parts = [
    discriminator,
    serializeU64(basePriceLamports),
    serializeU64(slopeLamports),
    serializeU16(feeBps),
    serializeU16(creatorFeeBps),
    serializeU64(graduationTargetLamports),
  ];
  
  // Concatenate all parts
  return Buffer.concat(parts);
};

async function main() {
  try {
    console.log('Starting initialization...');
    console.log('Using wallet:', wallet.publicKey.toBase58());
    
    // Get the vault ATA
    const vaultAta = await getVaultAta();
    console.log('Vault ATA:', vaultAta.toBase58());
    
    // Check if the vault ATA exists
    let vaultAtaAccount;
    try {
      vaultAtaAccount = await getAccount(connection, vaultAta);
      console.log('Vault ATA exists');
    } catch (e) {
      console.log('Vault ATA does not exist, creating it...');
      const createAtaIx = createAssociatedTokenAccountInstruction(
        wallet.publicKey, // payer
        vaultAta, // associatedToken
        authorityPda, // owner
        mint // mint
      );
      
      const tx = new Transaction().add(createAtaIx);
      const signature = await sendAndConfirmTransaction(connection, tx, [wallet]);
      console.log('Created vault ATA. Signature:', signature);
    }
    
    console.log('\nProgram addresses:');
    console.log('Program ID:', programId.toBase58());
    console.log('Authority PDA:', authorityPda.toBase58());
    console.log('State PDA:', statePda.toBase58());
    console.log('Vault SOL PDA:', vaultSolPda.toBase58());
    console.log('Vault ATA:', vaultAta.toBase58());
    
    console.log('\nLaunch parameters:');
    console.log('Base Price:', basePriceLamports.toString(), 'lamports');
    console.log('Slope:', slopeLamports.toString(), 'lamports');
    console.log('Fee BPS:', feeBps);
    console.log('Creator Fee BPS:', creatorFeeBps);
    console.log('Graduation Target:', graduationTargetLamports.toString(), 'lamports');
    
    // Create the instruction data
    const instructionData = createInitializeInstructionData();
    console.log('\nInstruction data (hex):', instructionData.toString('hex'));
    
    // Create the initialize launch instruction
    const instruction = {
      programId,
      keys: [
        { pubkey: wallet.publicKey, isSigner: true, isWritable: true }, // payer
        { pubkey: creator, isSigner: false, isWritable: false }, // creator
        { pubkey: platformFeeRecipient, isSigner: false, isWritable: false }, // platformFeeRecipient
        { pubkey: mint, isSigner: false, isWritable: false }, // mint
        { pubkey: authorityPda, isSigner: false, isWritable: false }, // authorityPda
        { pubkey: statePda, isSigner: false, isWritable: true }, // statePda
        { pubkey: vaultSolPda, isSigner: false, isWritable: true }, // vaultSolPda
        { pubkey: vaultAta, isSigner: false, isWritable: true }, // vaultAta
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // systemProgram
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // tokenProgram
        { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // associatedTokenProgram
        { pubkey: new PublicKey('SysvarRent111111111111111111111111111111111'), isSigner: false, isWritable: false }, // rent
      ],
      data: instructionData
    };
    
    // Create and send the transaction
    const transaction = new Transaction().add(instruction);
    const signature = await sendAndConfirmTransaction(connection, transaction, [wallet]);
    console.log('\nTransaction signature:', signature);
    
    console.log('Initialization successful!');
    
    // Fetch the state account to verify
    const stateAccount = await connection.getAccountInfo(statePda);
    console.log('State account exists:', !!stateAccount);
    console.log('State account size:', stateAccount ? stateAccount.data.length : 0);
    
    console.log('Done!');
  } catch (error) {
    console.error('Error:', error);
    if (error.logs) {
      console.error('Program logs:', error.logs);
    }
  }
}

main();