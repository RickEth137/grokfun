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
exports.GrokpadSDK = void 0;
const anchor = __importStar(require("@coral-xyz/anchor"));
const grokpad_1 = require("../target/types/grokpad");
const web3_js_1 = require("@solana/web3.js");
const spl_token_1 = require("@solana/spl-token");
// SDK Class for higher-level interaction with the Grokpad program
class GrokpadSDK {
    constructor(client, connection, wallet) {
        this.client = client;
        this.connection = connection;
        this.wallet = wallet;
    }
    static async create(connection, wallet, programId) {
        const provider = new anchor.AnchorProvider(connection, wallet, { commitment: 'confirmed' });
        // Use provided program ID or try to get from workspace
        const actualProgramId = programId || anchor.workspace?.grokpad?.programId;
        if (!actualProgramId) {
            throw new Error("Program ID not provided and not found in workspace");
        }
        const client = new grokpad_1.GrokpadClient(provider, actualProgramId);
        return new GrokpadSDK(client, connection, wallet);
    }
    // Creates a new token mint and initializes a bonding curve launch
    async createNewLaunch(initialSupply, basePriceLamports, slopeLamports, feeBps, creatorFeeBps, graduationTargetLamports) {
        // Create the mint account
        const mint = await (0, spl_token_1.createMint)(this.connection, this.wallet.payer, this.wallet.publicKey, null, // Freeze authority
        9 // Decimals
        );
        console.log("Created mint:", mint.toBase58());
        // Calculate PDAs for this launch
        const [authorityPda] = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from("launch"), mint.toBuffer()], this.client.program.programId);
        // Get the vault token account
        const vaultAta = await (0, spl_token_1.getOrCreateAssociatedTokenAccount)(this.connection, this.wallet.payer, mint, authorityPda, true);
        // Mint initial supply to the vault
        const mintAmount = initialSupply * (10 ** 9);
        await (0, spl_token_1.mintTo)(this.connection, this.wallet.payer, mint, vaultAta.address, this.wallet.publicKey, mintAmount);
        console.log(`Minted ${initialSupply} tokens to vault`);
        // Initialize the launch
        const txSignature = await this.client.initializeLaunch(mint, new anchor.BN(basePriceLamports), new anchor.BN(slopeLamports), feeBps, creatorFeeBps, new anchor.BN(graduationTargetLamports), this.wallet.publicKey, // creator
        this.wallet.publicKey // platform fee recipient
        );
        console.log("Launch initialized:", txSignature);
        return { mint, txSignature };
    }
    // Helper method to get current token balance
    async getTokenBalance(tokenAccount) {
        const account = await (0, spl_token_1.getAccount)(this.connection, tokenAccount);
        return Number(account.amount) / (10 ** 9);
    }
    // Helper to get SOL balance of an account
    async getSolBalance(account) {
        const balance = await this.connection.getBalance(account);
        return balance / web3_js_1.LAMPORTS_PER_SOL;
    }
    // Get info about a launch
    async getLaunchInfo(mint) {
        const state = await this.client.getLaunchState(mint);
        const [authorityPda] = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from("launch"), mint.toBuffer()], this.client.program.programId);
        const [vaultSolPda] = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from("vault_sol"), mint.toBuffer()], this.client.program.programId);
        const vaultAta = await (0, spl_token_1.getOrCreateAssociatedTokenAccount)(this.connection, this.wallet.payer, mint, authorityPda, true);
        const vaultTokens = await this.getTokenBalance(vaultAta.address);
        const solReserves = await this.getSolBalance(vaultSolPda);
        return {
            state,
            tokenSupply: Number(state.tokensSold) / (10 ** 9) + Number(state.supplyRemaining) / (10 ** 9),
            solReserves,
            vaultTokens
        };
    }
}
exports.GrokpadSDK = GrokpadSDK;
// Example usage
async function main() {
    try {
        // Setup
        const connection = new web3_js_1.Connection("http://localhost:8899", "confirmed");
        const wallet = new anchor.Wallet(web3_js_1.Keypair.generate());
        // Create SDK
        const sdk = await GrokpadSDK.create(connection, wallet);
        console.log("SDK initialized with program ID:", sdk.client.program.programId.toBase58());
    }
    catch (err) {
        console.error("Error:", err);
    }
}
// Run if executed directly
if (require.main === module) {
    main().catch((err) => console.error(err));
}
