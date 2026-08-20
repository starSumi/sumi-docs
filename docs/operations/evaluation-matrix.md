---
title: Evaluation matrix
description: Blocking capabilities, commands, thresholds, evidence, and rollback owners.
---

# Evaluation matrix

Run the narrowest failed evaluation first, then the root product gates. A pass
is valid only for the recorded source commit, runtime, configuration, and
artifact digest.

| Gate  | Capability                                               | Command or evidence                                         | Blocking rule                                                                                                                          |
| ----- | -------------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| E-L01 | Static analysis policy                                   | `pnpm run lint` plus `pnpm run typecheck`                   | Oxlint reports no errors or warnings, the pinned root policy is the only lint configuration, and compiler checks pass independently.   |
| E-Q01 | Duplicate-code growth                                    | `pnpm run duplication`                                      | Authored non-test code remains at or below the 5% repository threshold.                                                                |
| E-C01 | Contract schema and canonical revision                   | `pnpm run verify:contract`                                  | All fixtures and canonicalization tests pass.                                                                                          |
| E-W01 | Catalog, locales, routes, and artifact commit            | `pnpm run verify:web`                                       | No omissions, duplicate identity, source drift, replacement of existing output, or partial artifact visibility.                        |
| E-M01 | MCP protocol, statelessness, paths, Unicode, diagnostics | `pnpm run verify:mcp`                                       | All package gates pass with sanitized client and stderr errors.                                                                        |
| E-N01 | Rust native protocol probe                               | `pnpm run verify:native`                                    | Pinned toolchain, formatting, Clippy, locked tests, and a real stdio `tools/list` round trip pass; this does not satisfy R0-R6 parity. |
| E-I01 | Web projection consumed through MCP                      | `pnpm run verify:integration`                               | v1/v2, URL, locale, digest, and four stable tools agree.                                                                               |
| E-H01 | Codex, Claude Code, and VS Code adapters                 | `pnpm run verify:hosts` plus human trust checks             | Commands are portable, allowlisted, non-duplicating, and approved by each host.                                                        |
| E-S01 | Dependency and repository policy                         | lock/workflow/host policy verifier plus official pnpm audit | Only approved registry hosts, pinned actions, least privilege, and no local state.                                                     |
| E-P01 | MCP package boundary                                     | `pnpm run pack:mcp`                                         | Preview contains only declared distributable files.                                                                                    |
| E-X01 | Windows executable                                       | SEA build, version, and executable smoke                    | Current source builds and the produced hash passes the protocol smoke.                                                                 |
| E-X02 | Calibrated cold start                                    | 100 interleaved starts per raw, SDK, and product subject    | No errors/timeouts; product median <=200 ms and p95 <=350 ms; SDK-relative median delta <=35 ms and ratio <=1.30; p95 delta <=75 ms.   |
| E-R01 | Candidate provenance                                     | acceptance candidate workflow and digest readback           | Build is unprivileged; promotion is latest-main, protected, and commit-bound.                                                          |
| E-R02 | Signing and public privacy                               | signature verification and all-ref identity scan            | Signature policy and public email policy pass or has an owner-approved exception.                                                      |
| E-U01 | Human acceptance                                         | CP6 record                                                  | One owner accepts one commit and digest set after Web and MCP testing.                                                                 |

## Failure handling

A failed blocking gate moves the delivery state to `BLOCKED` and records the
raw evidence and rollback. Retrying requires a new run against the same source
commit; changing source invalidates CP2 and later evidence. `continue-on-error`
may collect diagnostics but cannot change a blocking gate to passed.

## Environment coverage

CI proves clean checkout behavior. Maintainers also verify Windows-native Node
25.5, the SEA executable, real browser desktop/mobile layout, and native host
trust prompts. A script that starts three commands independently does not prove
that every IDE avoids duplicate discovery or that a person accepted workspace
trust.
