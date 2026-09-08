import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  PROTOCOL_VERSION_META_KEY,
} from "@modelcontextprotocol/server";
import { DocsMcpServer } from "../../src/mcp/server.js";
import {
  HEALTH_PATH,
  READINESS_PATH,
  serveStreamableHttp,
} from "../../src/mcp/streamable-http.js";
import { DocsVault } from "../../src/vfs/DocsVault.js";
import { VERSION } from "../../src/version.js";

const requestMeta = {
  [PROTOCOL_VERSION_META_KEY]: "2026-07-28",
  [CLIENT_INFO_META_KEY]: { name: "http-integration-test", version: "1.0.0" },
  [CLIENT_CAPABILITIES_META_KEY]: {},
};
const execFileAsync = promisify(execFile);

function modernHeaders(method: string): Record<string, string> {
  return {
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
    "mcp-method": method,
    "mcp-protocol-version": "2026-07-28",
  };
}

test("Streamable HTTP exposes the same stateless tool surface", async () => {
  const vault = new DocsVault();
  const handle = await serveStreamableHttp(
    () => new DocsMcpServer(vault).server,
    {
      host: "127.0.0.1",
      port: 0,
      path: "/mcp",
      allowedHosts: [],
      allowedOrigins: [],
      maxBodyBytes: 8_192,
      buildRevision: "0123456789abcdef0123456789abcdef01234567",
      readiness: {
        documentCount: 2,
        corpusRevision: `sha256:${"a".repeat(64)}`,
      },
    },
  );

  try {
    const response = await fetch(handle.url, {
      method: "POST",
      headers: modernHeaders("tools/list"),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: { _meta: requestMeta },
      }),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("mcp-session-id"), null);
    const payload = (await response.json()) as {
      result: {
        tools: Array<{
          name: string;
          inputSchema: {
            type: string;
            required?: string[];
            additionalProperties?: boolean;
          };
        }>;
      };
    };
    assert.deepEqual(
      new Set(payload.result.tools.map((tool) => tool.name)),
      new Set(["fetch_doc", "get_openapi_spec", "list_docs", "search_docs"]),
    );
    const schemas = Object.fromEntries(
      payload.result.tools.map((tool) => [tool.name, tool.inputSchema]),
    );
    assert.deepEqual(schemas.list_docs, {
      type: "object",
      $schema: "https://json-schema.org/draft/2020-12/schema",
      properties: {},
      additionalProperties: false,
    });
    assert.deepEqual(schemas.search_docs.required, ["query"]);
    assert.equal(schemas.search_docs.additionalProperties, false);
    assert.deepEqual(schemas.fetch_doc.required, ["path"]);
    assert.equal(schemas.fetch_doc.additionalProperties, false);
    assert.equal(schemas.get_openapi_spec.additionalProperties, false);

    const health = await fetch(new URL(HEALTH_PATH, handle.url));
    assert.equal(health.status, 200);
    assert.equal(health.headers.get("cache-control"), "no-store");
    assert.equal(health.headers.get("x-content-type-options"), "nosniff");
    assert.equal(health.headers.get("mcp-session-id"), null);
    assert.deepEqual(await health.json(), {
      status: "ok",
      service: "sumi-docs-mcp",
      version: VERSION,
      protocolVersion: "2026-07-28",
      transport: "streamable-http",
      buildRevision: "0123456789abcdef0123456789abcdef01234567",
    });

    const readiness = await fetch(new URL(READINESS_PATH, handle.url));
    assert.equal(readiness.status, 200);
    assert.equal(readiness.headers.get("mcp-session-id"), null);
    assert.deepEqual(await readiness.json(), {
      status: "ready",
      service: "sumi-docs-mcp",
      version: VERSION,
      protocolVersion: "2026-07-28",
      transport: "streamable-http",
      buildRevision: "0123456789abcdef0123456789abcdef01234567",
      corpus: {
        documentCount: 2,
        revision: `sha256:${"a".repeat(64)}`,
      },
    });

    const rejectedHealthPost = await fetch(new URL(HEALTH_PATH, handle.url), {
      method: "POST",
    });
    assert.equal(rejectedHealthPost.status, 405);

    const mismatchedMethod = await fetch(handle.url, {
      method: "POST",
      headers: modernHeaders("tools/call"),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/list",
        params: { _meta: requestMeta },
      }),
    });
    assert.equal(mismatchedMethod.status, 400);

    const rejectedOrigin = await fetch(handle.url, {
      method: "POST",
      headers: {
        ...modernHeaders("tools/list"),
        origin: "https://evil.example",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: { _meta: requestMeta },
      }),
    });
    assert.equal(rejectedOrigin.status, 403);

    const missing = await fetch(new URL("/not-mcp", handle.url));
    assert.equal(missing.status, 404);

    const oversized = await fetch(handle.url, {
      method: "POST",
      headers: modernHeaders("tools/list"),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/list",
        params: { _meta: requestMeta, padding: "x".repeat(9_000) },
      }),
    });
    assert.equal(oversized.status, 413);

    const missingProtocolVersion = await fetch(handle.url, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-method": "tools/list",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 5,
        method: "tools/list",
        params: { _meta: requestMeta },
      }),
    });
    assert.equal(missingProtocolVersion.status, 400);
    assert.deepEqual(await missingProtocolVersion.json(), {
      jsonrpc: "2.0",
      id: 5,
      error: {
        code: -32020,
        message: "Required MCP request metadata is missing or mismatched.",
      },
    });

    const mismatchedProtocolVersion = await fetch(handle.url, {
      method: "POST",
      headers: modernHeaders("tools/list"),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 6,
        method: "tools/list",
        params: {
          _meta: {
            ...requestMeta,
            [PROTOCOL_VERSION_META_KEY]: "2025-11-25",
          },
        },
      }),
    });
    assert.equal(mismatchedProtocolVersion.status, 400);
    assert.deepEqual(await mismatchedProtocolVersion.json(), {
      jsonrpc: "2.0",
      id: 6,
      error: {
        code: -32020,
        message: "Required MCP request metadata is missing or mismatched.",
      },
    });

    const malformedJson = await fetch(handle.url, {
      method: "POST",
      headers: modernHeaders("tools/list"),
      body: "{",
    });
    assert.equal(malformedJson.status, 400);
    assert.equal(
      malformedJson.headers.get("x-content-type-options"),
      "nosniff",
    );
    assert.deepEqual(await malformedJson.json(), {
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: "Parse error." },
    });
  } finally {
    await handle.close();
  }
});

