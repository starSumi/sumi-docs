import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const docsRoot = join(packageRoot, "examples/basic/docs");
const validOpenApi = join(packageRoot, "examples/basic/openapi.json");
const invalidOpenApi = join(docsRoot, "getting-started.md");

const requestMeta = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientInfo": {
    name: "diagnostic-streams-test",
    version: "1.0.0",
  },
  "io.modelcontextprotocol/clientCapabilities": {},
};

interface CapturedRun {
  responses: Map<number, Record<string, unknown>>;
  stderrLines: string[];
}

async function runVerboseServer(openApiPath: string): Promise<CapturedRun> {
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      "src/index.ts",
      "serve",
      docsRoot,
      "--openapi",
      openApiPath,
      "--verbose",
    ],
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
      method: "tools/list",
      params: { _meta: requestMeta },
    },
    {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "list_docs", arguments: {}, _meta: requestMeta },
    },
  ];
  const responses = new Map<number, Record<string, unknown>>();
  const stderrLines: string[] = [];
  const stdout = createInterface({ input: child.stdout });
  const stderr = createInterface({ input: child.stderr });

  return await new Promise<CapturedRun>((resolveRun, rejectRun) => {
    let settled = false;
    let closing = false;
    let killTimer: NodeJS.Timeout | undefined;
    const timeout = setTimeout(() => {
      fail(
        new Error(
          `Timed out waiting for stdio responses: ${stderrLines.join("\n")}`,
        ),
      );
    }, 10_000);

    const cleanup = (): void => {
      clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      stdout.close();
      stderr.close();
    };
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      child.kill();
      rejectRun(error);
    };

    stderr.on("line", (line) => stderrLines.push(line));
    stdout.on("line", (line) => {
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(line) as Record<string, unknown>;
      } catch {
        fail(
          new Error(`Non-JSON output on MCP stdout: ${JSON.stringify(line)}`),
        );
        return;
      }
      if (message.jsonrpc !== "2.0") {
        fail(new Error(`Non-JSON-RPC output on MCP stdout: ${line}`));
        return;
      }
      if (typeof message.id !== "number") return;
      responses.set(message.id, message);
      if (responses.size === requests.length && !closing) {
        closing = true;
        child.stdin.end();
        killTimer = setTimeout(() => child.kill(), 1_000);
      }
    });
    child.once("error", (error) => fail(error));
    child.once("close", (code) => {
      if (settled) return;
      if (responses.size !== requests.length) {
        fail(
          new Error(
            `Server exited with code ${code}; received ${responses.size}/${requests.length} responses.`,
          ),
        );
        return;
      }
      settled = true;
      cleanup();
      resolveRun({ responses, stderrLines });
    });

    for (const request of requests) {
      child.stdin.write(`${JSON.stringify(request)}\n`);
    }
  });
}

function parseLifecycleEvents(lines: string[]): Array<Record<string, unknown>> {
  return lines
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

test("verbose stdio diagnostics stay on stderr and describe the loaded corpus", async () => {
  const run = await runVerboseServer(validOpenApi);
  const events = parseLifecycleEvents(run.stderrLines);

  assert.deepEqual(
    events.map((event) => event.event),
    [
      "sumi_docs_mcp.starting",
      "sumi_docs_mcp.ready",
      "sumi_docs_mcp.corpus_loaded",
    ],
  );
  assert.equal(typeof events[2]?.documentCount, "number");
  assert.ok((events[2]?.documentCount as number) > 0);
  assert.deepEqual(
    { ...events[2], documentCount: 0 },
    {
      event: "sumi_docs_mcp.corpus_loaded",
      transport: "stdio",
      sourceKind: "local-directory",
      documentCount: 0,
      openApiLoaded: true,
      corpusRevision: null,
    },
  );
  assert.equal(run.stderrLines.join("\n").includes(packageRoot), false);
});

test("stdio failures preserve the JSON-RPC stdout boundary", async () => {
  const run = await runVerboseServer(invalidOpenApi);
  const result = run.responses.get(2)?.result as
    { isError?: boolean } | undefined;

  assert.equal(result?.isError, true);
  assert.match(run.stderrLines.join("\n"), /list_docs failed:/u);
  assert.equal(run.stderrLines.join("\n").includes(packageRoot), false);
  assert.deepEqual(
    parseLifecycleEvents(run.stderrLines).map((event) => event.event),
    ["sumi_docs_mcp.starting", "sumi_docs_mcp.ready"],
  );
});
