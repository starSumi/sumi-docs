import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  COLD_START_POLICY,
  createBlockedSchedule,
  createColdStartReport,
  digestSchedule,
  evaluateColdStartPolicy,
  sanitizeBenchmarkDiagnostic,
  summarizeMeasurements,
  validateToolsListResponse,
} from "../../scripts/cold-start-policy.mjs";
import {
  HARD_KILL_AFTER_MS,
  MAX_STDOUT_BYTES,
  TIMEOUT_MS,
  measureOnce,
} from "../../scripts/cold-start-measurement.mjs";

test("cold-start summary uses an averaged median and nearest-rank tails", () => {
  const outcomes = Array.from({ length: 100 }, (_, index) => ({
    status: "ok" as const,
    elapsedMs: index + 1,
  }));
  outcomes.push(
    { status: "error" as const, message: "bad response" },
    { status: "timeout" as const, message: "timed out" },
  );

  assert.deepEqual(summarizeMeasurements(outcomes), {
    attempted: 102,
    samples: 100,
    medianMs: 50.5,
    p95Ms: 95,
    p99Ms: 99,
    maxMs: 100,
    errors: 1,
    timeouts: 1,
    unknownStatuses: 0,
    measurementsMs: Array.from({ length: 100 }, (_, index) => index + 1),
    errorDetails: ["bad response"],
    timeoutDetails: ["timed out"],
    unknownStatusDetails: [],
  });
});

test("cold-start policy accepts every threshold at its inclusive boundary", () => {
  const evaluation = evaluateColdStartPolicy({
    raw: metrics({ medianMs: 70, p95Ms: 90 }),
    sdkEmpty: metrics({ medianMs: 150, p95Ms: 250 }),
    product: metrics({ medianMs: 185, p95Ms: 325 }),
  });

  assert.equal(evaluation.passed, true);
  assert.deepEqual(evaluation.thresholds, COLD_START_POLICY);
  assert.deepEqual(evaluation.comparison, {
    medianDeltaMs: 35,
    medianRatio: 1.2333,
    p95DeltaMs: 75,
  });
  assert.deepEqual(evaluation.checks, {
    errorsZero: true,
    timeoutsZero: true,
    productMedian: true,
    productP95: true,
    medianDelta: true,
    medianRatio: true,
    p95Delta: true,
  });
});

test("cold-start policy rejects each blocking condition independently", () => {
  const cases = [
    {
      name: "errors",
      raw: metrics({ medianMs: 70, p95Ms: 90, errors: 1 }),
      sdkEmpty: metrics({ medianMs: 150, p95Ms: 250 }),
      product: metrics({ medianMs: 180, p95Ms: 300 }),
      check: "errorsZero",
    },
    {
      name: "timeouts",
      raw: metrics({ medianMs: 70, p95Ms: 90 }),
      sdkEmpty: metrics({ medianMs: 150, p95Ms: 250, timeouts: 1 }),
      product: metrics({ medianMs: 180, p95Ms: 300 }),
      check: "timeoutsZero",
    },
    {
      name: "product median",
      raw: metrics({ medianMs: 70, p95Ms: 90 }),
      sdkEmpty: metrics({ medianMs: 180, p95Ms: 300 }),
      product: metrics({ medianMs: 200.01, p95Ms: 340 }),
      check: "productMedian",
    },
    {
      name: "product p95",
      raw: metrics({ medianMs: 70, p95Ms: 90 }),
      sdkEmpty: metrics({ medianMs: 180, p95Ms: 300 }),
      product: metrics({ medianMs: 190, p95Ms: 350.01 }),
      check: "productP95",
    },
    {
      name: "median delta",
      raw: metrics({ medianMs: 70, p95Ms: 90 }),
      sdkEmpty: metrics({ medianMs: 150, p95Ms: 250 }),
      product: metrics({ medianMs: 185.01, p95Ms: 300 }),
      check: "medianDelta",
    },
    {
      name: "median ratio",
      raw: metrics({ medianMs: 70, p95Ms: 90 }),
      sdkEmpty: metrics({ medianMs: 100, p95Ms: 250 }),
      product: metrics({ medianMs: 130.01, p95Ms: 300 }),
      check: "medianRatio",
    },
    {
      name: "p95 delta",
      raw: metrics({ medianMs: 70, p95Ms: 90 }),
      sdkEmpty: metrics({ medianMs: 150, p95Ms: 250 }),
      product: metrics({ medianMs: 180, p95Ms: 325.01 }),
      check: "p95Delta",
    },
  ] as const;

  for (const current of cases) {
    const evaluation = evaluateColdStartPolicy(current);
    assert.equal(evaluation.passed, false, current.name);
    assert.equal(evaluation.checks[current.check], false, current.name);
  }
});

