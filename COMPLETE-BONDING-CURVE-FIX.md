# Bonding Curve Contract Fix - Complete Solution

## The Problem
The Solana bonding curve contract was failing with two main errors:

1. **"IllegalOwner" error** - This occurred because we were pre-creating the vault account.
2. **"InstructionFallbackNotFound" error (Custom Error 101)** - This occurred because we were using an incorrect function signature for the initialize_launch function.

## Root Cause Analysis

### Custom Error 101 (InstructionFallbackNotFound)
This error occurs when Anchor cannot match the discriminator (the first 8 bytes of the instruction data) to any of the program's registered functions. The solution is to ensure we're using the correct parameter structure for the initialize_launch function.

The key issue was that there are **two different implementations** of the `initialize_launch` function:

1. **In lib.rs:**
   ```rust
   pub fn initialize_launch(
       ctx: Context<InitializeLaunch>,
       base_price_lamports: u64,
       slope_lamports: u64,
       fee_bps: u16,
       creator_fee_bps: u16,
       graduation_target_lamports: u64,
   ) -> Result<()> { ... }
   ```

2. **In instructions/initialize_launch.rs:**
   ```rust
   pub fn initialize_launch(
       ctx: Context<InitializeLaunch>,
       name: String,
       _symbol: String,
       price_state: PriceState,
   ) -> Result<()> { ... }
   ```

The `initialize_launch.rs` version is the one that's being exported and registered with Anchor through the module system, as seen in `instructions/mod.rs`:

```rust
pub mod initialize_launch;
pub use initialize_launch::*;
```

Therefore, we need to use the parameter structure from `initialize_launch.rs`.

### IllegalOwner Error
This was fixed by not pre-creating the vault account and letting the program create it with the proper ownership.

## The Solution

### 1. Use the Correct Parameter Structure
We've implemented the correct structure in `fixed-initialize-launch.js`:

```javascript
// Fixed parameters based on initialize_launch.rs
const name = "mygrok"; // Must end with "grok" per the code requirement
const symbol = "GROK";

// PriceState struct from state.rs:
const trancheSize = 1_000_000_000; // 1 billion tokens in smallest units
const basePriceLamports = 10_000_000; // 0.01 SOL
const stepBps = 500; // 5.00% increase per tranche
```

### 2. Correct Serialization
The serialization format follows Anchor's standard:

1. 8-byte discriminator (hash of "namespace:function_name")
2. Name as a string (4-byte length + UTF-8 bytes)
3. Symbol as a string (4-byte length + UTF-8 bytes)
4. PriceState struct (tranche_size: u64, base_price_lamports: u64, step_bps: u16)

### 3. Correct Account Structure
We've also updated the accounts array to match the structure in `initialize_launch.rs`:

```javascript
const initIx = {
  programId: PROGRAM_ID,
  keys: [
    { pubkey: wallet.publicKey, isSigner: true, isWritable: true }, // global_config 
    { pubkey: wallet.publicKey, isSigner: true, isWritable: false }, // admin
    { pubkey: statePda, isSigner: false, isWritable: true }, // launch (not authorityPda)
    { pubkey: wallet.publicKey, isSigner: true, isWritable: true }, // creator
    { pubkey: mint, isSigner: false, isWritable: true }, // mint
    { pubkey: vaultAta.address, isSigner: false, isWritable: true }, // curve_vault
    { pubkey: vaultSolPda, isSigner: false, isWritable: true }, // sol_vault
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // token_program
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // system_program
  ],
  data: initData
};
```

## Verification and Testing

After initialization, you should verify:
1. The launch account (state PDA) was created successfully
2. The vault SOL PDA ownership is correct (owned by System Program, not the bonding curve program)
3. The bonding curve is functional by trying to buy and sell tokens

## Next Steps

1. Run the fixed initialization script: `./run-fixed-initialize.sh`
2. Test buying tokens with the existing buy scripts
3. Test selling tokens and withdrawing fees if required
4. Document the full bonding curve usage flow

## Lessons Learned

1. When working with Anchor, be aware that the exported function signatures (through `mod.rs`) determine the actual function interface.
2. Check discriminator calculations when manually constructing transactions.
3. Don't pre-create accounts that the program expects to create itself.
4. Use skipPreflight=true when debugging to get more accurate error messages.
