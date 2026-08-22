---
title: Changelog
description: User-visible evolution of the Sumi Docs Web projection.
---

This page is the reader-facing summary of the documentation product's
evolution. The package-level release records remain authoritative for exact
file-level changes:

- [Web changelog](https://github.com/starSumi/sumi-docs/blob/main/apps/web/CHANGELOG.md)
- [Corpus contract changelog](https://github.com/starSumi/sumi-docs/blob/main/packages/corpus-contract/CHANGELOG.md)
- [MCP changelog](https://github.com/starSumi/sumi-docs/blob/main/packages/mcp/CHANGELOG.md)

## Unreleased

- Added reviewable package release intent and automated version pull requests
  without granting package publication or tag authority.
- Replaced separate sidebar and publication mappings with one reviewed content
  catalog.
- Added a parallel immutable manifest v2 projection with locale, route, digest,
  navigation, and source provenance metadata while preserving manifest v1.
- Added source-drift checks before projection promotion and verified GitHub
  Pages deployment with explicit origin and base-path configuration.
- Added generated-output checks for canonical URLs, sitemaps, API routes, and
  local HTML references.
- Clarified that the TypeDoc API reference is canonical in English until a
  reviewed translated API corpus is published.
- Published the benchmark method and a reproducible reference run with its
  runtime, environment, workload, source commit, and release-evidence boundary.

## 0.1.0 - 2026-08-14

- Added the Astro and Starlight site with English and Simplified Chinese
  routes, light/dark/automatic theme modes, and a bounded MCP projection.
- Added build verification for the manifest, raw corpus, OpenAPI document,
  route map, rendered URLs, and all four MCP tools.
- Added contribution, security, release, and host-integration guidance.

This page is not a mutable runtime state store. A release candidate is still
identified by its Git commit, immutable CI artifacts, and the accepted
publication record described in [Releasing](../releasing/).
