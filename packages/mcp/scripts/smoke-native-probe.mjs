import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_OUTPUT_BYTES = 64 * 1024;
const TIMEOUT_MS = 30_000;
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = resolve(packageRoot, "native/Cargo.toml");
const child = spawn(
  "cargo",
  ["run", "--quiet", "--locked", "--manifest-path", manifestPath],
  {
    cwd: packageRoot,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  },
);

const requests = [
  {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2026-07-28",
      capabilities: {},
      clientInfo: { name: "sumi-docs-native-smoke", version: "1.0.0" },
    },
  },
  { jsonrpc: "2.0", method: "notifications/initialized", params: {} },
  { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
];

let stdout = Buffer.alloc(0);
let stderr = Buffer.alloc(0);
let settled = false;

const completed = new Promise((resolveRun, rejectRun) => {
  const fail = (error) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    child.kill();
    rejectRun(error);
  };

  const append = (current, chunk, streamName) => {
    const next = Buffer.concat([current, chunk]);
    if (next.length > MAX_OUTPUT_BYTES) {
      fail(new Error(`${streamName} exceeded ${MAX_OUTPUT_BYTES} bytes.`));
      return current;
    }
    return next;
  };

  child.stdout.on("data", (chunk) => {
    stdout = append(stdout, chunk, "stdout");
  });
  child.stderr.on("data", (chunk) => {
    stderr = append(stderr, chunk, "stderr");
  });
  child.once("error", fail);
  child.once("close", (code) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    if (code !== 0) {
      rejectRun(
        new Error(
          `Native probe exited with code ${code}. stderr: ${stderr.toString("utf8")}`,
        ),
      );
      return;
    }
    resolveRun();
  });

  const timeout = setTimeout(
    () => fail(new Error(`Native probe exceeded ${TIMEOUT_MS} ms.`)),
    TIMEOUT_MS,
  );
});

child.stdin.end(
  `${requests.map((request) => JSON.stringify(request)).join("\n")}\n`,
);
await completed;

const responses = stdout
  .toString("utf8")
  .split(/\r?\n/u)
  .filter(Boolean)
  .map((line) => JSON.parse(line));
const initialize = responses.find((message) => message.id === 1);
const toolsList = responses.find((message) => message.id === 2);

assert.equal(initialize?.jsonrpc, "2.0");
assert.equal(initialize?.result?.protocolVersion, "2026-07-28");
assert.equal(typeof initialize?.result?.capabilities?.tools, "object");
assert.equal(toolsList?.jsonrpc, "2.0");
assert.equal(toolsList?.error, undefined);

const tools = toolsList?.result?.tools;
assert.ok(Array.isArray(tools));
assert.deepEqual(tools.map((tool) => tool.name).sort(), [
  "fetch_doc",
  "get_openapi_spec",
  "list_docs",
  "search_docs",
]);

const schemas = Object.fromEntries(
  tools.map((tool) => [tool.name, tool.inputSchema]),
);
for (const schema of Object.values(schemas)) {
  assert.equal(schema.type, "object");
  assert.equal(schema.additionalProperties, false);
}
assert.deepEqual(schemas.search_docs.required, ["query"]);
assert.deepEqual(schemas.fetch_doc.required, ["path"]);
assert.equal(schemas.list_docs.required, undefined);
assert.equal(schemas.get_openapi_spec.required, undefined);

console.log(
  "Native stdio checkpoint passed (initialize + tools/list, 4 strict tools).",
);
