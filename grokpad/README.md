# GrokPad Token Launch Platform

This repository contains a **work‑in‑progress** implementation of a token
launch platform inspired by [Pump.fun](https://pump.fun/) and similar
Solana launchpads.  The goal is to provide a fair‑launch bonding curve
experience while automatically appending the suffix `grok` to all token
names and vanity mint addresses.  This codebase is intended as a
starting point for development rather than a production‑ready system.

## Overview

The project consists of several components:

* An [Anchor](https://book.anchor-lang.com/) smart contract (program) in
  `programs/grokpad/` that implements the bonding curve, launch
  mechanics and graduation logic.  It defines the on‑chain accounts
  and instructions required to create a new token, buy and sell on
  the curve and graduate to a Raydium‑style liquidity pool.
* A Go‑based vanity address generator in `vanity/grinder.go` that
  produces ed25519 key pairs whose base58‑encoded public keys end with
  the string `grok`.  These vanity mints allow each token’s mint
  address to have a recognisable suffix.
* A Next.js skeleton in `app/` that contains placeholder pages for
  creating tokens and interacting with live launches.  This frontend
  will need to be expanded with wallet connectivity, transaction
  signing and user interface elements.
* An indexing service in `indexer/` intended to listen to program
  events and expose analytics such as top launches, progress towards
  graduation and fee revenues.

## Disclaimer

This code is **not audited** and should not be deployed to mainnet
without further development, testing and security review.  It is
provided for educational purposes and as a scaffold to build upon.

## Vanity Address Support

The Solana CLI provides a `solana-keygen grind` subcommand which
generates key pairs until the resulting public key matches a given
prefix or suffix.  The provided Go tool wraps this functionality in a
programmable way.  Note that vanity suffixes must consist only of
characters from the Solana base58 alphabet (A–Z, a–z, 0–9) except
letters and numbers that are intentionally omitted to avoid
ambiguities.  Specifically, the characters `0`, `I`, `O` and `l`
cannot appear in base58 strings【772640916425823†L181-L187】.  The `grind` command
supports an `--ends-with` flag for generating such keys【608842693992350†L235-L247】.

## Getting Started

1. Install the [Anchor CLI](https://www.anchor-lang.com/docs/installation) and the
   Solana CLI tools on your development machine.
2. Clone this repository and run `anchor test` inside
   `programs/grokpad` to compile the smart contract.  The unit tests
   are currently placeholders and should be extended.
3. Build and run the vanity key generator with `go run vanity/grinder.go`.
4. Start the Next.js app from the `app/` directory with `npm run
   dev` and visit `http://localhost:3000` to see the placeholder UI.

Please refer to the source files for further details on the
implementation.