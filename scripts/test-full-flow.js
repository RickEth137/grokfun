const { Connection, PublicKey, Keypair, SystemProgram, SYSVAR_RENT_PUBKEY } = require('@solana/web3.js');
const { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, createMint, createAssociatedTokenAccount, mintTo, getAssociatedTokenAddress } = require('@solana/spl-token');
const BN = require('bn.js');
const anchor = require('@coral-xyz/anchor');
const fs = require('fs');
const path = require('path');
const { PROGRAM_ID, CLUSTER_URL } = require('./config');

// Load the IDL
const idlPath = path.join(__dirname, '..', 'grokpad-idl.json');
const idl = JSON.parse(fs.readFileSync(idlPath, 'utf8'));

// Connect to the cluster
const connection = new Connection(CLUSTER_URL, 'confirmed');

// Load the wallet from the default solana config file
const wallet = anchor.Wallet.local();
const payer = wallet.payer;

// Set up the provider
const provider = new anchor.AnchorProvider(
  connection, 
  wallet, 
  { commitment: 'confirmed' }
);
anchor.setProvider(provider);

// Program ID from config (Anchor.toml should match)
const programId = PROGRAM_ID;

// Create a program instance
const program = new anchor.Program(idl, programId, provider);

// Seeds for PDAs
const LAUNCH_SEED = Buffer.from('launch');
const STATE_SEED = Buffer.from('launch_state');
const VAULT_SOL_SEED = Buffer.from('vault_sol');

// Function to get PDA
const findPDA = async (seeds) => {
  return await PublicKey.findProgramAddress(seeds, program.programId);
};

