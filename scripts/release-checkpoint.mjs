import { createHash } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

const COMMIT = /^[0-9a-f]{40}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const RAW_DIGEST = /^[0-9a-f]{64}$/u;
const RUN_COORDINATE = /^[1-9][0-9]*$/u;
const LOCATOR_PATH = /^snapshots\/([0-9a-f]{64})\/manifest\.json$/u;
const MAX_LOCATOR_BYTES = 64 * 1024;
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
const MAX_METADATA_BYTES = 64 * 1024;
const CONDITION_TYPES = [
  "SourceProvenanceMatches",
  "CorpusIntegrityVerified",
  "PagesReadbackVerified",
  "RemoteMcpReadbackVerified",
];

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

function assertKeys(value, required, optional, label) {
  const object = assertObject(value, label);
  const allowed = new Set([...required, ...optional]);
  if (
    required.some((key) => !(key in object)) ||
    Object.keys(object).some((key) => !allowed.has(key))
  ) {
    throw new Error(`${label} contains missing or unknown fields.`);
  }
  return object;
}

function assertString(value, pattern, label) {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function assertPositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
  return value;
}

function parseJsonBytes(bytes, maximum, label) {
  if (!Buffer.isBuffer(bytes) || bytes.byteLength === 0) {
    throw new Error(`${label} bytes are required.`);
  }
  if (bytes.byteLength > maximum) {
    throw new Error(`${label} exceeds the byte limit.`);
  }
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`${label} must be valid JSON.`);
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function descriptor(bytes) {
  return {
    sha256: `sha256:${sha256(bytes)}`,
    bytes: bytes.byteLength,
  };
}

