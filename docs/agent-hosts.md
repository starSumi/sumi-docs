---
title: Agent host integration
description: Connect Codex, Claude Code, and VS Code without making a Skill mandatory.
---

# Agent host integration

Build once after cloning the repository:

```powershell
pnpm install --frozen-lockfile
pnpm run build
node packages/mcp/dist/index.js doctor --json
```

The repository then exposes the same stdio server through each host's native,
reviewable project configuration.

| Host        | Project configuration | Trust behavior                                                 |
| ----------- | --------------------- | -------------------------------------------------------------- |
| Codex       | `.codex/config.toml`  | Project configuration is applied only for a trusted project.   |
| Claude Code | `.mcp.json`           | Project-scoped servers require approval before use.            |
| VS Code     | `.vscode/mcp.json`    | The editor asks before starting workspace-defined MCP servers. |

Open the repository root as the workspace. Codex uses the pnpm workspace
launcher so the command also works when a session starts in a nested directory.
Claude Code and VS Code use their documented project-root variables to launch
the compiled entry without a package-manager stdout wrapper.

After changing configuration or rebuilding the MCP package, restart the MCP
server in the host. The server keeps one process-local, read-only corpus
snapshot and does not live reload.

## Project Skills and direct MCP use

Codex discovers the reviewed `$sumi-docs-use`, `$sumi-docs-pr`, and
`$sumi-docs-audit` workflows from `.agents/skills/` when their task descriptions
apply. Claude Code can read the same canonical files through the repository
instructions. They cover setup, pull-request preparation, and read-only
repository or release auditing; none is required for ordinary documentation
queries.

## Direct MCP use

The host configuration is sufficient. An agent can call `list_docs`, search by
keyword, fetch an exact listed path, and inspect OpenAPI without loading a
Skill. MCP initialization instructions describe that workflow and its
read-only, snapshot-based limits.

For product usage, architecture, operations, and stable decisions, agents
should query this reviewed projection before scanning documentation files.
Implementation work still uses source and tests as the current authority. The
MCP server limits its own four-tool surface; it does not grant, revoke, or
replace the agent host's filesystem permissions or sandbox.

The agent host is the MCP client. For a remote deployment, a host with
Streamable HTTP support connects to the service URL such as
`https://mcp.example.com/mcp` instead of launching a local process. The tool
names, strict schemas, initialization instructions, and corpus identity remain
the same.

The optional `$sumi-docs-maintain` Skill is only a maintenance router. It helps
an agent decide which package and validation gates own a repository change. It
is not a protocol dependency and does not write documentation through MCP.

## Natural-language requests

Natural-language interaction belongs to the agent host. A host can translate a
request such as "How do I configure a remote corpus?" into a bounded sequence:

1. call `list_docs` when the corpus identity is unknown;
2. call `search_docs` with the user's terms;
3. call `fetch_doc` for the selected source and preserve its path as the
   citation; and
4. call `get_openapi_spec` only when the request concerns the published API.

The host then writes the answer and cites the returned document path or public
URL. Sumi-Docs-MCP does not parse prompts, choose a model, store conversation
history, or require an API key. A future Codex-like integration can add an
agent or provider adapter around the same MCP contract without changing the
server or the reviewed corpus.

The retrieval step is retrieval-augmented generation when a model uses the
returned passages as context. The current implementation is deterministic
lexical retrieval, not an embedding or vector database. Fine-tuning is neither
required nor a mechanism for keeping documentation current; update the corpus,
rebuild or restart the process, and let the host retrieve the new revision.

## Defaults and navigation

With no CLI source, `sumi-docs.config.json` selects root `docs/`. Without that
file, discovery falls back to the nearest trusted Git project root's `docs/`
directory. Outside Git it never walks upward, so the parent `.sumi` workspace
container cannot be mistaken for product state.

MCP has no presentation navigation: `list_docs` returns every Markdown or MDX
path in deterministic order. The website uses the reviewed catalog for labels,
order, locale pairs, and routes. A new root documentation file intentionally
breaks the Web omissions gate until it is registered in both locales.
