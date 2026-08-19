---
title: Remote sources
description: Publish a bounded manifest for read-only remote documentation.
---

Remote source mode downloads an immutable documentation snapshot from a strict
manifest. It does not crawl a website. Source mode is independent of transport:
the same corpus can be served through stdio or Streamable HTTP.

## Manifest

This site generates `_mcp/sumi-docs-manifest.json` during every production build:

```json
{
  "version": 1,
  "documents": ["getting-started.md", "configuration.md"],
  "openapi": "openapi.json"
}
```

Document paths are restricted relative Markdown or MDX paths. OpenAPI is an
optional restricted relative JSON path. Unknown fields, duplicates, redirects,
oversized responses, and cross-origin paths are rejected by Sumi-Docs-MCP.

The same build also emits `_mcp/v2/current.json` and immutable, digest-addressed
snapshots. Prefer the exact v2 locator when integrity verification is required:

```powershell
node packages/mcp/dist/index.js serve http://127.0.0.1:4321/_mcp/v2/current.json --base-url http://127.0.0.1:4321/
```

The MCP loader verifies the canonical manifest, revision, byte counts, and
SHA-256 digests. Directory and v1 manifest URLs remain supported for backward
compatibility.

The same v2 projection can be consumed from its exact local locator after a Web
build or artifact extraction:

```powershell
node packages/mcp/dist/index.js serve ./apps/web/dist/_mcp/v2/current.json --base-url http://127.0.0.1:4321/
```

Local and remote v2 sources share the manifest and integrity contract. The
local path is additionally checked for lexical and real-path containment. The
locator is the only supported v2 entry point, and its manifest supplies
OpenAPI.

The projection contains reviewed Markdown or MDX. General HTML crawling, DOM
execution, and heuristic AST cleaning are deliberately outside the MCP core. A
separate ingestion system must normalize, record provenance, and submit reviewed
content before the publisher accepts it.

## Human routes

The adjacent `_mcp/sumi-docs-routes.json` maps each corpus path to a rendered
page. It is a deployment verification artifact, not part of the MCP manifest
protocol. The build fails when a mapped page or raw source is missing.

## Source, page, and endpoint

These addresses have separate owners:

```text
https://docs.example.com/                       rendered human pages
https://docs.example.com/_mcp/v2/current.json  immutable corpus locator
https://mcp.example.com/mcp                    Streamable HTTP MCP endpoint
```

GitHub Pages can host the first two static surfaces. The MCP endpoint needs a
running Node service or another conforming runtime, normally behind a TLS reverse
proxy. It may be mounted on the same domain, but it is not the `_mcp` locator.

## Local exercise

Build and preview this site, then use the local machine projection:

```powershell
pnpm run build
pnpm run preview
node dist/index.js serve http://127.0.0.1:4321/_mcp/ --base-url http://127.0.0.1:4321/
```

To exercise remote source and remote transport together:

```powershell
node packages/mcp/dist/index.js serve http://127.0.0.1:4321/_mcp/v2/current.json --base-url http://127.0.0.1:4321/ --transport streamable-http
```

Connect the client to `http://127.0.0.1:3000/mcp`.

Loopback HTTP is accepted for development. Production remote sources require
HTTPS and do not support credentials, cookies, redirects, query strings, or
fragments.
