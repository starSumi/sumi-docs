# Architecture

## Architecture decisions

- [ADR-0001: Separate Astro documentation UI from the MCP data plane](decisions/0001-astro-starlight-dual-surface.md)
- [ADR-0002: Keep the MCP server and documentation site in sibling repositories](decisions/0002-polyrepo-and-package-manager.md)
- [ADR-0003: Evolve localized content through a versioned projection](decisions/0003-localized-content-projection.md)
- [ADR-0004: Initialize the authoritative source repositories](decisions/0004-authoritative-repository-initialization.md)
- [ADR-0005: Discover project documentation without owning `.sumi`](decisions/0005-project-discovery-and-local-state-placement.md)
- [ADR-0006: Publish an immutable version 2 content projection](decisions/0006-immutable-content-projection.md)
- [ADR-0007: Integrate through native agent-host contracts](decisions/0007-native-agent-host-integration.md)
- [ADR-0008: Unify the product in a pnpm workspace](decisions/0008-product-workspace-topology.md)
- [ADR-0009: Keep reconciliation state outside the MCP data plane](decisions/0009-reconciliation-and-control-plane-state.md)
- [ADR-0010: Keep Node.js until a Rust spike passes a parity gate](decisions/0010-runtime-migration-gate.md)
- [ADR-0011: Calibrate cold-start performance against the supported SDK](decisions/0011-calibrated-cold-start-policy.md)
- [ADR-0012: Serve one documentation core over stdio and Streamable HTTP](decisions/0012-dual-transport-and-address-model.md)
- [ADR-0013: Assign one authority to each public contract](decisions/0013-standards-and-schema-authority.md)
- [ADR-0014: Build one machine projection for Web and MCP deployment](decisions/0014-single-build-dual-target-publication.md)
- [ADR-0015: Put the MCP core in Rust behind a thin npm launcher](decisions/0015-rust-core-and-npm-launcher.md)

## Runtime boundary

The current Node.js implementation remains the v0.1 reference runtime. The
target native topology is a Rust MCP core selected by a thin npm launcher. The
launcher owns command discovery, platform selection, argument and signal
forwarding, and fail-closed handling when a verified native binary is absent.
It does not parse documents, implement MCP tools, download executable code, or
maintain a second corpus contract.

The Rust core must consume the language-neutral schemas and fixtures from
`@sumi-os/corpus-contract`. It is not allowed to create Rust-only manifest,
route, error, or tool authorities. Node/SEA stays available as the accepted
fallback until the parity, security, lifecycle, distribution, and calibrated
performance gates in ADR-0015 are complete.

## Request path

```text
MCP client
  -> stdio or stateless Streamable HTTP transport
  -> MCP tool handlers and Zod input validation
  -> process-local DocsVault
  -> Markdown/MDX parser or OpenAPI parser
  -> local read-only files or bounded remote manifest fetches
```

Before the transport starts, `src/project-config.ts` resolves an explicit CLI
source, strict tracked config, or bounded `docs/` convention and verifies that a
local corpus is readable and non-empty. This startup discovery has no client or
session state. `src/doctor.ts` applies the same resolver and fully loads the
corpus for a read-only diagnostic without starting MCP.

In stdio mode, the MCP server is created without loading the corpus, so
`tools/list` and discovery can respond immediately. The first tool invocation
that needs content constructs the `DocsVault`; the resulting promise and
read-only index are reused for the life of that process.

Streamable HTTP performs the same bounded corpus load before opening its
listener. The HTTP adapter then creates a fresh protocol server per request and
shares only that immutable process-local snapshot. A local directory or remote
`_mcp` manifest selects corpus bytes, a catalog route selects the page a person
opens, and `/mcp` selects the agent-facing transport endpoint. None is inferred
from another.

In this project, stateless means no client identity, session data, conversation
state, or request-driven mutation. It does not mean the process has no memory.
The parsed documentation index is process-local read-only state.

## Modules

| Path          | Responsibility                                                |
| ------------- | ------------------------------------------------------------- |
| `src/parser/` | parse Markdown/MDX and OpenAPI input                          |
| `src/vfs/`    | acquire the local/remote corpus and query its read-only index |
| `src/mcp/`    | validate tool input and map calls to VFS operations           |
| `src/types/`  | shared TypeScript contracts only                              |
| `src/utils/`  | pure path and text helpers                                    |

The CLI owns project discovery and diagnostics. It passes one resolved source to
the VFS; project config parsing does not enter the MCP request handlers.

The protocol layer does not perform direct file I/O. The VFS does not know about
JSON-RPC. UI frameworks, DOM libraries, databases, and HTTP frameworks are out of
scope.

## Security boundaries

- MCP tool arguments are validated with strict Zod schemas.
- `fetch_doc` accepts a restricted relative Markdown/MDX path and performs a map
  lookup; it does not concatenate client input into a filesystem path.
- The VFS derives document keys only from files found below the configured root.
- Remote mode accepts a strict manifest, resolves restricted relative paths on
  the same origin, rejects redirects, and bounds response time and size.
- Any future feature that opens a client-provided path must resolve the candidate
  and use `path.relative` to prove it remains below the root. String prefix checks
  are not a valid containment test.
- Client-facing errors are sanitized. Detailed failures go to stderr.
- The server exposes no write, delete, or source modification tools.

## Data and refresh behavior

Local or remote Markdown and MDX files are parsed during vault construction. Full parsed content
therefore remains in memory; content is not loaded per `fetch_doc`. There is no
file watcher or live refresh. This is a known tradeoff against the original memory
target and must be measured before claiming support for very large corpora.

## Public tool contract

The stable tool names are `list_docs`, `search_docs`, `fetch_doc`, and
`get_openapi_spec`. Their schemas and output shape are covered by integration
tests. Renaming a tool or changing a schema is a public API change.
