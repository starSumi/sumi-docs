# Remote documentation sources

Remote mode reads a bounded, immutable corpus snapshot from an HTTP host. It is
a source mode, not a transport choice: the same snapshot and four tools can be
served through stdio or stateless Streamable HTTP.

## Manifest

The legacy v1 manifest remains the default for a directory URL and for an
ordinary JSON URL. This preserves existing clients and publishers.

Publish `sumi-docs-manifest.json` beside the source documents:

```json
{
  "version": 1,
  "documents": ["getting-started.md", "api/authentication.mdx"],
  "openapi": "openapi.json"
}
```

`version` and `documents` are required. `openapi` is optional. Unknown fields,
duplicate document entries, absolute paths, traversal segments, and paths
outside the restricted Markdown/MDX or JSON character set are rejected. Every
entry is resolved relative to the manifest URL and redirects are rejected.

Start the server with either the directory URL or the complete manifest URL:

```powershell
node dist/index.js serve https://content.example.com/product/
node dist/index.js serve https://content.example.com/product/sumi-docs-manifest.json
```

For a publisher that emits the Sumi v2 immutable projection, pass the exact
locator URL:

```powershell
node dist/index.js serve https://docs.example.com/_mcp/v2/current.json
```

The loader validates the locator, canonical manifest bytes and revision, then
verifies the byte count and SHA-256 digest of every document and optional
OpenAPI file before accepting the snapshot. Supplying a v2 manifest directly
is not supported; the mutable locator is the only v2 entry point.

After a Web build or artifact extraction, the same v2 projection can be loaded
from its exact local locator:

```powershell
node packages/mcp/dist/index.js serve ./apps/web/dist/_mcp/v2/current.json --base-url http://127.0.0.1:4321/
```

The local loader applies the same manifest and integrity checks plus lexical
and real-path containment. It accepts only `_mcp/v2/current.json`, not a direct
v2 manifest, and uses the manifest-declared OpenAPI document.

HTTPS is required except for loopback HTTP used during local development. URLs
with credentials, query strings, or fragments are rejected. Authentication
headers and cookies are not supported; publish the corpus on a host the MCP
process can read without credentials.

The loader consumes reviewed Markdown or MDX declared by the manifest. It does
not crawl HTML, execute DOM content, or heuristically clean arbitrary Web pages.
An external ingestion system must normalize and review such content before it
enters the publisher contract.

## Resource limits

The loader applies these fixed limits before parsing:

| Resource                   |         Limit |
| -------------------------- | ------------: |
| Manifest                   |       256 KiB |
| Documents                  | 1,000 entries |
| One Markdown/MDX document  |         2 MiB |
| All Markdown/MDX documents |        64 MiB |
| OpenAPI JSON               |         8 MiB |
| Parallel downloads         |             8 |
| One request                |    10 seconds |

Stdio downloads and parses all documents during the first content tool call.
Streamable HTTP performs the same bounded load before listening. The snapshot is
reused until process exit. Restart the process to pick up remote changes. One
failed, oversized, invalid, or redirected response rejects the whole snapshot.

## Machine and human URLs

The positional URL tells Sumi-Docs-MCP where machines read the manifest and raw
files. Without `--base-url`, list, search, and fetch results expose each raw
document URL. Use `--base-url` when people should open a separate rendered site:

```powershell
node dist/index.js serve https://raw.example.com/product/ --base-url https://docs.example.com/product/
```

The resulting `url` values use the rendered site prefix and extensionless
document paths. The server does not check that those pages exist.

The MCP endpoint is a fourth, independent address. A complete deployment may
use:

```text
https://docs.example.com/                       rendered Web pages
https://docs.example.com/_mcp/v2/current.json  machine corpus locator
https://mcp.example.com/mcp                    Streamable HTTP MCP endpoint
```

A reverse proxy may mount the endpoint at `https://docs.example.com/mcp`, but a
static host such as GitHub Pages can publish only the first two addresses.

## Local remote-mode exercise

Terminal 1 hosts the example source and generated manifest:

```powershell
pnpm run preview:docs
```

Terminal 2 starts the MCP server in remote source mode:

```powershell
node dist/index.js serve http://127.0.0.1:4173/ --base-url http://127.0.0.1:4173/
```

Configure an MCP client to launch the second command. The preview is bound to
loopback and is intended only for development.
