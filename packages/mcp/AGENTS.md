# Repository Agent Instructions

These instructions apply to the entire Sumi-Docs-MCP repository. More specific
instructions may be added in a nested `AGENTS.md` or `AGENTS.override.md`.

## Project contract

- Classification: headless, read-only documentation MCP server with local and
  remote corpus sources
- Runtime: Node.js 25.5.0 or newer
- Protocol target: MCP 2026-07-28
- Implemented transports: stdio and stateless Streamable HTTP for the Node.js
  distribution
- Architecture: parser, read-only document index, MCP adapter

Current behavior is documented in `README.md` and `docs/`. Files under
`docs/history/` are superseded snapshots and must not be treated as authority.

## Architecture invariants

### No client or session state

Requests must not depend on client identity, conversation history, sticky
routing, or prior mutations. Stdio may retain one read-only documentation index
and OpenAPI object after the first content tool call. Streamable HTTP loads that
same kind of immutable snapshot before it begins listening. This process-local
cache is corpus state, not user or session state.

### Read-only source access

The public tool surface may list, search, and fetch documentation. It must not
write, delete, rename, or modify source files. Future features must preserve this
boundary unless the project contract is deliberately revised.

Remote sources must use the strict manifest loader in `src/vfs/`, remain
read-only, and apply the documented protocol, origin, redirect, time, count, and
size limits. Do not add general site crawling or authenticated fetch behavior
without architecture and security review.

A local manifest-backed source must be the exact `_mcp/v2/current.json`
locator. Resolve and verify every referenced path lexically and through its real
path, enforce the shared count and byte limits, validate every digest, and
commit the vault only after the complete snapshot succeeds. Do not accept an
arbitrary JSON file or direct v2 manifest as a local entry point.

### Headless runtime

Do not add React, Vue, Svelte, Angular, DOM libraries, browser APIs, or UI-specific
code. Optional network transports must use Node.js primitives or the official MCP
SDK; do not add an HTTP framework without architecture review.

Streamable HTTP remains stateless. Construct a fresh protocol server for each
request while sharing only the process-local, preloaded read-only corpus snapshot.
Loopback is the default bind. Non-loopback listeners require an explicit
operator acknowledgement, Host allowlisting, Origin validation, bounded request
bodies, and an external TLS and rate-control boundary. Do not add private-corpus
authentication without an accepted authorization design.

### Protocol compatibility

MCP requests and responses must follow the installed official SDK contracts for
the 2026-07-28 protocol surface. Tool results include `_meta` with protocol
version, capabilities, and timestamp. Do not reintroduce a mandatory legacy
initialize handshake for clients using the 2026 protocol.

## Module ownership

| Path          | Responsibility                                        | Must not contain                               |
| ------------- | ----------------------------------------------------- | ---------------------------------------------- |
| `src/parser/` | Markdown/MDX parsing and OpenAPI loading              | HTML rendering, JSX evaluation, transport code |
| `src/vfs/`    | local/remote corpus acquisition and read-only queries | JSON-RPC handlers, source writes               |
| `src/mcp/`    | tool schemas, JSON-RPC adaptation, error mapping      | direct file I/O, parser implementation         |
| `src/types/`  | shared TypeScript interfaces                          | runtime behavior                               |
| `src/utils/`  | pure path and text helpers                            | global mutation or external side effects       |

Update shared types before implementations when a public contract changes. Keep
business behavior out of transport adapters.

## Security requirements

### Path containment

Never concatenate an untrusted path with the documentation root. Resolve the root
and candidate, compute `path.relative(root, candidate)`, and reject a relative
value that is `..`, begins with `..${path.sep}`, or is absolute. A string
`startsWith(root)` check is insufficient because sibling paths can share a text
prefix.

`fetch_doc` currently validates a restricted relative Markdown/MDX key and looks
it up in the index; it does not open a client-provided filesystem path. Preserve
that property.

### Input validation

- Validate every tool argument with a strict schema before handler execution.
- Reject missing required fields, unknown fields, and malformed paths.
- Keep search queries between 1 and 200 characters.
- Do not trust client-supplied paths, endpoint names, or metadata.

### Error handling

Client-facing tool errors use this shape:

```typescript
{
  isError: true,
  content: [{ type: 'text', text: 'Sanitized message' }],
  _meta: {
    protocolVersion: '2026-07-28',
    capabilities: ['tools'],
    timestamp: '2026-08-12T14:00:00.000Z',
    errorCode: 'PATH_NOT_FOUND' | 'INVALID_INPUT' | 'PARSE_ERROR'
  }
}
```

Do not expose absolute paths or stack traces to MCP clients. Detailed diagnostics
belong on stderr because stdout is reserved for stdio JSON-RPC.

## Dependency policy

Existing production dependencies are the approved baseline:

- `@modelcontextprotocol/server`
- `@modelcontextprotocol/node` for the official Node Streamable HTTP adapter
- `zod`
- the unified and remark parsing packages already in `package.json`
- `yaml`
- `minimist`

Prefer the Node.js standard library and existing dependencies. Document the gap
before adding a production dependency. Database drivers, UI frameworks, DOM
implementations, heavy runtime bundlers, and HTTP frameworks are outside the
current architecture.

