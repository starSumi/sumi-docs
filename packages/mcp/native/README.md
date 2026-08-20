# Native runtime probe

This crate is an isolated R1 protocol probe for the Rust runtime migration in
[ADR-0015](../docs/decisions/0015-rust-core-and-npm-launcher.md). It uses the
official `rmcp` SDK and exposes the four Sumi Docs tool names over stdio, but it
does not load a corpus and is not part of the npm package or production CLI.

Run the probe from this directory:

```powershell
cargo check
cargo test
cargo run
```

The probe must not be described as corpus parity, Streamable HTTP support, or a
release artifact until the R0-R6 gates in ADR-0015 are complete.
