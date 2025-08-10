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
exports.createClient = createClient;
const anchor = __importStar(require("@coral-xyz/anchor"));
const grokpad_1 = require("../target/types/grokpad");
// Constants for testing
const LAMPORTS_PER_SOL = 1000000000;
const ONE_TOKEN = 1000000000; // 1 token with 9 decimals
async function createClient() {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    // Get program ID from workspace or use a specific one
    const programId = anchor.workspace.grokpad.programId;
    // Create client instance
    return new grokpad_1.GrokpadClient(provider, programId);
}
async function main() {
    try {
        const client = await createClient();
        console.log("Client created successfully with program ID:", client.program.programId.toBase58());
        // Example: Fetch launch state for a mint
        // const mint = new PublicKey("your-mint-address");
        // const launchState = await client.getLaunchState(mint);
        // console.log("Launch state:", launchState);
    }
    catch (err) {
        console.error("Error:", err);
    }
}
// Run if executed directly
if (require.main === module) {
    main().catch((err) => console.error(err));
}