Build-only bundling for the SEA entry is allowed under `devDependencies`.

## Tool surface

The current public tools are:

| Tool               | Required input | Result                                            |
| ------------------ | -------------- | ------------------------------------------------- |
| `list_docs`        | none           | paths, titles, optional modification timestamps   |
| `search_docs`      | `query`        | ranked lexical matches with headings and snippets |
| `fetch_doc`        | `path`         | parsed content, frontmatter, and headings         |
| `get_openapi_spec` | none           | full or endpoint-filtered OpenAPI object          |

Search is lexical substring matching with relevance scoring. Do not call it
semantic search unless an actual semantic retrieval implementation is added and
tested.

Renaming tools, changing input schemas, or changing result shapes is a public API
change. Update documentation, examples, integration tests, and the changelog in
the same change.

## Data lifecycle

The MCP server object is cheap to construct. In stdio mode, the first content
tool call builds a `DocsVault`: it recursively parses a local Markdown/MDX
directory, verifies one local v2 locator, or downloads one bounded remote
manifest snapshot. Directory mode may load a separate OpenAPI JSON file;
manifest-backed modes take OpenAPI from the manifest. That promise and
read-only index are reused until process exit, and `tools/list` must not wait
for corpus loading. Streamable HTTP performs the same bounded load once before
opening its listener, then gives each request a fresh protocol server backed by
that immutable process-local snapshot.

There is no live reload. Documentation changes require a process restart. The
current implementation holds parsed document content in memory; do not claim
per-document lazy loading or a particular large-corpus memory bound without a
measurement.

## Development workflow

For protocol features and bug fixes:

1. Add a failing test that expresses the external behavior or regression.
2. Implement within the owning module.
3. Verify the absence of client/session state and source mutation.
4. Update active documentation and checked-in examples when the user contract
   changes.
5. Run the applicable checks below.

Test locations follow the current repository layout:

- `tests/unit/*.test.ts`
- `tests/integration/*.test.ts`
- `scripts/smoke-example.js` for a compiled stdio process round trip

Property-based tests remain recommended for path traversal, Unicode headings,
and large files when those surfaces change.

## Build and artifact policy

The Node.js distribution is generated in `dist/`. SEA uses the bundled CommonJS
entry `.sea/entry.cjs` and writes the executable to
`artifacts/bin/sumi-docs-mcp.exe`.

`dist/`, `.sea/`, `artifacts/`, `node_modules/`, coverage, editor metadata, and
`.gemini/` are local or generated state and remain ignored. `.omc/` is
operator-local state owned by a Claude development plugin; it remains ignored
and must not be reorganized as project source or an archived project artifact.
Historical reports are source records under `docs/history/` and are not ignored.

SEA configuration requirements:

- `useSnapshot` remains `false`.
- `useCodeCache` remains `true`.
- `assets` remains empty because the corpus is operator-supplied.
- The output directory must exist before `node --build-sea` runs.
- The SEA distribution remains stdio-only; HTTP serving belongs to the Node.js
  distribution until it has an independently accepted packaging profile.

## Performance requirements

Cold-start release evidence uses the calibrated policy in ADR-0011. It compares
the product SEA with benchmark-only raw SEA and empty official-SDK SEA baselines
in random interleaved order. Release evidence uses 100 starts per subject:

```powershell
pnpm run benchmark:cold-start --docs examples/basic/docs --iterations 100 --executable artifacts/bin/sumi-docs-mcp.exe
```

The blocking policy requires zero errors and timeouts, product median at most
200 ms, product p95 at most 350 ms, median delta to the SDK baseline at most
35 ms and ratio at most 1.30, and p95 delta at most 75 ms. P99 and maximum are
diagnostic. Less than 100 ms remains a native-runtime stretch target, not the
Node.js v0.1 release gate. Do not present the gate as passing until a current
report proves it. Preserve the runtime, host, executable digests, methodology,
raw observations, and all summary statistics.

## Required validation

For ordinary source or documentation changes:

```powershell
pnpm run lint
pnpm run typecheck
pnpm test
pnpm run build
pnpm run example:smoke
pnpm pack --dry-run
```

For SEA or packaging changes, also run on Node.js 25.5 or newer:

```powershell
pnpm run build:sea
.\artifacts\bin\sumi-docs-mcp.exe --version
pnpm run example:smoke --executable artifacts/bin/sumi-docs-mcp.exe
pnpm run benchmark:cold-start --executable artifacts/bin/sumi-docs-mcp.exe
```

Report failed gates as failures with the measured evidence. Do not replace test
output with generated phase-completion claims.

## Documentation policy

- `README.md` is the first-run contract.
- `docs/` contains current operator and maintainer documentation.
- `examples/basic/` is executable documentation and is covered by tests.
- `CHANGELOG.md` records user-visible release changes.
- `docs/history/` contains clearly marked, non-authoritative snapshots.
- Durable architecture decisions belong in `docs/decisions/`, not in phase logs.

Use plain, factual language. Avoid emoji status markers, agent signatures,
fictional approvals, unmeasured quality claims, and absolute marketing language.
