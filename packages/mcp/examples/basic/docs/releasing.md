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
produce a release tarball. The acceptance workflow instead packs the corpus
contract and MCP package together, verifies their packed metadata and digests,
installs both tarballs into a clean temporary consumer, and exercises the
installed CLI and package exports. The calibrated ADR-0011 policy compares the
product with a same-host empty official-SDK baseline. A failed performance
command blocks release; p99 and maximum remain diagnostic rather than
single-sample release thresholds.

## Release intent and version pull requests

The already versioned 0.1.0 packages use the separate first-publication bootstrap
below. Do not create a 0.1.1 bump solely for release-tooling changes made before
that baseline exists in the registry.

After the bootstrap, public package behavior changes include a changeset in the
contributing pull request. The contract and MCP packages remain independently
versioned; select both when a contract change also changes MCP behavior or
compatibility. The `Release intent` workflow may run `changeset version` to
maintain a reviewed version pull request. It has no package-publication, tag,
candidate-build, or protected-environment authority.

Merge the version pull request before constructing the acceptance candidate.
The candidate commit, tarball digests, and human acceptance then become the
inputs to promotion. `changeset publish` is not an approved release command.

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
- `npm/npm-candidate.json`;
- `npm/sumi-os-corpus-contract-<version>.tgz` and its SHA-256 sidecar;
- `npm/sumi-os-docs-mcp-<version>.tgz` and its SHA-256 sidecar;
- `cold-start.json`.

Both ZIP archives contain the project license, deterministic third-party notices,
and a CycloneDX component inventory. The MCP archive also contains the Node.js
runtime license. The SEA bundle preserves legal comments and its esbuild
metafile is checked against the production dependency inventory.

The workflow uploads the raw evidence before enforcing the performance gate, so
a failed run can be diagnosed without treating its artifact as accepted.

An optional, separate job attests the ZIP files, npm tarballs, and npm candidate
manifest only when the repository variable `ENABLE_ATTESTATION` is `true` and
the protected `candidate-attestation` environment is available. A skipped
attestation is an open release gate. It is not equivalent to a successful
attestation.

## Human acceptance

Download the artifact from the selected workflow run. Verify every ZIP and npm
tarball against its sibling SHA-256 sidecar, and compare the npm tarballs with
`npm/npm-candidate.json`. Test the archived executable rather than a local
rebuild:

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

Do not create or push a release tag from this procedure. The first npm release
is a separate bootstrap operation: prove control of the `@sumi-os` scope and
two-factor authentication, publish the exact accepted corpus-contract tarball
before the exact accepted MCP tarball, and read back registry integrity and
metadata. Do not rebuild either package during promotion.

After both packages exist on npm, use a protected trusted-publisher workflow
with npm staged publishing and human two-factor approval. It must consume the
exact accepted tarballs, verify their checksums and accepted commit, and avoid a
long-lived registry write token. Binary, tag, and GitHub Release promotion
remain separate gates with their own signing, provenance, and rollback policy.

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
