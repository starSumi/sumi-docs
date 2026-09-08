---
name: sumi-docs-use
description: Set up and operate Sumi Docs from this repository. Use when installing the workspace, selecting a local or remote documentation source, running doctor or either MCP transport, starting the Web site, or connecting Codex, Claude Code, or VS Code.
---

# Use Sumi Docs

Work from the repository root and read `README.md` plus the relevant page under
`docs/` before running commands. Use Node.js 25.5.0 or newer and the pinned pnpm
version; do not substitute npm.

## Select the workflow

- First checkout: run `pnpm install --frozen-lockfile`, `pnpm run build`, then
  `node packages/mcp/dist/index.js doctor --json`.
- Default corpus: run `node packages/mcp/dist/index.js serve`; repository
  discovery selects the reviewed root `docs/` corpus.
- Another local corpus: pass its root-relative directory to `serve` and add
  `--openapi <relative-json-path>` only when needed.
- Published corpus: pass its HTTPS `_mcp/` manifest URL and the human site URL
  through `--base-url`.
- Remote MCP service: use `--transport streamable-http`; keep the default
  loopback bind for development and apply the documented Host, Origin, TLS, and
  public-network gates before deployment.
- Web development: run `pnpm --filter @sumi-labs/docs-web dev` and use the URL
  printed by Astro.
- Agent host setup: read `docs/agent-hosts.md`, build first, then use the
  checked-in project adapter for the active host.

Choose stdio for a local child process or Streamable HTTP for a remote MCP
endpoint. Do not confuse either transport with the HTTPS corpus locator or the
human page URL. Restart the server after source or configuration changes because
a process keeps one read-only corpus snapshot.

## Diagnose before changing configuration

Run `doctor --json` and inspect stderr separately from stdout. Prefer
repository-relative arguments and host project-root variables; do not commit
machine-specific absolute paths. Use `--show-paths` only for local diagnosis
and do not paste its output into public reports.

Confirm the active source with `list_docs`, then use `search_docs` and
`fetch_doc` with paths returned by the server. Do not claim semantic search,
live reload, source mutation, arbitrary Web crawling, or private-corpus
authorization.

For product usage, architecture, operations, and stable decision questions,
query the active MCP projection before searching documentation files directly.
For implementation changes, regressions, or current behavior, inspect source
and tests because a process-local documentation snapshot can be stale. MCP
constrains only its own read-only tool surface; host sandboxing and filesystem
authorization remain the agent host's responsibility.

Report the exact commands run, the selected corpus mode, and failed or skipped
checks. Do not modify source or host configuration unless the user asked for a
change.
