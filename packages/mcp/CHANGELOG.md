# Changelog

This file records user-visible changes. Internal phase notes are retained under
`docs/history/` and are not release records.

## Unreleased

- Added stateless Streamable HTTP to the Node.js distribution while preserving
  stdio as the default and SEA transport.
- Added strict local v2 locator loading so the Web artifact and MCP container
  can consume the same sealed corpus bytes and revision without republishing.
- Required the 2026 protocol version metadata on every Streamable HTTP POST and
  normalized header mismatches and malformed JSON as JSON-RPC errors.
- Made the repository's reviewed `docs/` corpus the primary self-hosted example
  and documented source, page, and MCP endpoint addresses separately.
- Assigned versioned authorities for MCP, tool schemas, corpus manifests,
  TypeScript API docs, Web behavior, and a future Rust parity implementation.
- Replaced the host-sensitive cold-start maximum with an interleaved raw, SDK,
  and product benchmark plus a calibrated product-over-SDK release policy.
- Made the `serve` documentation source optional through bounded Git-aware
  project discovery and a strict `sumi-docs.config.json` contract.
- Added `--config` with explicit CLI precedence and containment checks for
  configured local paths.
- Added the read-only `doctor` command with human and JSON reports for runtime,
  discovery, corpus, and OpenAPI validation.
- Added self-contained MCP initialization instructions while preserving the
  existing four-tool surface and manifest v1 behavior.
- Prevented non-Git discovery from walking into parent directories such as a
  workspace container named `.sumi`.
- Made cold-start benchmarks reject invalid pnpm argument forwarding and record
  the executable digest, raw measurements, and p95 latency.
- Preserved bundled legal comments and added deterministic license, runtime,
  and CycloneDX materials to acceptance-candidate archives.
- Preserved deployment subpaths when explicit manifest routes are combined with
  `--base-url`.
- Added commit-bound npm candidate tarballs for the corpus contract and MCP
  package, including clean-consumer installation, checksums, and provenance
  evidence without publishing to the registry.
- Added a language-neutral Node/Rust parity fixture for Markdown/MDX parsing,
  Unicode lexical search, document lookup, and OpenAPI filtering while keeping
  the Node runtime as the production default.

## 0.1.0 - 2026-08-12

- Implemented Markdown/MDX and OpenAPI parsing.
- Implemented the read-only documentation index.
- Added the four MCP tools over stdio.
- Added a runnable example corpus and end-to-end stdio smoke test.
- Added source, development, configuration, architecture, and troubleshooting
  documentation.
- Added deterministic Git hooks, remote commit-policy checks, and a guarded
  history-rewrite playbook.
- Added commit-policy checks and a documented human-acceptance boundary for
  release candidates.
- Corrected the development commands and npm packaging preflight.
- Moved standalone build output to ignored `artifacts/bin/`.
- Clarified that search is lexical, stdio is the only transport, and the corpus
  is a process-local read-only snapshot.
- Added optional `--base-url` mapping so document list, search, and fetch results
  can include clickable public URLs.
- Mapped `index.md` and `index.mdx` document URLs to their directory pages.
- Added a loopback-only, read-only local document preview for using those URLs
  before a public site is deployed.
- Added remote documentation source mode using a strict, bounded JSON manifest.
  Local directories and remote HTTPS corpora expose the same four MCP tools.
- Preserved Unicode lexical substring search and deterministic result ordering.
- Made local corpus loading bounded and transactional so failed refreshes retain
  the previous read-only snapshot.
- Added an exact MCP tool reference and documented the authoritative repository
  initialization boundary.
- Added issue and pull request templates plus a reviewable contribution
  lifecycle.
- Documented the boundary between client Skills, the stateless MCP server,
  agent orchestration, and the human documentation site.
- Expanded the self-hosted example corpus with contribution and integration
  guidance.
