# Sumi Docs Workspace Instructions

## Product contract

This workspace owns the Sumi Docs product. It contains a read-only MCP server,
an Astro/Starlight website, and a versioned corpus contract. Source visibility
does not authorize a tag, package, deployment, binary release, or archival of
predecessor repositories.

## Ownership

- `packages/mcp/`: headless, stateless, read-only MCP data plane.
- `apps/web/`: trusted content rendering and corpus publication.
- `packages/corpus-contract/`: pure schemas, canonicalization, fixtures, and
  conformance helpers. No transport, filesystem, Astro, or parser behavior.
- `docs/`: reviewed product documentation and default self-hosted corpus.
- `.agents/skills/`: reviewed, repository-scoped usage and contribution
  workflows. Cross-repository maintainer policy remains user-scoped.
- `.codex/`, `.mcp.json`, `.vscode/`: thin project MCP adapters only.

Nested `AGENTS.md` files continue to govern package-specific security and
validation. The root contract wins for workspace topology and cross-package
commands.

## Reconciliation model

- For any mutable orchestration resource, keep versioned desired `spec`
  separate from controller-owned `status`. Machine-readable `conditions` bind
  `observedGeneration` to the `generation` actually observed and record type,
  status, reason, and immutable evidence. Stale or incomplete evidence is
  `Unknown`, never success.
- Automation follows an observe-diff-reconcile loop. Reconciliation is
  idempotent, cancellation-aware, and restartable. Each mutable resource has one
  logical writer protected by a lease and monotonically increasing fencing
  token. Promotion uses compare-and-set against the expected generation or
  revision; conflicts and unavailable preconditions fail closed.
- `apps/web` owns staging, sealing, atomic promotion, and rollback of complete
  publication artifacts. Any future controller owns leases, events, retries,
  checkpoints, and cleanup outside the repository. Skills route intent and
  procedure only; `packages/mcp` remains a stateless, read-only data plane.
- Preserve the last verified artifact when reconciliation fails, and treat
  rollback as an explicit, evidence-backed generation transition. Do not add a
  generic orchestration API, distributed state store, scheduler, or extension
  framework without a measured workload and an accepted decision.

## Design review lenses

- Apply Conway's law deliberately: package, service, workflow, and release
  boundaries must match durable ownership and operational responsibility. If a
  routine change repeatedly requires synchronized edits across owners, repair
  the contract or ownership boundary instead of normalizing coordination debt.
- Essential complexity must have an explicit owner. Keep protocol, security,
  integrity, and recovery complexity in their governing contract or control
  plane; do not leak it into host adapters, skills, or consumers merely to make
  the core appear simpler.
- Prefer executable invariants, conformance tests, and fail-closed workflow
  policy over prose. Documentation explains the contract but cannot substitute
  for an enforced state transition or release gate.

## Invariants

- Preserve manifest v1 at its existing URL and shape while v2 is introduced in
  parallel.
- Web and MCP keep different MDX trust models; do not share their parsers.
- MCP requests never depend on client identity, session history, or mutable
  workflow state.
- Mutable controller state never lives in `.sumi/`, the repository, or an agent
  host configuration directory.
- Generated projection has one logical publisher. Consumers verify immutable
  revisions and never observe a partially promoted snapshot.
- Do not answer a Sumi Docs status question from a stale report when current
  source, tests, GitHub checks, or a status probe is available.

## Commands

Use Node.js 25.5.0 or newer and install from the workspace root:

```powershell
pnpm install --frozen-lockfile
pnpm run verify
pnpm run verify:integration
```

Run package-local commands with `pnpm --filter <name> <script>`. Stage
exact paths only. Keep predecessor repositories private and intact until their
recovery role is deliberately retired.
