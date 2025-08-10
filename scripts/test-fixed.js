const { 
  Connection, 
  PublicKey, 
  Keypair,
  SystemProgram, 
  SYSVAR_RENT_PUBKEY,
  Transaction,
  sendAndConfirmTransaction
} = require('@solana/web3.js');
const { 
  TOKEN_PROGRAM_ID, 
  ASSOCIATED_TOKEN_PROGRAM_ID, 
  getOrCreateAssociatedTokenAccount, 
  getAccount,
  createAssociatedTokenAccount,
  mintTo
} = require('@solana/spl-token');
const fs = require('fs');
const path = require('path');
const { PROGRAM_ID, CLUSTER_URL } = require('./config');

// Configure constants
const USE_EXISTING_MINT = true;
const EXISTING_MINT = "FF5Khx5KBpyZKurFM4zUe2L4C7FWzAAZ92sP7mEWqvCJ";

// Instruction discriminators (these are from the Anchor IDL)
const DISCRIMINATOR_INITIALIZE = Buffer.from([30, 120, 39, 212, 120, 168, 29, 81]); // anchor.sighash("global:initializeLaunch")
const DISCRIMINATOR_BUY = Buffer.from([103, 17, 200, 25, 118, 95, 125, 61]); // anchor.sighash("global:buy")
const DISCRIMINATOR_SELL = Buffer.from([168, 86, 144, 193, 84, 236, 124, 112]); // anchor.sighash("global:sell")
const DISCRIMINATOR_WITHDRAW_FEES = Buffer.from([249, 77, 180, 202, 241, 88, 221, 124]); // anchor.sighash("global:withdrawFees")
const DISCRIMINATOR_GRADUATE = Buffer.from([175, 69, 176, 246, 204, 41, 172, 222]); // anchor.sighash("global:graduate")

