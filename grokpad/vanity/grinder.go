package main

// This package implements a simple vanity address generator for
// Solana.  It repeatedly generates random ed25519 key pairs until
// the resulting public key, encoded in base58, ends with the
// suffix "grok".  The private key is printed in JSON format so it
// can be imported into the Solana CLI.  Note that this program may
// take a few seconds to find a match because there are 58^4 ≈ 11.3
// million possible four‑character combinations.  Parallelism could be
// added for faster generation.

import (
    "crypto/ed25519"
    "crypto/rand"
    "encoding/json"
    "fmt"
    "log"
    "os"
    "time"

    base58 "github.com/btcsuite/btcutil/base58"
)

// Keypair represents a Solana key pair in the JSON format used by
// the Solana CLI.  It contains the concatenated 64‑byte secret key
// and the public key.
type Keypair []byte

func main() {
    suffix := "grok"
    log.Printf("Searching for a public key ending with %q...", suffix)
    start := time.Now()
    for {
        pub, priv, err := ed25519.GenerateKey(rand.Reader)
        if err != nil {
            log.Fatalf("failed to generate key: %v", err)
        }
        // Encode the public key in base58.
        b58 := base58.Encode(pub)
        if len(b58) >= len(suffix) && b58[len(b58)-len(suffix):] == suffix {
            // Print the keypair to stdout in JSON array format.  The
            // Solana CLI expects a 64‑byte secret key followed by the
            // 32‑byte public key.  We append the public key for
            // completeness even though it's redundant.
            keyBytes := append(priv.Seed(), pub...)
            // keyBytes currently contains only the 32 byte seed and
            // public key; to produce a full 64 byte secret key we
            // append the seed again.  ed25519.PrivateKey embeds the
            // private key as priv.Seed()||pub.
            // However, for the Solana JSON format we include all 64
            // bytes of the private key (seed + pubkey).
            // ed25519.GenerateKey returns priv of type
            // ed25519.PrivateKey which already contains seed||pub.
            keyBytes = priv
            // Marshal to JSON
            out, err := json.Marshal(keyBytes)
            if err != nil {
                log.Fatalf("failed to marshal key: %v", err)
            }
            fmt.Printf("Found vanity address: %s\n", b58)
            // Write the JSON to a file.
            filename := fmt.Sprintf("%s-keypair.json", b58)
            if err := os.WriteFile(filename, out, 0600); err != nil {
                log.Fatalf("failed to write key file: %v", err)
            }
            fmt.Printf("Wrote keypair to %s\n", filename)
            fmt.Printf("Elapsed time: %s\n", time.Since(start))
            return
        }
    }
}