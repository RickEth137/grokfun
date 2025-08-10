const { Connection, PublicKey } = require('@solana/web3.js');
const { TOKEN_PROGRAM_ID, getAccount } = require('@solana/spl-token');
const fs = require('fs');
const path = require('path');
const { PROGRAM_ID } = require('./config');

// Constants
const MINT_ADDRESS = "9D6nQ9ufX8hASHySDMFA8W26fPuJgtyemuDFBhi4gAxa";
const PROGRAM_ID_STR = PROGRAM_ID.toString();

async function main() {
  try {
    // Setup connection
    const connection = new Connection('http://localhost:8899', 'confirmed');
    console.log('Successfully connected to local Solana node');
    
    // Program ID and mint
    const programId = new PublicKey(PROGRAM_ID_STR);
    const mint = new PublicKey(MINT_ADDRESS);
    
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
    
    // Check if state account exists
    const stateInfo = await connection.getAccountInfo(statePda);
    if (stateInfo) {
      console.log('State account exists with size:', stateInfo.data.length);
      console.log('Raw state data:', stateInfo.data.toString('hex'));
      
      // Try to parse the state data based on the LaunchState struct
      try {
        // Basic parsing assuming the LaunchState layout is:
        // - mint: PublicKey (32 bytes)
        // - decimals: u8 (1 byte)
        // - basePriceLamports: u64 (8 bytes)
        // - slopeLamports: u64 (8 bytes)
        // - feeBps: u16 (2 bytes)
        // - creatorFeeBps: u16 (2 bytes)
        // - platformFeeRecipient: PublicKey (32 bytes)
        // - creator: PublicKey (32 bytes)
        // - graduationTargetLamports: u64 (8 bytes)
        // - graduated: bool (1 byte)
        // - supplyRemaining: u64 (8 bytes)
        // - tokensSold: u64 (8 bytes)
        // - reservesLamports: u64 (8 bytes)
        // - platformFeeAccrued: u64 (8 bytes)
        // - creatorFeeAccrued: u64 (8 bytes)
        
        // Skip 8 bytes of anchor's discriminator
        const data = stateInfo.data.slice(8);
        
        // Extract mint
        const mintKey = new PublicKey(data.slice(0, 32));
        console.log('Mint:', mintKey.toString());
        
        // Extract decimals
        const decimals = data[32];
        console.log('Decimals:', decimals);
        
        // Check if the state account is properly initialized
        console.log('State initialized:', mintKey.equals(mint) ? 'YES' : 'NO');
        
        // Get SOL balance in vault
        const vaultSolBalance = await connection.getBalance(vaultSolPda);
        console.log('Vault SOL balance:', vaultSolBalance / 1e9, 'SOL');
      } catch (e) {
        console.error('Error parsing state data:', e);
      }
    } else {
      console.log('State account does not exist. Launch not initialized.');
    }
    
    // Check if there are any tokens in the buyer's account
    try {
      // Get wallet path
      const walletPath = process.env.ANCHOR_WALLET || path.join(process.env.HOME, '.config', 'solana', 'id.json');
      const secretKeyString = fs.readFileSync(walletPath, { encoding: 'utf8' });
      const wallet = new PublicKey(JSON.parse(secretKeyString)[0]);
      
      // Get associated token address
      const buyerAta = await PublicKey.findProgramAddressSync(
        [
          wallet.toBuffer(),
          TOKEN_PROGRAM_ID.toBuffer(),
          mint.toBuffer(),
        ],
        new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')
      )[0];
      
      const buyerTokenInfo = await connection.getAccountInfo(buyerAta);
      if (buyerTokenInfo) {
        console.log('Buyer has a token account for this mint');
        try {
          const tokenAccount = await getAccount(connection, buyerAta);
          console.log('Buyer token balance:', tokenAccount.amount.toString());
        } catch (e) {
          console.log('Error getting buyer token account:', e.message);
        }
      } else {
        console.log('Buyer does not have a token account for this mint');
      }
    } catch (e) {
      console.log('Error checking buyer token account:', e.message);
    }
    
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();
