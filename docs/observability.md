---
title: Observability and tracking
description: What Sumi Docs records automatically and where telemetry belongs.
---

Operational evidence should be produced by the system that owns the operation,
not reconstructed from a user's notes. This project separates product
telemetry from document content and from agent memory.

## Current behavior

- The MCP core is stateless and read-only. It keeps a process-local corpus
  snapshot, not a user timeline or persistent event log.
- Client-facing responses expose bounded protocol metadata and sanitized error
  codes. Detailed diagnostics stay on stderr.
- CI records commit-bound test, build, packaging, security, and deployment
  evidence. The accepted commit and immutable artifacts are the release record.
- No OpenTelemetry exporter or remote analytics collector is enabled by default.

## Ownership boundary

| Signal                                          | Owner                        | Default policy                                                              |
| ----------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------- |
| Tool latency, error class, transport status     | MCP host or deployed service | Opt-in collection with bounded retention and no document bodies.            |
| Model, token, and prompt traces                 | Agent host or model gateway  | Host policy and provider controls; never emitted by the read-only MCP core. |
| Corpus revision, digest, and publication status | Publisher and CI             | Commit-bound, reproducible evidence.                                        |
| Business analytics                              | Adopting application         | Outside this repository's contract.                                         |

When telemetry is enabled, use OpenTelemetry resource and semantic-convention
names, redact absolute paths and credentials, and make sampling, export, and
retention explicit. A trace identifier may correlate a host operation with its
MCP call, but it must not turn the MCP server into a session store.

## Planned extension rule

Adding SDK instrumentation or a remote collector requires an architecture
decision covering data fields, consent, redaction, failure behavior, cost,
retention, and rollback. The first extension point is the host or Streamable
HTTP service boundary; stdio remains usable without network access. This keeps
the four read-only tools portable and avoids forcing every local user to run an
observability backend.
