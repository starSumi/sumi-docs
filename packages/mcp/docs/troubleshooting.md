# Troubleshooting

## The server appears to hang

A stdio MCP server waits for JSON-RPC input and does not present an interactive
prompt. Run `pnpm run example:smoke` to verify the process, or attach it through an
MCP client. Ordinary diagnostics appear on stderr.

## The CLI prints Usage and exits

Use `serve` with an explicit source, tracked config, or discoverable project
`docs/` directory:

```powershell
node dist/index.js serve ./docs
node dist/index.js doctor --json
```

If no source is supplied, discovery stops at the nearest Git worktree root. In
a non-Git directory it never searches above the current directory.

## A client cannot find the corpus

Run `doctor --json` with the same command arguments and working directory as the
client. Use an absolute source or `--config` path when the client working
directory is not controlled.

Doctor redacts external paths by default. Add `--show-paths` only for local
interactive diagnosis, and do not paste that output into a public issue. Stack
traces and URL credentials remain redacted.

## Project config is rejected

`sumi-docs.config.json` is strict JSON. Remove comments and unknown fields,
keep a supplied `version` at `1`, and keep configured local paths inside the
project root. CLI values override the matching config values.

## OpenAPI is unavailable

Confirm that `--openapi` points to readable JSON with `openapi`, `info`, and
`paths` fields. When the option is omitted, `get_openapi_spec` returns a
`PATH_NOT_FOUND` tool error.

In remote mode, `--openapi` is invalid. Add the relative JSON path to the
manifest's `openapi` field and restart the process.

## A remote source does not load

Confirm that the host serves valid `sumi-docs-manifest.json` and every declared
path without redirects. Production sources require HTTPS; loopback HTTP is
allowed for local testing. The server does not send cookies or authentication
headers and does not crawl an HTML documentation site.

## Source changes do not appear

The corpus is a process-local snapshot. Restart the MCP server after editing a
document or OpenAPI file.

## A local document URL does not open

The MCP process does not host HTTP pages. Start `pnpm run preview:docs` in a
separate terminal and keep it running. The preview port must match the port in
`--base-url`, and both processes must point to the same documentation root.
Open `/` or an extensionless document URL for the styled HTML view. Use an
explicit `.md` or `.mdx` URL when a tool needs the original source text. The
preview is loopback-only and treats HTML, JSX, and MDX as escaped content.

## SEA build fails

Check `node --version`. Native `--build-sea` requires Node.js 25.5 or newer for
this project. A normal `pnpm run build` does not create the standalone executable.
