const { Connection, PublicKey, Keypair, SystemProgram, SYSVAR_RENT_PUBKEY, TransactionInstruction, Transaction, sendAndConfirmTransaction } = require('@solana/web3.js');
const { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getOrCreateAssociatedTokenAccount } = require('@solana/spl-token');
const anchor = require('@coral-xyz/anchor');
const fs = require('fs');
const path = require('path');
const BN = anchor.BN;
const { PROGRAM_ID } = require('./config');

// Constants
const LAMPORTS_PER_SOL = 1_000_000_000;

async function main() {
  if (process.argv.length < 3) {
    console.error("Please provide the mint address as an argument");
    process.exit(1);
  }
  
  const mintAddress = process.argv[2];
  console.log('Using mint:', mintAddress);
  
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
    
    // Program ID and mint
    const programId = PROGRAM_ID;
    const mint = new PublicKey(mintAddress);
    
    // Derive PDAs
    const [authorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("launch"), mint.toBuffer()], 
      programId
    );
    
    const [statePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("launch_state"), mint.toBuffer()],
      programId
    );
    
    const [vaultSolPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_sol"), mint.toBuffer()],
      programId
    );
    
    // Get vault ATA
    const vaultAta = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet,
      mint,
      authorityPda,
      true
    );
    
    // Create manual initialize launch instruction
    console.log('Creating initialize launch instruction...');
    
    // Parameters for initialize_launch
    const basePriceLamports = 1_000_000; // 0.001 SOL
    const slopeLamports = 100_000;       // +0.0001 SOL per unit
    const feeBps = 300;                 // 3%
    const creatorFeeBps = 100;          // 1%
    const graduationTargetLamports = 2 * LAMPORTS_PER_SOL; // 2 SOL
    
    // Load IDL to get the instruction discriminator
    const idlPath = path.join(__dirname, '..', 'target', 'idl', 'grokpad.json');
    const idlFile = fs.readFileSync(idlPath, 'utf8');
    const idl = JSON.parse(idlFile);
    
    // Manually create the initialize_launch instruction data
    // This is a workaround to avoid using the complex anchor Program class
    const dataLayout = anchor.borsh.struct([
      anchor.borsh.u64('basePriceLamports'),
      anchor.borsh.u64('slopeLamports'),
      anchor.borsh.u16('feeBps'),
      anchor.borsh.u16('creatorFeeBps'),
      anchor.borsh.u64('graduationTargetLamports')
    ]);
    
    // Get initialize_launch discriminator
    const initializeDiscriminator = anchor.sighash.sighash('global:initializeLaunch');
    
    // Create the instruction data
    const data = Buffer.alloc(1000);
    data.set(initializeDiscriminator, 0);
    const length = dataLayout.encode(
      {
        basePriceLamports: new BN(basePriceLamports),
        slopeLamports: new BN(slopeLamports),
        feeBps: feeBps,
        creatorFeeBps: creatorFeeBps,
        graduationTargetLamports: new BN(graduationTargetLamports)
      },
      data,
      8 // offset after discriminator
    ) + 8; // add discriminator length

    // Create the initialize instruction
    const initializeLaunchIx = new TransactionInstruction({
      programId,
      keys: [
        { pubkey: wallet.publicKey, isSigner: true, isWritable: true }, // payer
        { pubkey: wallet.publicKey, isSigner: false, isWritable: false }, // creator
        { pubkey: wallet.publicKey, isSigner: false, isWritable: false }, // platformFeeRecipient
        { pubkey: mint, isSigner: false, isWritable: false }, // mint
        { pubkey: authorityPda, isSigner: false, isWritable: false }, // authorityPda
        { pubkey: statePda, isSigner: false, isWritable: true }, // statePda
        { pubkey: vaultSolPda, isSigner: false, isWritable: true }, // vaultSolPda
        { pubkey: vaultAta.address, isSigner: false, isWritable: true }, // vaultAta
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // systemProgram
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // tokenProgram
        { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // associatedTokenProgram
        { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false } // rent
      ],
      data: data.slice(0, length)
    });

    // Create and send transaction
    console.log('Sending initialize launch transaction...');
    const tx = new Transaction().add(initializeLaunchIx);
    const signature = await sendAndConfirmTransaction(
      connection,
      tx,
      [wallet]
    );
    console.log('Transaction successful! Signature:', signature);
    
    // Check the state account to confirm initialization
    try {
      console.log('Fetching launch state...');
      const stateAccount = await connection.getAccountInfo(statePda);
      if (stateAccount) {
        console.log('Launch state account exists with size:', stateAccount.data.length);
      } else {
        console.log('Launch state account does not exist');
      }
    } catch (e) {
      console.error('Failed to fetch launch state:', e);
    }
    
  } catch (error) {
    console.error('Error:', error);
  }
}

main();
