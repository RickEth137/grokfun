const { PublicKey } = require('@solana/web3.js');

// Program ID from deployed program
const PROGRAM_ID = new PublicKey('CYUSvq2vmNZ4rcyhfKyfaTKvfeH3doxyqx69ifV3w3TP');

// Local cluster URL
const CLUSTER_URL = 'http://localhost:8899';

module.exports = {
  PROGRAM_ID,
  CLUSTER_URL
};
