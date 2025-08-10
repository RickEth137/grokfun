# Solana Bonding Curve Initialization Fix

This repository contains tools and scripts to initialize and interact with a Solana bonding curve contract. After analyzing initialization issues, we've created improved scripts that properly handle the required account structure and transaction data.

## Key Issues Identified & Fixed

1. **InstructionFallbackNotFound Error**
   - The program was not recognizing the instruction discriminator
   - We tried multiple discriminator calculation approaches to find one that works
   - The correct discriminator needs to be calculated using Anchor's method

2. **Provided owner is not allowed Error**
   - The vault_sol_pda must be owned by the System Program
   - When the vault_sol_pda is created with another owner, initialization fails
   - Our solution ensures the vault has the correct ownership before initialization

## Key Files

### Initialization Scripts

- `fix-anchor-initialization.js`: Our improved initialization script using Anchor framework
- `prepare-vault-ownership.js`: Checks vault_sol_pda ownership is correct before initialization
- `fix-bonding-test.sh`: Comprehensive test script that tries multiple approaches

### Testing Tools

- `simple-mint-setup.js`: Creates a new SPL token for testing
- `simple-buy-test.js`: Tests buying tokens from the bonding curve
- `complete-fixed-test.sh`: The original test script we analyzed

## Setup & Usage Instructions

### Prerequisites

1. Ensure you have Solana CLI and validator running:
   ```
   solana-test-validator
   ```

2. Make sure Node.js and required packages are installed:
   ```
   npm install
   ```

### Full Initialization Process

1. **Create a new mint token**:
   ```
   node simple-mint-setup.js
   ```
   This will generate a new token and save its address to `mint-details.json`.

2. **Run the comprehensive initialization script**:
   ```
   ./fix-bonding-test.sh
   ```
   This will:
   - Verify validator connection
   - Check mint and program deployment
   - Ensure vault_sol_pda has correct ownership
   - Try to initialize the bonding curve
   - Test buy/sell functionality if initialization succeeds

### Fixing Common Issues

If initialization fails with:

1. **"Provided owner is not allowed" error**:
   - The vault_sol_pda account has the wrong owner
   - Reset your validator and use a fresh mint: 
     ```
     rm -rf test-ledger
     solana-test-validator
     node simple-mint-setup.js
     ```

2. **"InstructionFallbackNotFound" error**:
   - The wrong discriminator is being used
   - Try using the Anchor approach with `fix-anchor-initialization.js`

## Technical Implementation Details

### PDAs (Program Derived Addresses)

The program uses the following PDAs:
- `authorityPda` = PDA derived from `["launch", mint]`
- `statePda` = PDA derived from `["launch_state", mint]`
- `vaultSolPda` = PDA derived from `["vault_sol", mint]`

### Initialization Instruction Format

The `initializeLaunch` instruction requires:
- Correct discriminator (8 bytes)
- Base price in lamports (8 bytes)
- Slope in lamports (8 bytes)
- Fee basis points (2 bytes)
- Creator fee basis points (2 bytes)
- Graduation target in lamports (8 bytes)

### Account Structure Requirements

The initialization requires the following accounts:
1. `payer` (signer, writable)
2. `creator` (not signer)
3. `platformFeeRecipient` (not signer)
4. `mint` (not signer)
5. `authorityPda` (not signer)
6. `statePda` (not signer, writable)
7. `vaultSolPda` (not signer, writable) - MUST be owned by the System Program
8. `vaultAta` (not signer, writable)
9. `systemProgram`
10. `tokenProgram`
11. `associatedTokenProgram`
12. `rent`

## Troubleshooting

If all initialization approaches fail:
1. Start with a fresh environment: `rm -rf test-ledger`
2. Start a new validator: `solana-test-validator`
3. Create a new token: `node simple-mint-setup.js`
4. Run the fix script: `./fix-bonding-test.sh`
