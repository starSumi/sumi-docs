# Deployment

The site is a static Astro build. The root `Production documentation release`
workflow deploys the latest verified `main` commit. It defaults to Pages-only
publication and can explicitly add the protected Streamable HTTP service. The
separate `Acceptance candidate` workflow prepares immutable review artifacts
without deploying them.

## Prerequisites

- Configure the repository's authoritative GitHub remote.
- Protect the default branch and require both `CI` operating-system jobs.
- Enable private vulnerability reporting.
- Enable GitHub Pages with GitHub Actions as its source.
- Keep the `github-pages` environment restricted to the protected `main`
  branch.
- Configure the hosting environment separately from local `.env` files.

## GitHub Pages deployment

For this repository, `SITE_URL` is the HTTPS origin and `BASE_PATH` is the
project path:

```text
SITE_URL=https://starsumi.github.io
BASE_PATH=/sumi-docs/
```

The workflow obtains both values from `actions/configure-pages`, verifies the
site and MCP projection under that exact prefix, and uploads only
`apps/web/dist`. With `ENABLE_REMOTE_MCP` absent or `false`, it requires remote
discovery metadata to be absent and does not enter the remote environment,
publish an image, or use SSH. The deploy job holds Pages and OIDC authority but
does not check out or execute repository code.

## Optional remote MCP deployment

Set the repository variable `ENABLE_REMOTE_MCP=true` only after the protected
`production-mcp` environment is ready. That environment owns:

- `DEPLOY_PUBLIC_MCP_URL` and `DEPLOY_PUBLIC_MCP_READINESS_URL`;
- `DEPLOY_ALLOWED_HOSTS` and `DEPLOY_ALLOWED_ORIGINS`;
- `DEPLOY_SSH_HOST`, `DEPLOY_SSH_PORT`, and `DEPLOY_SSH_USER`; and
- the `DEPLOY_SSH_PRIVATE_KEY` and `DEPLOY_SSH_KNOWN_HOSTS` secrets.

The workflow seals one commit-bound projection. Its exact v2 locator, manifest,
documents, and OpenAPI bytes are used by both the static site and the OCI image.
The image is published by immutable commit tag and registry digest. A candidate
container is switched before Pages, then `/readyz`, `tools/list`, the public
Pages locator, discovery metadata, and `fetch_doc` are read back before the old
container is removed.

The previously deployed Pages artifact and MCP container remain available
during acceptance. On failure, Pages is restored first and MCP second. The
recovery workflow consumes evidence from the exact failed run, so cancellation
does not turn compensation into a rebuild. The first site publication has no
prior artifact and therefore requires an explicit manual `bootstrap` dispatch.

## Build a candidate

Run the root manual `Acceptance candidate` workflow from the exact latest
`main` commit under test. Enter the full 40-character commit SHA and the public
HTTPS origin and deployment base path. The workflow rejects a SHA that differs
from its dispatch ref or current `main`, installs the committed lockfile,
validates `SITE_URL` and `BASE_PATH`, runs the full product suite, and packages
the Web and MCP outputs for 14 days.

The workflow emits:

- `sumi-docs-web-<commit>.zip` and `sumi-docs-mcp-<commit>.zip`;
- SHA-256 checksums and raw cold-start evidence; and
- protected GitHub provenance only when the repository and the root
  `candidate-attestation` environment enforce that boundary.

It does not deploy or modify repository contents. A skipped attestation remains
an open release gate.

## Human acceptance

Download and verify the candidate from the workflow run. Extract it into a
temporary directory and serve that directory through the intended hosting or a
local static server. Check at minimum:

- English and Simplified Chinese navigation and equivalent-page switching;
- light, dark, and automatic theme modes on desktop and mobile;
- canonical URLs and the sitemap use the intended public origin;
- every route in `_mcp/sumi-docs-routes.json` resolves;
- `_mcp/sumi-docs-manifest.json`, raw documents, and OpenAPI JSON are public;
- `_mcp/v2/current.json` verifies the referenced immutable manifest bytes and
  every document digest under its snapshot;
- Sumi-Docs-MCP passes `pnpm run verify:mcp` against the candidate.

Record the accepted commit SHA, workflow run ID, origin, checksum, tester, and
acceptance time. Do not promote a locally rebuilt directory in place of the
accepted candidate.

## Promotion and rollback

For GitHub Pages, roll forward by merging a verified change to `main`; the
production workflow builds that exact commit. For another host, publish the
accepted archive or reproduce the same commit, lockfile, Node version,
`SITE_URL`, and `BASE_PATH`. Verify the deployed URLs before changing DNS or
announcing availability.

Keep the previously accepted archive and its deployment identifier. Do not
mutate a deployed snapshot directory or promote a build whose source-drift gate
failed. Roll back by restoring that immutable artifact or deployment, then
verify the root, localized routes, and machine projection. In dual-target mode,
restore Pages before MCP so the Web discovery record never points at a rejected
service. Content-contract changes that break the current MCP manifest require
their own ADR and coordinated rollback plan.
