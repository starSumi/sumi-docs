# Changelog

This file records user-visible changes to the documentation site.

## Unreleased

- Replaced separate sidebar and publication mappings with one reviewed content
  catalog.
- Added a parallel immutable manifest v2 projection with explicit locale,
  route, digest, navigation, and source provenance metadata while preserving
  manifest v1.
- Added build-time source drift detection before projection promotion.
- Added verified GitHub Pages deployment with explicit origin and base-path
  configuration.
- Added generated-output checks for canonical URLs, sitemaps, exact-case API
  routes, and every local HTML reference.
- Added public benchmark methodology and reference results with explicit
  source, runtime, environment, workload, and release-evidence boundaries.
- Replaced the generated API translation warning with a localized notice that
  identifies English as the current canonical API source.
- Added reader-facing changelog, standards, and observability pages to the
  reviewed bilingual catalog.

## 0.1.0 - 2026-08-14

- Added an Astro and Starlight documentation site with English and Simplified
  Chinese routes.
- Added light, dark, and automatic theme modes.
- Added a bounded machine-readable projection for Sumi-Docs-MCP remote mode.
- Added build verification for the manifest, raw corpus, OpenAPI document,
  route map, and rendered URLs.
- Added cross-project verification of all four MCP tools and published page
  URLs.
- Added dependency, commit-message, and release-candidate quality gates.
- Added repository metadata, the security-reporting entry point, and a branded
  favicon for the public source distribution.
- Expanded the bilingual showcase corpus with the overview, MCP tool reference,
  troubleshooting, development, and release handbooks.
- Added issue and pull request templates plus a reviewable contribution
  lifecycle.
- Added bilingual guidance for client Skills, the MCP capability boundary,
  agent orchestration, and the Web projection.
