# Security

## Supported status

This site is pre-release and has no published supported release line. Security
fixes are applied to the current source branch.

## Reporting

Report vulnerabilities through [GitHub private vulnerability reporting](https://github.com/starSumi/sumi-docs/security/advisories/new).
Do not include credentials, private content, or exploit details in a public
issue. The repository owner will acknowledge a report and coordinate a fix
before disclosure.

## Trust boundary

Astro compiles repository-owned Markdown and MDX at build time. Only reviewed,
trusted content may enter the workspace root `docs/`; remote or user-supplied MDX must
never be executed. The generated site and everything under `dist/_mcp/` are
public distribution outputs, so they must not contain secrets, private URLs, or
internal-only documentation.

The site contains no model credentials, browser-side MCP transport, or
authenticated content fetch. Any future interactive agent or private-document
feature requires a separate BFF and security architecture review.
