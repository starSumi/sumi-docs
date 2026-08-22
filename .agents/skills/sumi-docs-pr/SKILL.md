---
name: sumi-docs-pr
description: Prepare and validate a Sumi Docs pull request. Use when classifying a proposed change, checking a branch or diff, deciding whether an issue, proposal, ADR, specification, benchmark, or security advisory is required, or drafting a PR title and body.
---

# Prepare a Sumi Docs Pull Request

Read the root and nearest nested `AGENTS.md`, `CONTRIBUTING.md`, and the current
pull request template. Inspect live Git status, the diff, and the base branch;
preserve unrelated work and never infer a clean tree from an earlier report.

## Classify the record before implementation

- Use a direct pull request for a narrow correction or internal change that
  preserves public behavior.
- Open a proposal issue before changing a public contract, architecture,
  security boundary, production dependency, locale or route model, deployment,
  or host integration.
- Update the product requirements document for durable product scope.
- Record an accepted, durable tradeoff as an ADR in the owning decision
  directory. Do not use an ADR as a work log.
- Put executable specifications in schemas, TypeScript types, tool schemas, and
  conformance tests. Do not maintain a prose duplicate of a machine contract.
- Add or update a reproducible benchmark when a performance claim or threshold
  changes; generated benchmark evidence belongs to CI artifacts.
- Route vulnerabilities through `SECURITY.md` and a private GitHub advisory.
  Never open a public CVE placeholder or public vulnerability issue.

## Verify the net change

Map changed paths to their owning workspace. Run the smallest relevant red test
first, then the owning package checks. Before declaring the branch ready, run
from the repository root:

```powershell
pnpm run verify
pnpm run verify:integration
```

For content changes, require both locales, the reviewed content catalog, fresh
translation-pair records after human semantic review, and a Web-to-MCP URL
round trip. For a public contract change, update active documentation,
examples, tests, and the changelog together. After the initial 0.1.0 npm
bootstrap, add a changeset for every public package whose published behavior
changes. Do not use `changeset publish`; package promotion remains bound to the
accepted candidate tarballs. Report every failed or skipped gate.

## Draft the pull request

Use a Conventional Commit-style title. Explain why the net change is needed
before what changed. Include compatibility and security impact, focused test
evidence, documentation impact, and an exact rollback. Use repository-relative
paths and omit local paths, credentials, private corpus data, agent attribution,
and abandoned implementation attempts.

Preserve useful existing PR content. Do not create, edit, label, merge, or
publish a GitHub pull request unless the user explicitly authorizes that remote
write.
