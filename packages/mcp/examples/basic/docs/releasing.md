# Release process

Candidate construction, human acceptance, and publication are separate gates.
The MCP package and executable lane automates candidate construction only; it
does not publish an npm registry package, create a tag, or create a GitHub
Release. The repository's production documentation workflow independently
deploys the static site and can explicitly deploy the same sealed corpus through
the Streamable HTTP container. That service deployment is not a package release.

## Local preflight

Use Node.js 25.5.0 or newer from the workspace root:

```powershell
pnpm install --frozen-lockfile --ignore-scripts
pnpm run verify
pnpm run verify:integration
pnpm run smoke:mcp
pnpm run pack:mcp
pnpm run build:sea
pnpm --filter @sumi-os/docs-mcp example:smoke --executable artifacts/bin/sumi-docs-mcp.exe
pnpm run benchmark:cold-start --iterations 100 --executable artifacts/bin/sumi-docs-mcp.exe
```

`pnpm run pack:mcp` is a dry run. It validates the package boundary but does not
produce a release tarball. The calibrated ADR-0011 policy compares the product
with a same-host empty official-SDK baseline. A failed performance command
blocks release; p99 and maximum remain diagnostic rather than single-sample
release thresholds.

## Build an acceptance candidate

Run the repository `Acceptance candidate` workflow from the latest `main` and
provide:

- the exact full 40-character `main` commit SHA;
- the HTTPS site origin used for canonical URLs.

The unprivileged build job checks that the selected SHA remains the latest
`main`, runs the repository and cross-product verification suites on Node.js
25.5.0, builds and smoke-tests the Windows executable, and records 100 randomly
interleaved starts for each calibrated benchmark subject. It uploads one
commit-bound artifact retained for 14 days:

- `sumi-docs-mcp-<commit>.zip`;
- `sumi-docs-mcp-<commit>.zip.sha256`;
- `sumi-docs-web-<commit>.zip`;
- `sumi-docs-web-<commit>.zip.sha256`;
- `cold-start.json`.

Both archives contain the project license, deterministic third-party notices,
and a CycloneDX component inventory. The MCP archive also contains the Node.js
runtime license. The SEA bundle preserves legal comments and its esbuild
metafile is checked against the production dependency inventory.

The workflow uploads the raw evidence before enforcing the performance gate, so
a failed run can be diagnosed without treating its artifact as accepted.

An optional, separate job attests the two ZIP files only when the repository
variable `ENABLE_ATTESTATION` is `true` and the protected
`candidate-attestation` environment is available. A skipped attestation is an
open release gate. It is not equivalent to a successful attestation.

## Human acceptance

Download the artifact from the selected workflow run and verify each SHA-256
sidecar against its sibling ZIP. Test the archived executable rather than a
local rebuild:

```powershell
Get-FileHash .\sumi-docs-mcp-<commit>.zip -Algorithm SHA256
.\sumi-docs-mcp.exe --version
node path\to\scripts\smoke-example.js --executable .\sumi-docs-mcp.exe
```

Connect the candidate to each supported host and exercise `list_docs`,
`search_docs`, `fetch_doc`, and `get_openapi_spec` against representative local
and remote corpora. Verify both documentation locales, all supported theme
modes, canonical page URLs, and the `/_mcp/` projection. Record the commit SHA,
workflow run, checksums, tester, and acceptance time.

The Windows executable is currently unsigned. Authenticode signing or an
explicit release-owner exception remains required before distributing it as a
production binary. SHA-256 sidecars and provenance attestations identify an
artifact; they do not replace operating-system code signing.

## Promotion boundary

Do not create or push a release tag from this procedure. A later promotion
workflow must consume the exact accepted artifact without rebuilding it, verify
its checksums and accepted commit, enforce signing and provenance policy, and
provide a rollback target. Until that workflow exists and passes human review,
the repository remains a pre-release source project.

Version changes must update package metadata, CLI and MCP server identity, and
the changelog in the same commit. Do not create a `v1.0.0` tag while the
application reports another version.

## Documentation service deployment

The `Production documentation release` workflow defaults to Pages-only mode.
Only `ENABLE_REMOTE_MCP=true` activates the protected remote stage. In that
stage, the production image consumes the exact v2 projection already built for
the site; the container does not republish or reinterpret the corpus. The
workflow verifies the image corpus revision, deploys by registry digest, probes
the public Streamable HTTP tools, and keeps the previous container until Pages
and MCP readback both pass. Ordered compensation restores Pages before MCP.

This workflow requires reviewed HTTPS, Host and Origin policy, strict SSH
known-host verification, and an immutable prior artifact. Missing remote
configuration fails the remote stage closed and must never be replaced with
placeholder endpoints or unverified credentials.
