# ADR-0013: Assign one authority to each public contract

- Status: Accepted
- Date: 2026-08-19
- Owners: Sumi Docs maintainers

## Context

Sumi Docs exposes several different contracts: MCP messages, tool arguments,
corpus manifests, TypeScript APIs, browser pages, and a possible future native
runtime. Treating one implementation language or generator as the authority for
all of them would create duplicate schemas and misleading compatibility claims.

MCP and LSP both use JSON-RPC, but they are different protocols. Rust and
TypeScript documentation generators describe language APIs, not the wire
contract. HTML extraction is also distinct from the reviewed Markdown/MDX
publishing pipeline.

## Decision

Each contract has one versioned authority:

| Contract                    | Authority                                                                                               | Generated or derived surfaces                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| MCP protocol and transports | The versioned Model Context Protocol specification and installed official SDK packages                  | stdio and Streamable HTTP conformance tests                           |
| MCP tool arguments          | Strict Zod definitions in `src/mcp/server.ts`                                                           | Runtime validation and the JSON Schema advertised by the official SDK |
| Corpus manifest wire format | Versioned JSON Schema, canonicalization rules, and conformance fixtures in `@sumi-labs/corpus-contract` | TypeScript reference implementation and future language bindings      |
| TypeScript package API      | Exported TypeScript declarations                                                                        | TypeDoc reference pages                                               |
| Future Rust package API     | Exported Rust items                                                                                     | `rustdoc` pages, only after a supported Rust implementation exists    |
| Browser behavior            | Published Web standards, accessibility requirements, and the reviewed content catalog                   | Astro and Starlight output                                            |

The corpus contract targets JSON Schema Draft 2020-12. A future Rust
implementation must consume the same schemas and fixtures; it must not become a
second source for manifest or tool semantics. Protocol and schema changes are
accepted only with versioned fixtures and cross-runtime conformance evidence.

LSP is not a dependency of Sumi Docs. It requires an editor-oriented language
service contract that this product does not implement. Sharing JSON-RPC does not
make MCP an LSP implementation.

Remote corpus acquisition consumes reviewed Markdown or MDX bytes referenced by
the versioned manifest. General HTML crawling, DOM execution, and heuristic AST
cleaning are outside the read-only server. If arbitrary Web ingestion is later
required, a separate ingestion boundary must own URL canonicalization,
normalization version, provenance, extraction diagnostics, and reviewed output
before the corpus publisher accepts it.

## Consequences

TypeScript remains the supported v0.1 runtime and schema reference. The bounded
Rust parity spike in ADR-0010 may measure runtime and memory behavior, but it
cannot redefine public contracts. API documentation stays language-specific,
while the machine wire contract stays language-neutral.

Standards references must name the exact version or stable specification URL.
An RFC is cited only when it actually governs the surface; a generic RFC label
does not substitute for the MCP, JSON Schema, Web, or package contract.

## Validation and rollback

Contract tests validate strict schemas, canonical bytes, digests, and fixtures.
MCP integration tests compare advertised tool schemas across transports. Web
verification checks catalog identity, routes, rendered files, and published
corpus bytes. TypeDoc output is checked against exported TypeScript symbols.

Rollback removes a derived generator or runtime adapter without changing the
authoritative schema. Reverting an authority requires a superseding ADR and a
documented compatibility migration.
