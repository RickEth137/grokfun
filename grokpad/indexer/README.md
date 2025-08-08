# GrokPad Indexer

This directory contains a very simple outline for an indexing service
that listens to events emitted by the GrokPad program on Solana.  In
order to track bonding curve progress, fee revenue and graduations,
you will need to run a program that subscribes to the relevant
accounts and instructions on your RPC node.  The provided `worker.ts`
is a stub demonstrating how such a service might be structured using
the [@project-serum/anchor](https://github.com/coral-xyz/anchor) and
[@solana/web3.js](https://solana-labs.github.io/solana-web3.js/) libraries.

> **Note:** The indexer is not fully implemented.  It is provided as a
> starting point for development and will not function as‑is.