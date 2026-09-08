---
title: Engineering records
description: Choose the durable record for a requirement, proposal, decision, specification, benchmark, security report, or pull request.
---

Engineering records serve different stages of a change. Use the smallest record
that preserves the decision and its evidence; do not create parallel prose that
can drift from executable contracts.

## Record map

| Question                                                             | Record                        | Canonical location                                                     | Lifecycle                                                                           |
| -------------------------------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| What product outcome must remain true?                               | Product requirement           | `docs/product/product-requirements.md`                                 | Updated when durable scope or acceptance criteria change                            |
| Should the project adopt this external behavior or design direction? | Proposal issue                | GitHub issue created from the feature proposal form                    | Open before implementation; close with the resulting decision or pull request       |
| Why was a durable tradeoff accepted or rejected?                     | Architecture decision record  | The owning package's `docs/decisions/` directory                       | Immutable decision history with explicit supersession                               |
| What does a machine-readable contract accept and produce?            | Executable specification      | JSON Schema, TypeScript types, MCP tool schemas, and conformance tests | Versioned with the public contract                                                  |
| Does a performance threshold pass under a defined method?            | Benchmark policy and evidence | Policy ADR plus commit-bound CI artifact                               | Keep the method durable; regenerate raw evidence for each candidate                 |
| How is a vulnerability coordinated?                                  | Private security advisory     | GitHub Security Advisory under `SECURITY.md`                           | Private until coordinated disclosure; request or assign a CVE only when appropriate |
| What reviewed implementation will merge?                             | Pull request                  | GitHub pull request and its checks                                     | References the applicable issue, decision, specification, and evidence              |

## Proposal and decision boundary

A proposal describes an unresolved problem, intended external behavior,
alternatives, compatibility impact, and acceptance evidence. It is not an
accepted architecture decision. Use a direct pull request for a narrow
correction that preserves public behavior.

An ADR records a durable decision after the tradeoff is understood. Put it in
the workspace that owns the boundary, include status and date, and document
context, decision, consequences, validation, and rollback. Supersede an ADR
instead of silently rewriting its historical decision.

The project uses proposal issues for pre-decision review rather than a second
RFC document tree. Introduce a versioned RFC process only when a proposal needs
long-lived review outside the issue lifecycle; that change itself requires an
architecture decision with an owner and migration plan.

## Specifications and generated references

Schemas, exported types, tool input definitions, and tests are the executable
specification. Human documentation explains how to use those contracts. API
reference pages are generated from reviewed TypeScript exports and remain a Web
surface; they do not automatically become MCP corpus entries.

Changing a public contract requires compatible schema and type changes, red and
green conformance tests, active documentation, examples, and changelog entries
in the same pull request.

## Current contract authorities

| Surface                     | Authority                                                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| MCP messages and transports | The versioned [Model Context Protocol specification](https://modelcontextprotocol.io/specification/) and installed official SDK |
| Tool arguments              | Strict Zod definitions in the MCP package; the official SDK advertises their JSON Schema                                        |
| Corpus manifests            | Draft 2020-12 schemas, canonicalization, and fixtures in `@sumi-labs/corpus-contract`                                           |
| TypeScript API reference    | Exported declarations and generated TypeDoc pages                                                                               |
| Future Rust API reference   | Exported Rust items and rustdoc, only after a supported parity implementation exists                                            |
| Browser accessibility       | Published Web standards and [WCAG 2.2](https://www.w3.org/TR/WCAG22/)                                                           |

LSP is not a project contract. It is an editor language-service protocol, and
sharing JSON-RPC with MCP does not make this server an LSP implementation. A
future Rust runtime must consume the same language-neutral schemas and fixtures;
it must not redefine the wire contract.

## Benchmark and security evidence

A benchmark claim must identify the implementation, runtime, platform, sample
count, ordering method, thresholds, and raw result artifact. Local reports and
generated measurements are not committed as product state. Candidate evidence
is bound to the tested commit and retained by CI.

Report suspected vulnerabilities through the private route in `SECURITY.md`.
Do not publish exploit details or create placeholder CVE identifiers. A public
advisory and CVE record follow validation and coordinated disclosure, not the
initial report.

See [Contributing](../../contributing/) for the implementation and review flow.
