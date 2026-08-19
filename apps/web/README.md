# Sumi Docs Web

Human-facing documentation for Sumi-Docs-MCP, built with Astro and Starlight as
the `@sumi-os/docs-web` workspace package.
The site also publishes the strict raw-document manifest consumed by the MCP
server's remote source mode. The checked-in product, operations, development,
release, contribution, and integration handbook is the showcase corpus: an MCP
client can answer project questions from the same reviewed source people
browse.

English is served from the root path. Simplified Chinese is available under
`/zh-cn/`, with Starlight's language selector connecting equivalent pages.
The built-in theme selector supports light, dark, and automatic system modes;
code blocks follow the selected site theme.

## Development

Requires Node.js 25.5.0 or newer and pnpm 10.26.0. Install dependencies once from the
workspace root:

```powershell
pnpm install --frozen-lockfile
pnpm --filter @sumi-os/docs-web dev
```

The local site starts at `http://localhost:4321/` by default.

Development does not require environment variables. A production deployment
sets `SITE_URL` to its public HTTPS origin and `BASE_PATH` to its root-relative
deployment prefix so canonical links and the sitemap do not use development
defaults. `PUBLIC_MCP_URL` and `PUBLIC_MCP_READINESS_URL` are an optional pair.
When set, they name the deployed HTTPS Streamable HTTP endpoint and its explicit
readiness endpoint. The build publishes deterministic MCP discovery metadata at
`<BASE_PATH>_mcp/server.json`; for GitHub Project Pages this is
`/sumi-docs/_mcp/server.json`. When the pair is absent, that file is absent
and the remote probe is skipped. Start from `.env.example`; do not commit
secrets or machine-specific `.env` files.

## Verification

```powershell
pnpm test
pnpm run build
pnpm run verify:push
```

`pnpm run build` type-checks the site, builds static output, and verifies the
published manifest, raw corpus, OpenAPI document, route map, and rendered URLs.

The generated machine entry point is:

```text
dist/_mcp/sumi-docs-manifest.json
```

Existing clients continue to use that strict manifest v1. Revision-aware
clients start from:

```text
dist/_mcp/v2/current.json
```

The locator verifies an immutable manifest and raw document snapshot. Human
pages and raw projection bytes come from the workspace root `docs/`. Both
formats are governed by `src/content-catalog.ts`; `astro.config.mjs` does not
maintain a second source-to-route list.

Point Sumi-Docs-MCP at the deployed `_mcp/` URL and use the site root as
`--base-url`.

For a local product demonstration, build the Web and MCP workspace packages,
serve `dist/`, then launch Sumi-Docs-MCP with the local `/_mcp/` URL as its
source and the site root as `--base-url`. The command below automates that full
round trip.

When the MCP workspace package is built, exercise the complete boundary locally:

```powershell
pnpm run verify:mcp
```

## Deployment candidates

Production candidates require an explicit public HTTPS origin:

```powershell
$env:SITE_URL = "https://docs.example.com"
$env:BASE_PATH = "/"
pnpm run verify:release
```

When the endpoint pair is configured, verify the already built projection
against the deployed service before publishing it:

```powershell
node apps/web/scripts/verify-remote-mcp.mjs
```

The probe uses `PUBLIC_MCP_READINESS_URL` directly. It does not derive an
operational URL from `PUBLIC_MCP_URL`. The response must identify the same MCP
version and protocol, and its corpus revision must equal
`dist/_mcp/v2/current.json`. In GitHub Actions, `GITHUB_SHA` also binds the
service build revision to the Pages commit.

GitHub Project Pages uses an origin and subpath instead:

```powershell
$env:SITE_URL = "https://starsumi.github.io"
$env:BASE_PATH = "/sumi-docs/"
pnpm run verify:release
```

The root `Acceptance candidate` workflow builds immutable Web and MCP archives
for the latest selected `main` commit and records their checksums. Protected
GitHub provenance is conditional on repository plan support and explicit root
workflow configuration. It does not deploy the site. See
[docs/deployment.md](docs/deployment.md) for the human acceptance and rollback
procedure.

The root `Production documentation release` workflow deploys the latest
verified `main` commit. It defaults to Pages-only publication with remote MCP
discovery absent. When the reviewed `ENABLE_REMOTE_MCP` gate is true, the same
commit-bound machine projection is also embedded in the production MCP image
and the workflow performs the protected remote switch, public readback, and
ordered compensation. This does not publish the npm package, executable, tag,
or GitHub Release.

## Architecture

Web and MCP share the pure `@sumi-os/corpus-contract` workspace package, while
retaining separate parser and trust boundaries. The accepted decisions live in
`packages/mcp/docs/decisions/`: ADR-0003 defines explicit locale semantics,
ADR-0006 defines immutable v2 publication, and ADR-0008 defines the pnpm
workspace topology.

Web-specific decisions live in `apps/web/docs/decisions/`. ADR-0001 records the
bounded Starlight component override used for primary header navigation.

## Project policy

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md),
[CHANGELOG.md](CHANGELOG.md), [docs/README.md](docs/README.md), and
[LICENSE](LICENSE).

The published handbook includes the complete pull request lifecycle and the
ownership boundary between client Skills, Sumi-Docs-MCP, agent orchestration,
and this site. The repository does not ship a client-specific runtime Skill.
