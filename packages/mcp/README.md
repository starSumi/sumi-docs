# Sumi-Docs-MCP

Sumi-Docs-MCP is a read-only MCP server for Markdown, MDX, and OpenAPI
documentation stored in a local directory, a sealed local v2 projection, or a
remote HTTPS manifest. It exposes the same four tools over local stdio or
stateless Streamable HTTP: list documents, search by keyword, fetch one
document, and retrieve an OpenAPI specification.

Source is hosted at [GitHub](https://github.com/starSumi/sumi-docs). No npm
package or GitHub Release has been published for pre-release `0.1.0`; run the
checkout locally or build the documented executable artifact.

## Quick start

Prerequisite: Node.js 25.5.0 or newer.

```powershell
pnpm install --frozen-lockfile
pnpm run example:smoke
```

The smoke test builds the server, starts a real stdio child process, and verifies
all four tools against the checked-in corpus in `examples/basic/`.

Start the same corpus for an MCP client:

```powershell
pnpm run build
node dist/index.js serve examples/basic/docs --openapi examples/basic/openapi.json --base-url https://docs.example.com/product/
```

In a Git worktree with a `docs/` directory, the source is optional. Check the
resolved project and fully load the corpus before connecting a client:

```powershell
node dist/index.js doctor --json
node dist/index.js serve
```

Repositories with another documentation root use a tracked
`sumi-docs.config.json`:

```json
{
  "version": 1,
  "source": "handbook",
  "openapi": "openapi.json",
  "baseUrl": "https://docs.example.com/product/"
}
```

The config is strict JSON. Unknown fields and paths escaping the project root
are rejected. Use `--config <path>` to select a different file explicitly.

The process uses stdout for JSON-RPC. Diagnostics go to stderr. It is normal for
the process to wait silently until a client sends a request.

For client configuration, start from
[`examples/clients/launcher-template.json`](examples/clients/launcher-template.json),
replace the placeholders with absolute paths, and follow the configuration
contract of your MCP client. Remote-source clients can start from
[`examples/clients/remote-launcher-template.json`](examples/clients/remote-launcher-template.json).

For Codex opened at this repository root, the project-level `config.toml` entry
is:

```toml
[mcp_servers.sumiDocs]
command = "node"
args = ["packages/mcp/dist/index.js", "serve"]
cwd = "."
```

With `--base-url`, `list_docs`, `search_docs`, and `fetch_doc` include a public
`url` for each document. MCP clients can show the result to the model and render
the URL as a link for the operator.

If the public site is not deployed yet, start the loopback-only preview in a
separate terminal:

```powershell
pnpm run preview:docs
```

Then use `http://127.0.0.1:4173/` as `--base-url`. The preview serves the
checked-in example by default. To preview another corpus:

```powershell
pnpm run preview:docs -- --docs ./product-docs --port 4173
```

## Commands

| Purpose                         | Command                                            | Result                               |
| ------------------------------- | -------------------------------------------------- | ------------------------------------ |
| Run the example from TypeScript | `pnpm run dev`                                     | stdio server using `examples/basic/` |
| Restart on source changes       | `pnpm run dev:watch`                               | development-only stdio server        |
| Preview clickable local URLs    | `pnpm run preview:docs`                            | loopback-only Markdown preview       |
| Validate the example end to end | `pnpm run example:smoke`                           | build plus five MCP requests         |
| Build the Node.js distribution  | `pnpm run build`                                   | `dist/`                              |
| Run the built example           | `pnpm start`                                       | stdio server from `dist/`            |
| Build a standalone executable   | `pnpm run build:sea`                               | `artifacts/bin/sumi-docs-mcp.exe`    |
| Run quality checks              | `pnpm run lint`, `pnpm run typecheck`, `pnpm test` | static checks and tests              |
| Diagnose a project corpus       | `node dist/index.js doctor --json`                 | read-only resolution and load report |

To serve another corpus, invoke the CLI directly:

```powershell
node dist/index.js serve ./product-docs --openapi ./product-docs/openapi.json --base-url https://docs.example.com/
```

Relative paths are resolved from the process working directory. Absolute paths
are accepted when a host cannot set a stable working directory, but they are not
required and should not be copied into shared diagnostics.

From the monorepo root, a completed Web build can be consumed through its exact
local v2 locator:

```powershell
node packages/mcp/dist/index.js serve ./apps/web/dist/_mcp/v2/current.json --base-url http://127.0.0.1:4321/
```

This verifies the sealed manifest, corpus revision, byte counts, SHA-256
digests, and local path containment before loading the snapshot. OpenAPI is
declared by the manifest, so `--openapi` is rejected for this form.

To serve a remote corpus, point the same command at its manifest or containing
directory:

```powershell
node dist/index.js serve https://content.example.com/product/
```

The remote host must expose `sumi-docs-manifest.json`. The same four MCP tools
operate on the downloaded read-only snapshot. Manifest-backed OpenAPI is
declared in the manifest, so `--openapi` is directory-only. See
[Remote documentation sources](docs/remote-sources.md) for the manifest format
and network limits.

The source URL above changes where the server reads documents; it does not make
the MCP endpoint remote. To expose the same read-only core on loopback:

```powershell
node dist/index.js serve https://content.example.com/product/_mcp/v2/current.json --base-url https://docs.example.com/product/ --transport streamable-http --http-host 127.0.0.1 --http-port 3000
```

Connect an MCP client to `http://127.0.0.1:3000/mcp`. A public deployment needs
an explicit non-loopback acknowledgement, Host and Origin allowlists, and a TLS
reverse proxy. See [Configuration](docs/configuration.md).

From the workspace root, the same Node distribution can run in the maintained
container:

```powershell
docker compose up --build
```

The default read-only mount serves root `docs/`. The service exposes liveness at
`/healthz` and corpus readiness at `/readyz`. The Postman collection under
`examples/postman/` provides manual deployment probes; it is not a substitute
for an MCP client.

## Tool surface

| Tool               | Input                       | Behavior                                       |
| ------------------ | --------------------------- | ---------------------------------------------- |
| `list_docs`        | `{}`                        | lists files and optional public URLs           |
| `search_docs`      | `{ "query": "token" }`      | returns ranked matches and optional URLs       |
| `fetch_doc`        | `{ "path": "guide.md" }`    | returns parsed content and an optional URL     |
| `get_openapi_spec` | `{ "endpoint": "/health" }` | returns all or one endpoint of the loaded spec |

See [docs/tool-reference.md](docs/tool-reference.md) for exact schemas, result
fields, error behavior, protocol metadata, and snapshot lifecycle.

The server has no client or session state. Stdio builds one process-local,
read-only corpus snapshot from the selected directory or manifest on the first
content tool call. Streamable HTTP loads the same snapshot before accepting
traffic so `/readyz` can identify it. Source changes require a process restart.

## Configuration model

Runtime configuration comes from CLI arguments, not `.env` files:

```text
sumi-docs-mcp serve [docs-source] [--config <path>] [--openapi <path>] [--base-url <url>] [--transport <stdio|streamable-http>] [HTTP options] [--verbose]
sumi-docs-mcp doctor [docs-source] [--config <path>] [--json] [--show-paths]
```

`[docs-source]` is a local directory, an exact local `_mcp/v2/current.json`
locator, or a remote HTTPS manifest/base URL. When omitted, the server uses the
nearest config inside the current Git worktree, then `<worktree-root>/docs`.
Without a Git boundary, it inspects only the current directory and defaults to
`<cwd>/docs`; it never climbs into a parent `.sumi` workspace container.
`--base-url` controls clickable human-facing page URLs; it is not the remote
content source.

Doctor reports project-relative paths or explicit external placeholders by
default. `--show-paths` is an opt-in for local diagnosis and is rejected by
`serve`; credentials and stack traces stay redacted in both modes.

The benchmark has its own command options; see
[`docs/development.md`](docs/development.md). Local operation requires no runtime
secrets. The optional production deployment keeps SSH material in its protected
environment. The container maps the documented `SUMI_DOCS_*` deployment
variables to the same validated CLI contract.

## Documentation

- [Getting started](docs/getting-started.md)
- [Configuration and environments](docs/configuration.md)
- [Remote documentation sources](docs/remote-sources.md)
- [Contribution workflow](docs/contributing.md)
- [Skills, MCP, and orchestration](docs/skills-and-orchestration.md)
- [Development and validation](docs/development.md)
- [Git workflow and commit policy](docs/git-workflow.md)
- [Release candidates and human acceptance](docs/releasing.md)
- [Architecture and constraints](docs/architecture.md)
- [Architecture decisions](docs/architecture.md#architecture-decisions)
- [Troubleshooting](docs/troubleshooting.md)
- [Contributing](CONTRIBUTING.md)
- [Historical project reports](docs/history/README.md)

## Current limitations

- The SEA executable supports stdio; Streamable HTTP currently uses the Node.js
  distribution.
- Search is lexical keyword matching, not embedding or semantic search.
- The corpus is loaded into memory on first use and is not refreshed in place.
- Remote sources require an explicit manifest; the server does not crawl sites.
- The standalone executable is a local build artifact, not a published release.
- Cold-start acceptance uses the calibrated same-host SDK baseline in ADR-0011;
  less than 100 ms remains a future native-runtime stretch target.

## License

MIT. See [LICENSE](LICENSE).
