# Native runtime probe

This crate is an isolated native migration probe for the Rust runtime target in
[ADR-0015](../docs/decisions/0015-rust-core-and-npm-launcher.md). It uses the
official `rmcp` SDK and exposes the four Sumi Docs tool names over stdio. Its
corpus module is exercised only by a language-neutral parity fixture against
the Node reference implementation. The crate is not part of the npm package or
production CLI.

Run the probe from this directory:

```powershell
cargo check
cargo test
cargo run
```

Run the full repository-owned native checkpoint from `packages/mcp`:

```powershell
pnpm run native:verify
```

The fixture currently covers Markdown/MDX frontmatter and text extraction,
Unicode lexical search, document lookup, and OpenAPI filtering. It does not
cover manifest v1/v2 acquisition, routes, Streamable HTTP, or distribution.
The probe must not be described as full R2 corpus parity or a release artifact
until the remaining R0-R6 gates in ADR-0015 are complete.