test("readiness fails closed until a corpus snapshot is supplied", async () => {
  const handle = await serveStreamableHttp(
    () => new DocsMcpServer(new DocsVault()).server,
    {
      host: "127.0.0.1",
      port: 0,
      path: "/mcp",
      allowedHosts: [],
      allowedOrigins: [],
    },
  );

  try {
    const health = await fetch(new URL(HEALTH_PATH, handle.url));
    assert.equal(health.status, 200);

    const readiness = await fetch(new URL(READINESS_PATH, handle.url));
    assert.equal(readiness.status, 503);
    assert.deepEqual(await readiness.json(), {
      status: "unavailable",
      service: "sumi-docs-mcp",
    });
  } finally {
    await handle.close();
  }
});

test("HTTP startup rejects a stale expected corpus before listening", async () => {
  await assert.rejects(
    execFileAsync(
      process.execPath,
      [
        "--import",
        "tsx",
        "src/index.ts",
        "serve",
        "examples/basic/docs",
        "--transport",
        "streamable-http",
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          SUMI_DOCS_BUILD_REVISION: "0123456789abcdef0123456789abcdef01234567",
          SUMI_DOCS_EXPECTED_CORPUS_REVISION: `sha256:${"b".repeat(64)}`,
        },
        timeout: 15_000,
        windowsHide: true,
      },
    ),
    (error: unknown) => {
      const failure = error as { code?: number; stderr?: string };
      assert.equal(failure.code, 1);
      assert.match(failure.stderr ?? "", /does not match/u);
      assert.doesNotMatch(failure.stderr ?? "", /sumi_docs_mcp\.ready/u);
      assert.doesNotMatch(failure.stderr ?? "", /[A-Z]:\\/iu);
      return true;
    },
  );
});
