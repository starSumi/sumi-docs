---
title: Security policy
description: Report vulnerabilities privately and understand the current trust boundary.
---

Sumi Docs publishes source code but does not yet have a supported product
release. Do not report vulnerabilities in a public issue.

Use [GitHub private vulnerability reporting](https://github.com/starSumi/sumi-docs/security/advisories/new)
and include the affected commit, reproduction steps, impact, and any known
mitigation. Do not include secrets or private corpus content in logs or reports.

The MCP server is intentionally read-only and unauthenticated. Do not point it at
private remote documentation until an authenticated source design has completed
architecture and security review.
