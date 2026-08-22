# Release intent

Changesets record the semver and changelog intent of a pull request that changes
a public npm package. Run `pnpm changeset`, select every affected public package,
and describe the externally observable change in factual release-note language.

The public packages are versioned independently. Select both
`@sumi-os/corpus-contract` and `@sumi-os/docs-mcp` when a contract change also
changes the MCP package's supported behavior or dependency requirement.

Documentation-only, test-only, repository tooling, and private Web application
changes do not require an empty changeset. Pull requests that change a public
package but preserve its published behavior should explain the exemption in the
pull request body.

After changesets reach `main`, the release-intent workflow maintains a version
pull request. It may update package versions and package changelogs. It does not
publish packages, create tags, build acceptance artifacts, or replace human
acceptance. Do not add `changeset publish` to repository scripts or automation.

The already versioned 0.1.0 baseline is a separate first-publication bootstrap.
Do not add a changeset for pre-bootstrap release-tooling changes or manufacture a
0.1.1 version solely to make `changeset status` pass on that bootstrap branch.
Normal release-intent collection begins after both 0.1.0 packages are present in
the registry.
