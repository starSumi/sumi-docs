# ADR-0015: Put the MCP core in Rust behind a thin npm launcher

- Status: Accepted target architecture
- Date: 2026-08-20
- Extends: ADR-0010, ADR-0013, ADR-0014

## Context

The current Node.js distribution is the accepted v0.1 runtime. It already
provides the required read-only corpus behavior, stdio transport, Streamable
HTTP transport, integrity-checked projections, and the supported package and
SEA delivery paths. Those behaviors are protected by the corpus-contract
schemas, fixtures, integration tests, and release gates.

The MCP data plane is a better long-term fit for a native implementation than
for a JavaScript implementation that is responsible for protocol framing,
bounded I/O, cancellation, and process lifecycle. The npm surface is still
valuable for discoverability, cross-platform installation, and a stable command
name, but it must not become a second implementation of the protocol or corpus
semantics.

## Decision

The target runtime topology is:

```text
npm package / platform package
  -> thin launcher
  -> verified native Sumi Docs MCP binary
  -> MCP stdio or sessionless Streamable HTTP
  -> corpus-contract schemas and fixtures
  -> bounded local/remote corpus loader
```

### Ownership

| Surface                    | Responsibility                                                                                             | Exclusions                                           |
| -------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `@sumi-os/docs-mcp`        | npm metadata, command discovery, platform selection, argument/signal forwarding, fallback policy           | protocol handlers, corpus parsing, runtime downloads |
| Rust MCP core              | protocol adapter, stdio and Streamable HTTP, bounded loaders, path/integrity checks, diagnostics, shutdown | Web rendering, publication, mutable controller state |
| `@sumi-os/corpus-contract` | JSON Schemas, canonicalization, fixtures, revision and integrity rules                                     | transport-specific behavior                          |
| `apps/web`                 | Astro/Starlight rendering, navigation, machine projection, static deployment                               | MCP process lifecycle                                |
| release workflow           | immutable artifacts, signatures, SBOM, provenance, rollback evidence                                       | runtime behavior changes                             |

The Rust core must consume the language-neutral corpus schemas and fixtures.
It must preserve the four public tool names, strict input rules, sanitized
error codes, metadata, read-only semantics, and the v1/v2 projection contracts.
It may not introduce a Rust-only wire or manifest authority.

The native server supports stdio and the 2026-07-28 sessionless Streamable HTTP
contract. The npm command forwards arguments, environment, exit status, and
termination signals. It fails closed when a verified native binary is absent;
it does not download executable code at runtime. Node/SEA remains the supported
fallback until the migration gates below pass and a human acceptance record
approves a default switch.

The Web application remains TypeScript/Astro. A Rust rewrite of the renderer,
publisher, or reconciliation controller is outside this decision.

## Migration gates

The native runtime is introduced in stages. Each stage produces an immutable
candidate and a rollback path; no stage changes the default runtime by itself.

| Gate             | Required evidence                                                                                                                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R0 contract      | Rust reads the current schemas and fixtures; canonical bytes, revisions, routes, and integrity failures match the contract package.                                                                |
| R1 protocol      | stdio and Streamable HTTP round trips match the current tool list, strict validation, metadata, error codes, protocol version, and shutdown behavior.                                              |
| R2 corpus parity | Markdown/MDX frontmatter, Unicode search, OpenAPI, local v2, remote v1/v2, route generation, and missing-document behavior match the Node reference.                                               |
| R3 security      | Path containment, symlink/junction handling, origin and redirect policy, response/file limits, timeout, credential redaction, and source immutability pass the shared negative suite.              |
| R4 lifecycle     | Restart, cancellation, bounded shutdown, repeated requests, snapshot preservation after failed loads, and no client/session state are demonstrated.                                                |
| R5 distribution  | Target binaries and the launcher have reproducible bytes, signing, SBOM, provenance, candidate smoke, and an executable rollback record.                                                           |
| R6 performance   | On the same supported Windows runner, 100-sample native, SDK baseline, and Node product measurements are complete; the native result meets the calibrated policy and shows a material improvement. |

The default runtime may switch only when R0-R6 are green, the existing Node
path remains available for rollback, and a human acceptance record names the
candidate digest, source commit, corpus revision, supported targets, and next
rollback command. A failed or incomplete gate leaves Node/SEA as the default.

## Implementation status

The native crate currently satisfies the stdio `tools/list` probe within R1
and an initial subset of R2. A shared fixture compares Markdown/MDX
frontmatter and text extraction, Unicode lexical search, document lookup, and
OpenAPI filtering against the Node reference field by field. This is not full
R1 or R2 completion: Streamable HTTP, strict tool execution, manifest v1/v2,
routes, security, lifecycle, distribution, and performance gates remain open.
Node/SEA remains the default runtime.

## Consequences

This separates installation ergonomics from runtime correctness and gives the
native implementation a clear compatibility boundary. It adds a platform
matrix, native signing and SBOM work, and a second implementation during the
parity period. Those costs are accepted only because they are isolated behind
the existing contract package and measured gates.

The npm package is not a general-purpose downloader or package manager. Native
artifacts are released as immutable, target-specific packages or release
assets. A missing or unverifiable binary is an installation error, not a reason
to silently execute a different architecture.

## Validation and rollback

The first implementation is a separately named Rust crate or workspace member
under the MCP package ownership boundary. It must have a protocol probe and
parity fixtures before the launcher selects it. The probe is allowed to be
stdio-only at R0/R1, but it cannot be described as dual-transport complete.

Rollback is the existing Node/SEA candidate with the same corpus projection and
release metadata. Removing the native package from the launcher selection and
restoring the last accepted Node artifact must not require source mutation or
corpus republishing.
