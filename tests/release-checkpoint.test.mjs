import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { parse } from "yaml";

import {
  createReleaseCheckpoint,
  validateReleaseCheckpoint,
} from "../scripts/release-checkpoint.mjs";

const repository = "https://github.com/starSumi/sumi-docs";
const sourceCommit = "a".repeat(40);
const corpusRevision = `sha256:${"b".repeat(64)}`;

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function fixture(overrides = {}) {
  const manifest = {
    version: 2,
    defaultLocale: "en",
    locales: ["en"],
    documents: [{ path: "index.md" }],
    provenance: {
      repository,
      commit: sourceCommit,
      dirty: false,
    },
    revision: corpusRevision,
  };
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  const locator = {
    version: 2,
    revision: corpusRevision,
    manifest: `snapshots/${corpusRevision.slice(7)}/manifest.json`,
    bytes: manifestBytes.byteLength,
    sha256: digest(manifestBytes),
  };
  const locatorBytes = Buffer.from(JSON.stringify(locator));
  return {
    repository,
    sourceCommit,
    runId: "700",
    runAttempt: "2",
    expectedCorpusRevision: corpusRevision,
    siteRoot: "https://starsumi.github.io/sumi-docs/",
    locatorBytes,
    manifestBytes,
    remote: {
      enabled: false,
      serverStatus: 404,
      serverBytes: Buffer.alloc(0),
    },
    observedAt: "2026-08-19T12:00:00.000Z",
    ...overrides,
  };
}

test("CP7 checkpoint binds source, run attempt, and exact corpus bytes", () => {
  const input = fixture();
  const checkpoint = createReleaseCheckpoint(input);

  assert.deepEqual(validateReleaseCheckpoint(checkpoint), checkpoint);
  assert.equal(checkpoint.status, "passed");
  assert.equal(checkpoint.subject.sourceCommit, sourceCommit);
  assert.equal(checkpoint.subject.runId, "700");
  assert.equal(checkpoint.subject.runAttempt, "2");
  assert.equal(checkpoint.generation.corpusRevision, corpusRevision);
  assert.equal(
    checkpoint.evidence.pages.locator.sha256,
    `sha256:${digest(input.locatorBytes)}`,
  );
  assert.equal(
    checkpoint.evidence.pages.manifest.sha256,
    `sha256:${digest(input.manifestBytes)}`,
  );
  assert.equal(checkpoint.evidence.remoteMcp.status, "disabled");
  assert.ok(
    checkpoint.conditions.every((condition) => condition.status === "True"),
  );
});

test("checkpoint creation fails closed on drift and incomplete evidence", () => {
  const base = fixture();
  const manifest = JSON.parse(base.manifestBytes.toString("utf8"));

  assert.throws(
    () =>
      createReleaseCheckpoint({
        ...base,
        expectedCorpusRevision: `sha256:${"c".repeat(64)}`,
      }),
    /revision/u,
  );
  assert.throws(
    () =>
      createReleaseCheckpoint({
        ...base,
        manifestBytes: Buffer.from(
          JSON.stringify({
            ...manifest,
            provenance: { ...manifest.provenance, commit: "d".repeat(40) },
          }),
        ),
      }),
    /integrity|commit/u,
  );
  assert.throws(
    () =>
      createReleaseCheckpoint({
        ...base,
        remote: { ...base.remote, serverStatus: 200 },
      }),
    /discovery/u,
  );
});

test("validated checkpoints reject unknown fields and non-True conditions", () => {
  const checkpoint = createReleaseCheckpoint(fixture());
  assert.throws(
    () => validateReleaseCheckpoint({ ...checkpoint, cursor: "mutable" }),
    /unknown|fields/u,
  );
  assert.throws(
    () =>
      validateReleaseCheckpoint({
        ...checkpoint,
        conditions: checkpoint.conditions.map((condition, index) =>
          index === 0 ? { ...condition, status: "Unknown" } : condition,
        ),
      }),
    /True/u,
  );
});

test("remote MCP evidence is bound to discovery and readiness bytes", () => {
  const endpoint = "https://mcp.example.com/mcp";
  const readinessUrl = "https://mcp.example.com/readyz";
  const serverBytes = Buffer.from(
    JSON.stringify({ remotes: [{ type: "streamable-http", url: endpoint }] }),
  );
  const readyBytes = Buffer.from(
    JSON.stringify({
      status: "ready",
      buildRevision: sourceCommit,
      corpus: { documentCount: 1, revision: corpusRevision },
    }),
  );
  const checkpoint = createReleaseCheckpoint(
    fixture({
      remote: {
        enabled: true,
        serverStatus: 200,
        serverBytes,
        endpoint,
        readinessUrl,
        readyBytes,
      },
    }),
  );

  assert.equal(checkpoint.evidence.remoteMcp.status, "ready");
  assert.equal(checkpoint.evidence.remoteMcp.endpoint, endpoint);
  assert.equal(
    checkpoint.evidence.remoteMcp.readinessSha256,
    `sha256:${digest(readyBytes)}`,
  );
  assert.throws(() =>
    createReleaseCheckpoint(
      fixture({
        remote: {
          enabled: true,
          serverStatus: 200,
          serverBytes,
          endpoint,
          readinessUrl,
          readyBytes: Buffer.from(
            JSON.stringify({
              status: "ready",
              buildRevision: "e".repeat(40),
              corpus: { documentCount: 1, revision: corpusRevision },
            }),
          ),
        },
      }),
    ),
  );
});

test("production seals a run-scoped checkpoint only after public acceptance", () => {
  const workflow = parse(readFileSync(".github/workflows/pages.yml", "utf8"));
  const job = workflow.jobs["release-checkpoint"];
  assert.deepEqual(job.needs, ["build", "final-acceptance", "finalize-mcp"]);
  assert.match(String(job.if), /final-acceptance\.result == 'success'/u);
  assert.match(String(job.if), /finalize-mcp\.result == 'success'/u);

  const observe = job.steps.find(
    (step) => step.name === "Observe and seal the public release tuple",
  );
  assert.match(observe.run, /release-checkpoint\.mjs/u);
  assert.match(observe.run, /GITHUB_RUN_ID/u);
  assert.match(observe.run, /GITHUB_RUN_ATTEMPT/u);
  assert.match(observe.run, /CORPUS_REVISION/u);

  const upload = job.steps.find(
    (step) => step.name === "Upload immutable release checkpoint",
  );
  assert.equal(
    upload.with.name,
    "release-checkpoint-${{ github.run_id }}-${{ github.run_attempt }}",
  );
  assert.equal(
    upload.with.path,
    "artifacts/checkpoint/release-checkpoint.json",
  );
});
