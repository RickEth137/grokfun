import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
let count = 0;
const target = "grok";
while (true) {
  const kp = Keypair.generate();
  const base58 = bs58.encode(kp.publicKey.toBytes());
  if (base58.endsWith(target)) {
    console.log("FOUND", base58);
    console.log("SECRET (save securely!):", bs58.encode(kp.secretKey));
  }
  if (++count % 100000 === 0) {
    console.log("Checked", count);
  }
}