// Central config for program ID and cluster
const { PublicKey } = require('@solana/web3.js');

const PROGRAM_ID = process.env.GROKPAD_PROGRAM_ID || 'CYUSvq2vmNZ4rcyhfKyfaTKvfeH3doxyqx69ifV3w3TP';
const CLUSTER_URL = process.env.GROKPAD_CLUSTER_URL || 'http://localhost:8899';

module.exports = {
  PROGRAM_ID,  // Export as string to avoid initialization issues
  PROGRAM_ID_PUBKEY: new PublicKey(PROGRAM_ID),  // Also provide as PublicKey if needed
  CLUSTER_URL,
};