async function main() {
  try {
    // Setup connection
    const connection = new Connection(CLUSTER_URL, 'confirmed');
    console.log('Successfully connected to local Solana node');
    
    // Load wallet
    const walletPath = process.env.ANCHOR_WALLET || path.join(process.env.HOME, '.config', 'solana', 'id.json');
    const secretKeyString = fs.readFileSync(walletPath, { encoding: 'utf8' });
    const secretKey = Uint8Array.from(JSON.parse(secretKeyString));
    const wallet = Keypair.fromSecretKey(secretKey);
    console.log('Using wallet:', wallet.publicKey.toString());
    
    // Program ID
    const programId = PROGRAM_ID;
    console.log('Program ID:', programId.toString());
    
    // Get mint
    let mint;
    if (USE_EXISTING_MINT) {
      mint = new PublicKey(EXISTING_MINT);
      console.log('Using existing mint:', mint.toString());
    } else {
      // Create a new mint
      console.log('Creating a new mint...');
      mint = await createMint(
        connection,
        wallet,
        wallet.publicKey,
        null,
        9
      );
      console.log('Mint created:', mint.toString());
    }
    
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
    
    // If not using existing mint, mint initial supply
    if (!USE_EXISTING_MINT) {
      console.log('Minting initial supply...');
      await mintTo(
        connection,
        wallet,
        mint,
        vaultAta.address,
        wallet.publicKey,
        1000000000000 // 1000 tokens with 9 decimals
      );
      console.log('Initial supply minted');
    }
    
    // Get buyer's ATA
    const buyerAta = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet,
      mint,
      wallet.publicKey
    );
    console.log('Buyer ATA:', buyerAta.address.toString());
    
    // Check if state account exists
    const stateInfo = await connection.getAccountInfo(statePda);
    
    if (stateInfo) {
      console.log('State account exists with size:', stateInfo.data.length);
      console.log('Launch is already initialized.');
    } else {
      console.log('State account does not exist, initializing launch...');
      
      // Initialize launch parameters
      const basePriceLamports = 1_000_000; // 0.001 SOL
      const slopeLamports = 100_000; // 0.0001 SOL per token
      const feeBps = 300; // 3.00%
      const creatorFeeBps = 100; // 1.00%
      const graduationTargetLamports = 2 * 1_000_000_000; // 2 SOL
      
      // Construct initialization data
      const initData = Buffer.alloc(8 + 8 + 8 + 2 + 2 + 8);
      
      // Write discriminator
      DISCRIMINATOR_INITIALIZE.copy(initData, 0);
      
      // Write params
      let offset = 8;
      initData.writeBigUInt64LE(BigInt(basePriceLamports), offset); offset += 8;
      initData.writeBigUInt64LE(BigInt(slopeLamports), offset); offset += 8;
      initData.writeUInt16LE(feeBps, offset); offset += 2;
      initData.writeUInt16LE(creatorFeeBps, offset); offset += 2;
      initData.writeBigUInt64LE(BigInt(graduationTargetLamports), offset);
      
      // Create instruction
      const initIx = {
        programId,
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
      const initSig = await sendAndConfirmTransaction(connection, initTx, [wallet]);
      console.log('Initialization transaction sent! Signature:', initSig);
    }
    
    // Buy tokens
    console.log('\nBuying tokens...');
    
    // Buy parameters
    const buyAmount = 5_000_000_000; // 5 tokens with 9 decimals
    const maxCostLamports = 10_000_000_000; // 10 SOL max cost
    
    // Construct buy data
    const buyData = Buffer.alloc(8 + 8 + 8);
    
    // Write discriminator
    DISCRIMINATOR_BUY.copy(buyData, 0);
    
    // Write params
    let buyOffset = 8;
    buyData.writeBigUInt64LE(BigInt(buyAmount), buyOffset); buyOffset += 8;
    buyData.writeBigUInt64LE(BigInt(maxCostLamports), buyOffset);
    
    // Create instruction
    const buyIx = {
      programId,
      keys: [
        { pubkey: wallet.publicKey, isSigner: true, isWritable: true }, // buyer
        { pubkey: mint, isSigner: false, isWritable: false }, // mint
        { pubkey: statePda, isSigner: false, isWritable: true }, // state_pda
        { pubkey: authorityPda, isSigner: false, isWritable: false }, // authority_pda
        { pubkey: vaultSolPda, isSigner: false, isWritable: true }, // vault_sol_pda
        { pubkey: vaultAta.address, isSigner: false, isWritable: true }, // vault_ata
        { pubkey: buyerAta.address, isSigner: false, isWritable: true }, // buyer_ata
        { pubkey: wallet.publicKey, isSigner: false, isWritable: false }, // platform_fee_recipient
        { pubkey: wallet.publicKey, isSigner: false, isWritable: false }, // creator
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // system_program
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // token_program
        { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // associated_token_program
        { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false } // rent
      ],
      data: buyData
    };
    
    // Send transaction
    console.log('Sending buy transaction...');
    try {
      const buyTx = new Transaction().add(buyIx);
      const buySig = await sendAndConfirmTransaction(connection, buyTx, [wallet]);
      console.log('Buy transaction sent! Signature:', buySig);
      
      // Check buyer's token balance
      const buyerTokenAccount = await getAccount(connection, buyerAta.address);
      console.log('Buyer token balance:', buyerTokenAccount.amount.toString());
    } catch (e) {
      console.error('Error buying tokens:', e);
      if (e.logs) {
        console.error('Transaction logs:', e.logs);
      }
    }
    
    // Sell tokens
    console.log('\nSelling tokens...');
    
    try {
      // Get current token balance
      const buyerTokenAccount = await getAccount(connection, buyerAta.address);
      const currentBalance = BigInt(buyerTokenAccount.amount.toString());
      
      if (currentBalance > 0) {
        // Sell half of the balance
        const sellAmount = currentBalance / BigInt(2);
        const minPayoutLamports = 1_000_000; // 0.001 SOL minimum payout
        
        console.log('Selling', sellAmount.toString(), 'tokens...');
        
        // Construct sell data
        const sellData = Buffer.alloc(8 + 8 + 8);
        
        // Write discriminator
        DISCRIMINATOR_SELL.copy(sellData, 0);
        
        // Write params
        let sellOffset = 8;
        sellData.writeBigUInt64LE(sellAmount, sellOffset); sellOffset += 8;
        sellData.writeBigUInt64LE(BigInt(minPayoutLamports), sellOffset);
        
        // Create instruction
        const sellIx = {
          programId,
          keys: [
            { pubkey: wallet.publicKey, isSigner: true, isWritable: true }, // seller
            { pubkey: mint, isSigner: false, isWritable: false }, // mint
            { pubkey: statePda, isSigner: false, isWritable: true }, // state_pda
            { pubkey: authorityPda, isSigner: false, isWritable: false }, // authority_pda
            { pubkey: vaultSolPda, isSigner: false, isWritable: true }, // vault_sol_pda
            { pubkey: vaultAta.address, isSigner: false, isWritable: true }, // vault_ata
            { pubkey: buyerAta.address, isSigner: false, isWritable: true }, // seller_ata
            { pubkey: wallet.publicKey, isSigner: false, isWritable: false }, // platform_fee_recipient
            { pubkey: wallet.publicKey, isSigner: false, isWritable: false }, // creator
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // system_program
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // token_program
            { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // associated_token_program
            { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false } // rent
          ],
          data: sellData
        };
        
        // Send transaction
        const sellTx = new Transaction().add(sellIx);
        const sellSig = await sendAndConfirmTransaction(connection, sellTx, [wallet]);
        console.log('Sell transaction sent! Signature:', sellSig);
        
        // Check buyer's token balance after selling
        const buyerTokenAccountAfter = await getAccount(connection, buyerAta.address);
        console.log('Buyer token balance after selling:', buyerTokenAccountAfter.amount.toString());
      } else {
        console.log('No tokens to sell');
      }
    } catch (e) {
      console.error('Error selling tokens:', e);
      if (e.logs) {
        console.error('Transaction logs:', e.logs);
      }
    }
    
    // Withdraw fees
    console.log('\nWithdrawing fees...');
    
    try {
      // Construct withdraw fees data
      const withdrawData = Buffer.alloc(8);
      
      // Write discriminator
      DISCRIMINATOR_WITHDRAW_FEES.copy(withdrawData, 0);
      
      // Create instruction
      const withdrawIx = {
        programId,
        keys: [
          { pubkey: wallet.publicKey, isSigner: true, isWritable: false }, // caller
          { pubkey: mint, isSigner: false, isWritable: false }, // mint
          { pubkey: statePda, isSigner: false, isWritable: true }, // state_pda
          { pubkey: vaultSolPda, isSigner: false, isWritable: true }, // vault_sol_pda
          { pubkey: wallet.publicKey, isSigner: false, isWritable: true }, // platform_fee_recipient
          { pubkey: wallet.publicKey, isSigner: false, isWritable: true }, // creator
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false } // system_program
        ],
        data: withdrawData
      };
      
      // Send transaction
      const withdrawTx = new Transaction().add(withdrawIx);
      const withdrawSig = await sendAndConfirmTransaction(connection, withdrawTx, [wallet]);
      console.log('Fee withdrawal transaction sent! Signature:', withdrawSig);
    } catch (e) {
      console.error('Error withdrawing fees:', e);
      if (e.logs) {
        console.error('Transaction logs:', e.logs);
      }
    }
    
    // Test graduation by buying a large amount
    console.log('\nBuying a large amount to test graduation...');
    
    try {
      // Large buy parameters
      const largeBuyAmount = 1_000_000_000_000; // 1000 tokens
      const largeMaxCostLamports = 100_000_000_000; // 100 SOL max cost
      
      // Construct buy data
      const largeBuyData = Buffer.alloc(8 + 8 + 8);
      
      // Write discriminator
      DISCRIMINATOR_BUY.copy(largeBuyData, 0);
      
      // Write params
      let largeBuyOffset = 8;
      largeBuyData.writeBigUInt64LE(BigInt(largeBuyAmount), largeBuyOffset); largeBuyOffset += 8;
      largeBuyData.writeBigUInt64LE(BigInt(largeMaxCostLamports), largeBuyOffset);
      
      // Create instruction
      const largeBuyIx = {
        programId,
        keys: [
          { pubkey: wallet.publicKey, isSigner: true, isWritable: true }, // buyer
          { pubkey: mint, isSigner: false, isWritable: false }, // mint
          { pubkey: statePda, isSigner: false, isWritable: true }, // state_pda
          { pubkey: authorityPda, isSigner: false, isWritable: false }, // authority_pda
          { pubkey: vaultSolPda, isSigner: false, isWritable: true }, // vault_sol_pda
          { pubkey: vaultAta.address, isSigner: false, isWritable: true }, // vault_ata
          { pubkey: buyerAta.address, isSigner: false, isWritable: true }, // buyer_ata
          { pubkey: wallet.publicKey, isSigner: false, isWritable: false }, // platform_fee_recipient
          { pubkey: wallet.publicKey, isSigner: false, isWritable: false }, // creator
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // system_program
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // token_program
          { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // associated_token_program
          { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false } // rent
        ],
        data: largeBuyData
      };
      
      // Send transaction
      const largeBuyTx = new Transaction().add(largeBuyIx);
      const largeBuySig = await sendAndConfirmTransaction(connection, largeBuyTx, [wallet]);
      console.log('Large buy transaction sent! Signature:', largeBuySig);
    } catch (e) {
      console.error('Error with large buy:', e);
      if (e.logs) {
        console.error('Transaction logs:', e.logs);
      }
    }
    
    // Call graduate explicitly
    console.log('\nCalling graduate explicitly...');
    
    try {
      // Construct graduate data
      const graduateData = Buffer.alloc(8);
      
      // Write discriminator
      DISCRIMINATOR_GRADUATE.copy(graduateData, 0);
      
      // Create instruction
      const graduateIx = {
        programId,
        keys: [
          { pubkey: wallet.publicKey, isSigner: true, isWritable: false }, // caller
          { pubkey: mint, isSigner: false, isWritable: false }, // mint
          { pubkey: statePda, isSigner: false, isWritable: true } // state_pda
        ],
        data: graduateData
      };
      
      // Send transaction
      const graduateTx = new Transaction().add(graduateIx);
      const graduateSig = await sendAndConfirmTransaction(connection, graduateTx, [wallet]);
      console.log('Graduate transaction sent! Signature:', graduateSig);
    } catch (e) {
      console.error('Error graduating:', e);
      if (e.logs) {
        console.error('Transaction logs:', e.logs);
      }
    }
    
    console.log('\nAll tests completed!');
    
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();
