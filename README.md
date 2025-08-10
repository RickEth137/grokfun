# Solana Bonding Curve Implementation (GROK)

This repository contains a Solana-based implementation of a bonding curve for token launches. The bonding curve mechanism enables price discovery and liquidity for newly launched tokens.

## Overview

The bonding curve creates a mathematical relationship between token supply and price. As more tokens are purchased, the price increases according to the curve's formula. This implementation includes:

- Initialization of a bonding curve for a token
- Buy functionality to purchase tokens at the current curve price
- Sell functionality to sell tokens back to the curve
- Fee collection for platform and creators
- Graduation mechanism when a token reaches maturity

## Fixed Issues

This repository includes fixes for the following issues:

- Corrected instruction discriminator for the `initialize_launch` function
- Fixed vault ownership requirements for proper initialization
- Ensured the vault is rent-exempt before initialization
- Properly structured accounts according to the program's context expectations

## Key Components

- **Programs**: Anchor-based Solana programs implementing the bonding curve logic
- **Scripts**: JavaScript utilities for interacting with the deployed programs
- **Tests**: Test scripts to validate functionality

## Usage

### Prerequisites

- Solana CLI tools
- Node.js and npm
- Anchor framework

### Setup

1. Clone the repository
```bash
git clone https://github.com/RickEth137/grokfun.git
cd grokfun
```

2. Install dependencies
```bash
npm install
```

3. Build the program
```bash
anchor build
```

### Running Tests

```bash
# Run a local validator
solana-test-validator

# Run the fixed test script
node scripts/test-fixed-with-correct-discriminator.js
```

## Technical Details

### Bonding Curve Formula

The price formula used is:
```
price = base_price + (slope * current_supply)
```

Where:
- `base_price`: Initial token price in lamports
- `slope`: Rate of price increase per token in circulation
- `current_supply`: Current token supply

### Account Structure

- **State PDA**: Stores the bonding curve parameters and current state
- **Authority PDA**: Controls token operations
- **Vault SOL PDA**: Holds SOL from token purchases
- **Vault ATA**: Associated Token Account that holds tokens for the bonding curve

## License

[MIT License](LICENSE)
