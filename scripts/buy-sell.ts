import * as anchor from "@coral-xyz/anchor";
import {
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount,
  createMint,
  mintTo,
} from "@solana/spl-token";

const ONE = 1_000_000_000n;
const INITIAL_SUPPLY_TOKENS = 1_000n;
const BUY_AMOUNT_TOKENS = 5n;
const SELL_AMOUNT_TOKENS = 2n;

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const connection = provider.connection;
  const wallet = provider.wallet as anchor.Wallet;

  await connection.requestAirdrop(wallet.publicKey, 5 * LAMPORTS_PER_SOL);

  const program = (anchor.workspace as any).grokpad as anchor.Program;
  const programId = program.programId as PublicKey;

  // Mint
  const mint = await createMint(
    connection,
    (wallet as any).payer,
    wallet.publicKey,
    null,
    9
  );
  console.log("Mint:", mint.toBase58());

  // PDAs
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
  console.log("authorityPda:", authorityPda.toBase58());
  console.log("statePda:", statePda.toBase58());
  console.log("vaultSolPda:", vaultSolPda.toBase58());

  // Vault ATA
  const vaultAta = await getOrCreateAssociatedTokenAccount(
    connection,
    (wallet as any).payer,
    mint,
    authorityPda,
    true
  );
  console.log("vaultAta:", vaultAta.address.toBase58());

  // Mint initial supply
  const initialSupplyAmount = INITIAL_SUPPLY_TOKENS * ONE;
  await mintTo(
    connection,
    (wallet as any).payer,
    mint,
    vaultAta.address,
    (wallet as any).payer,
    initialSupplyAmount
  );
  console.log("Minted initial supply:", INITIAL_SUPPLY_TOKENS.toString());

  // Initialize launch
  const feeBps = 300;
  const creatorFeeBps = 100;
  const basePrice = 1_000_000; // 0.001 SOL
  const slope = 100_000;       // +0.0001 SOL per unit
  const graduationTarget = 2 * LAMPORTS_PER_SOL;

  const initSig = await program.methods
    .initializeLaunch(
      feeBps,
      creatorFeeBps,
      new anchor.BN(basePrice),
      new anchor.BN(slope),
      new anchor.BN(graduationTarget)
    )
    .accounts({
      payer: wallet.publicKey,
      creator: wallet.publicKey,
      platformFeeRecipient: wallet.publicKey,
      mint,
      authorityPda,
      statePda,
      vaultSolPda,
      vaultAta: vaultAta.address,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    })
    .rpc();
  console.log("initialize_launch tx:", initSig);

  // User ATA
  const userAta = await getOrCreateAssociatedTokenAccount(
    connection,
    (wallet as any).payer,
    mint,
    wallet.publicKey
  );
  console.log("userAta:", userAta.address.toBase58());

  const lamportsOf = (pk: PublicKey) => connection.getBalance(pk);
  const tokenBal = (pk: PublicKey) => connection.getTokenAccountBalance(pk);

  const beforeVaultToken = await tokenBal(vaultAta.address);
  const beforeUserToken = await tokenBal(userAta.address);
  const beforeVaultSol = await lamportsOf(vaultSolPda);
  console.log("Before buy -> vaultToken:", beforeVaultToken.value.uiAmountString, "userToken:", beforeUserToken.value.uiAmountString, "vaultSOL:", beforeVaultSol);

  // BUY
  const buyAmountRaw = BUY_AMOUNT_TOKENS * ONE;
  const buySig = await program.methods
    .buy(new anchor.BN(buyAmountRaw))
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
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  console.log("Buy tx:", buySig);

  const midVaultToken = await tokenBal(vaultAta.address);
  const midUserToken = await tokenBal(userAta.address);
  const midVaultSol = await lamportsOf(vaultSolPda);
  console.log("After buy  -> vaultToken:", midVaultToken.value.uiAmountString, "userToken:", midUserToken.value.uiAmountString, "vaultSOL:", midVaultSol);

  // SELL (no SOL refund yet on-chain)
  const sellAmountRaw = SELL_AMOUNT_TOKENS * ONE;
  const sellSig = await program.methods
    .sell(new anchor.BN(sellAmountRaw))
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
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  console.log("Sell tx:", sellSig);

  const afterVaultToken = await tokenBal(vaultAta.address);
  const afterUserToken = await tokenBal(userAta.address);
  const afterVaultSol = await lamportsOf(vaultSolPda);
  console.log("After sell -> vaultToken:", afterVaultToken.value.uiAmountString, "userToken:", afterUserToken.value.uiAmountString, "vaultSOL:", afterVaultSol);

  // State
  const state = await (program.account as any).launch.fetch(statePda);
  console.log("State tokens_sold:", state.tokensSold.toString(), "reserves_lamports:", state.reservesLamports.toString(), "platform_fee_accrued:", state.platformFeeAccrued.toString(), "creator_fee_accrued:", state.creatorFeeAccrued.toString());
}

main().catch(e => { console.error(e); process.exit(1); });
