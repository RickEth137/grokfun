const { Connection, PublicKey, Keypair, SystemProgram, SYSVAR_RENT_PUBKEY, Transaction, sendAndConfirmTransaction } = require('@solana/web3.js');
const { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getOrCreateAssociatedTokenAccount, getAccount } = require('@solana/spl-token');
const fs = require('fs');
const path = require('path');
const { PROGRAM_ID } = require('./config');

// Constants
const MINT_ADDRESS = process.argv[2] || "FF5Khx5KBpyZKurFM4zUe2L4C7FWzAAZ92sP7mEWqvCJ"; // Use the new mint we just created

async function main() {
  try {
    console.log('Using mint:', MINT_ADDRESS);
    
    // Setup connection
    const connection = new Connection('http://localhost:8899', 'confirmed');
    console.log('Successfully connected to local Solana node');
    
    // Load wallet
    const walletPath = process.env.ANCHOR_WALLET || path.join(process.env.HOME, '.config', 'solana', 'id.json');
    const secretKeyString = fs.readFileSync(walletPath, { encoding: 'utf8' });
    const secretKey = Uint8Array.from(JSON.parse(secretKeyString));
    const wallet = Keypair.fromSecretKey(secretKey);
    console.log('Using wallet:', wallet.publicKey.toString());
    
    // Program ID
    const programId = PROGRAM_ID;
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
    
    // Get vault ATA
    const vaultAta = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet,
      mint,
      authorityPda,
      true
    );
    console.log('Vault ATA:', vaultAta.address.toString());
    
    // Check if state account exists
    const stateInfo = await connection.getAccountInfo(statePda);
    if (stateInfo) {
      console.log('State account already exists with size:', stateInfo.data.length);
      console.log('Launch appears to be already initialized.');
      return;
    }
    
    // Generate CLI command for initializing the launch
    console.log('\nPlease run the following anchor CLI command to deploy and initialize the program:');
    console.log(`cd /Users/bash/Desktop/FUN.GROK && anchor deploy`);
    
    console.log('\nThen use the following Anchor CLI command to call the initialize_launch instruction:');
    console.log(`cd /Users/bash/Desktop/FUN.GROK && anchor run scripts/anchor-initialize.js -- ${MINT_ADDRESS}`);
    
    // Create anchor-initialize.js script
    const anchorInitPath = path.join(__dirname, 'anchor-initialize.js');
    const anchorInitScript = `
const anchor = require('@coral-xyz/anchor');
const { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } = require('@solana/web3.js');
const { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } = require('@solana/spl-token');

// Get the mint address from command line
const mintAddress = process.argv[2];
if (!mintAddress) {
  console.error("Please provide a mint address as argument");
  process.exit(1);
}

// Set up the provider
const provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);

// Load the IDL
const idl = require('../target/idl/grokpad.json');
const programId = PROGRAM_ID;
const program = new anchor.Program(idl, programId, provider);

async function main() {
  try {
    const mint = new PublicKey(mintAddress);
    console.log("Using mint:", mint.toString());
    
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
    
    // Get vault ATA
    const vaultAta = await anchor.utils.token.associatedAddress({
      mint: mint,
      owner: authorityPda
    });
    console.log('Vault ATA:', vaultAta.toString());
    
    // Launch parameters
    const basePriceLamports = new anchor.BN(1_000_000); // 0.001 SOL base price
    const slopeLamports = new anchor.BN(100_000); // 0.0001 SOL per token price increase
    const feeBps = 300; // 3.00% platform fee
    const creatorFeeBps = 100; // 1.00% creator fee
    const graduationTargetLamports = new anchor.BN(2 * 1_000_000_000); // 2 SOL graduation target
    
    console.log("Initializing launch...");
    const tx = await program.methods
      .initializeLaunch(
        basePriceLamports,
        slopeLamports,
        feeBps,
        creatorFeeBps,
        graduationTargetLamports
      )
      .accounts({
        payer: provider.wallet.publicKey,
        creator: provider.wallet.publicKey,
        platformFeeRecipient: provider.wallet.publicKey,
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
    
    console.log("Launch initialized! Transaction signature:", tx);
    
    // Get the state account
    const state = await program.account.launchState.fetch(statePda);
    console.log("Launch state:", {
      basePriceLamports: state.basePriceLamports.toString(),
      slopeLamports: state.slopeLamports.toString(),
      feeBps: state.feeBps,
      creatorFeeBps: state.creatorFeeBps,
      tokensSold: state.tokensSold.toString(),
      reservesLamports: state.reservesLamports.toString()
    });
    
  } catch (error) {
    console.error("Error:", error);
    if (error.logs) {
      console.error("Program logs:", error.logs);
    }
  }
}

main();
`;
    
    fs.writeFileSync(anchorInitPath, anchorInitScript);
    console.log(`\nCreated ${anchorInitPath} script.`);
    
    // Create script for buying tokens
    const anchorBuyPath = path.join(__dirname, 'anchor-buy.js');
    const anchorBuyScript = `
const anchor = require('@coral-xyz/anchor');
const { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } = require('@solana/web3.js');
const { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } = require('@solana/spl-token');

// Get the mint address from command line
const mintAddress = process.argv[2];
if (!mintAddress) {
  console.error("Please provide a mint address as argument");
  process.exit(1);
}

// Amount to buy (in token units)
const amountToBuy = new anchor.BN(5_000_000); // 5 tokens (assuming 6 decimals)
const maxCostLamports = new anchor.BN(10_000_000_000); // 10 SOL (max willing to pay)

// Set up the provider
const provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);

// Load the IDL
const idl = require('../target/idl/grokpad.json');
const programId = PROGRAM_ID;
const program = new anchor.Program(idl, programId, provider);

async function main() {
  try {
    const mint = new PublicKey(mintAddress);
    console.log("Using mint:", mint.toString());
    
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
    const vaultAta = await anchor.utils.token.associatedAddress({
      mint: mint,
      owner: authorityPda
    });
    
    // Get buyer ATA
    const buyerAta = await anchor.utils.token.associatedAddress({
      mint: mint,
      owner: provider.wallet.publicKey
    });
    
    console.log("Buying tokens...");
    console.log("Amount:", amountToBuy.toString());
    console.log("Max cost:", maxCostLamports.toString(), "lamports");
    
    const tx = await program.methods
      .buy(
        amountToBuy,
        maxCostLamports
      )
      .accounts({
        buyer: provider.wallet.publicKey,
        mint: mint,
        statePda: statePda,
        authorityPda: authorityPda,
        vaultSolPda: vaultSolPda,
        vaultAta: vaultAta,
        buyerAta: buyerAta,
        platformFeeRecipient: provider.wallet.publicKey,
        creator: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        rent: SYSVAR_RENT_PUBKEY
      })
      .rpc();
    
    console.log("Buy transaction successful! Signature:", tx);
    
    // Get the state account after purchase
    const state = await program.account.launchState.fetch(statePda);
    console.log("Updated launch state:", {
      tokensSold: state.tokensSold.toString(),
      reservesLamports: state.reservesLamports.toString(),
      platformFeeAccrued: state.platformFeeAccrued.toString(),
      creatorFeeAccrued: state.creatorFeeAccrued.toString()
    });
    
  } catch (error) {
    console.error("Error:", error);
    if (error.logs) {
      console.error("Program logs:", error.logs);
    }
  }
}

main();
`;
    
    fs.writeFileSync(anchorBuyPath, anchorBuyScript);
    console.log(`Created ${anchorBuyPath} script.`);
    
    // Create sell script
    const anchorSellPath = path.join(__dirname, 'anchor-sell.js');
    const anchorSellScript = `
const anchor = require('@coral-xyz/anchor');
const { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } = require('@solana/web3.js');
const { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAccount } = require('@solana/spl-token');

// Get the mint address from command line
const mintAddress = process.argv[2];
if (!mintAddress) {
  console.error("Please provide a mint address as argument");
  process.exit(1);
}

// Set up the provider
const provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);

// Load the IDL
const idl = require('../target/idl/grokpad.json');
const programId = PROGRAM_ID;
const program = new anchor.Program(idl, programId, provider);

async function main() {
  try {
    const mint = new PublicKey(mintAddress);
    console.log("Using mint:", mint.toString());
    
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
    const vaultAta = await anchor.utils.token.associatedAddress({
      mint: mint,
      owner: authorityPda
    });
    
    // Get seller ATA
    const sellerAta = await anchor.utils.token.associatedAddress({
      mint: mint,
      owner: provider.wallet.publicKey
    });
    
    // Get current token balance
    const connection = provider.connection;
    const tokenAccount = await getAccount(connection, sellerAta);
    console.log("Current token balance:", tokenAccount.amount.toString());
    
    // Calculate amount to sell (half of current balance)
    const sellAmount = new anchor.BN(Math.floor(Number(tokenAccount.amount) / 2));
    const minPayoutLamports = new anchor.BN(100_000); // 0.0001 SOL minimum payout
    
    if (sellAmount.lte(new anchor.BN(0))) {
      console.log("No tokens to sell");
      return;
    }
    
    console.log("Selling tokens...");
    console.log("Amount to sell:", sellAmount.toString());
    console.log("Min payout:", minPayoutLamports.toString(), "lamports");
    
    const tx = await program.methods
      .sell(
        sellAmount,
        minPayoutLamports
      )
      .accounts({
        seller: provider.wallet.publicKey,
        mint: mint,
        statePda: statePda,
        authorityPda: authorityPda,
        vaultSolPda: vaultSolPda,
        vaultAta: vaultAta,
        sellerAta: sellerAta,
        platformFeeRecipient: provider.wallet.publicKey,
        creator: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        rent: SYSVAR_RENT_PUBKEY
      })
      .rpc();
    
    console.log("Sell transaction successful! Signature:", tx);
    
    // Get the state account after sale
    const state = await program.account.launchState.fetch(statePda);
    console.log("Updated launch state:", {
      tokensSold: state.tokensSold.toString(),
      reservesLamports: state.reservesLamports.toString(),
      platformFeeAccrued: state.platformFeeAccrued.toString(),
      creatorFeeAccrued: state.creatorFeeAccrued.toString()
    });
    
    // Check new token balance
    const newTokenAccount = await getAccount(connection, sellerAta);
    console.log("New token balance:", newTokenAccount.amount.toString());
    
  } catch (error) {
    console.error("Error:", error);
    if (error.logs) {
      console.error("Program logs:", error.logs);
    }
  }
}

main();
`;
    
    fs.writeFileSync(anchorSellPath, anchorSellScript);
    console.log(`Created ${anchorSellPath} script.`);
    
    // Create withdraw fees script
    const anchorWithdrawPath = path.join(__dirname, 'anchor-withdraw.js');
    const anchorWithdrawScript = `
const anchor = require('@coral-xyz/anchor');
const { PublicKey, SystemProgram } = require('@solana/web3.js');

// Get the mint address from command line
const mintAddress = process.argv[2];
if (!mintAddress) {
  console.error("Please provide a mint address as argument");
  process.exit(1);
}

// Set up the provider
const provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);

// Load the IDL
const idl = require('../target/idl/grokpad.json');
const programId = PROGRAM_ID;
const program = new anchor.Program(idl, programId, provider);

async function main() {
  try {
    const mint = new PublicKey(mintAddress);
    console.log("Using mint:", mint.toString());
    
    // Derive PDAs
    const [statePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("launch_state"), mint.toBuffer()],
      programId
    );
    
    const [vaultSolPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_sol"), mint.toBuffer()],
      programId
    );
    
    // Get balances before withdrawal
    const connection = provider.connection;
    const platformBalanceBefore = await connection.getBalance(provider.wallet.publicKey);
    
    console.log("Withdrawing fees...");
    
    const tx = await program.methods
      .withdrawFees()
      .accounts({
        caller: provider.wallet.publicKey,
        mint: mint,
        statePda: statePda,
        vaultSolPda: vaultSolPda,
        platformFeeRecipient: provider.wallet.publicKey,
        creator: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId
      })
      .rpc();
    
    console.log("Withdraw fees transaction successful! Signature:", tx);
    
    // Get balances after withdrawal
    const platformBalanceAfter = await connection.getBalance(provider.wallet.publicKey);
    
    console.log("Platform balance increase:", (platformBalanceAfter - platformBalanceBefore) / 1e9, "SOL");
    
    // Get the state account after withdrawal
    const state = await program.account.launchState.fetch(statePda);
    console.log("Updated launch state:", {
      platformFeeAccrued: state.platformFeeAccrued.toString(),
      creatorFeeAccrued: state.creatorFeeAccrued.toString()
    });
    
  } catch (error) {
    console.error("Error:", error);
    if (error.logs) {
      console.error("Program logs:", error.logs);
    }
  }
}

main();
`;
    
    fs.writeFileSync(anchorWithdrawPath, anchorWithdrawScript);
    console.log(`Created ${anchorWithdrawPath} script.`);
    
    // Create graduate script
    const anchorGraduatePath = path.join(__dirname, 'anchor-graduate.js');
    const anchorGraduateScript = `
const anchor = require('@coral-xyz/anchor');
const { PublicKey } = require('@solana/web3.js');

// Get the mint address from command line
const mintAddress = process.argv[2];
if (!mintAddress) {
  console.error("Please provide a mint address as argument");
  process.exit(1);
}

// Set up the provider
const provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);

// Load the IDL
const idl = require('../target/idl/grokpad.json');
const programId = PROGRAM_ID;
const program = new anchor.Program(idl, programId, provider);

async function main() {
  try {
    const mint = new PublicKey(mintAddress);
    console.log("Using mint:", mint.toString());
    
    // Derive PDAs
    const [statePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("launch_state"), mint.toBuffer()],
      programId
    );
    
    // Check if eligible for graduation
    const state = await program.account.launchState.fetch(statePda);
    console.log("Current launch state:", {
      reservesLamports: state.reservesLamports.toString(),
      graduationTargetLamports: state.graduationTargetLamports.toString(),
      graduated: state.graduated
    });
    
    if (state.graduated) {
      console.log("Launch already graduated");
      return;
    }
    
    if (state.reservesLamports.lt(state.graduationTargetLamports)) {
      console.log("Not eligible for graduation yet. Need more reserves.");
      return;
    }
    
    console.log("Calling graduate...");
    
    const tx = await program.methods
      .graduate()
      .accounts({
        caller: provider.wallet.publicKey,
        mint: mint,
        statePda: statePda
      })
      .rpc();
    
    console.log("Graduate transaction successful! Signature:", tx);
    
    // Get the state account after graduation
    const stateAfter = await program.account.launchState.fetch(statePda);
    console.log("Updated launch state:", {
      graduated: stateAfter.graduated,
      reservesLamports: stateAfter.reservesLamports.toString(),
      tokensSold: stateAfter.tokensSold.toString()
    });
    
  } catch (error) {
    console.error("Error:", error);
    if (error.logs) {
      console.error("Program logs:", error.logs);
    }
  }
}

main();
`;
    
    fs.writeFileSync(anchorGraduatePath, anchorGraduateScript);
    console.log(`Created ${anchorGraduatePath} script.`);
    
    console.log('\nTo run the full test flow, use the following commands:');
    console.log('1. Initialize launch:');
    console.log(`   node scripts/anchor-initialize.js ${MINT_ADDRESS}`);
    console.log('2. Buy tokens:');
    console.log(`   node scripts/anchor-buy.js ${MINT_ADDRESS}`);
    console.log('3. Sell tokens:');
    console.log(`   node scripts/anchor-sell.js ${MINT_ADDRESS}`);
    console.log('4. Withdraw fees:');
    console.log(`   node scripts/anchor-withdraw.js ${MINT_ADDRESS}`);
    console.log('5. Graduate (if eligible):');
    console.log(`   node scripts/anchor-graduate.js ${MINT_ADDRESS}`);
    
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();
