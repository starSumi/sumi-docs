import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const IMAGE_ID = /^sha256:[0-9a-f]{64}$/u;
const DIGEST_IMAGE =
  /^ghcr\.io\/[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?\/[a-z0-9](?:[a-z0-9._/-]*[a-z0-9])?@sha256:[0-9a-f]{64}$/u;
const JOB_RESULTS = new Set(["success", "failure", "cancelled", "skipped"]);
const PAGES_PHASES = new Set([
  "not-attempted",
  "success",
  "failure",
  "cancelled",
]);

function assertExactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw new Error(`${label} contains missing or unknown fields.`);
  }
}

function parseHttpsUrl(value, label) {
  if (typeof value !== "string") throw new Error(`${label} is required.`);
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute URL.`);
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(`${label} must be a credential-free HTTPS URL.`);
  }
  return url;
}

function parseCsv(value, label) {
  if (typeof value !== "string" || value.trim() !== value || value === "") {
    throw new Error(`${label} must be a non-empty comma-separated value.`);
  }
  const entries = value.split(",");
  if (
    entries.some((entry) => entry === "" || entry.trim() !== entry) ||
    new Set(entries).size !== entries.length
  ) {
    throw new Error(`${label} contains an empty, padded, or duplicate value.`);
  }
  return entries;
}

function parseRunCoordinate(value, label) {
  const text = String(value);
  if (!/^[1-9][0-9]*$/u.test(text)) {
    throw new Error(`${label} must be a positive decimal integer.`);
  }
  return text;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

export function createEvidenceEnvelope(kind, bytes, value) {
  if (!/^[a-z][a-z0-9-]*$/u.test(kind) || !Buffer.isBuffer(bytes)) {
    throw new Error("Validated evidence envelope input is invalid.");
  }
  return {
    schemaVersion: 1,
    kind,
    evidenceSha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    value: canonicalize(value),
  };
}

export function productionArtifactNames(runId, runAttempt) {
  const id = parseRunCoordinate(runId, "Run ID");
  const attempt = parseRunCoordinate(runAttempt, "Run attempt");
  const coordinate = `${id}-${attempt}`;
  return {
    pages: `github-pages-${coordinate}`,
    image: `mcp-image-${coordinate}`,
    record: `mcp-deployment-${coordinate}`,
    switch: `mcp-switch-${coordinate}`,
    switchObservation: `mcp-switch-observation-${coordinate}`,
    rollbackPages: `github-pages-rollback-${coordinate}`,
    checkpoint: `release-checkpoint-${coordinate}`,
  };
}

export function selectRecoveryArtifacts(value, runId, runAttempt) {
  if (!value || typeof value !== "object" || !Array.isArray(value.artifacts)) {
    throw new Error("Artifact inventory must contain an artifacts array.");
  }
  const names = productionArtifactNames(runId, runAttempt);
  const idsFor = (name) =>
    value.artifacts
      .filter(
        (artifact) => artifact?.name === name && artifact.expired === false,
      )
      .map((artifact) => artifact.id);
  const result = {
    names,
    recordIds: idsFor(names.record),
    switchIds: idsFor(names.switch),
    rollbackPagesIds: idsFor(names.rollbackPages),
  };
  for (const [label, ids] of Object.entries(result).slice(1)) {
    if (
      ids.length > 1 ||
      ids.some((id) => !Number.isSafeInteger(id) || id <= 0)
    ) {
      throw new Error(`${label} must identify at most one unexpired artifact.`);
    }
  }
  return result;
}

export function validatePriorDiscovery(value) {
  const liveStatus = Number(value?.liveStatus);
  const artifactStatus = Number(value?.artifactStatus);
  if (
    ![200, 404].includes(liveStatus) ||
    ![200, 404].includes(artifactStatus)
  ) {
    throw new Error("Prior discovery status must be 200 or 404.");
  }
  if (liveStatus !== artifactStatus) {
    throw new Error("Live and artifact discovery presence differs.");
  }
  if (liveStatus === 200) {
    if (
      !Buffer.isBuffer(value.liveBytes) ||
      !Buffer.isBuffer(value.artifactBytes) ||
      !value.liveBytes.equals(value.artifactBytes)
    ) {
      throw new Error("Live and artifact discovery bytes differ.");
    }
  } else if (value.liveBytes !== null || value.artifactBytes !== null) {
    throw new Error("Absent discovery must not carry bytes.");
  }
  return { status: liveStatus };
}

export function deriveAllowedOriginHosts(value) {
  const origins = parseCsv(value, "Allowed origins");
  if (origins.includes("*")) {
    throw new Error("Allowed origins must not contain a wildcard.");
  }
  const hosts = origins.map((origin) => {
    const parsed = parseHttpsUrl(origin, "Allowed origin");
    if (parsed.pathname !== "/") {
      throw new Error("Allowed origins must not contain a path.");
    }
    return parsed.hostname;
  });
  if (new Set(hosts).size !== hosts.length) {
    throw new Error(
      "Allowed origins collapse to duplicate CLI hostnames after normalization.",
    );
  }
  return hosts;
}

export function validateProductionEndpointConfiguration(value) {
  assertExactKeys(
    value,
    ["mcpUrl", "readinessUrl", "allowedHosts", "allowedOrigins"],
    "Production endpoint configuration",
  );
  const mcp = parseHttpsUrl(value.mcpUrl, "MCP URL");
  const readiness = parseHttpsUrl(value.readinessUrl, "Readiness URL");
  if (mcp.origin !== readiness.origin) {
    throw new Error("MCP and readiness URLs must use the same origin.");
  }
  if (mcp.pathname === "/" || readiness.pathname === "/") {
    throw new Error("MCP and readiness URLs must use explicit paths.");
  }
  if (mcp.pathname === readiness.pathname) {
    throw new Error("MCP and readiness URLs must use different paths.");
  }

  const hosts = parseCsv(value.allowedHosts, "Allowed hosts");
  if (
    !hosts.includes(mcp.hostname) ||
    !hosts.includes("localhost") ||
    !hosts.includes("127.0.0.1") ||
    hosts.some(
      (host) =>
        host === "*" ||
        !/^(?:[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?|127\.0\.0\.1)$/u.test(host),
    )
  ) {
    throw new Error(
      "Allowed hosts must include the public host and both loopback names.",
    );
  }

  const origins = parseCsv(value.allowedOrigins, "Allowed origins");
  deriveAllowedOriginHosts(value.allowedOrigins);
  const normalizedOrigins = origins.map(
    (origin) => parseHttpsUrl(origin, "Allowed origin").origin,
  );
  if (!normalizedOrigins.includes(mcp.origin)) {
    throw new Error("Allowed origins must include the public MCP origin.");
  }
  return value;
}

export function validateDeploymentRecord(value) {
  assertExactKeys(
    value,
    [
      "schemaVersion",
      "repository",
      "commit",
      "corpusRevision",
      "image",
      "imageId",
    ],
    "Deployment record",
  );
  if (value.schemaVersion !== 1) {
    throw new Error("Deployment record schemaVersion must be 1.");
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(value.repository)) {
    throw new Error("Deployment record repository is invalid.");
  }
  if (!COMMIT.test(value.commit)) {
    throw new Error("Deployment record commit must be a full Git SHA.");
  }
  if (!SHA256.test(value.corpusRevision)) {
    throw new Error("Deployment record corpus revision is invalid.");
  }
  if (!DIGEST_IMAGE.test(value.image)) {
    throw new Error("Deployment record image must be a GHCR digest reference.");
  }
  if (!IMAGE_ID.test(value.imageId)) {
    throw new Error("Deployment record image ID is invalid.");
  }
  return value;
}

export function validateExpectedDeploymentRecord(value, expected) {
  const record = validateDeploymentRecord(value);
  assertExactKeys(
    expected,
    ["repository", "commit", "corpusRevision", "image", "imageId"],
    "Expected deployment record",
  );
  for (const field of [
    "repository",
    "commit",
    "corpusRevision",
    "image",
    "imageId",
  ]) {
    if (record[field] !== expected[field]) {
      throw new Error(`Deployment record ${field} differs from the release.`);
    }
  }
  return record;
}

export function validatePriorSiteManifest(
  locatorBytes,
  manifestBytes,
  expected,
) {
  assertExactKeys(expected, ["repository"], "Expected prior site");
  const locator = JSON.parse(locatorBytes.toString("utf8"));
  assertExactKeys(
    locator,
    ["version", "revision", "manifest", "bytes", "sha256"],
    "Prior site locator",
  );
  if (
    locator.version !== 2 ||
    !SHA256.test(locator.revision) ||
    locator.manifest !==
      `snapshots/${locator.revision.slice("sha256:".length)}/manifest.json` ||
    !Number.isSafeInteger(locator.bytes) ||
    locator.bytes <= 0 ||
    !/^[0-9a-f]{64}$/u.test(locator.sha256)
  ) {
    throw new Error("Prior site locator is invalid.");
  }
  if (
    manifestBytes.byteLength !== locator.bytes ||
    createHash("sha256").update(manifestBytes).digest("hex") !== locator.sha256
  ) {
    throw new Error("Prior site manifest integrity differs from its locator.");
  }

  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  if (
    manifest?.version !== 2 ||
    manifest?.revision !== locator.revision ||
    manifest?.provenance?.repository !== expected.repository ||
    !COMMIT.test(manifest?.provenance?.commit ?? "") ||
    manifest?.provenance?.dirty !== false
  ) {
    throw new Error(
      "Prior site manifest is not bound to clean repository provenance.",
    );
  }
  return { commit: manifest.provenance.commit, manifest: locator.manifest };
}

export function validateReadyEvidence(value, expected) {
  if (!COMMIT.test(expected?.commit ?? "")) {
    throw new Error("Expected build revision must be a full Git SHA.");
  }
  if (!SHA256.test(expected?.corpusRevision ?? "")) {
    throw new Error("Expected corpus revision is invalid.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Readiness evidence must be an object.");
  }
  if (value.status !== "ready") {
    throw new Error("Readiness status is not ready.");
  }
  if (value.buildRevision !== expected.commit) {
    throw new Error("Readiness build revision differs from the deployment.");
  }
  if (
    !value.corpus ||
    typeof value.corpus !== "object" ||
    Array.isArray(value.corpus) ||
    !Number.isInteger(value.corpus.documentCount) ||
    value.corpus.documentCount <= 0
  ) {
    throw new Error("Readiness corpus evidence is missing or empty.");
  }
  if (value.corpus.revision !== expected.corpusRevision) {
    throw new Error("Readiness corpus revision differs from the deployment.");
  }
  return value;
}

export function validateSwitchRecord(value, expected) {
  assertExactKeys(
    value,
    [
      "schemaVersion",
      "changed",
      "token",
      "newImage",
      "newImageId",
      "oldImage",
      "oldImageId",
    ],
    "Switch record",
  );
  assertExactKeys(
    expected,
    ["commit", "image", "imageId"],
    "Expected switch record",
  );
  if (!COMMIT.test(expected.commit)) {
    throw new Error("Expected switch commit must be a full Git SHA.");
  }
  if (!DIGEST_IMAGE.test(expected.image) || !IMAGE_ID.test(expected.imageId)) {
    throw new Error("Expected switch image identity is invalid.");
  }
  if (
    value.schemaVersion !== 1 ||
    typeof value.changed !== "boolean" ||
    value.token !== expected.commit.slice(0, 12) ||
    value.newImage !== expected.image ||
    value.newImageId !== expected.imageId
  ) {
    throw new Error("Switch record differs from the verified deployment.");
  }
  if (value.changed === false) {
    if (value.oldImage !== null || value.oldImageId !== null) {
      throw new Error("An idempotent switch must not claim rollback state.");
    }
    return value;
  }
  const hasOldImage = value.oldImage !== null;
  const hasOldImageId = value.oldImageId !== null;
  if (hasOldImage !== hasOldImageId) {
    throw new Error("Switch rollback image identity must be complete.");
  }
  if (
    (hasOldImage && !DIGEST_IMAGE.test(value.oldImage)) ||
    (hasOldImageId && !IMAGE_ID.test(value.oldImageId))
  ) {
    throw new Error("Switch rollback image identity is invalid.");
  }
  return value;
}

export function validateSwitchObservation(value, expected) {
  assertExactKeys(
    value,
    ["schemaVersion", "state", "priorState", "rollbackRequired", "switch"],
    "Switch observation",
  );
  if (
    value.schemaVersion !== 1 ||
    ![
      "absent",
      "prepared",
      "changed",
      "idempotent",
      "committed",
      "rolled-back",
    ].includes(value.state) ||
    !["absent", "present"].includes(value.priorState) ||
    typeof value.rollbackRequired !== "boolean"
  ) {
    throw new Error("Switch observation schema is invalid.");
  }
  if (value.state === "committed" || value.state === "rolled-back") {
    if (value.switch !== null || value.rollbackRequired !== false) {
      throw new Error(
        "A terminal switch observation must not request rollback.",
      );
    }
    return value;
  }
  if (value.state === "absent" || value.state === "prepared") {
    if (
      value.switch !== null ||
      value.rollbackRequired !== (value.state === "prepared") ||
      (value.state === "absent" && value.priorState !== "absent")
    ) {
      throw new Error(
        "An absent or prepared switch observation has inconsistent evidence.",
      );
    }
    return value;
  }
  const record = validateSwitchRecord(value.switch, expected);
  if (
    (value.state === "changed" && record.changed !== true) ||
    (value.state === "idempotent" && record.changed !== false) ||
    value.rollbackRequired !== (value.state === "changed") ||
    (value.state === "idempotent" && value.priorState !== "absent") ||
    (value.state === "changed" &&
      value.priorState !== (record.oldImage === null ? "absent" : "present"))
  ) {
    throw new Error("Switch observation state differs from its switch record.");
  }
  return value;
}

export function classifyPagesPhaseEvidence(value) {
  assertExactKeys(
    value,
    ["jobConclusion", "stepConclusion"],
    "Pages phase evidence",
  );
  const { jobConclusion, stepConclusion } = value;
  if (!JOB_RESULTS.has(jobConclusion)) {
    throw new Error("Pages phase evidence has an unknown job conclusion.");
  }
  if (
    (jobConclusion === "skipped" &&
      (stepConclusion === null || stepConclusion === "skipped")) ||
    (jobConclusion === "cancelled" && stepConclusion === "skipped")
  ) {
    return "not-attempted";
  }
  if (
    (stepConclusion === "success" && jobConclusion === "success") ||
    (stepConclusion === "failure" && jobConclusion === "failure") ||
    (stepConclusion === "cancelled" && jobConclusion === "cancelled")
  ) {
    return stepConclusion;
  }
  throw new Error(
    "Pages phase evidence does not prove whether the deploy action ran.",
  );
}

export function extractPagesPhaseEvidence(value, expected) {
  assertExactKeys(expected, ["jobName", "stepName"], "Expected Pages phase");
  if (!value || typeof value !== "object" || !Array.isArray(value.jobs)) {
    throw new Error("Pages jobs evidence must contain a jobs array.");
  }
  const jobs = value.jobs.filter((job) => job?.name === expected.jobName);
  if (jobs.length !== 1) {
    throw new Error("Pages jobs evidence must contain exactly one deploy job.");
  }
  const job = jobs[0];
  const steps = Array.isArray(job.steps)
    ? job.steps.filter((step) => step?.name === expected.stepName)
    : [];
  if (steps.length > 1) {
    throw new Error("Pages jobs evidence contains duplicate deploy steps.");
  }
  return classifyPagesPhaseEvidence({
    jobConclusion: job.conclusion,
    stepConclusion: steps.length === 1 ? steps[0].conclusion : null,
  });
}

export function validateRollbackRecord(value) {
  assertExactKeys(
    value,
    [
      "schemaVersion",
      "restored",
      "image",
      "imageId",
      "buildRevision",
      "corpusRevision",
    ],
    "Rollback record",
  );
  if (value.schemaVersion !== 1 || typeof value.restored !== "boolean") {
    throw new Error("Rollback record schema is invalid.");
  }
  const tuple = [
    value.image,
    value.imageId,
    value.buildRevision,
    value.corpusRevision,
  ];
  if (value.restored === false) {
    if (tuple.some((entry) => entry !== null)) {
      throw new Error("Absent rollback state must not claim a restored tuple.");
    }
    return value;
  }
  if (
    !DIGEST_IMAGE.test(value.image) ||
    !IMAGE_ID.test(value.imageId) ||
    !COMMIT.test(value.buildRevision) ||
    !SHA256.test(value.corpusRevision)
  ) {
    throw new Error("Restored rollback tuple is invalid.");
  }
  return value;
}

export function decideProductionCompensation(value) {
  assertExactKeys(
    value,
    [
      "remoteEnabled",
      "mcpRollbackPending",
      "pagesPhase",
      "finalAcceptance",
      "finalizeMcp",
    ],
    "Production compensation state",
  );
  if (
    typeof value.remoteEnabled !== "boolean" ||
    typeof value.mcpRollbackPending !== "boolean" ||
    !PAGES_PHASES.has(value.pagesPhase) ||
    !JOB_RESULTS.has(value.finalAcceptance) ||
    !JOB_RESULTS.has(value.finalizeMcp)
  ) {
    throw new Error("Production compensation state is invalid.");
  }

  if (value.remoteEnabled) {
    const pagesWasAttempted = value.pagesPhase !== "not-attempted";
    const accepted =
      value.pagesPhase === "success" &&
      value.finalAcceptance === "success" &&
      value.finalizeMcp === "success";
    const restorePages = pagesWasAttempted && !accepted;
    return {
      restorePages,
      mcpRollbackRequired: value.mcpRollbackPending && !accepted,
    };
  }

  const pagesWasAttempted = value.pagesPhase !== "not-attempted";
  const restorePages =
    pagesWasAttempted &&
    (value.pagesPhase !== "success" || value.finalAcceptance !== "success");
  return { restorePages, mcpRollbackRequired: false };
}

export function mayRollbackMcp(plan, pagesCompensationResult) {
  assertExactKeys(
    plan,
    ["restorePages", "mcpRollbackRequired"],
    "Production compensation plan",
  );
  if (
    typeof plan.restorePages !== "boolean" ||
    typeof plan.mcpRollbackRequired !== "boolean" ||
    !JOB_RESULTS.has(pagesCompensationResult)
  ) {
    throw new Error("Production compensation result is invalid.");
  }
  if (!plan.mcpRollbackRequired) return false;
  return plan.restorePages
    ? pagesCompensationResult === "success"
    : pagesCompensationResult === "skipped";
}

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? undefined : process.argv[index + 1];
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function booleanOption(name) {
  const value = option(name);
  if (value !== "true" && value !== "false") {
    throw new Error(`${name} must be true or false.`);
  }
  return value === "true";
}

function readJsonEvidence(path, label) {
  if (!path) throw new Error(`${label} path is required.`);
  const bytes = readFileSync(path);
  try {
    return { bytes, value: JSON.parse(bytes.toString("utf8")) };
  } catch (error) {
    throw new Error(`${label} is not valid JSON.`, { cause: error });
  }
}

function readJson(path, label) {
  return readJsonEvidence(path, label).value;
}

function reportValidatedEvidence(kind, evidence, value, message) {
  if (hasFlag("json")) {
    process.stdout.write(
      `${JSON.stringify(createEvidenceEnvelope(kind, evidence.bytes, value))}\n`,
    );
  } else {
    process.stdout.write(`${message}\n`);
  }
}

function main() {
  const command = process.argv[2];
  if (command === "config") {
    validateProductionEndpointConfiguration({
      mcpUrl: process.env.DEPLOY_PUBLIC_MCP_URL,
      readinessUrl: process.env.DEPLOY_PUBLIC_MCP_READINESS_URL,
      allowedHosts: process.env.DEPLOY_ALLOWED_HOSTS,
      allowedOrigins: process.env.DEPLOY_ALLOWED_ORIGINS,
    });
    process.stdout.write("Verified production endpoint configuration.\n");
    return;
  }
  if (command === "origin-hosts") {
    process.stdout.write(
      `${deriveAllowedOriginHosts(option("origins")).join(",")}\n`,
    );
    return;
  }
  if (command === "artifact-names") {
    process.stdout.write(
      `${JSON.stringify(productionArtifactNames(option("run-id"), option("run-attempt")))}\n`,
    );
    return;
  }
  if (command === "artifact-inventory") {
    process.stdout.write(
      `${JSON.stringify(selectRecoveryArtifacts(readJson(option("input")), option("run-id"), option("run-attempt")))}\n`,
    );
    return;
  }
  if (command === "prior-discovery") {
    const liveStatus = Number(option("live-status"));
    const artifactStatus = Number(option("artifact-status"));
    validatePriorDiscovery({
      liveStatus,
      artifactStatus,
      liveBytes: liveStatus === 200 ? readFileSync(option("live")) : null,
      artifactBytes:
        artifactStatus === 200 ? readFileSync(option("artifact")) : null,
    });
    return;
  }
  if (command === "record") {
    const evidence = readJsonEvidence(option("input"), "Deployment record");
    const record = validateDeploymentRecord(evidence.value);
    const expectedFields = {
      repository: option("repository"),
      commit: option("commit"),
      corpusRevision: option("corpus-revision"),
      image: option("image"),
      imageId: option("image-id"),
    };
    for (const [field, expected] of Object.entries(expectedFields)) {
      if (expected !== undefined && record[field] !== expected) {
        throw new Error(`Deployment record ${field} differs from the release.`);
      }
    }
    reportValidatedEvidence(
      "deployment-record",
      evidence,
      record,
      "Verified digest-bound image-ID deployment record.",
    );
    return;
  }
  if (command === "prior-manifest") {
    const result = validatePriorSiteManifest(
      readFileSync(option("locator")),
      readFileSync(option("manifest")),
      { repository: option("repository") },
    );
    process.stdout.write(`${result.commit}\n`);
    return;
  }
  if (command === "ready") {
    validateReadyEvidence(readJson(option("input"), "Readiness evidence"), {
      commit: option("commit"),
      corpusRevision: option("corpus-revision"),
    });
    process.stdout.write("Verified build and corpus readiness evidence.\n");
    return;
  }
  if (command === "switch") {
    const evidence = readJsonEvidence(option("input"), "Switch record");
    const record = validateSwitchRecord(evidence.value, {
      commit: option("commit"),
      image: option("image"),
      imageId: option("image-id"),
    });
    reportValidatedEvidence(
      "switch-record",
      evidence,
      record,
      "Verified deployment switch evidence.",
    );
    return;
  }
  if (command === "switch-observation") {
    const evidence = readJsonEvidence(option("input"), "Switch observation");
    const observation = validateSwitchObservation(evidence.value, {
      commit: option("commit"),
      image: option("image"),
      imageId: option("image-id"),
    });
    reportValidatedEvidence(
      "switch-observation",
      evidence,
      observation,
      "Verified durable deployment switch observation.",
    );
    return;
  }
  if (command === "pages-phase") {
    const phase = extractPagesPhaseEvidence(
      readJson(option("input"), "Pages jobs evidence"),
      { jobName: option("job-name"), stepName: option("step-name") },
    );
    process.stdout.write(`${phase}\n`);
    return;
  }
  if (command === "rollback") {
    const evidence = readJsonEvidence(option("input"), "Rollback record");
    const record = validateRollbackRecord(evidence.value);
    reportValidatedEvidence(
      "rollback-record",
      evidence,
      record,
      "Verified restored deployment tuple.",
    );
    return;
  }
  if (command === "compensation-plan") {
    const plan = decideProductionCompensation({
      remoteEnabled: booleanOption("remote-enabled"),
      mcpRollbackPending: booleanOption("mcp-rollback-pending"),
      pagesPhase: option("pages-phase"),
      finalAcceptance: option("final-acceptance"),
      finalizeMcp: option("finalize-mcp"),
    });
    process.stdout.write(`${JSON.stringify(plan)}\n`);
    return;
  }
  if (command === "create-record") {
    const locator = readJson(option("locator"), "Corpus locator");
    const record = validateDeploymentRecord({
      schemaVersion: 1,
      repository: option("repository"),
      commit: option("commit"),
      corpusRevision: locator.revision,
      image: option("image"),
      imageId: option("image-id"),
    });
    const output = option("output");
    if (!output) throw new Error("Deployment record output path is required.");
    writeFileSync(output, `${JSON.stringify(record, null, 2)}\n`, {
      mode: 0o600,
    });
    process.stdout.write("Created digest-bound image-ID deployment record.\n");
    return;
  }
  throw new Error(
    "Expected config, origin-hosts, artifact-names, artifact-inventory, prior-discovery, record, prior-manifest, ready, switch, switch-observation, pages-phase, rollback, compensation-plan, or create-record command.",
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
