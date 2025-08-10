# Solana Bonding Curve Custom Error 101 Analysis

## Error Context

After fixing the "IllegalOwner" error by not pre-creating the vault account, we're now encountering:
```
{"err":{"InstructionError":[0,{"Custom":101}]}}
```

This is a custom error defined in the Solana program with code 101.

## Common Causes for Error 101 in Bonding Curve Programs

Custom errors with specific codes (like 101) are typically defined in the program's Rust code as an error enum. While we don't have the direct source code for error definitions, there are several common validations that might trigger error 101 based on similar bonding curve implementations:

### 1. Parameter Validation Issues

These parameters might be subject to validation:

- **Base Price**: Might need to be above a minimum threshold (e.g., 0.01 SOL)
- **Slope**: Might need to be within an allowed range
- **Fee Percentages**: Total fees might need to be below a maximum (e.g., feeBps + creatorFeeBps < 1000)
- **Graduation Target**: Might need to be significantly higher than base price

### 2. Token Validation Issues

- **Mint Authority**: The program might require specific mint authority setup
- **Token Decimals**: Must match expected decimals (usually 9 for SOL-based tokens)
- **Token Supply**: Initial supply requirements may exist

### 3. Account Initialization Issues

- **Vault ATA**: There might be specific requirements for the token account
- **Authority PDA**: The PDA derivation might need specific seed ordering
- **State Account**: Might have requirements for data sizing

### 4. System Constraints

- **Rent Exemption**: Accounts might need specific rent-exemption funding
- **Transaction Timing**: Some validations might depend on timing or slot

## Troubleshooting Approach

To diagnose and fix error 101:

1. **Try Alternative Parameters**: Use more conservative values for initialization parameters
2. **Check Transaction Logs**: Look for specific error messages in the logs
3. **Inspect Similar Implementations**: Review other bonding curve programs for validation patterns
4. **Try Different Discriminators**: Although we identified the correct discriminator, variations might exist
5. **Examine Account State**: Verify all account states before and after initialization

## Common Solutions

Typical fixes for error 101 include:

1. **Adjust Parameters**: Use more conservative fee percentages, higher base price
2. **Ensure Correct Order**: Make sure accounts are in the correct order in the instruction
3. **Pre-fund Accounts**: Some accounts might need minimum balances
4. **Check Decimals**: Ensure token decimals match program expectations

## Next Steps

1. Try initialization with alternate parameters
2. If still failing, examine detailed transaction logs
3. Consider reviewing the program's Anchor IDL for additional insights
4. If necessary, try to decompile the program to identify error conditions
