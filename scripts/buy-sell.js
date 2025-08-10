"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const anchor = __importStar(require("@coral-xyz/anchor"));
const web3_js_1 = require("@solana/web3.js");
const { SYSVAR_RENT_PUBKEY } = require("@solana/web3.js");
const spl_token_1 = require("@solana/spl-token");
const fs = require('fs');

const ONE = 1000000000n;
const INITIAL_SUPPLY_TOKENS = 1000n;
const BUY_AMOUNT_TOKENS = 5n;
const SELL_AMOUNT_TOKENS = 2n;

function linearBuyCost(basePrice, slope, soldBeforeUnits, units) {
    const unitsMinus1 = units - 1n;
    return (
        basePrice * units +
        slope * (soldBeforeUnits * units + (unitsMinus1 * units) / 2n)
    );
}

async function main() {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    const connection = provider.connection;
    const wallet = provider.wallet;
    await connection.requestAirdrop(wallet.publicKey, 5 * web3_js_1.LAMPORTS_PER_SOL);
    const idl = JSON.parse(fs.readFileSync('./target/idl/grokpad.json', 'utf8'));
    const programId = new anchor.web3.PublicKey('CYUSvq2vmNZ4rcyhfKyfaTKvfeH3doxyqx69ifV3w3TP');
    const program = new anchor.Program(idl, programId, provider);
    // Use existing mint from complete-test.sh
    const mint = new web3_js_1.PublicKey("2DYrK8AQrr9EyPb4F2nP16Dw5F4kTYxWGLMHPgC5Bmdb");
    console.log("Using existing mint:", mint.toBase58());
    // PDAs
    const [authorityPda] = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from("launch"), mint.toBuffer()], programId);
    const [statePda] = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from("launch_state"), mint.toBuffer()], programId);
    const [vaultSolPda] = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from("vault_sol"), mint.toBuffer()], programId);
    console.log("authorityPda:", authorityPda.toBase58());
    console.log("statePda:", statePda.toBase58());
    console.log("vaultSolPda:", vaultSolPda.toBase58());
    // Vault ATA
    const vaultAta = await (0, spl_token_1.getOrCreateAssociatedTokenAccount)(connection, wallet.payer, mint, authorityPda, true);
    console.log("vaultAta:", vaultAta.address.toBase58());
    // Check if we need to mint initial supply
    try {
        const accountInfo = await connection.getTokenAccountBalance(vaultAta.address);
        console.log("Vault already has tokens:", accountInfo.value.uiAmount);
    } catch (e) {
        // If the account doesn't exist or has no tokens, mint initial supply
        const initialSupplyAmount = INITIAL_SUPPLY_TOKENS * ONE;
        await (0, spl_token_1.mintTo)(connection, wallet.payer, mint, vaultAta.address, wallet.publicKey, initialSupplyAmount);
        console.log("Minted initial supply:", INITIAL_SUPPLY_TOKENS.toString());
    }
    // Initialize launch or use existing
    const feeBps = 300;
    const creatorFeeBps = 100;
    const basePrice = 1000000; // 0.001 SOL
    const slope = 100000; // +0.0001 SOL per unit
    const graduationTarget = 2 * web3_js_1.LAMPORTS_PER_SOL;
    
    // Check if launch is already initialized
    console.log("Checking if state account exists at:", statePda.toBase58());
    const stateAccount = await connection.getAccountInfo(statePda);
    
    if (stateAccount) {
        console.log("Launch already initialized. Using existing state account.");
        console.log("State account size:", stateAccount.data.length, "bytes");
        
        try {
            // Try to parse the state account to verify it's valid
            const state = await program.account.launchState.fetch(statePda);
            console.log("State account parsed successfully.");
            console.log("Current tokens_sold:", state.tokensSold.toString());
            console.log("Current reserves_lamports:", state.reservesLamports.toString());
        } catch (e) {
            console.log("Warning: Could not parse state account. It might be corrupted or incompatible.");
            console.log("Error:", e.message);
            console.log("Continuing anyway to test if operations work...");
        }
    } else {
        console.log("Launch not initialized. Attempting to initialize now...");
        
        try {
            // Try to initialize using our module
            const initializeModule = require('../initialize-all-discriminators');
            const result = await initializeModule.initializeWithAllDiscriminators();
            
            if (result.success || result.alreadyInitialized) {
                console.log("Launch initialized successfully or was already initialized.");
            } else {
                console.error("Failed to initialize the launch.");
                console.error("Please run 'node initialize-all-discriminators.js' first and check for errors.");
                return;
            }
        } catch (e) {
            console.error("Error during initialization:", e.message);
            console.error("Please run 'node initialize-all-discriminators.js' first.");
            return;
        }
    }
    // User ATA
    const userAta = await (0, spl_token_1.getOrCreateAssociatedTokenAccount)(connection, wallet.payer, mint, wallet.publicKey);
    console.log("userAta:", userAta.address.toBase58());
    const lamportsOf = (pk) => connection.getBalance(pk);
    const tokenBal = (pk) => connection.getTokenAccountBalance(pk);
    const beforeVaultToken = await tokenBal(vaultAta.address);
    const beforeUserToken = await tokenBal(userAta.address);
    const beforeVaultSol = await lamportsOf(vaultSolPda);
    console.log("Before buy -> vaultToken:", beforeVaultToken.value.uiAmountString, "userToken:", beforeUserToken.value.uiAmountString, "vaultSOL:", beforeVaultSol);
    
    // BUY
    const buyAmountRaw = BUY_AMOUNT_TOKENS * ONE;
    const buyAmountUnits = BUY_AMOUNT_TOKENS;
    const stateBeforeBuy = await program.account.launchState.fetch(statePda);
    const cost = linearBuyCost(
        BigInt(stateBeforeBuy.basePriceLamports),
        BigInt(stateBeforeBuy.slopeLamports),
        BigInt(stateBeforeBuy.tokensSold) / ONE,
        buyAmountUnits
    );
    const maxCostLamports = cost + cost / 100n; // 1% slippage
    const buySig = await program.methods
        .buy(new anchor.BN(buyAmountRaw), new anchor.BN(maxCostLamports.toString()))
        .accounts({
        buyer: wallet.publicKey,
        mint,
        statePda,
        vaultSolPda,
        authorityPda,
        vaultAta: vaultAta.address,
        buyerAta: userAta.address,
        platformFeeRecipient: wallet.publicKey,
        creator: wallet.publicKey,
        tokenProgram: spl_token_1.TOKEN_PROGRAM_ID,
        associatedTokenProgram: spl_token_1.ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: web3_js_1.SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    })
        .rpc();
    console.log("Buy tx:", buySig);
    const midVaultToken = await tokenBal(vaultAta.address);
    const midUserToken = await tokenBal(userAta.address);
    const midVaultSol = await lamportsOf(vaultSolPda);
    console.log("After buy  -> vaultToken:", midVaultToken.value.uiAmountString, "userToken:", midUserToken.value.uiAmountString, "vaultSOL:", midVaultSol);
    
    // SELL
    const sellAmountRaw = SELL_AMOUNT_TOKENS * ONE;
    const sellAmountUnits = SELL_AMOUNT_TOKENS;
    const stateBeforeSell = await program.account.launchState.fetch(statePda);
    const payout = linearBuyCost(
        BigInt(stateBeforeSell.basePriceLamports),
        BigInt(stateBeforeSell.slopeLamports),
        BigInt(stateBeforeSell.tokensSold) / ONE - sellAmountUnits,
        sellAmountUnits
    );
    const minPayoutLamports = payout - payout / 100n; // 1% slippage
    const sellSig = await program.methods
        .sell(new anchor.BN(sellAmountRaw), new anchor.BN(minPayoutLamports.toString()))
        .accounts({
        seller: wallet.publicKey,
        mint,
        statePda,
        vaultSolPda,
        authorityPda,
        vaultAta: vaultAta.address,
        sellerAta: userAta.address,
        platformFeeRecipient: wallet.publicKey,
        creator: wallet.publicKey,
        tokenProgram: spl_token_1.TOKEN_PROGRAM_ID,
        associatedTokenProgram: spl_token_1.ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: web3_js_1.SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    })
        .rpc();
    console.log("Sell tx:", sellSig);
    const afterVaultToken = await tokenBal(vaultAta.address);
    const afterUserToken = await tokenBal(userAta.address);
    const afterVaultSol = await lamportsOf(vaultSolPda);
    console.log("After sell -> vaultToken:", afterVaultToken.value.uiAmountString, "userToken:", afterUserToken.value.uiAmountString, "vaultSOL:", afterVaultSol);
    // State
    const state = await program.account.launchState.fetch(statePda);
    console.log("State tokens_sold:", state.tokensSold.toString(), "reserves_lamports:", state.reservesLamports.toString(), "platform_fee_accrued:", state.platformFeeAccrued.toString(), "creator_fee_accrued:", state.creatorFeeAccrued.toString());
}
main().catch(e => { console.error(e); process.exit(1); });
