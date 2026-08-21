---
title: Standards and references
description: External specifications that define Sumi Docs compatibility boundaries.
---

These links identify the external specifications used as contract authorities.
They are references, not claims of certification or endorsement. Sumi adopts
only the portions named by its local schemas, tests, and architecture records.

## Protocols and data contracts

| Surface                                        | Authority                                                                                                 | Use in Sumi Docs                                                                             |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| MCP messages, lifecycle, tools, and transports | [Model Context Protocol specification](https://modelcontextprotocol.io/specification/)                    | Defines JSON-RPC interaction and the boundary between an agent host, MCP client, and server. |
| HTTP transport behavior                        | [MCP transport specification](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)  | Defines stdio and Streamable HTTP semantics; Sumi keeps stdio as the default.                |
| Schema vocabulary                              | [JSON Schema Draft 2020-12](https://json-schema.org/draft/2020-12/json-schema-core)                       | Defines the corpus manifest and conformance schema vocabulary.                               |
| HTTP API description                           | [OpenAPI Specification](https://spec.openapis.org/oas/latest.html)                                        | Describes the optional OpenAPI document exposed by `get_openapi_spec`.                       |
| Normative wording                              | [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119) and [RFC 8174](https://www.rfc-editor.org/rfc/rfc8174) | Interprets capitalized MUST, SHOULD, and MAY in project contracts.                           |

## Web, language, and operations

| Surface               | Authority                                                                                                                                         | Use in Sumi Docs                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Browser accessibility | [WCAG 2.2](https://www.w3.org/TR/WCAG22/)                                                                                                         | Sets the accessibility target for the human documentation site.                                                    |
| TypeScript language   | [TypeScript documentation](https://www.typescriptlang.org/docs/)                                                                                  | Describes the language used by the Node packages and generated TypeDoc reference.                                  |
| Rust parity lane      | [The Rust Reference](https://doc.rust-lang.org/reference/)                                                                                        | Applies only to a future supported native implementation; it does not change the current Node contract.            |
| Operational telemetry | [OpenTelemetry specification](https://opentelemetry.io/docs/specs/otel/) and [semantic conventions](https://opentelemetry.io/docs/specs/semconv/) | Provides the vocabulary for opt-in host or service telemetry without adding an exporter to the read-only MCP core. |
| Workflow security     | [GitHub Actions security hardening](https://docs.github.com/en/actions/security-for-github-actions/security-hardening-for-github-actions)         | Informs least-privilege workflow permissions and release evidence handling.                                        |

## Applying a reference

An external link does not override the repository contract. A proposed change
must identify the affected local schema, implementation, tests, and rollback
path. If the external specification and the pinned project behavior diverge,
the difference is recorded in an architecture decision before implementation.

See [Engineering records](../product/engineering-records/) for the record type
to use and [Architecture](../architecture/) for the current compatibility
boundary.
