# Sumi Docs

English | [简体中文](README.zh-CN.md)

Sumi Docs publishes one reviewed documentation corpus for two consumers:

- people browse an Astro and Starlight website;
- agents query the same corpus through a read-only MCP server.

The reviewed root `docs/` tree and content catalog are the semantic source of
truth. The Web site and MCP server are independently addressable projections;
an agent host is the MCP client.

The [source repository](https://github.com/starSumi/sumi-docs) and
[documentation site](https://starsumi.github.io/sumi-docs/) are public and
under active development. No npm package, tagged GitHub Release, or supported
binary has been published.

## Prerequisites

- Node.js 25.5.0 or newer
- pnpm 10.26.0 through Corepack or the version declared in `packageManager`
- a trusted checkout when loading repository-provided agent host configuration

## First Run

```powershell
pnpm install --frozen-lockfile
pnpm run build
node packages/mcp/dist/index.js doctor --json
```

Doctor reports project-relative paths or external-source placeholders by
default. Add `--show-paths` only for local diagnosis; do not attach that output
to public issues or build artifacts.

The checked-in `sumi-docs.config.json` selects root `docs/` and the example
OpenAPI document. Start the human site with:

```powershell
pnpm --filter @sumi-os/docs-web dev
```

Open `http://127.0.0.1:4321`. Codex, Claude Code, and VS Code project adapters
are described in [Agent host integration](docs/agent-hosts.md). They expose the
four MCP tools without requiring the optional maintainer Skill.

To expose the same corpus on a loopback Streamable HTTP endpoint:

```powershell
node packages/mcp/dist/index.js serve --transport streamable-http
```

Connect a compatible MCP client to `http://127.0.0.1:3000/mcp`. The static Web
site and `_mcp` corpus projection do not themselves run that endpoint.

For a hardened local container using the same reviewed root corpus:

```powershell
docker compose up --build
```

The service exposes MCP at `http://localhost:3000/mcp`, liveness at `/healthz`,
and corpus readiness at `/readyz`. Docker is optional for source development;
public deployment still requires HTTPS termination and explicit Host policy.

The repository also provides three optional project workflows under
`.agents/skills/`: `$sumi-docs-use` for setup and operation, `$sumi-docs-pr`
for proposal and pull-request preparation, and `$sumi-docs-audit` for
read-only, evidence-bound repository and release audits. They route work but do
not replace MCP or publish remote changes.

## Workspace

```text
apps/web/                   Astro/Starlight site and corpus publisher
packages/mcp/               stdio and Streamable HTTP MCP server and CLI
packages/corpus-contract/   manifest schemas and conformance fixtures
docs/                       product handbook and default corpus
.agents/skills/             optional project usage and contribution workflows
```

| Mode                     | Command                                                             | Purpose                                        |
| ------------------------ | ------------------------------------------------------------------- | ---------------------------------------------- |
| Web development          | `pnpm --filter @sumi-os/docs-web dev`                               | Local browser site with reload                 |
| MCP development          | `pnpm --filter @sumi-os/docs-mcp dev`                               | TypeScript server against its example corpus   |
| Production build         | `pnpm run build`                                                    | Build contract, MCP, and static site           |
| Compiled MCP             | `node packages/mcp/dist/index.js serve`                             | Serve the discovered project corpus over stdio |
| Remote MCP endpoint      | `node packages/mcp/dist/index.js serve --transport streamable-http` | Serve the same corpus on loopback HTTP         |
| Validation               | `pnpm run verify`                                                   | Package quality, tests, and dependency gates   |
| Cross-product validation | `pnpm run verify:integration`                                       | Exercise the generated Web corpus through MCP  |

Local operation and the default Pages-only publication require no runtime
secrets. `SITE_URL` is required only for a release-site candidate. Enabling the
optional production Streamable HTTP service requires reviewed endpoint
variables and SSH material in the protected `production-mcp` environment. The
container accepts documented `SUMI_DOCS_*` deployment variables; generated
output, local state, logs, caches, and `.env` files remain ignored.

Package-specific instructions remain in each workspace. Active architecture
decisions live in the owning workspace's `docs/decisions/` directory; the root
handbook presents their user-facing consequences without duplicating the
decision records.

Source and site visibility do not publish a tag, package, or binary. Those
artifacts remain subject to the documented release gates.