function parseHttpsUrl(value, label, requireTrailingSlash = false) {
  if (typeof value !== "string") throw new Error(`${label} is required.`);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute URL.`);
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    (requireTrailingSlash && !parsed.pathname.endsWith("/"))
  ) {
    throw new Error(`${label} must be a credential-free HTTPS URL.`);
  }
  return parsed.href;
}

function validateLocator(value) {
  const locator = assertKeys(
    value,
    ["version", "revision", "manifest", "bytes", "sha256"],
    [],
    "Corpus locator",
  );
  if (locator.version !== 2)
    throw new Error("Corpus locator version is invalid.");
  assertString(locator.revision, DIGEST, "Corpus locator revision");
  assertString(locator.sha256, RAW_DIGEST, "Corpus locator sha256");
  assertPositiveInteger(locator.bytes, "Corpus locator bytes");
  const pathMatch =
    typeof locator.manifest === "string"
      ? LOCATOR_PATH.exec(locator.manifest)
      : null;
  if (!pathMatch || `sha256:${pathMatch[1]}` !== locator.revision) {
    throw new Error("Corpus locator manifest path differs from its revision.");
  }
  return locator;
}

function validateManifest(value, expected) {
  const manifest = assertKeys(
    value,
    [
      "version",
      "defaultLocale",
      "locales",
      "documents",
      "provenance",
      "revision",
    ],
    ["openapi"],
    "Corpus manifest",
  );
  if (
    manifest.version !== 2 ||
    typeof manifest.defaultLocale !== "string" ||
    !Array.isArray(manifest.locales) ||
    !Array.isArray(manifest.documents) ||
    manifest.documents.length === 0
  ) {
    throw new Error("Corpus manifest shape is invalid.");
  }
  assertString(manifest.revision, DIGEST, "Corpus manifest revision");
  if (manifest.revision !== expected.revision) {
    throw new Error("Corpus manifest revision differs from the release.");
  }
  const provenance = assertKeys(
    manifest.provenance,
    ["repository", "commit", "dirty"],
    [],
    "Corpus provenance",
  );
  if (
    provenance.repository !== expected.repository ||
    provenance.commit !== expected.commit ||
    provenance.dirty !== false
  ) {
    throw new Error(
      "Corpus provenance repository or commit differs from the release.",
    );
  }
  return manifest;
}

function validateRemoteEvidence(remote, expected) {
  const value = assertKeys(
    remote,
    ["enabled", "serverStatus", "serverBytes"],
    ["endpoint", "readinessUrl", "readyBytes"],
    "Remote MCP evidence",
  );
  if (
    typeof value.enabled !== "boolean" ||
    !Buffer.isBuffer(value.serverBytes)
  ) {
    throw new Error("Remote MCP evidence is invalid.");
  }
  if (!value.enabled) {
    if (
      value.serverStatus !== 404 ||
      value.endpoint !== undefined ||
      value.readinessUrl !== undefined ||
      value.readyBytes !== undefined
    ) {
      throw new Error("Remote MCP discovery must be absent when disabled.");
    }
    return {
      discovery: { status: "absent", sha256: null },
      remoteMcp: {
        status: "disabled",
        endpoint: null,
        readinessUrl: null,
        buildRevision: null,
        corpusRevision: null,
        readinessSha256: null,
      },
      reason: "DisabledByPolicy",
    };
  }

  if (value.serverStatus !== 200) {
    throw new Error("Remote MCP discovery must be present when enabled.");
  }
  const endpoint = parseHttpsUrl(value.endpoint, "Remote MCP endpoint");
  const readinessUrl = parseHttpsUrl(
    value.readinessUrl,
    "Remote MCP readiness URL",
  );
  const metadata = parseJsonBytes(
    value.serverBytes,
    MAX_METADATA_BYTES,
    "Remote MCP discovery",
  );
  if (
    !Array.isArray(metadata.remotes) ||
    metadata.remotes.length !== 1 ||
    metadata.remotes[0]?.type !== "streamable-http" ||
    metadata.remotes[0]?.url !== endpoint
  ) {
    throw new Error("Remote MCP discovery differs from the expected endpoint.");
  }
  const ready = parseJsonBytes(
    value.readyBytes,
    MAX_METADATA_BYTES,
    "Remote MCP readiness",
  );
  if (
    ready.status !== "ready" ||
    ready.buildRevision !== expected.commit ||
    ready.corpus?.revision !== expected.revision ||
    !Number.isSafeInteger(ready.corpus?.documentCount) ||
    ready.corpus.documentCount <= 0
  ) {
    throw new Error("Remote MCP readiness differs from the release tuple.");
  }
  return {
    discovery: {
      status: "present",
      sha256: descriptor(value.serverBytes).sha256,
    },
    remoteMcp: {
      status: "ready",
      endpoint,
      readinessUrl,
      buildRevision: ready.buildRevision,
      corpusRevision: ready.corpus.revision,
      readinessSha256: descriptor(value.readyBytes).sha256,
    },
    reason: "Verified",
  };
}

function condition(type, reason) {
  return { type, status: "True", reason };
}

export function createReleaseCheckpoint(input) {
  const repository = parseHttpsUrl(input?.repository, "Repository URL").replace(
    /\/$/u,
    "",
  );
  const sourceCommit = assertString(
    input?.sourceCommit,
    COMMIT,
    "Source commit",
  );
  const runId = assertString(String(input?.runId), RUN_COORDINATE, "Run ID");
  const runAttempt = assertString(
    String(input?.runAttempt),
    RUN_COORDINATE,
    "Run attempt",
  );
  const expectedCorpusRevision = assertString(
    input?.expectedCorpusRevision,
    DIGEST,
    "Expected corpus revision",
  );
  const siteRoot = parseHttpsUrl(input?.siteRoot, "Site root", true);
  const locator = validateLocator(
    parseJsonBytes(input?.locatorBytes, MAX_LOCATOR_BYTES, "Corpus locator"),
  );
  if (locator.revision !== expectedCorpusRevision) {
    throw new Error("Corpus locator revision differs from the release.");
  }
  if (
    input.manifestBytes.byteLength !== locator.bytes ||
    sha256(input.manifestBytes) !== locator.sha256
  ) {
    throw new Error("Corpus manifest integrity differs from the locator.");
  }
  const manifest = validateManifest(
    parseJsonBytes(input.manifestBytes, MAX_MANIFEST_BYTES, "Corpus manifest"),
    { repository, commit: sourceCommit, revision: expectedCorpusRevision },
  );
  const remote = validateRemoteEvidence(input.remote, {
    commit: sourceCommit,
    revision: expectedCorpusRevision,
  });
  if (
    typeof input.observedAt !== "string" ||
    new Date(input.observedAt).toISOString() !== input.observedAt
  ) {
    throw new Error("Observation timestamp must be canonical ISO 8601.");
  }
  const locatorUrl = new URL("_mcp/v2/current.json", siteRoot).href;
  const manifestUrl = new URL(`_mcp/v2/${locator.manifest}`, siteRoot).href;
  const checkpoint = {
    schemaVersion: 1,
    kind: "sumi-docs.release-checkpoint",
    checkpoint: "CP7",
    status: "passed",
    subject: {
      repository,
      sourceCommit,
      workflow: "pages.yml",
      runId,
      runAttempt,
    },
    generation: { corpusRevision: expectedCorpusRevision },
    evidence: {
      pages: {
        siteRoot,
        locator: { url: locatorUrl, ...descriptor(input.locatorBytes) },
        manifest: {
          url: manifestUrl,
          ...descriptor(input.manifestBytes),
          documentCount: manifest.documents.length,
        },
        discovery: remote.discovery,
      },
      remoteMcp: remote.remoteMcp,
    },
    conditions: [
      condition("SourceProvenanceMatches", "Verified"),
      condition("CorpusIntegrityVerified", "Verified"),
      condition("PagesReadbackVerified", "Verified"),
      condition("RemoteMcpReadbackVerified", remote.reason),
    ],
    observedAt: input.observedAt,
  };
  return validateReleaseCheckpoint(checkpoint);
}

function validateDescriptor(value, label, extraKeys = []) {
  const descriptorValue = assertKeys(
    value,
    ["url", "sha256", "bytes", ...extraKeys],
    [],
    label,
  );
  parseHttpsUrl(descriptorValue.url, `${label} URL`);
  assertString(descriptorValue.sha256, DIGEST, `${label} sha256`);
  assertPositiveInteger(descriptorValue.bytes, `${label} bytes`);
  return descriptorValue;
}

export function validateReleaseCheckpoint(value, expected = {}) {
  const checkpoint = assertKeys(
    value,
    [
      "schemaVersion",
      "kind",
      "checkpoint",
      "status",
      "subject",
      "generation",
      "evidence",
      "conditions",
      "observedAt",
    ],
    [],
    "Release checkpoint",
  );
  if (
    checkpoint.schemaVersion !== 1 ||
    checkpoint.kind !== "sumi-docs.release-checkpoint" ||
    checkpoint.checkpoint !== "CP7" ||
    checkpoint.status !== "passed"
  ) {
    throw new Error("Release checkpoint identity or status is invalid.");
  }
  const subject = assertKeys(
    checkpoint.subject,
    ["repository", "sourceCommit", "workflow", "runId", "runAttempt"],
    [],
    "Checkpoint subject",
  );
  parseHttpsUrl(subject.repository, "Checkpoint repository");
  assertString(subject.sourceCommit, COMMIT, "Checkpoint source commit");
  assertString(subject.runId, RUN_COORDINATE, "Checkpoint run ID");
  assertString(subject.runAttempt, RUN_COORDINATE, "Checkpoint run attempt");
  if (subject.workflow !== "pages.yml") {
    throw new Error("Checkpoint workflow is invalid.");
  }
  const generation = assertKeys(
    checkpoint.generation,
    ["corpusRevision"],
    [],
    "Checkpoint generation",
  );
  assertString(generation.corpusRevision, DIGEST, "Checkpoint corpus revision");
  for (const [key, actual] of [
    ["repository", subject.repository],
    ["sourceCommit", subject.sourceCommit],
    ["runId", subject.runId],
    ["runAttempt", subject.runAttempt],
    ["corpusRevision", generation.corpusRevision],
  ]) {
    if (expected[key] !== undefined && expected[key] !== actual) {
      throw new Error(`Checkpoint ${key} differs from the expected subject.`);
    }
  }
  const evidence = assertKeys(
    checkpoint.evidence,
    ["pages", "remoteMcp"],
    [],
    "Checkpoint evidence",
  );
  const pages = assertKeys(
    evidence.pages,
    ["siteRoot", "locator", "manifest", "discovery"],
    [],
    "Pages evidence",
  );
  parseHttpsUrl(pages.siteRoot, "Pages site root", true);
  validateDescriptor(pages.locator, "Pages locator");
  const manifestDescriptor = validateDescriptor(
    pages.manifest,
    "Pages manifest",
    ["documentCount"],
  );
  assertPositiveInteger(
    manifestDescriptor.documentCount,
    "Pages manifest document count",
  );
  const discovery = assertKeys(
    pages.discovery,
    ["status", "sha256"],
    [],
    "Pages discovery evidence",
  );
  if (
    ![
      discovery.status === "absent" && discovery.sha256 === null,
      discovery.status === "present" && DIGEST.test(discovery.sha256),
    ].some(Boolean)
  ) {
    throw new Error("Pages discovery evidence is invalid.");
  }
  const remote = assertKeys(
    evidence.remoteMcp,
    [
      "status",
      "endpoint",
      "readinessUrl",
      "buildRevision",
      "corpusRevision",
      "readinessSha256",
    ],
    [],
    "Remote MCP checkpoint evidence",
  );
  if (remote.status === "disabled") {
    if (
      [
        remote.endpoint,
        remote.readinessUrl,
        remote.buildRevision,
        remote.corpusRevision,
        remote.readinessSha256,
      ].some((item) => item !== null) ||
      discovery.status !== "absent"
    ) {
      throw new Error("Disabled remote MCP evidence is inconsistent.");
    }
  } else if (remote.status === "ready") {
    parseHttpsUrl(remote.endpoint, "Remote MCP checkpoint endpoint");
    parseHttpsUrl(remote.readinessUrl, "Remote MCP checkpoint readiness URL");
    assertString(remote.buildRevision, COMMIT, "Remote MCP build revision");
    assertString(remote.corpusRevision, DIGEST, "Remote MCP corpus revision");
    assertString(remote.readinessSha256, DIGEST, "Remote MCP readiness digest");
    if (
      remote.buildRevision !== subject.sourceCommit ||
      remote.corpusRevision !== generation.corpusRevision ||
      discovery.status !== "present"
    ) {
      throw new Error(
        "Remote MCP checkpoint evidence differs from the subject.",
      );
    }
  } else {
    throw new Error("Remote MCP checkpoint status is invalid.");
  }
  if (
    !Array.isArray(checkpoint.conditions) ||
    checkpoint.conditions.length !== CONDITION_TYPES.length
  ) {
    throw new Error("Checkpoint conditions are incomplete.");
  }
  checkpoint.conditions.forEach((item, index) => {
    const checked = assertKeys(
      item,
      ["type", "status", "reason"],
      [],
      "Checkpoint condition",
    );
    if (
      checked.type !== CONDITION_TYPES[index] ||
      checked.status !== "True" ||
      typeof checked.reason !== "string" ||
      checked.reason === ""
    ) {
      throw new Error("Every checkpoint condition must be ordered and True.");
    }
  });
  if (
    typeof checkpoint.observedAt !== "string" ||
    new Date(checkpoint.observedAt).toISOString() !== checkpoint.observedAt
  ) {
    throw new Error("Checkpoint observation timestamp is invalid.");
  }
  return checkpoint;
}

async function readBoundedResponse(url, label, allowedStatuses, maximum) {
  let response;
  try {
    response = await fetch(url, {
      headers: { accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Error(`${label} request failed.`);
  }
  if (!allowedStatuses.includes(response.status)) {
    throw new Error(`${label} returned an unexpected status.`);
  }
  const chunks = [];
  let length = 0;
  if (response.body) {
    for await (const chunk of response.body) {
      length += chunk.byteLength;
      if (length > maximum) throw new Error(`${label} exceeds the byte limit.`);
      chunks.push(Buffer.from(chunk));
    }
  }
  return { status: response.status, bytes: Buffer.concat(chunks, length) };
}

export async function observeReleaseState(options) {
  const siteRoot = parseHttpsUrl(options.siteRoot, "Site root", true);
  const locatorResult = await readBoundedResponse(
    new URL("_mcp/v2/current.json", siteRoot),
    "Corpus locator",
    [200],
    MAX_LOCATOR_BYTES,
  );
  const locator = validateLocator(
    parseJsonBytes(locatorResult.bytes, MAX_LOCATOR_BYTES, "Corpus locator"),
  );
  const manifestResult = await readBoundedResponse(
    new URL(`_mcp/v2/${locator.manifest}`, siteRoot),
    "Corpus manifest",
    [200],
    MAX_MANIFEST_BYTES,
  );
  const serverResult = await readBoundedResponse(
    new URL("_mcp/server.json", siteRoot),
    "Remote MCP discovery",
    options.remoteEnabled ? [200] : [404],
    MAX_METADATA_BYTES,
  );
  let readyBytes;
  if (options.remoteEnabled) {
    readyBytes = (
      await readBoundedResponse(
        options.readinessUrl,
        "Remote MCP readiness",
        [200],
        MAX_METADATA_BYTES,
      )
    ).bytes;
  }
  return createReleaseCheckpoint({
    repository: options.repository,
    sourceCommit: options.sourceCommit,
    runId: options.runId,
    runAttempt: options.runAttempt,
    expectedCorpusRevision: options.expectedCorpusRevision,
    siteRoot,
    locatorBytes: locatorResult.bytes,
    manifestBytes: manifestResult.bytes,
    remote: {
      enabled: options.remoteEnabled,
      serverStatus: serverResult.status,
      serverBytes: serverResult.bytes,
      ...(options.remoteEnabled
        ? {
            endpoint: options.endpoint,
            readinessUrl: options.readinessUrl,
            readyBytes,
          }
        : {}),
    },
    observedAt: new Date().toISOString(),
  });
}

function parseOptions(arguments_) {
  const result = {};
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index];
    const value = arguments_[index + 1];
    if (
      !name?.startsWith("--") ||
      value === undefined ||
      value.startsWith("--")
    ) {
      throw new Error("Every option requires one value.");
    }
    const key = name.slice(2);
    if (key in result) throw new Error(`Duplicate option --${key}.`);
    result[key] = value;
  }
  return result;
}

function requireOptions(options, required, optional = []) {
  const allowed = new Set([...required, ...optional]);
  if (
    required.some((key) => !(key in options)) ||
    Object.keys(options).some((key) => !allowed.has(key))
  ) {
    throw new Error("Command contains missing or unknown options.");
  }
}

function writeExclusive(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const handle = openSync(path, "wx", 0o600);
  try {
    writeFileSync(handle, `${JSON.stringify(value, null, 2)}\n`);
    fsyncSync(handle);
  } finally {
    closeSync(handle);
  }
}

async function main() {
  const command = process.argv[2];
  const options = parseOptions(process.argv.slice(3));
  if (command === "observe") {
    const required = [
      "repository",
      "commit",
      "run-id",
      "run-attempt",
      "site-root",
      "corpus-revision",
      "remote-enabled",
      "output",
    ];
    const optional = ["mcp-url", "readiness-url"];
    requireOptions(options, required, optional);
    if (!["true", "false"].includes(options["remote-enabled"])) {
      throw new Error("remote-enabled must be true or false.");
    }
    const remoteEnabled = options["remote-enabled"] === "true";
    if (
      remoteEnabled !== Boolean(options["mcp-url"] && options["readiness-url"])
    ) {
      throw new Error("Remote MCP URLs must be present exactly when enabled.");
    }
    const checkpoint = await observeReleaseState({
      repository: options.repository,
      sourceCommit: options.commit,
      runId: options["run-id"],
      runAttempt: options["run-attempt"],
      siteRoot: options["site-root"],
      expectedCorpusRevision: options["corpus-revision"],
      remoteEnabled,
      endpoint: options["mcp-url"],
      readinessUrl: options["readiness-url"],
    });
    writeExclusive(options.output, checkpoint);
    process.stdout.write(
      `${JSON.stringify({ checkpoint: checkpoint.checkpoint, status: checkpoint.status, corpusRevision: checkpoint.generation.corpusRevision })}\n`,
    );
    return;
  }
  if (command === "verify") {
    requireOptions(
      options,
      [
        "input",
        "repository",
        "commit",
        "run-id",
        "run-attempt",
        "corpus-revision",
      ],
      [],
    );
    const checkpoint = validateReleaseCheckpoint(
      JSON.parse(readFileSync(options.input, "utf8")),
      {
        repository: options.repository,
        sourceCommit: options.commit,
        runId: options["run-id"],
        runAttempt: options["run-attempt"],
        corpusRevision: options["corpus-revision"],
      },
    );
    process.stdout.write(
      `${JSON.stringify({ checkpoint: checkpoint.checkpoint, status: checkpoint.status, corpusRevision: checkpoint.generation.corpusRevision })}\n`,
    );
    return;
  }
  throw new Error("Expected observe or verify command.");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Release checkpoint failed."}\n`,
    );
    process.exitCode = 1;
  });
}