test("a one-sample ad-hoc report cannot become release eligible", () => {
  const report = createColdStartReport({
    generatedAt: "2026-08-19T00:00:00.000Z",
    environment: {
      runtime: "v25.5.0",
      platform: "win32",
      architecture: "x64",
    },
    method: {
      iterationsPerSubject: 1,
      totalAttempts: 3,
      timeoutMs: 5_000,
      schedule: "seeded-randomized-subject-blocks",
      scheduleOrder: ["raw", "sdkEmpty", "product"],
      scheduleSha256: digestSchedule(["raw", "sdkEmpty", "product"]),
      seed: 42,
      customBaselines: false,
    },
    subjectDefinitions: trustedDefinitions(),
    outcomes: {
      raw: [{ status: "ok", elapsedMs: 70 }],
      sdkEmpty: [{ status: "ok", elapsedMs: 150 }],
      product: [{ status: "ok", elapsedMs: 180 }],
    },
  });

  assert.equal(report.schemaVersion, 2);
  assert.equal(report.method.schedule, "seeded-randomized-subject-blocks");
  assert.equal(report.subjects.raw.role, "measurement-baseline-only");
  assert.equal(report.subjects.raw.isProductProtocolImplementation, false);
  assert.equal(report.subjects.sdkEmpty.usesOfficialSdkPublicApi, true);
  assert.equal(report.performancePolicy.passed, true);
  assert.equal(report.releaseEligibility.eligible, false);
  assert.equal(report.releaseEligibility.classification, "ad-hoc-ineligible");
  assert.equal(report.policy.passed, false);
});

test("release eligibility rejects Linux, custom SDK, unknown outcomes, and old Node", () => {
  const base = releaseInput();
  assert.equal(createColdStartReport(base).releaseEligibility.eligible, true);

  const cases = [
    {
      name: "linux",
      input: {
        ...base,
        environment: { ...base.environment, platform: "linux" },
      },
      check: "windowsX64",
    },
    {
      name: "custom SDK",
      input: {
        ...base,
        method: { ...base.method, customBaselines: true },
        subjectDefinitions: {
          ...base.subjectDefinitions,
          sdkEmpty: {
            ...base.subjectDefinitions.sdkEmpty,
            isRepositoryDefaultBaseline: false,
            isTrustedBaseline: false,
            usesOfficialSdkPublicApi: false,
          },
        },
      },
      check: "repositoryDefaultBaselines",
    },
    {
      name: "unknown outcome",
      input: {
        ...base,
        outcomes: {
          ...base.outcomes,
          raw: [...base.outcomes.raw.slice(0, 99), { status: "mystery" }],
        },
      },
      check: "knownOutcomeStatuses",
    },
    {
      name: "old Node",
      input: {
        ...base,
        environment: { ...base.environment, runtime: "v25.4.9" },
      },
      check: "minimumNodeRuntime",
    },
    {
      name: "untrusted SDK provenance",
      input: {
        ...base,
        subjectDefinitions: {
          ...base.subjectDefinitions,
          sdkEmpty: {
            ...base.subjectDefinitions.sdkEmpty,
            sdkPackage: {
              ...base.subjectDefinitions.sdkEmpty.sdkPackage,
              version: "evil",
            },
          },
        },
      },
      check: "sdkAndProbeProvenance",
    },
  ];

  for (const current of cases) {
    const report = createColdStartReport(current.input);
    assert.equal(report.releaseEligibility.eligible, false, current.name);
    assert.equal(
      report.releaseEligibility.checks[current.check],
      false,
      current.name,
    );
    assert.equal(report.policy.passed, false, current.name);
  }
});

test("release schedule randomizes within complete three-subject blocks", () => {
  const schedule = createBlockedSchedule(100, 42);
  assert.equal(schedule.length, 300);
  assert.match(digestSchedule(schedule), /^[a-f0-9]{64}$/u);
  for (let index = 0; index < schedule.length; index += 3) {
    assert.deepEqual(schedule.slice(index, index + 3).sort(), [
      "product",
      "raw",
      "sdkEmpty",
    ]);
  }
});

