# Corpus contract

This package owns the Sumi Docs manifest schemas, canonical JSON,
revision calculation, strict validation, and conformance fixtures. It contains
no filesystem acquisition, Markdown parser, MCP transport, or Astro behavior.

Manifest version 1 remains supported without changing its payload. Version 2
adds immutable revisions, explicit locale and route metadata, content digests,
navigation metadata, and provenance.

## Contract rules

- V1 is an exact `version: 1` object with a path-only `documents` array. Unknown
  fields, duplicate paths, absolute paths, and non-Markdown paths are rejected.
- V2 is sealed with `sha256:` plus the SHA-256 digest of canonical compact JSON
  for the core fields, excluding `revision`. Object keys and published arrays
  are sorted deterministically. Producer-side Windows separators normalize to
  `/`; wire manifests must already use portable paths.
- Locale values must equal `Intl.getCanonicalLocales(value)[0]` (for example,
  `zh-CN`, not `zh-cn`). Routes are absolute site paths ending in `/` and do
  not contain dot segments, encoded delimiters, or query/fragment syntax.
- `repository`, `commit`, and `dirty` are all required provenance fields.
  `null` explicitly means unavailable; a commit without a repository is not
  accepted. Non-null repository URLs are canonical HTTPS URLs without
  credentials, queries, or fragments.
- `bytes` and `sha256` describe the raw bytes acquired by a consumer. Use
  `assertIntegrity` before parsing text. The package enforces the existing
  bounded acquisition limits: 1,000 documents, 2 MiB per document, 8 MiB for
  OpenAPI, and 64 MiB total document bytes.

The JSON Schemas provide portable structural validation and mark the canonical
BCP 47 rule. Runtime validation remains authoritative for computed revisions,
cross-field uniqueness, byte totals, and exact locale canonicalization, which
JSON Schema cannot express portably without custom formats.

`createCurrentLocatorV2` serializes a validated manifest using the same
canonical JSON and records its byte count and digest. The locator's manifest
path is derived from the digest-only revision directory, so `sha256:` never
becomes a Windows path segment. Consumers can use `parseLocatedManifestV2` to
verify the immutable bytes before JSON parsing and bind the parsed revision to
the locator.
