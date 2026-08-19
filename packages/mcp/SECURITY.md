# Security

## Supported status

This project is pre-release and has no published package or supported release
line. Security fixes are applied to the current source checkout.

## Reporting

Report vulnerabilities through [GitHub private vulnerability reporting](https://github.com/starSumi/sumi-docs/security/advisories/new).
Do not include credentials, private documentation, or exploit data in a public
issue. The repository owner will acknowledge a report and coordinate a fix
before disclosure.

## Trust boundary

The server reads local Markdown, MDX, and optional OpenAPI JSON selected by the
operator, or downloads the same content from an operator-selected remote
manifest. MCP clients can query that loaded corpus but cannot write source files.
Treat the served corpus as visible to every client allowed to start or connect
to the process.

Remote mode requires HTTPS except on loopback, accepts no credentials, rejects
redirects, and restricts manifest paths and response sizes. It intentionally
does not support authenticated private hosts. The operator remains responsible
for trusting the selected host and the content it serves.

See [docs/architecture.md](docs/architecture.md) for input validation and path
containment requirements.
