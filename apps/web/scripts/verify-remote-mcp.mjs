import { parseCurrentLocatorV2 } from "@sumi-labs/corpus-contract";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  resolveRemoteMcpEnvironment,
  serializeRemoteServerMetadata,
} from "../integrations/sumi-docs-publisher.mjs";

export const MAX_READINESS_BYTES = 64 * 1024;
export const READINESS_TIMEOUT_MS = 10_000;
const EXPECTED_SERVICE = "sumi-docs-mcp";
const EXPECTED_PROTOCOL_VERSION = "2026-07-28";
const DEFAULT_OUTPUT_ROOT = fileURLToPath(new URL("../dist/", import.meta.url));

function normalizeBuildRevision(value) {
  const revision = value?.trim();
  if (!revision) return undefined;
  if (!/^[a-f0-9]{40}$/iu.test(revision)) {
    throw new Error("Expected build revision must be a full Git SHA.");
  }
  return revision.toLowerCase();
}

async function readBuiltLocator(outputRoot) {
  try {
    const source = await readFile(
      resolve(outputRoot, "_mcp", "v2", "current.json"),
      "utf8",
    );
    return parseCurrentLocatorV2(JSON.parse(source));
  } catch {
    throw new Error("Built corpus locator is missing or invalid.");
  }
}

async function readOptionalServerMetadata(outputRoot) {
  try {
    return await readFile(resolve(outputRoot, "_mcp", "server.json"), "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw new Error("Remote MCP discovery metadata could not be read.", {
      cause: error,
    });
  }
}

async function readBoundedBody(response, maxBytes) {
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength !== null &&
    (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > maxBytes)
  ) {
    throw new Error("Remote MCP readiness response exceeds the size limit.");
  }
  if (!response.body) {
    throw new Error("Remote MCP readiness response has no body.");
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    let result;
    try {
      result = await reader.read();
    } catch {
      throw new Error("Remote MCP readiness response could not be read.");
    }
    const { done, value } = result;
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("Remote MCP readiness response exceeds the size limit.");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total).toString("utf8");
}

function validateReadiness(payload, { version, revision, buildRevision }) {
  if (
    payload === null ||
    typeof payload !== "object" ||
    Array.isArray(payload)
  ) {
    throw new Error("Remote MCP readiness response must be a JSON object.");
  }
  if (payload.status !== "ready") {
    throw new Error("Remote MCP service is not ready.");
  }
  if (payload.service !== EXPECTED_SERVICE) {
    throw new Error("Remote MCP service identity differs from the release.");
  }
  if (payload.version !== version) {
    throw new Error("Remote MCP version differs from the release.");
  }
  if (payload.protocolVersion !== EXPECTED_PROTOCOL_VERSION) {
    throw new Error("Remote MCP protocol version differs from the release.");
  }
  if (payload.transport !== "streamable-http") {
    throw new Error("Remote MCP transport differs from the discovery record.");
  }
  if (
    payload.corpus === null ||
    typeof payload.corpus !== "object" ||
    Array.isArray(payload.corpus) ||
    payload.corpus.revision !== revision
  ) {
    throw new Error("Remote MCP corpus revision differs from the built site.");
  }
  if (
    buildRevision &&
    (typeof payload.buildRevision !== "string" ||
      payload.buildRevision.toLowerCase() !== buildRevision)
  ) {
    throw new Error("Remote MCP build revision differs from the Pages commit.");
  }
  return {
    skipped: false,
    revision,
    ...(buildRevision && { buildRevision }),
  };
}

export async function verifyRemoteMcpReadiness({
  outputRoot = DEFAULT_OUTPUT_ROOT,
  remoteMcp,
  expectedBuildRevision,
  fetchImpl = fetch,
  timeoutMs = READINESS_TIMEOUT_MS,
  maxResponseBytes = MAX_READINESS_BYTES,
}) {
  const actualServerMetadata = await readOptionalServerMetadata(outputRoot);
  if (!remoteMcp) {
    if (actualServerMetadata !== undefined) {
      throw new Error(
        "Remote MCP discovery metadata exists without endpoint configuration.",
      );
    }
    return { skipped: true };
  }

  const normalizedBuildRevision = normalizeBuildRevision(expectedBuildRevision);
  const expectedServerMetadata = serializeRemoteServerMetadata(remoteMcp);
  if (actualServerMetadata !== expectedServerMetadata) {
    throw new Error(
      "Remote MCP discovery metadata differs from endpoint configuration.",
    );
  }
  const current = await readBuiltLocator(outputRoot);

  let response;
  try {
    response = await fetchImpl(remoteMcp.readinessUrl, {
      method: "GET",
      headers: { accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new Error("Remote MCP readiness request failed or timed out.");
  }
  if (!response || response.status !== 200) {
    throw new Error(
      `Remote MCP readiness returned HTTP ${response?.status ?? "unknown"}.`,
    );
  }

  const body = await readBoundedBody(response, maxResponseBytes);
  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new Error("Remote MCP readiness response is not valid JSON.");
  }
  return validateReadiness(payload, {
    version: remoteMcp.version,
    revision: current.revision,
    buildRevision: normalizedBuildRevision,
  });
}

async function main() {
  const mcpPackage = JSON.parse(
    await readFile(
      new URL("../../../packages/mcp/package.json", import.meta.url),
      "utf8",
    ),
  );
  const remoteMcp = resolveRemoteMcpEnvironment({
    publicMcpUrl: process.env.PUBLIC_MCP_URL,
    publicMcpReadinessUrl: process.env.PUBLIC_MCP_READINESS_URL,
    version: mcpPackage.version,
  });
  const result = await verifyRemoteMcpReadiness({
    remoteMcp,
    expectedBuildRevision: process.env.GITHUB_SHA,
  });
  if (result.skipped) {
    console.log(
      "Skipped remote MCP readiness verification because endpoint variables are not configured.",
    );
  } else {
    console.log(
      `Verified remote MCP readiness for corpus ${result.revision}${
        result.buildRevision ? ` at build ${result.buildRevision}` : ""
      }.`,
    );
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch(() => {
    console.error("Remote MCP readiness verification failed.");
    process.exitCode = 1;
  });
}
