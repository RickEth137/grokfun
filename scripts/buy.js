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
const spl_token_1 = require("@solana/spl-token");
const ONE = 1000000000n;
const INITIAL_SUPPLY_TOKENS = 1000n;
const BUY_AMOUNT_TOKENS = 5n;
async function main() {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    const connection = provider.connection;
    const wallet = provider.wallet;
    await connection.requestAirdrop(wallet.publicKey, 5 * web3_js_1.LAMPORTS_PER_SOL);
    const program = anchor.workspace.grokpad;
    const programId = program.programId;
    // Mint
    const mint = await (0, spl_token_1.createMint)(connection, wallet.payer, wallet.publicKey, null, 9);
    console.log("Mint:", mint.toBase58());
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
    // Mint initial supply
    const initialSupplyAmount = INITIAL_SUPPLY_TOKENS * ONE;
    await (0, spl_token_1.mintTo)(connection, wallet.payer, mint, vaultAta.address, wallet.payer, initialSupplyAmount);
    console.log("Minted initial supply:", INITIAL_SUPPLY_TOKENS.toString());
    // Initialize launch
    const feeBps = 300;
    const creatorFeeBps = 100;
    const basePrice = 1000000; // 0.001 SOL
    const slope = 100000; // +0.0001 SOL per unit
    const graduationTarget = 2 * web3_js_1.LAMPORTS_PER_SOL;
    const initSig = await program.methods
        .initializeLaunch(new anchor.BN(basePrice), new anchor.BN(slope), feeBps, creatorFeeBps, new anchor.BN(graduationTarget))
        .accounts({
        payer: wallet.publicKey,
        creator: wallet.publicKey,
        platformFeeRecipient: wallet.publicKey,
        mint,
        authorityPda,
        statePda,
        vaultSolPda,
        vaultAta: vaultAta.address,
        systemProgram: web3_js_1.SystemProgram.programId,
        tokenProgram: spl_token_1.TOKEN_PROGRAM_ID,
        associatedTokenProgram: spl_token_1.ASSOCIATED_TOKEN_PROGRAM_ID,
    })
        .rpc();
    console.log("initialize_launch tx:", initSig);
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
    // Set max cost as 10 SOL to ensure it goes through (can be calculated more precisely)
    const maxCostLamports = 10 * web3_js_1.LAMPORTS_PER_SOL;
    const buySig = await program.methods
        .buy(new anchor.BN(buyAmountRaw), new anchor.BN(maxCostLamports))
        .accounts({
        buyer: wallet.publicKey,
        mint,
        statePda,
        vaultSolPda,
        authorityPda,
        vaultAta: vaultAta.address,
        buyerAta: userAta.address,
        tokenProgram: spl_token_1.TOKEN_PROGRAM_ID,
        associatedTokenProgram: spl_token_1.ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: web3_js_1.SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    })
        .rpc();
    console.log("Buy tx:", buySig);
    const afterVaultToken = await tokenBal(vaultAta.address);
    const afterUserToken = await tokenBal(userAta.address);
    const afterVaultSol = await lamportsOf(vaultSolPda);
    console.log("After buy  -> vaultToken:", afterVaultToken.value.uiAmountString, "userToken:", afterUserToken.value.uiAmountString, "vaultSOL:", afterVaultSol);
    // State
    const state = await program.account.launchState.fetch(statePda);
    console.log("State tokens_sold:", state.tokensSold.toString(), "reserves_lamports:", state.reservesLamports.toString(), "platform_fee_accrued:", state.platformFeeAccrued.toString(), "creator_fee_accrued:", state.creatorFeeAccrued.toString());
}
main().catch(e => { console.error(e); process.exit(1); });
