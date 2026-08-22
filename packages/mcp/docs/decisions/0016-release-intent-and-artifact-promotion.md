# ADR-0016: Separate release intent from artifact promotion

- Status: Accepted
- Date: 2026-08-22
- Owners: Sumi Docs maintainers

## Context

The workspace has two public npm packages with independent versions and one
private Web application. Pull requests need a reviewable statement of semver and
changelog intent, while the release process already builds commit-bound
tarballs, records their digests, and requires human acceptance before any public
promotion.

Changesets can maintain version pull requests, but its publishing command can
also publish packages and create Git tags. Giving that command authority would
merge release intent with artifact construction and promotion, allowing a
versioning tool to rebuild or replace accepted bytes.

Changesets 3.0.1 does not support the project's pinned Node.js 25 runtime. The
latest compatible 2.x release is therefore the reviewed integration baseline.
Changesets Action v2 targets Changesets v3, so it cannot be paired with that
CLI. The latest v1 maintenance release is the compatible action line.

## Decision

Use Changesets 2.31.1 for pull-request release intent, semver calculation,
package-version updates, internal dependency updates, and package changelogs.
Keep `@sumi-os/corpus-contract` and `@sumi-os/docs-mcp` independently versioned;
do not configure fixed or linked groups. Private packages are neither versioned
nor tagged.

Pin Changesets Action v1.9.0 by commit SHA. Its v1 input contract and Changesets
2 compatibility are repository-policy assertions; an action major upgrade must
be reviewed together with the CLI and Node runtime.

A contribution that changes the published behavior of a public package adds a
changeset for every affected package. A contract change selects the MCP package
as well when it changes supported MCP behavior or compatibility; the workspace
dependency alone is not evidence of that product impact. Documentation-only,
test-only, repository-tooling, and private-Web changes do not need an empty
changeset.

After release-intent files reach `main`, one least-privilege workflow may use the
pinned Changesets action to maintain a version pull request. That workflow may
run `changeset version`. It must not receive a `publish` command, an npm token,
tag authority, artifact-building responsibility, or a protected release
environment.

The accepted sequence for a package release is:

```text
change pull requests with release intent
  -> reviewed version pull request
  -> immutable acceptance candidate from the merged version commit
  -> human acceptance of exact tarballs and checksums
  -> protected promotion of those exact tarballs
  -> registry and public metadata readback
```

The first 0.1.0 publication remains a bootstrap of the already versioned and
accepted baseline. Changesets must not invent a 0.1.1 bump merely to describe
pre-bootstrap release-tooling work. Normal changeset collection begins after
the two 0.1.0 packages exist in the registry.

`changeset publish` is not an approved repository command. The candidate builder
continues to construct and validate the exact contract and MCP tarballs. A
separate protected publisher may later consume only those accepted bytes; it
must not rebuild them or derive release authority from the version pull request.
Git tags, GitHub Releases, binaries, the site, and the remote MCP service remain
separate promotion surfaces.

## Consequences

Release intent becomes reviewable beside the code change, package changelogs and
versions are maintained consistently, and independent package versions remain
possible. The repository carries one additional development dependency and one
write-capable workflow whose authority is limited to contents and pull requests.

The current Changesets major version is intentionally behind latest until the
project runtime supports its engine contract. A dependency update must recheck
Node and pnpm engines, config-schema compatibility, version output, and the
workflow's negative publication tests.

## Validation and rollback

Repository tests require the exact Changesets version and configuration, reject
publish or tag commands, validate the fixed action SHA and workflow permissions,
and keep npm candidate construction independent. Package, integration, smoke,
and dry-run pack gates remain required after a version pull request is merged.

Rollback removes the release-intent workflow, Changesets scripts, dependency,
and configuration in one reviewed change. Existing package versions,
changelogs, accepted candidate records, and published artifacts are not rewritten.
