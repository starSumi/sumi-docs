---
title: Releasing
description: Build, review, promote, and roll back an immutable site candidate.
---

Source publication and a product release are separate events. A commit may be
public while no npm registry package, deployed site, tag, or GitHub Release exists.

Build a production candidate with an explicit public origin:

```powershell
$env:SITE_URL = "https://docs.example.com"
$env:BASE_PATH = "/"
pnpm --filter @sumi-os/docs-web verify:release
pnpm run verify:integration
```

The manual `Acceptance candidate` workflow accepts an exact 40-character commit
SHA, public origin, and deployment base path from the latest `main`, runs the
release suite without OIDC or
attestation authority, and uploads static archives, SHA-256 checksums, raw
performance evidence, project and runtime licenses, third-party notices, and a
CycloneDX component inventory. It does not deploy the site.

Provenance attestation is a separate protected job. It runs only when the
repository variable `ENABLE_ATTESTATION` is `true` and the
`candidate-attestation` environment is available and protected. Keep the
variable unset when the repository cannot enforce that boundary;
a skipped attestation remains an open release gate, not a successful one.

A person must verify both languages, all theme modes, canonical URLs, the
machine manifest, raw documents, OpenAPI output, every mapped page, and the MCP
cross-project check. Record the accepted commit, workflow run, origin, checksum,
tester, and time before promotion.

Keep the previously accepted immutable artifact. Roll back by restoring that
artifact or deployment, then verify the root, localized routes, and `/_mcp/`
projection again.

The `Production documentation release` workflow deploys the latest verified
`main` commit. With `ENABLE_REMOTE_MCP` absent or `false`, it is a Pages-only
release: no remote environment, SSH secret, container image, or MCP discovery
record is used. It derives the origin and base path from the Pages configuration
and requires `_mcp/server.json` to remain absent.

Setting the repository variable `ENABLE_REMOTE_MCP` to `true` selects the
reviewed dual-target stage. The protected `production-mcp` environment must
provide the public MCP and readiness URLs, Host and Origin policy, SSH target,
private key, and pinned known-hosts material. One commit-bound build then seals
the machine projection once, places the same v2 bytes in the Pages artifact and
the OCI image, and records the corpus revision, image digest, and image ID.

The workflow preserves the exact prior Pages artifact before promotion and
keeps the prior MCP container until public readback succeeds. It switches the
candidate MCP first, deploys Pages, verifies the public locator and either the
absence or exact content of discovery metadata, and then finalizes the remote
switch. A later failure restores Pages before restoring MCP. An interrupted run
uses the same run-bound evidence through the recovery workflow; compensation
never rebuilds the old artifact. The first site publication requires an
explicit manual dispatch with `bootstrap` confirmed because no prior artifact
exists.

This production workflow does not publish the npm package, Windows executable,
Git tag, or GitHub Release.
