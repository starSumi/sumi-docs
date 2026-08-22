# Contribution workflow

This document defines how an idea becomes a reviewed change in
Sumi-Docs-MCP. The root `CONTRIBUTING.md` remains the conventional repository
entry point; this page is the detailed workflow available to both people and
MCP clients.

## Start with an issue when the contract may change

Open an issue before implementation when a proposal affects any of these
surfaces:

- public tool names, inputs, results, metadata, or errors;
- transports, source acquisition, trust boundaries, or security limits;
- production dependencies, runtime support, packaging, or release policy;
- architecture, performance targets, or compatibility guarantees;
- a reusable Skill, agent integration, or orchestration layer.

A direct pull request is appropriate for a narrow documentation correction,
test-only improvement, or internal fix that preserves the public contract.
Security vulnerabilities must follow `SECURITY.md`, not a public issue.

An issue should state the observed problem, the desired external behavior,
alternatives considered, compatibility impact, and acceptance evidence. It
should not assume that a proposed implementation is the only solution.

## Prepare a focused change

Create a topic branch from the current default branch. Keep one conceptual
change in each pull request. Add a failing test for a regression or define
observable acceptance criteria before implementation. Keep business behavior
inside its owning module and update shared types before adapters when a public
contract changes.

Use a draft pull request while the design, tests, or documentation are still
incomplete. Rebase a private topic branch onto the current default branch when
needed, but do not rewrite commits that other contributors are already using.

Commits use Conventional Commits and remain independently understandable.
Generated output, local agent state, and unrelated formatting do not belong in
the same change.

After the initial 0.1.0 npm bootstrap, a change to published contract or MCP
behavior includes a changeset for every affected public package. Documentation,
tests, repository tooling, and private Web changes do not require an empty
changeset. Release intent does not authorize publication.

## Describe the pull request

Complete the repository pull request template. Reviewers must be able to find:

- what changed, why it is needed, and how the implementation works;
- the related issue or a reason why no issue was necessary;
- user, protocol, security, dependency, and compatibility impact;
- exact validation commands and their results;
- documentation, example, and changelog updates;
- rollback steps for changes with operational impact.

Mark the pull request ready only when it is mergeable, the required checks
pass, and every requested review change is either implemented or resolved in
discussion. Do not use a successful narrow test as evidence that the complete
gate passed.

## Validate at the correct scope

Ordinary source and documentation changes run:

```powershell
pnpm run lint
pnpm run typecheck
pnpm test
pnpm run build
pnpm run example:smoke
pnpm pack --dry-run
```

SEA and packaging changes also run the executable checks and cold-start
benchmark documented in `AGENTS.md` and `docs/development.md`. Protocol or
publishing changes must run `pnpm run verify:integration` from the workspace
root.

Report runtime versions, failed gates, skipped gates, and measured performance
without rewriting them as passing conclusions.

## Review and merge

Review focuses on external behavior, architecture boundaries, security,
compatibility, tests, and operator documentation. Authors respond to every
review thread before requesting another review. New commits after approval may
require renewed review when they change the assessed behavior.

GitHub merge commits are disabled. Maintainers choose squash merge for a
focused change or rebase merge when an intentionally structured commit series
is useful. Release tags and GitHub Releases are created only through the
separate human acceptance process in `docs/releasing.md`.

## Skill and agent integration changes

A Skill describes when and how an agent should use a capability. This MCP
server provides the controlled capability and documentation data. Stateful
workflow orchestration belongs to an agent host, workflow engine, or reviewed
BFF rather than this server. Read `docs/skills-and-orchestration.md` before
proposing files under `.agent`, `.agents`, or a client-specific skill catalog.