test("tools/list response validation is strict per subject contract", () => {
  const productTools = [
    "list_docs",
    "search_docs",
    "fetch_doc",
    "get_openapi_spec",
  ];
  const valid = {
    jsonrpc: "2.0",
    id: 1,
    result: { tools: productTools.map((name) => ({ name })) },
  };
  assert.deepEqual(
    validateToolsListResponse(valid, {
      id: 1,
      expectedToolNames: productTools,
    }),
    { ok: true },
  );

  for (const [name, response] of [
    ["jsonrpc", { ...valid, jsonrpc: "1.0" }],
    ["id", { ...valid, id: 2 }],
    ["error", { ...valid, error: null }],
    ["tools", { ...valid, result: {} }],
    ["names", { ...valid, result: { tools: [{ name: "list_docs" }] } }],
  ] as const) {
    const validation = validateToolsListResponse(response, {
      id: 1,
      expectedToolNames: productTools,
    });
    assert.equal(validation.ok, false, name);
  }
});

test("measurement timeout and stdout limits always resolve a failed outcome", async () => {
  assert.equal(HARD_KILL_AFTER_MS, 2_000);
  assert.equal(MAX_STDOUT_BYTES, 64 * 1024);

  const timeoutStarted = Date.now();
  const timeout = await measureOnce(
    {
      name: "raw",
      command: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000)"],
      expectedToolNames: [],
    },
    { timeoutMs: 25, hardKillAfterMs: 25 },
  );
  assert.equal(timeout.status, "timeout");
  assert.ok(Date.now() - timeoutStarted < 2_000);

  const oversized = await measureOnce(
    {
      name: "raw",
      command: process.execPath,
      args: [
        "-e",
        "process.stdout.write('x'.repeat(2048)); setInterval(() => {}, 1000)",
      ],
      expectedToolNames: [],
    },
    { timeoutMs: TIMEOUT_MS, maxStdoutBytes: 128, hardKillAfterMs: 25 },
  );
  assert.equal(oversized.status, "error");
  assert.match(oversized.message, /stdout exceeded 128 bytes/u);
  assert.ok(oversized.message.length < 500);
});

