# Repository Agent Instructions

These instructions apply to the Sumi Docs Web repository.

## Project contract

- Classification: static Astro and Starlight documentation site
- Runtime: Node.js 25.5.0 or newer
- Package manager: pnpm workspace with the committed root `pnpm-lock.yaml`
- Output: static files under `dist/`
- Machine projection: `dist/_mcp/`
- Human locales: English at `/`, Simplified Chinese at `/zh-cn/`
- Theme modes: light, dark, and automatic system preference

The site is the `@sumi-labs/docs-web` workspace package. It shares only the pure
`@sumi-labs/corpus-contract` package with the MCP consumer; it must not import MCP
runtime source files or parsers.

## Content and trust

Only trusted, reviewed Markdown and MDX may be compiled by Astro. Never execute
remote or user-supplied MDX. Keep credentials, private URLs, and machine-local
paths out of published content and frontmatter.

Every machine-readable document must have an explicit entry in the reviewed
catalog at `src/content-catalog.ts`. That catalog is the only source for the
Starlight sidebar, source-to-route map, strict manifest v1, and manifest v2.
The public MCP manifest v1 remains this exact shape at its existing URL:

```json
{
  "version": 1,
  "documents": ["getting-started.md"],
  "openapi": "openapi.json"
}
```

Do not add route objects or other fields to v1. Human route mappings remain in
the generated `sumi-docs-routes.json` verification artifact. The parallel v2
projection lives under `dist/_mcp/v2/` and uses immutable revision directories;
schema validation and canonicalization belong to `@sumi-labs/corpus-contract`.

## Ownership

- `../../docs/`: reviewed human and machine documentation source
- `src/assets/`: project visual assets
- `src/styles/`: restrained Starlight customization
- `integrations/`: bounded build-time publishing behavior
- `docs/decisions/`: durable Web-specific architecture decisions
- `scripts/`: deterministic validation and development helpers
- `tests/`: publishing contract tests
- `public/`: reviewed static inputs, including OpenAPI

Do not add Sumi-Docs-MCP parser, VFS, transport, or client code to this project.
A browser Agent requires a separate BFF architecture decision; it must not embed
model credentials or try to connect directly to stdio.

## Required validation

```powershell
pnpm test
pnpm run build
```

For a public deployment candidate, also run `pnpm run verify:release` with an
explicit public HTTPS `SITE_URL`. A candidate workflow may package verified
`dist/` output, but it must not deploy without the repository's human acceptance
and environment controls.

When the MCP workspace package is built, also run:

```powershell
pnpm run verify:mcp
```

Visually verify desktop and mobile output before handoff. Generated `dist/`,
`.astro/`, `node_modules/`, coverage, logs, and temporary image work remain
ignored.

## Documentation style

Use direct, factual language. Avoid emoji status markers, fictional approvals,
agent signatures, placeholder domains presented as live, and unmeasured claims.