// Main function
async function main() {
  try {
    console.log('Starting test...');
    
    // Token parameters
    const decimals = 6;
    const initialSupply = new BN(1_000_000_000).mul(new BN(10).pow(new BN(decimals))); // 1 billion tokens
    
    // Launch parameters
    const basePriceLamports = new BN(10_000_000); // 0.01 SOL base price
    const slopeLamports = new BN(100_000); // 0.0001 SOL per token price increase
    const feeBps = 50; // 0.5% platform fee
    const creatorFeeBps = 250; // 2.5% creator fee
    const graduationTargetLamports = new BN(1_000_000_000); // 1 SOL graduation target
    
    // 1. Create token mint
    console.log('Creating token mint...');
    const mint = await createMint(
      connection,
      payer,
      payer.publicKey,
      payer.publicKey,
      decimals
    );
    console.log('Token mint created:', mint.toString());
    
    // Find PDAs
    const [authorityPda, authorityBump] = await findPDA([LAUNCH_SEED, mint.toBuffer()]);
    const [statePda, stateBump] = await findPDA([STATE_SEED, mint.toBuffer()]);
    const [vaultSolPda, vaultSolBump] = await findPDA([VAULT_SOL_SEED, mint.toBuffer()]);
    
    // Create vault ATA
    const vaultAta = await getAssociatedTokenAddress(mint, authorityPda, true);
    console.log('Vault ATA:', vaultAta.toString());
    
    // Create vault ATA
    await createAssociatedTokenAccount(
      connection,
      payer,
      mint,
      authorityPda,
      true
    );
    
    // Mint tokens to vault
    await mintTo(
      connection,
      payer,
      mint,
      vaultAta,
      payer, // mint authority
      initialSupply.toNumber()
    );
    console.log('Minted', initialSupply.toString(), 'tokens to vault');
    
    // 2. Initialize launch
    console.log('Initializing launch...');
    
    // Create separate platform fee recipient and creator wallets
    const platformFeeRecipient = Keypair.generate();
    const creator = Keypair.generate();
    
    // Fund these wallets with some SOL
    await connection.requestAirdrop(platformFeeRecipient.publicKey, 1_000_000_000);
    await connection.requestAirdrop(creator.publicKey, 1_000_000_000);
    
    // Initialize the launch
    await program.methods
      .initializeLaunch(
        basePriceLamports,
        slopeLamports,
        feeBps,
        creatorFeeBps,
        graduationTargetLamports
      )
      .accounts({
        payer: payer.publicKey,
        creator: creator.publicKey,
        platformFeeRecipient: platformFeeRecipient.publicKey,
        mint: mint,
        authorityPda: authorityPda,
        statePda: statePda,
        vaultSolPda: vaultSolPda,
        vaultAta: vaultAta,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        rent: SYSVAR_RENT_PUBKEY
      })
      .rpc();
    
    console.log('Launch initialized');
    
    // Fetch the state
    const state = await program.account.launchState.fetch(statePda);
    console.log('Initial state:', {
      basePriceLamports: state.basePriceLamports.toString(),
      slopeLamports: state.slopeLamports.toString(),
      feeBps: state.feeBps,
      creatorFeeBps: state.creatorFeeBps,
      graduationTargetLamports: state.graduationTargetLamports.toString(),
      supplyRemaining: state.supplyRemaining.toString()
    });
    
    // 3. Buy tokens
    console.log('Buying tokens...');
    
    // Create buyer's token account
    const buyer = payer; // Use payer as buyer
    const buyerAta = await getAssociatedTokenAddress(mint, buyer.publicKey);
    
    // Create buyer's ATA if it doesn't exist
    try {
      await createAssociatedTokenAccount(
        connection,
        payer,
        mint,
        buyer.publicKey
      );
    } catch (e) {
      // Ignore if already exists
      console.log('Buyer ATA already exists or error:', e.message);
    }
    
    // Buy tokens
    const buyAmount = new BN(1_000_000).mul(new BN(10).pow(new BN(decimals))); // 1 million tokens
    const maxCostLamports = new BN(100_000_000_000); // 100 SOL max cost (high slippage tolerance)
    
    await program.methods
      .buy(
        buyAmount,
        maxCostLamports
      )
      .accounts({
        buyer: buyer.publicKey,
        mint: mint,
        statePda: statePda,
        authorityPda: authorityPda,
        vaultSolPda: vaultSolPda,
        vaultAta: vaultAta,
        buyerAta: buyerAta,
        platformFeeRecipient: platformFeeRecipient.publicKey,
        creator: creator.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        rent: SYSVAR_RENT_PUBKEY
      })
      .rpc();
    
    console.log('Buy transaction successful');
    
    // Fetch state after buy
    const stateAfterBuy = await program.account.launchState.fetch(statePda);
    console.log('State after buy:', {
      tokensSold: stateAfterBuy.tokensSold.toString(),
      supplyRemaining: stateAfterBuy.supplyRemaining.toString(),
      reservesLamports: stateAfterBuy.reservesLamports.toString(),
      platformFeeAccrued: stateAfterBuy.platformFeeAccrued.toString(),
      creatorFeeAccrued: stateAfterBuy.creatorFeeAccrued.toString()
    });
    
    // 4. Sell tokens
    console.log('Selling tokens...');
    
    // Sell half of the bought tokens
    const sellAmount = buyAmount.div(new BN(2));
    const minPayoutLamports = new BN(1_000_000); // 0.001 SOL minimum payout
    
    await program.methods
      .sell(
        sellAmount,
        minPayoutLamports
      )
      .accounts({
        seller: buyer.publicKey,
        mint: mint,
        statePda: statePda,
        authorityPda: authorityPda,
        vaultSolPda: vaultSolPda,
        vaultAta: vaultAta,
        sellerAta: buyerAta,
        platformFeeRecipient: platformFeeRecipient.publicKey,
        creator: creator.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        rent: SYSVAR_RENT_PUBKEY
      })
      .rpc();
    
    console.log('Sell transaction successful');
    
    // Fetch state after sell
    const stateAfterSell = await program.account.launchState.fetch(statePda);
    console.log('State after sell:', {
      tokensSold: stateAfterSell.tokensSold.toString(),
      supplyRemaining: stateAfterSell.supplyRemaining.toString(),
      reservesLamports: stateAfterSell.reservesLamports.toString(),
      platformFeeAccrued: stateAfterSell.platformFeeAccrued.toString(),
      creatorFeeAccrued: stateAfterSell.creatorFeeAccrued.toString()
    });
    
    // 5. Withdraw fees
    console.log('Withdrawing fees...');
    
    // Get balances before withdrawal
    const platformBalanceBefore = await connection.getBalance(platformFeeRecipient.publicKey);
    const creatorBalanceBefore = await connection.getBalance(creator.publicKey);
    
    await program.methods
      .withdrawFees()
      .accounts({
        caller: payer.publicKey,
        mint: mint,
        statePda: statePda,
        vaultSolPda: vaultSolPda,
        platformFeeRecipient: platformFeeRecipient.publicKey,
        creator: creator.publicKey,
        systemProgram: SystemProgram.programId
      })
      .rpc();
    
    console.log('Fee withdrawal successful');
    
    // Get balances after withdrawal
    const platformBalanceAfter = await connection.getBalance(platformFeeRecipient.publicKey);
    const creatorBalanceAfter = await connection.getBalance(creator.publicKey);
    
    console.log('Platform fee recipient received:', (platformBalanceAfter - platformBalanceBefore) / 1e9, 'SOL');
    console.log('Creator received:', (creatorBalanceAfter - creatorBalanceBefore) / 1e9, 'SOL');
    
    // Fetch state after withdrawal
    const stateAfterWithdraw = await program.account.launchState.fetch(statePda);
    console.log('State after fee withdrawal:', {
      platformFeeAccrued: stateAfterWithdraw.platformFeeAccrued.toString(),
      creatorFeeAccrued: stateAfterWithdraw.creatorFeeAccrued.toString()
    });
    
    // 6. Buy more tokens to reach graduation target
    console.log('Buying more tokens to reach graduation target...');
    
    // Calculate how many tokens we need to buy to reach graduation target
    // This is simplified and might not be accurate for a real bonding curve calculation
    const largeAmount = new BN(100_000_000).mul(new BN(10).pow(new BN(decimals))); // 100 million tokens
    
    await program.methods
      .buy(
        largeAmount,
        maxCostLamports
      )
      .accounts({
        buyer: buyer.publicKey,
        mint: mint,
        statePda: statePda,
        authorityPda: authorityPda,
        vaultSolPda: vaultSolPda,
        vaultAta: vaultAta,
        buyerAta: buyerAta,
        platformFeeRecipient: platformFeeRecipient.publicKey,
        creator: creator.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        rent: SYSVAR_RENT_PUBKEY
      })
      .rpc();
    
    console.log('Large buy transaction successful');
    
    // Check if we've graduated
    const stateAfterLargeBuy = await program.account.launchState.fetch(statePda);
    console.log('State after large buy:', {
      tokensSold: stateAfterLargeBuy.tokensSold.toString(),
      reservesLamports: stateAfterLargeBuy.reservesLamports.toString(),
      graduated: stateAfterLargeBuy.graduated
    });
    
    // 7. Call graduate explicitly
    if (!stateAfterLargeBuy.graduated && 
        stateAfterLargeBuy.reservesLamports.gte(stateAfterLargeBuy.graduationTargetLamports)) {
      console.log('Calling graduate explicitly...');
      
      await program.methods
        .graduate()
        .accounts({
          caller: payer.publicKey,
          mint: mint,
          statePda: statePda
        })
        .rpc();
      
      const stateAfterGraduate = await program.account.launchState.fetch(statePda);
      console.log('State after graduate call:', {
        graduated: stateAfterGraduate.graduated
      });
    } else if (stateAfterLargeBuy.graduated) {
      console.log('Already graduated during buy transaction');
    } else {
      console.log('Not yet eligible for graduation, need more reserves');
    }
    
    console.log('Test completed successfully!');
  } catch (error) {
    console.error('Error:', error);
    if (error.logs) {
      console.error('Program logs:', error.logs);
    }
  }
}

// Run the test
main().then(
  () => process.exit(),
  err => {
    console.error(err);
    process.exit(-1);
  }
);