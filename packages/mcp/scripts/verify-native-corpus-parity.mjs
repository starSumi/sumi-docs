import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DocsVault } from "../src/vfs/DocsVault.js";

const MAX_OUTPUT_BYTES = 1024 * 1024;
const TIMEOUT_MS = 60_000;
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = resolve(
  packageRoot,
  "../corpus-contract/fixtures/runtime-parity-v1",
);

function normalizeDocument(document) {
  if (document === null) return null;
  return {
    path: document.path,
    title: document.title,
    content: document.content,
    headings: document.headings,
    ...(document.frontmatter === undefined
      ? {}
      : { frontmatter: document.frontmatter }),
  };
}

function normalizeSearchResult(result) {
  return {
    path: result.path,
    title: result.title,
    headings: result.headings,
    snippet: result.snippet,
  };
}

async function createNodeSnapshot() {
  const cases = JSON.parse(
    await readFile(resolve(fixtureRoot, "cases.json"), "utf8"),
  );
  const vault = new DocsVault();
  await vault.loadFromDirectory(resolve(fixtureRoot, "docs"));
  await vault.loadOpenApi(resolve(fixtureRoot, "openapi.json"));

  return {
    documents: vault
      .listTree()
      .map(({ path }) => normalizeDocument(vault.getDoc(path))),
    searches: Object.fromEntries(
      cases.queries.map((query) => [
        query,
        vault.search(query).map(normalizeSearchResult),
      ]),
    ),
    fetches: Object.fromEntries(
      cases.fetchPaths.map((path) => [
        path,
        normalizeDocument(vault.getDoc(path)),
      ]),
    ),
    openapi: Object.fromEntries(
      cases.openapiEndpoints.map((endpoint) => [
        endpoint ?? "<full>",
        vault.getOpenApiSpec(endpoint ?? undefined),
      ]),
    ),
  };
}

function runRustSnapshot() {
  const manifestPath = resolve(packageRoot, "native/Cargo.toml");
  const child = spawn(
    "cargo",
    [
      "run",
      "--quiet",
      "--locked",
      "--manifest-path",
      manifestPath,
      "--example",
      "corpus_snapshot",
      "--",
      fixtureRoot,
    ],
    { cwd: packageRoot, stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
  );

  return new Promise((resolveRun, rejectRun) => {
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      rejectRun(new Error(`Rust parity emitter exceeded ${TIMEOUT_MS} ms.`));
    }, TIMEOUT_MS);

    const append = (current, chunk, name) => {
      const next = Buffer.concat([current, chunk]);
      if (next.length > MAX_OUTPUT_BYTES) {
        child.kill();
        rejectRun(new Error(`${name} exceeded ${MAX_OUTPUT_BYTES} bytes.`));
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
    child.once("error", rejectRun);
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code !== 0) {
        rejectRun(
          new Error(
            `Rust parity emitter exited with code ${code}: ${stderr.toString("utf8")}`,
          ),
        );
        return;
      }
      resolveRun(JSON.parse(stdout.toString("utf8")));
    });
  });
}

const nodeSnapshot = await createNodeSnapshot();
const rustSnapshot = await runRustSnapshot();
assert.deepEqual(rustSnapshot, nodeSnapshot);
console.log(
  `Native corpus parity passed (${nodeSnapshot.documents.length} documents, ${Object.keys(nodeSnapshot.searches).length} queries).`,
);
