---
title: Architecture
description: Separate the human presentation plane from the read-only MCP data plane.
---

The website, MCP server, and corpus contract are independently owned packages
in one pnpm workspace. Web and MCP remain separately deployable, while a public
product release binds both artifacts to one commit and one machine-projection
revision. Only schemas, canonicalization, and conformance helpers are shared at
runtime.

The human surface keeps English at the root for stable existing links and
serves a complete Simplified Chinese translation at `/zh-cn/`. Starlight's
language selector switches between equivalent pages, while its theme selector
supports light, dark, and automatic system preference. These presentation
features do not change the MCP manifest or either MCP transport.

Manifest v1 represents Chinese machine documents with explicit
paths such as `zh-cn/getting-started.md`. MCP clients can fetch that exact path,
but v1 does not expose locale metadata, negotiation, or fallback. Manifest v2
is published in parallel with stable document IDs, explicit locale and route,
content digests, navigation data, source provenance, and an immutable revision.

```text
reviewed docs/ + content catalog + OpenAPI
        |
        +-- one publisher build
              |
              +-- rendered pages and Pagefind
              |
              +-- exact v1 + immutable v2 projection bytes
                             /                    \
                    static Web artifact     MCP service image
                                                   |
                                      one read-only DocsMcpServer core
                                      /                           \
                                  stdio                 Streamable HTTP
```

## Ownership

The website owns rendering, navigation, accessibility, browser search, and the
published corpus projection. The corpus-contract package owns pure manifest
validation and canonicalization. Sumi-Docs-MCP owns bounded acquisition,
non-executing document parsing, public tools, input validation, and stdio plus
stateless Streamable HTTP adapters.

One commit-bound publisher build creates the machine projection once. The Web
artifact and service image consume those exact locator, manifest, document, and
OpenAPI bytes; neither target independently recomputes a second projection.

## Address and client model

Stable document identity, source acquisition, browser route, and MCP endpoint
are four separate layers. The reviewed `docs/` files and catalog are the source
of truth. The Web publisher derives rendered pages and immutable corpus
snapshots; MCP derives a read-only query surface. An agent host is the MCP
client, not another content authority.

Stdio loads the corpus on the first content tool call. Streamable HTTP loads one
bounded snapshot before listening, then creates a fresh protocol server for each
request backed by that immutable process-local snapshot. Neither transport
retains client or conversation state.

A local directory snapshot has no wire revision. Revision equality is therefore
enforced only when the MCP service acquires the Web publisher's immutable v2
manifest. Local source mode is checked against the reviewed catalog and tool
contract by integration tests instead of inventing a second revision algorithm.

## Workspace boundary

The workspace makes producer and consumer contract changes atomic without
combining their trust models. Web never imports the MCP parser or transport,
and MCP never executes Astro or trusted MDX. The reviewed content catalog is the
only source for site navigation and projection membership.

## MDX trust boundary

Only reviewed MDX may enter the website build because Astro can execute trusted
component expressions while rendering. Sumi-Docs-MCP treats published MDX as
documentation data and does not evaluate JSX or JavaScript.
