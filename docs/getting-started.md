---
title: Getting started
description: Run Sumi-Docs-MCP against this repository, another local corpus, or a published corpus.
---

Sumi-Docs-MCP exposes documentation through four read-only tools: list, search,
fetch, and OpenAPI lookup. MCP clients connect through local stdio or stateless
Streamable HTTP.

## This repository

Install and build from the workspace root:

```powershell
pnpm install --frozen-lockfile
pnpm run build
node packages/mcp/dist/index.js doctor --json
node packages/mcp/dist/index.js serve
```

The tracked project config selects root `docs/`. Those reviewed files and the
content catalog are the source of truth, so this site is also the real
self-hosted product example. The MCP server is a read-only projection and the
connected agent host is the MCP client. See
[Agent host integration](../agent-hosts/) for the checked-in Codex, Claude Code,
and VS Code adapters.

To serve another local Markdown or MDX corpus, pass its directory explicitly:

```powershell
node packages/mcp/dist/index.js serve ./product-docs --openapi ./product-docs/openapi.json
```

After building the Web workspace, use its exact local v2 locator to exercise
the same immutable projection that a production image consumes:

```powershell
node packages/mcp/dist/index.js serve ./apps/web/dist/_mcp/v2/current.json --base-url http://127.0.0.1:4321/
```

The v2 manifest declares OpenAPI and integrity metadata, so this form does not
accept `--openapi`.

Opening the executable directly only prints help and exits; that is expected
CLI behavior.

## Published corpus

After a site is deployed, use its machine projection as the source and the site
root for links that people can open:

```powershell
node packages/mcp/dist/index.js serve https://docs.example.com/_mcp/ --base-url https://docs.example.com/
```

The command still uses stdio for MCP traffic; HTTPS selects only the bounded,
read-only corpus snapshot. It does not crawl the site.

To expose the same core to a remote MCP client, start the Node.js distribution
with Streamable HTTP:

```powershell
node packages/mcp/dist/index.js serve https://docs.example.com/_mcp/v2/current.json --base-url https://docs.example.com/ --transport streamable-http
```

The loopback endpoint is `http://127.0.0.1:3000/mcp`. Public deployment requires
an explicit network bind policy and a TLS reverse proxy.

## Container deployment

The repository includes a multi-stage, non-root container for the same Node.js
server:

```powershell
docker compose up --build
```

The default read-only bind mount is root `docs/`. MCP is available at
`http://localhost:3000/mcp`; `/healthz` checks the process without loading the
corpus, while `/readyz` identifies the loaded snapshot. Set
`SUMI_DOCS_SOURCE_DIR` to mount another local corpus. The Postman collection in
`packages/mcp/examples/postman/` is a manual deployment probe, not an MCP client
configuration.

## Client configuration

Configure an MCP client to launch `node` or the standalone executable with the
same `serve` arguments. Prefer the host's project-root variable or the npm
workspace launcher over a machine-specific absolute path.

For a remote host, configure the Streamable HTTP endpoint URL instead of a local
process command. No Skill is required: initialization instructions and
`tools/list` describe the query surface.
