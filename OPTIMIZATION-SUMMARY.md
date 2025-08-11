# Grokpad Program Optimization

This document summarizes the optimizations made to reduce the size and stack usage of the Solana program.

## Issues Addressed

1. **miniz_oxide Stack Overflow**
   - Error: `Function _ZN11miniz_oxide7inflate6stream12InflateState3new17h761e5e4b36ba5591E Stack offset of 43296 exceeded max offset of 4096`
   - Caused by: Panic unwinding and backtrace features

2. **regex-automata Dependencies**
   - Large dependencies pulled in via Anchor IDL generation
   - Multiple Unicode feature sets increasing binary size

## Optimizations Applied

### 1. Panic Handling

Added to workspace Cargo.toml:
```toml
[profile.release]
panic = "abort"  # Removes unwinding/backtrace dependencies
```

This prevents the inclusion of unwinding code and backtrace support which pulls in heavy dependencies like miniz_oxide.

### 2. Feature Management

Modified the program's Cargo.toml to separate IDL generation from deployment:

```toml
[features]
# Default build for deployment excludes IDL generation features
default = ["no-idl"]
# Use idl-build feature only when generating IDL
idl-build = ["anchor-spl/idl-build"]
```

### 3. Workflow Separation

Created separate workflows:
- Deployment build: Optimized for minimal size without IDL features
- IDL generation: Run natively (not BPF) to avoid stack limitations

## Results

Before:
- Stack overflow during compilation due to miniz_oxide
- Large dependency tree including regex-automata with many features

After:
- Program successfully builds and deploys without stack errors
- Binary size: 252K (optimized for BPF deployment)
- Program verified working on-chain

## Future Recommendations

1. **Keep IDL Generation Separate**: Always generate IDL using native build
2. **Use panic=abort**: Continue using panic=abort for all release builds
3. **Monitor Dependencies**: Watch for heavy dependencies in future updates
4. **Update Deprecated APIs**: Fix warnings about deprecated Anchor APIs

## Tools

- `deploy-optimized.sh`: Builds and deploys with optimized settings
- `generate-idl-native.sh`: Generates IDL using native build
- `fix-idl.sh`: Updates IDL with correct program ID
- `verify-program.js`: Verifies program exists on chain

Program now meets Solana BPF stack constraints without sacrificing functionality.
