# ADR-0014: Build one corpus projection for both deployment targets

- Status: Accepted
- Date: 2026-08-19
- Owners: Sumi Docs maintainers
- Extends: [ADR-0006](0006-immutable-content-projection.md), [ADR-0012](0012-dual-transport-and-address-model.md)

## Context

The public documentation site and the remote MCP service are separate
deployment targets. A configured site release verifies that the remote MCP
service reports the same source commit and corpus revision as the site artifact.
If the service acquires its new corpus from the currently deployed site, the
next release is circular: the service cannot report the next revision until the
site publishes it, while the site refuses to publish until the service reports
it.

Generating the projection independently inside a container is also
insufficient. Equal source inputs are not evidence that two independently
produced byte streams are the same accepted artifact.

## Decision

One commit-bound build produces one complete machine projection. The exact v2
locator, immutable manifest, documents, and OpenAPI bytes from that build are
fanned out unchanged to both artifacts:

```text
reviewed docs + catalog + OpenAPI at commit S
                    |
                    v
           sealed projection W(S, R)
              /              \
             v                v
       MCP OCI image       Web site artifact
          I(S, R)             W(S, R)
```

The container consumes an already generated projection. It does not run a
second publisher. The MCP process loads the embedded `v2/current.json` through
a local read-only locator loader that verifies the canonical manifest,
revision, byte counts, and SHA-256 digests before committing the process-local
vault. The image reports the source commit as `buildRevision` and the verified
locator revision as `corpusRevision`.

Production publication is one logical, serialized workflow:

1. verify the source commit and build the projection once;
2. build and publish the OCI image by immutable digest;
3. record the previously deployed image digest and public site tuple;
4. deploy the new MCP image and verify `/readyz` plus a real MCP request;
5. deploy the Web artifact containing the same projection bytes;
6. read back the public locator and repeat the cross-product probe.

A newer source commit queues behind an in-progress production publication. It
must not cancel a run after the MCP target may have changed. Only the deployment
job receives production credentials. Build jobs remain unprivileged.

The two public origins do not provide a shared transaction or common compare-
and-set operation. The workflow therefore records immutable evidence and uses
compensation: if the MCP target changes but the Web deployment does not become
valid, restore the recorded previous image digest and verify the previous
tuple. Before the first stable-container mutation, the remote host records an
immutable transaction intent containing the old and new image, image ID, build,
and corpus identities. A second immutable marker is written only after the new
stable container passes readiness. The release and recovery workflows observe
those markers and the exact container topology; an uploaded switch artifact is
additional evidence rather than the sole recovery source.

Finalization and rollback each write a durable terminal marker before deleting
any intent, completion, or rollback container. A committed marker is written
only after both public products have passed readback. A rolled-back marker is
retained until the restored public locator and MCP readiness tuple have passed
readback; only then may intermediate evidence be removed. Repeating either
operation validates the terminal marker against the current container identity
before continuing cleanup.

Recovery binds its Pages decision to the exact workflow run attempt, job, and
deployment-step conclusion. The existence of a retained Pages artifact is not
evidence that Pages deployment was attempted. If Pages was attempted,
compensation restores and reads back the retained public locator before
restoring the MCP container. If Pages was not attempted, it does not deploy an
artifact and may restore MCP directly. Missing, contradictory, or unknown phase
or transaction evidence fails closed; recovery does not attempt an unproven
forward promotion.

Release, switch, rollback, and recovery artifacts include both the workflow run
ID and run attempt in their names. Recovery derives the exact names from the
failed event coordinate and rejects duplicate or cross-attempt evidence. The
retained Pages artifact must match the live v2 locator and manifest provenance,
and must also match the live `_mcp/server.json` state: either the same 404
absence or byte-identical 200 content. Equal corpus revisions do not substitute
for discovery-state evidence.

Deployment JSON is read and parsed once by the production verifier. Its
validated envelope contains the canonical validated value and a SHA-256 digest
of the exact input bytes. Workflow outputs are derived from that envelope; they
do not re-read the mutable input file after validation.

Deployment configuration keeps operator-facing origins as absolute HTTPS URLs.
The preflight verifier canonicalizes their hostnames, removes ports, applies
URL IDN processing, rejects duplicates after normalization, and passes only the
hostname list to the MCP CLI boundary. The remote deployment script validates
both host lists again before starting a container.

Remote discovery metadata remains absent until DNS, TLS, ingress ownership,
the deployment environment, and the complete end-to-end probe are accepted.
An unavailable deployment prerequisite fails closed; it does not weaken the
revision or build identity check.

## Consequences

The local locator loader is an additive acquisition mode. It shares the same
strict versioned corpus contract as the HTTPS loader and does not add crawling,
source mutation, session state, or a second MCP tool implementation.

The publication workflow is a bounded release coordinator, not a general
controller. It does not introduce a database, scheduler, distributed lock, or
plugin runtime. A dedicated external controller requires a measured workload
and a separate accepted decision.

Local development may still mount an ordinary documentation directory. Such a
directory has no wire revision and is not a production cross-origin release
artifact.

## Validation and rollback

Tests prove that the machine projection used for the image is byte-identical to
the Web projection for the same commit. Local loader tests cover locator and
manifest tampering, content integrity, containment, symbolic-link escape,
bounded input, and atomic vault replacement. Container tests assert the exact
build and corpus revisions and exercise the 2026 protocol request shape.

Workflow policy tests require least privilege, immutable image references,
serialized production execution, strict host-key verification, post-deploy
readback, exact run-attempt artifact selection, live discovery-byte binding,
explicit Pages phase evidence, durable transaction observation, terminal-marker
cleanup re-entry, table-driven job-result compensation, and a previous-digest
rollback path. These are structural policy tests, not an executable
fault-injection harness. Protected-environment drills remain an open production
gate for interruption at each intent, stop, rename, start, readiness, completion,
terminal, cleanup, and artifact-upload boundary; Pages compensation success and
failure; unknown phase evidence; recovery restart; and both restored public
readbacks.

When Pages was attempted, rollback restores the previously recorded image
identity and retained site artifact, then verifies both public tuples. When
Pages was not attempted, rollback leaves Pages untouched and verifies the
restored or absent MCP tuple against the public locator state. Source history
and immutable corpus snapshots are not rewritten during rollback.
