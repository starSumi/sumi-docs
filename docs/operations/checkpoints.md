---
title: Checkpoint protocol
description: Commit-bound delivery stages, evidence, invalidation, and controller boundaries.
---

# Checkpoint protocol

Checkpoints are immutable evidence records, not a live database or a list of
unchecked claims. GitHub checks and candidate artifacts hold completed records;
this page defines their required shape.

## Delivery stages

| ID  | Stage                   | Exit evidence                                                                   |
| --- | ----------------------- | ------------------------------------------------------------------------------- |
| CP0 | Scope frozen            | owner, authority, PRD scope, source commit, and rollback boundary               |
| CP1 | Design accepted         | applicable ADRs, public contracts, threat boundary, and compatibility plan      |
| CP2 | Implementation complete | exact changed paths and package-local tests                                     |
| CP3 | Package gates green     | lint, typecheck, unit/integration tests, builds, and package previews           |
| CP4 | Product gates green     | cross-product, security, host, provenance, signing, and performance results     |
| CP5 | Candidate sealed        | clean commit, immutable artifact digests, source provenance, and candidate URL  |
| CP6 | Human accepted          | named accountable owner, decision, accepted exceptions, and evidence references |
| CP7 | Promoted                | remote refs, release/deployment identifiers, readback, and rollback evidence    |

Every record binds `repository`, `sourceCommit`, `checkpoint`, `generation`,
`gateIds`, immutable evidence references or hashes, blockers, rollback, and the
next allowed transition. A source commit or corpus revision change invalidates
CP2 and later records. It never silently advances an old candidate.

## Transition model

```text
DISCOVERED -> PLANNED -> IMPLEMENTING -> VERIFYING -> CANDIDATE
           -> BLOCKED -> IMPLEMENTING
CANDIDATE  -> HUMAN_ACCEPTED -> RELEASED
CANDIDATE  -> REJECTED -> IMPLEMENTING
RELEASED   -> ROLLED_BACK -> VERIFYING
```

Publication has one logical writer. Promotion uses compare-and-set against the
expected generation and accepted source commit. A CAS failure blocks promotion;
it never falls back to last-writer-wins.

## State placement

Repository source owns contracts, templates, and decisions. GitHub owns review
and commit-bound CI evidence. Immutable manifests own corpus revision identity.
Mutable leases, retries, cursors, processes, caches, queues, SQLite files, WAL,
and acknowledgements belong in the platform user-data directory, never in this
repository, its parent `.sumi`, or an agent-host directory.

## Executable evidence

The production workflow runs `scripts/release-checkpoint.mjs observe` only after
public Pages readback and, when enabled, protected remote MCP finalization. The
observer collects the live locator, immutable manifest, discovery metadata, and
readiness response in one process. It emits a strict CP7 record only when every
condition is `True`, then uploads that record as
`release-checkpoint-<run-id>-<run-attempt>`.

Use `verify` to bind a downloaded checkpoint to its expected repository,
commit, run attempt, and corpus revision. A maintainer may write a manual
observation below ignored `artifacts/`; checkpoint instances are not repository
source. `observedAt` is diagnostic time, not an ordering cursor. Run ID, run
attempt, source commit, and corpus revision provide identity.

CP0-CP4 remain Git, PR, and required-check evidence. CP5 is the immutable
acceptance-candidate artifact. CP6 exists only when an accountable human or a
protected environment records acceptance. CP7 is the post-promotion checkpoint
artifact. None of these records authorizes mutable state inside the read-only
MCP server.

## Future managed controller gate

The current product does not require a background controller. If continuous
watching, queued reconcile, or crash recovery becomes necessary, a new ADR must
specify a single writer lease with fencing, append-only events, rebuildable
SQLite WAL projection, idempotent replay, CAS promotion, and explicit
`flush`/`checkpoint`/`shutdown` acknowledgements.

Cancellation should use `AbortSignal` cooperatively and then a bounded hard
termination grace. Timeouts are configured per task class and measured; a
global `10s + 2s` constant is not a product invariant. Cancellation, duplicate
or lost notifications, process death, WAL recovery, and stale fencing tokens
must not expose a partial revision. Notifications remain best-effort wakeups,
not correctness or UI state.
