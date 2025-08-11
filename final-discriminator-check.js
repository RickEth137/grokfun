/**
 * Try different instruction namespaces for Anchor's instruction discriminator
 */
const crypto = require('crypto');

// Generate an Anchor discriminator with explicit namespace
function generateDiscriminator(namespace, name) {
  const preimage = `${namespace}:${name}`;
  const hash = crypto.createHash('sha256').update(preimage).digest();
  return hash.slice(0, 8);
}

// Try different combinations 
console.log('Trying different discriminator combinations:');

console.log('\n=== With initialize_launch (snake_case) ===');
console.log(`global:initialize_launch: [${Array.from(generateDiscriminator('global', 'initialize_launch'))}]`);
console.log(`instruction:initialize_launch: [${Array.from(generateDiscriminator('instruction', 'initialize_launch'))}]`);
console.log(`ix:initialize_launch: [${Array.from(generateDiscriminator('ix', 'initialize_launch'))}]`);
console.log(`(no namespace):initialize_launch: [${Array.from(generateDiscriminator('', 'initialize_launch'))}]`);

console.log('\n=== With initializeLaunch (camelCase) ===');
console.log(`global:initializeLaunch: [${Array.from(generateDiscriminator('global', 'initializeLaunch'))}]`);
console.log(`instruction:initializeLaunch: [${Array.from(generateDiscriminator('instruction', 'initializeLaunch'))}]`);
console.log(`ix:initializeLaunch: [${Array.from(generateDiscriminator('ix', 'initializeLaunch'))}]`);
console.log(`(no namespace):initializeLaunch: [${Array.from(generateDiscriminator('', 'initializeLaunch'))}]`);
