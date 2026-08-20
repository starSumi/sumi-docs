# Development and validation

## Setup

Use Node.js 25.5.0 and pnpm 10.26.0. `.node-version`, `package.json`, and the
GitHub workflows declare the same toolchain.

```powershell
pnpm install --frozen-lockfile
pnpm run dev
```

`pnpm run dev` serves the checked-in example corpus from TypeScript. Use
`pnpm run dev:watch` while changing source files. Both commands reserve stdout
for MCP JSON-RPC traffic.

`pnpm run preview:docs` is a separate loopback HTTP process for opening the
example corpus and exercising the remote-source loader. It does not carry MCP
traffic and is not a second MCP transport. Override its corpus, OpenAPI input,
and port with `--docs`, `--openapi`, and `--port`:

```powershell
pnpm run preview:docs -- --docs ./product-docs --port 4173
```

While it is running, `node dist/index.js serve http://127.0.0.1:4173/` loads its
generated manifest as a remote source.

Run a compiled-process round trip against that remote source with:

```powershell
pnpm run example:smoke -- --docs-source http://127.0.0.1:4173/
```

## Required checks

Run these before handing off a change:

```powershell
pnpm run lint
pnpm run typecheck
pnpm test
pnpm run build
pnpm run example:smoke
pnpm pack --dry-run
```

Changes to SEA configuration or packaging also require Node.js 25.5 or newer:

```powershell
pnpm run build:sea
.\artifacts\bin\sumi-docs-mcp.exe --version
pnpm run example:smoke --executable artifacts/bin/sumi-docs-mcp.exe
pnpm run benchmark:cold-start --executable artifacts/bin/sumi-docs-mcp.exe
```

The benchmark measures a new process through its first `tools/list` response.
It randomizes starts of a raw SEA measurement baseline, an empty server using
the public MCP SDK, and the product SEA. Release evidence uses 100 iterations
per subject and records every observation plus median, p95, p99, maximum, errors,
timeouts, executable digests, and the product delta from the SDK baseline.

ADR-0011 defines the blocking thresholds. P99 and maximum are diagnostic; the
former 100 ms maximum is retained only as a native-runtime stretch target.
Benchmark probes are measurement code, not alternative product transports.

## Test layout

- `tests/unit/` covers parsers, VFS behavior, CLI parsing, path validation, and
  SEA configuration.
- `tests/integration/mcp.test.ts` covers protocol behavior in memory.
- `tests/integration/remote-source.test.ts` covers bounded remote acquisition
  and all four MCP tools over a remote snapshot.
- `tests/integration/example-corpus.test.ts` verifies the checked-in example.
- `scripts/smoke-example.js` verifies the compiled CLI over a real stdio child
  process.

Protocol changes should begin with a failing test. Security fixes require a
regression test that demonstrates the rejected input or incorrect boundary.

## Packaging

`pnpm pack` runs `prepack`, which rebuilds `dist/`. The package allowlist contains
the compiled distribution, active operator documentation, examples, project
policies, README, and license. Local state, historical reports, tests, and SEA
artifacts are excluded.

The npm registry package is not currently published. Do not document `npx` or global
installation as supported until registry publication is verified.

The repository candidate and human-acceptance workflow is documented in
[releasing.md](releasing.md). It validates the package boundary, builds and
smoke-tests the Windows executable, records raw cold-start evidence, packages
commit-bound Web and MCP archives, and installs the exact npm candidate
tarballs in a clean temporary consumer. Registry publication, code signing,
tags, and GitHub Releases are not implemented by the current workflow. SBOMs
are generated for the candidate archives but do not publish a registry package.
