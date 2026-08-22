import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import minimist from "minimist";

const options = minimist(process.argv.slice(2), {
  string: ["executable", "docs-source"],
});
const docsRoot = resolve("examples/basic/docs");
const openApiPath = resolve("examples/basic/openapi.json");
const baseUrl = "https://docs.example.com/product/";
const docsSource = options["docs-source"] ?? docsRoot;
const isRemoteSource = /^https?:\/\//i.test(docsSource);
const command = options.executable
  ? resolve(options.executable)
  : process.execPath;
const args = [
  ...(!options.executable ? ["dist/index.js"] : []),
  "serve",
  docsSource,
  ...(!isRemoteSource ? ["--openapi", openApiPath] : []),
  "--base-url",
  baseUrl,
];
const child = spawn(command, args, {
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
});
const meta = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientInfo": {
    name: "example-smoke",
    version: "1.0.0",
  },
  "io.modelcontextprotocol/clientCapabilities": {},
};
const requests = [
  { jsonrpc: "2.0", id: 1, method: "tools/list", params: { _meta: meta } },
  {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "list_docs", arguments: {}, _meta: meta },
  },
  {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "search_docs", arguments: { query: "token" }, _meta: meta },
  },
  {
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: {
      name: "fetch_doc",
      arguments: { path: "getting-started.md" },
      _meta: meta,
    },
  },
  {
    jsonrpc: "2.0",
    id: 5,
    method: "tools/call",
    params: {
      name: "get_openapi_spec",
      arguments: { endpoint: "/health" },
      _meta: meta,
    },
  },
];

const responses = new Map();
const stderr = [];
child.stderr.on("data", (chunk) => stderr.push(chunk.toString()));

const completed = new Promise((resolveRun, rejectRun) => {
  let settled = false;
  let stopping = false;
  let killTimer;
  const fail = (error) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    clearTimeout(killTimer);
    child.kill();
    rejectRun(error);
  };
  const timeout = setTimeout(() => {
    fail(
      new Error(
        `Timed out waiting for MCP responses. stderr: ${stderr.join("")}`,
      ),
    );
  }, 5_000);
  child.once("error", (error) => {
    fail(error);
  });
  child.once("close", (code) => {
    if (settled) return;
    if (responses.size < requests.length) {
      fail(
        new Error(
          `Server exited with code ${code}. stderr: ${stderr.join("")}`,
        ),
      );
      return;
    }
    settled = true;
    clearTimeout(timeout);
    clearTimeout(killTimer);
    output.close();
    resolveRun();
  });

  const output = createInterface({ input: child.stdout });
  output.on("line", (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      fail(new Error(`Non-JSON output on MCP stdout: ${JSON.stringify(line)}`));
      return;
    }
    if (message?.jsonrpc !== "2.0") {
      fail(new Error(`Non-JSON-RPC output on MCP stdout: ${line}`));
      return;
    }
    if (typeof message.id !== "number") return;
    responses.set(message.id, message);
    if (responses.size === requests.length && !stopping) {
      stopping = true;
      clearTimeout(timeout);
      child.stdin.end();
      killTimer = setTimeout(() => child.kill(), 1_000);
    }
  });
});

for (const request of requests)
  child.stdin.write(`${JSON.stringify(request)}\n`);
await completed;

const toolNames = responses.get(1)?.result?.tools?.map((tool) => tool.name);
assert.deepEqual(
  new Set(toolNames),
  new Set(["list_docs", "search_docs", "fetch_doc", "get_openapi_spec"]),
);

const parseToolText = (id) =>
  JSON.parse(responses.get(id).result.content[0].text);
const listedDocuments = parseToolText(2);
assert.equal(
  listedDocuments.find((document) => document.path === "api/authentication.mdx")
    ?.url,
  "https://docs.example.com/product/api/authentication/",
);
assert.equal(
  listedDocuments.find((document) => document.path === "getting-started.md")
    ?.url,
  "https://docs.example.com/product/getting-started/",
);
assert.equal(parseToolText(3)[0].path, "api/authentication.mdx");
assert.equal(
  parseToolText(3)[0].url,
  "https://docs.example.com/product/api/authentication/",
);
assert.match(
  parseToolText(4).content,
  /remote HTTPS host with a Sumi documentation manifest/i,
);
assert.equal(
  parseToolText(4).url,
  "https://docs.example.com/product/getting-started/",
);
assert.deepEqual(Object.keys(parseToolText(5).paths), ["/health"]);

console.log(`Example stdio smoke test passed (5 MCP requests via ${command}).`);