test("benchmark probes preserve their public-SDK and measurement-only boundaries", () => {
  const rawSource = readFileSync("scripts/benchmark-raw-responder.js", "utf8");
  const sdkSource = readFileSync("scripts/benchmark-sdk-empty.js", "utf8");
  const runnerSource = readFileSync("scripts/benchmark-cold-start.js", "utf8");
  const rawConfig = JSON.parse(
    readFileSync("scripts/benchmark-raw-sea-config.json", "utf8"),
  );
  const sdkConfig = JSON.parse(
    readFileSync("scripts/benchmark-sdk-empty-sea-config.json", "utf8"),
  );

  assert.match(rawSource, /not an MCP implementation/i);
  assert.match(rawSource, /must never be used as the product server/i);
  assert.match(sdkSource, /from "@modelcontextprotocol\/server"/);
  assert.match(sdkSource, /from "@modelcontextprotocol\/server\/stdio"/);
  assert.doesNotMatch(sdkSource, /jsonSchemaValidator/);
  assert.doesNotMatch(
    sdkSource,
    /@modelcontextprotocol\/server\/(?:dist|_shims|validators)/,
  );
  assert.match(runnerSource, /buildDefaultProbeExecutables\(\)/);
  assert.match(runnerSource, /spawnSync\(\s*process\.execPath/);

  for (const config of [rawConfig, sdkConfig]) {
    assert.equal(config.useSnapshot, false);
    assert.equal(config.useCodeCache, true);
    assert.deepEqual(config.assets, {});
  }
});

test("benchmark diagnostics remove upload-sensitive paths, URL credentials, and stacks", () => {
  const diagnostic = [
    "Failed E:\\Zero_Base\\playground\\.sumi\\sumi-docs-perf\\packages\\mcp\\examples\\basic\\docs",
    "at E:\\Zero_Base\\playground\\.sumi\\sumi-docs-perf\\packages\\mcp\\scripts\\benchmark-sdk-empty.js:12:3",
    "remote https://alice:super-secret@example.test/corpus.json",
  ].join("\n");

  const sanitized = sanitizeBenchmarkDiagnostic(diagnostic, [
    {
      value:
        "E:\\Zero_Base\\playground\\.sumi\\sumi-docs-perf\\packages\\mcp\\examples\\basic\\docs",
      placeholder: "<docs-root>",
    },
    {
      value: "E:\\Zero_Base\\playground\\.sumi\\sumi-docs-perf\\packages\\mcp",
      placeholder: "<benchmark-workspace>",
    },
  ]);

  assert.equal(sanitized, "Failed <docs-root> remote <credential-url>");
  assert.doesNotMatch(sanitized, /Zero_Base|alice|super-secret|\bat\b/);

  const report = createColdStartReport({
    generatedAt: "2026-08-19T00:00:00.000Z",
    environment: {},
    method: {},
    subjectDefinitions: {
      raw: { role: "measurement-baseline-only" },
      sdkEmpty: { role: "official-sdk-empty-baseline" },
      product: { role: "product" },
    },
    outcomes: {
      raw: [{ status: "error", message: diagnostic }],
      sdkEmpty: [{ status: "ok", elapsedMs: 100 }],
      product: [{ status: "ok", elapsedMs: 110 }],
    },
    diagnosticReplacements: [
      {
        value:
          "E:\\Zero_Base\\playground\\.sumi\\sumi-docs-perf\\packages\\mcp\\examples\\basic\\docs",
        placeholder: "<docs-root>",
      },
      {
        value:
          "E:\\Zero_Base\\playground\\.sumi\\sumi-docs-perf\\packages\\mcp",
        placeholder: "<benchmark-workspace>",
      },
    ],
  });
  const serialized = JSON.stringify(report);
  assert.deepEqual(report.subjects.raw.errorDetails, [sanitized]);
  assert.doesNotMatch(serialized, /Zero_Base|alice|super-secret/);

  const fallback = sanitizeBenchmarkDiagnostic(
    "C:\\private\\file.txt /home/alice/project/file \\\\server\\share\\secret https://example.test/corpus?X-Amz-Credential=abc&sig=secret token=top-secret Authorization: Bearer abc123 api_key=xyz",
  );
  assert.equal(
    fallback,
    "<absolute-path> <absolute-path> <absolute-path> <credential-url> <credential> <credential> <credential>",
  );
  assert.doesNotMatch(
    fallback,
    /private|alice|server|Credential|secret|abc123|xyz/u,
  );
});

function metrics(
  overrides: Partial<ReturnType<typeof summarizeMeasurements>>,
): ReturnType<typeof summarizeMeasurements> {
  return {
    attempted: 100,
    samples: 100,
    medianMs: 0,
    p95Ms: 0,
    p99Ms: 0,
    maxMs: 0,
    errors: 0,
    timeouts: 0,
    unknownStatuses: 0,
    measurementsMs: [],
    errorDetails: [],
    timeoutDetails: [],
    unknownStatusDetails: [],
    ...overrides,
  };
}

function trustedDefinitions() {
  return {
    raw: {
      role: "measurement-baseline-only",
      executionKind: "sea",
      isRepositoryDefaultBaseline: true,
      isTrustedBaseline: true,
      usesOfficialSdkPublicApi: false,
      sourceSha256: "a".repeat(64),
      seaConfigSha256: "c".repeat(64),
    },
    sdkEmpty: {
      role: "official-sdk-empty-baseline",
      executionKind: "sea",
      isRepositoryDefaultBaseline: true,
      isTrustedBaseline: true,
      usesOfficialSdkPublicApi: true,
      sourceSha256: "b".repeat(64),
      seaConfigSha256: "d".repeat(64),
      sdkPackage: {
        name: "@modelcontextprotocol/server",
        version: "2.0.0",
        entrySha256: "e".repeat(64),
      },
    },
    product: { role: "product", executionKind: "sea" },
  };
}

function releaseInput() {
  const scheduleOrder = createBlockedSchedule(100, 42);
  const outcomes = Object.fromEntries(
    ["raw", "sdkEmpty", "product"].map((name) => [
      name,
      Array.from({ length: 100 }, () => ({
        status: "ok" as const,
        elapsedMs: name === "raw" ? 60 : name === "sdkEmpty" ? 150 : 180,
      })),
    ]),
  );
  return {
    generatedAt: "2026-08-19T00:00:00.000Z",
    environment: {
      runtime: "v25.5.0",
      platform: "win32",
      architecture: "x64",
    },
    method: {
      iterationsPerSubject: 100,
      totalAttempts: 300,
      timeoutMs: 5_000,
      schedule: "seeded-randomized-subject-blocks",
      scheduleOrder,
      scheduleSha256: digestSchedule(scheduleOrder),
      seed: 42,
      customBaselines: false,
    },
    subjectDefinitions: trustedDefinitions(),
    outcomes,
  };
}
