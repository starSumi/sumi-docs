import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "yaml";

const PINNED_ACTION = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[0-9a-f]{40}$/u;
const CHANGESETS_ACTION =
  "changesets/action@a45c4d594aa4e2c509dc14a9f2b3b67ba3780d0d";
const DEPENDABOT_METADATA_ACTION =
  "dependabot/fetch-metadata@21025c705c08248db411dc16f3619e6b5f9ea21a";
const DEPENDENCY_REVIEW_ACTION =
  "actions/dependency-review-action@2031cfc080254a8a887f58cffee85186f0e49e48";
const PNPM_BOOTSTRAP = [
  "npm install --global --ignore-scripts --registry https://registry.npmjs.org pnpm@10.26.0",
  "pnpm --version",
].join("\n");
const CANDIDATE_COLD_START_COMMAND =
  "pnpm run benchmark:cold-start --docs examples/basic/docs --iterations 100 --executable artifacts/bin/sumi-docs-mcp.exe --output ../../artifacts/cold-start.json";
const RAW_DEPLOYMENT_EVIDENCE_JQ =
  /\bjq\b[^\n]*(?:deployment|switch(?:-observation)?|rollback)\.json\b/u;
const ACTIVE_WORKFLOWS = new Set([
  "candidate.yml",
  "ci.yml",
  "dependabot-policy.yml",
  "operations-observe.yml",
  "pages.yml",
  "production-recovery.yml",
  "release-intent.yml",
]);

function workflowSteps(workflow) {
  return Object.values(workflow.jobs ?? {}).flatMap((job) => job.steps ?? []);
}

function validateDeclaredNeeds(workflowName, workflow, errors) {
  for (const [jobName, job] of Object.entries(workflow.jobs ?? {})) {
    const declared = new Set(
      Array.isArray(job.needs) ? job.needs : job.needs ? [job.needs] : [],
    );
    const references = [
      ...JSON.stringify(job).matchAll(/\bneeds\.([A-Za-z0-9_-]+)\b/gu),
    ].map((match) => match[1]);
    for (const reference of new Set(references)) {
      if (!declared.has(reference)) {
        errors.push(
          `${workflowName} job ${jobName} references undeclared need ${reference}.`,
        );
      }
    }
  }
}

function sameKeys(object, keys) {
  return (
    object &&
    typeof object === "object" &&
    JSON.stringify(Object.keys(object).sort()) ===
      JSON.stringify([...keys].sort())
  );
}

function validatePnpmLifecycle(workflowName, jobName, job, errors) {
  const steps = job?.steps ?? [];
  const setupIndex = steps.findIndex(
    (step) => String(step.run ?? "").trim() === PNPM_BOOTSTRAP,
  );
  const installIndex = steps.findIndex((step) =>
    String(step.run ?? "").includes(
      "pnpm install --frozen-lockfile --ignore-scripts",
    ),
  );
  if (setupIndex < 0 || installIndex <= setupIndex) {
    errors.push(
      `${workflowName} ${jobName} must install pinned pnpm before the frozen dependency install.`,
    );
  }
  if (
    steps.some(
      (step) =>
        String(step.run ?? "").trim() !== PNPM_BOOTSTRAP &&
        /(?:^|\s)npm\s+(?:ci|install|run|test|pack|audit)(?:\s|$)/u.test(
          String(step.run ?? ""),
        ),
    )
  ) {
    errors.push(
      `${workflowName} ${jobName} must not invoke npm lifecycle commands.`,
    );
  }
}

export function validateWorkflowPolicy({
  ci,
  candidate,
  dependabotPolicy,
  operations,
  pages,
  recovery,
  releaseIntent,
  rootWorkflowNames,
  nestedWorkflowPaths,
}) {
  const errors = [];
  const workflows = {
    "ci.yml": ci,
    "candidate.yml": candidate,
    "dependabot-policy.yml": dependabotPolicy,
    "operations-observe.yml": operations,
    "pages.yml": pages,
    "production-recovery.yml": recovery,
    "release-intent.yml": releaseIntent,
  };

  for (const [name, workflow] of Object.entries(workflows)) {
    validateDeclaredNeeds(name, workflow, errors);
    for (const step of workflowSteps(workflow)) {
      if (step.uses && !PINNED_ACTION.test(step.uses)) {
        errors.push(`${name} contains a mutable action: ${step.uses}`);
      }
    }
  }

  const unexpectedRoot = rootWorkflowNames.filter(
    (name) => !ACTIVE_WORKFLOWS.has(name),
  );
  const missingRoot = [...ACTIVE_WORKFLOWS].filter(
    (name) => !rootWorkflowNames.includes(name),
  );
  if (unexpectedRoot.length > 0) {
    errors.push(`Unreviewed root workflows: ${unexpectedRoot.join(", ")}`);
  }
  if (missingRoot.length > 0) {
    errors.push(`Missing active workflows: ${missingRoot.join(", ")}`);
  }
  if (nestedWorkflowPaths.length > 0) {
    errors.push(
      `Nested workflows are inert: ${nestedWorkflowPaths.join(", ")}`,
    );
  }

  const releaseVersion = releaseIntent.jobs?.version;
  const releaseSteps = releaseVersion?.steps ?? [];
  const releaseCheckout = releaseSteps.find((step) =>
    step.uses?.startsWith("actions/checkout@"),
  );
  const releaseNode = releaseSteps.find((step) =>
    step.uses?.startsWith("actions/setup-node@"),
  );
  const versionPullRequest = releaseSteps.find(
    (step) => step.name === "Maintain version pull request",
  );
  const releaseCommands = releaseSteps
    .map(
      (step) => `${String(step.run ?? "")}\n${JSON.stringify(step.with ?? {})}`,
    )
    .join("\n");
  if (
    !sameKeys(releaseIntent.on, ["push", "workflow_dispatch"]) ||
    JSON.stringify(releaseIntent.on?.push?.branches) !==
      JSON.stringify(["main"]) ||
    !sameKeys(releaseIntent.on?.workflow_dispatch, []) ||
    !sameKeys(releaseIntent.permissions, ["contents", "pull-requests"]) ||
    releaseIntent.permissions.contents !== "write" ||
    releaseIntent.permissions["pull-requests"] !== "write" ||
    releaseIntent.concurrency?.group !== "release-intent-main" ||
    releaseIntent.concurrency?.["cancel-in-progress"] !== false ||
    !sameKeys(releaseIntent.jobs, ["version"]) ||
    releaseVersion?.["runs-on"] !== "ubuntu-24.04" ||
    releaseVersion?.["timeout-minutes"] !== 10 ||
    releaseVersion?.if !== "${{ github.repository == 'starSumi/sumi-docs' }}" ||
    releaseCheckout?.with?.["fetch-depth"] !== 0 ||
    releaseCheckout?.with?.["persist-credentials"] !== false ||
    releaseNode?.with?.["node-version-file"] !== ".node-version" ||
    versionPullRequest?.uses !== CHANGESETS_ACTION ||
    !sameKeys(versionPullRequest?.with, [
      "version",
      "commit",
      "title",
      "github-token",
    ]) ||
    versionPullRequest?.with?.version !== "pnpm run release:version" ||
    versionPullRequest?.with?.commit !== "chore(release): version packages" ||
    versionPullRequest?.with?.title !== "chore(release): version packages" ||
    versionPullRequest?.with?.["github-token"] !==
      "${{ secrets.GITHUB_TOKEN }}" ||
    versionPullRequest?.env !== undefined ||
    /(?:changeset|npm|pnpm)\s+publish\b|\bgit\s+tag\b|NPM_TOKEN/iu.test(
      releaseCommands,
    )
  ) {
    errors.push(
      "Release intent may maintain one pinned version pull request but must not publish, tag, or rebuild artifacts.",
    );
  }
  validatePnpmLifecycle("Release intent", "version", releaseVersion, errors);

  const dependabotJob = dependabotPolicy.jobs?.["patch-automerge"];
  const dependabotSteps = dependabotJob?.steps ?? [];
  const dependabotMetadata = dependabotSteps.find(
    (step) => step.name === "Read verified Dependabot metadata",
  );
  const dependabotMerge = dependabotSteps.find(
    (step) => step.name === "Enable squash auto-merge for patch updates",
  );
  const dependabotJobCondition = String(dependabotJob?.if ?? "");
  const dependabotMergeCondition = String(dependabotMerge?.if ?? "");
  if (
    !sameKeys(dependabotPolicy.on, ["pull_request"]) ||
    JSON.stringify(dependabotPolicy.on?.pull_request?.types) !==
      JSON.stringify([
        "opened",
        "synchronize",
        "reopened",
        "ready_for_review",
      ]) ||
    !sameKeys(dependabotPolicy.permissions, ["contents", "pull-requests"]) ||
    dependabotPolicy.permissions.contents !== "write" ||
    dependabotPolicy.permissions["pull-requests"] !== "write" ||
    dependabotPolicy.concurrency?.group !==
      "dependabot-policy-${{ github.event.pull_request.number }}" ||
    dependabotPolicy.concurrency?.["cancel-in-progress"] !== true ||
    !sameKeys(dependabotPolicy.jobs, ["patch-automerge"]) ||
    dependabotJob?.["runs-on"] !== "ubuntu-24.04" ||
    dependabotJob?.["timeout-minutes"] !== 5 ||
    !dependabotJobCondition.includes(
      "github.repository == 'starSumi/sumi-docs'",
    ) ||
    !dependabotJobCondition.includes(
      "github.event.pull_request.user.login == 'dependabot[bot]'",
    ) ||
    !dependabotJobCondition.includes(
      "github.event.pull_request.base.ref == 'main'",
    ) ||
    !dependabotJobCondition.includes("!github.event.pull_request.draft") ||
    dependabotMetadata?.uses !== DEPENDABOT_METADATA_ACTION ||
    !sameKeys(dependabotMetadata?.with, ["github-token"]) ||
    dependabotMetadata?.with?.["github-token"] !==
      "${{ secrets.GITHUB_TOKEN }}" ||
    dependabotMergeCondition !==
      "steps.metadata.outputs.update-type == 'version-update:semver-patch' && !contains(github.event.pull_request.labels.*.name, 'github_actions')" ||
    !sameKeys(dependabotMerge?.env, ["GH_TOKEN", "PR_URL"]) ||
    dependabotMerge.env.GH_TOKEN !== "${{ secrets.GITHUB_TOKEN }}" ||
    dependabotMerge.env.PR_URL !==
      "${{ github.event.pull_request.html_url }}" ||
    dependabotMerge.run !== 'gh pr merge --auto --squash "$PR_URL"' ||
    dependabotSteps.some((step) =>
      step.uses?.startsWith("actions/checkout@"),
    ) ||
    dependabotSteps.some((step) =>
      /(?:checkout|pull_request_target|gh\s+pr\s+(?:review|edit)|git\s+)/iu.test(
        `${String(step.run ?? "")}\n${JSON.stringify(step.with ?? {})}`,
      ),
    )
  ) {
    errors.push(
      "Dependabot automation may only enable squash auto-merge for verified patch updates without checking out pull-request code.",
    );
  }

  if (
    !sameKeys(ci.permissions, ["contents"]) ||
    ci.permissions.contents !== "read"
  ) {
    errors.push("CI must have read-only contents permission.");
  }
  validatePnpmLifecycle(
    "CI",
    "commit-policy",
    ci.jobs?.["commit-policy"],
    errors,
  );
  const commitPolicySteps = workflowSteps({
    jobs: { "commit-policy": ci.jobs?.["commit-policy"] },
  });
  const commitMessageRun = String(
    commitPolicySteps.find(
      (step) => step.name === "Validate every new commit message",
    )?.run ?? "",
  );
  if (
    !commitMessageRun.includes('pnpm exec commitlint --edit "$message_file"') ||
    commitMessageRun.includes("commitlint -- --edit") ||
    !commitMessageRun.includes('git cat-file -e "$EVENT_BEFORE^{commit}"') ||
    !commitMessageRun.includes(
      'git merge-base --is-ancestor "$EVENT_BEFORE" "$GITHUB_SHA"',
    ) ||
    !commitMessageRun.includes('commit_args=("$GITHUB_SHA")') ||
    !commitMessageRun.includes('git rev-list --reverse "${commit_args[@]}"') ||
    commitMessageRun.includes('range="$EVENT_BEFORE..$GITHUB_SHA"')
  ) {
    errors.push(
      "CI commit policy must validate each materialized message file and fail safe across rewritten pushes.",
    );
  }
  const dependencyReview = ci.jobs?.["dependency-review"];
  const dependencyReviewSteps = dependencyReview?.steps ?? [];
  const dependencyReviewCheckout = dependencyReviewSteps.find((step) =>
    step.uses?.startsWith("actions/checkout@"),
  );
  const dependencyReviewAction = dependencyReviewSteps.find(
    (step) => step.name === "Reject vulnerable dependency changes",
  );
  if (
    dependencyReview?.if !== "${{ github.event_name == 'pull_request' }}" ||
    dependencyReview?.["runs-on"] !== "ubuntu-24.04" ||
    dependencyReview?.["timeout-minutes"] !== 10 ||
    !sameKeys(dependencyReview?.permissions, ["contents"]) ||
    dependencyReview.permissions.contents !== "read" ||
    dependencyReviewCheckout?.with?.["persist-credentials"] !== false ||
    dependencyReviewAction?.uses !== DEPENDENCY_REVIEW_ACTION ||
    !sameKeys(dependencyReviewAction?.with, [
      "fail-on-severity",
      "fail-on-scopes",
    ]) ||
    dependencyReviewAction.with["fail-on-severity"] !== "moderate" ||
    dependencyReviewAction.with["fail-on-scopes"] !==
      "runtime, development, unknown"
  ) {
    errors.push(
      "CI dependency review must reject moderate-or-higher vulnerabilities across every dependency scope with read-only authority.",
    );
  }
  validatePnpmLifecycle("CI", "verify", ci.jobs?.verify, errors);
  const container = ci.jobs?.container;
  validatePnpmLifecycle("CI", "container", container, errors);
  const containerSteps = workflowSteps({ jobs: { container } });
  const contractBuildIndex = containerSteps.findIndex(
    (step) => step.name === "Build the corpus contract",
  );
  const projectionIndex = containerSteps.findIndex(
    (step) => step.name === "Build the sealed machine projection once",
  );
  const containerProjection = containerSteps.find(
    (step) => step.name === "Build the sealed machine projection once",
  );
  const containerBuild = containerSteps.find(
    (step) => step.name === "Build the reviewed image",
  );
  const containerExercise = containerSteps.find(
    (step) => step.name === "Exercise the hardened container boundary",
  );
  if (
    contractBuildIndex < 0 ||
    projectionIndex <= contractBuildIndex ||
    String(containerSteps[contractBuildIndex]?.run ?? "").trim() !==
      "pnpm --filter @sumi-os/corpus-contract build"
  ) {
    errors.push(
      "CI container must build the corpus contract before machine projection.",
    );
  }
  if (
    container?.["runs-on"] !== "ubuntu-24.04" ||
    !String(containerProjection?.run ?? "").includes(
      "apps/web/scripts/build-machine-projection.mjs",
    ) ||
    !String(containerProjection?.run ?? "").includes(
      "--output artifacts/machine-projection",
    ) ||
    !String(containerBuild?.run ?? "").includes("docker build") ||
    !String(containerBuild?.run ?? "").includes("VCS_REF=$GITHUB_SHA") ||
    !String(containerBuild?.run ?? "").includes(
      "--build-context corpus=artifacts/machine-projection/_mcp",
    ) ||
    !String(containerBuild?.run ?? "").includes("--target production") ||
    !String(containerBuild?.run ?? "").includes(".Config.User") ||
    !String(containerExercise?.run ?? "").includes("--read-only") ||
    !String(containerExercise?.run ?? "").includes("--cap-drop ALL") ||
    !String(containerExercise?.run ?? "").includes(
      "--security-opt no-new-privileges",
    ) ||
    !String(containerExercise?.run ?? "").includes("/readyz") ||
    !String(containerExercise?.run ?? "").includes("Host: localhost:3000") ||
    !String(containerExercise?.run ?? "").includes("tools/list") ||
    !String(containerExercise?.run ?? "").includes(
      "mcp-protocol-version: 2026-07-28",
    ) ||
    !String(containerExercise?.run ?? "").includes(
      "accept: application/json, text/event-stream",
    ) ||
    !String(containerExercise?.run ?? "").includes(
      ".buildRevision == $revision",
    ) ||
    !String(containerExercise?.run ?? "").includes(
      ".corpus.revision == $corpus",
    ) ||
    !String(containerExercise?.run ?? "").includes("mcp-session-id") ||
    !String(containerExercise?.run ?? "").includes("docker stop --time 10") ||
    !String(containerExercise?.run ?? "").includes(".State.ExitCode")
  ) {
    errors.push(
      "CI must build and exercise the hardened stateless MCP container.",
    );
  }

  if (
    !sameKeys(candidate.permissions, ["contents"]) ||
    candidate.permissions.contents !== "read"
  ) {
    errors.push(
      "Candidate workflow-level permissions must be contents: read only.",
    );
  }
  if (
    candidate.concurrency?.group !==
      "acceptance-candidate-${{ github.workflow }}" ||
    candidate.concurrency?.["cancel-in-progress"] !== true
  ) {
    errors.push("Candidate concurrency must cancel superseded runs globally.");
  }

  const build = candidate.jobs?.build;
  const attest = candidate.jobs?.attest;
  validatePnpmLifecycle("Candidate", "build", build, errors);
  if (!String(build?.if ?? "").includes("refs/heads/main")) {
    errors.push("Candidate build must be restricted to main.");
  }
  if (build?.permissions && !sameKeys(build.permissions, ["contents"])) {
    errors.push("Candidate build has unexpected permissions.");
  }
  if (
    workflowSteps({ jobs: { build } }).some((step) =>
      step.uses?.startsWith("actions/attest@"),
    )
  ) {
    errors.push("Candidate build must not hold or use attestation authority.");
  }
  const buildSteps = workflowSteps({ jobs: { build } });
  const verifyCandidate = buildSteps.find(
    (step) => step.name === "Verify candidate source",
  );
  if (
    verifyCandidate?.env?.SITE_URL !== "${{ inputs.site_url }}" ||
    verifyCandidate?.env?.BASE_PATH !== "${{ inputs.site_base }}" ||
    candidate.on?.workflow_dispatch?.inputs?.site_base?.required !== true
  ) {
    errors.push(
      "Candidate builds must bind the reviewed site origin and base path.",
    );
  }
  const performance = buildSteps.find((step) => step.id === "performance");
  const packageCandidate = buildSteps.find(
    (step) => step.name === "Package candidate",
  );
  const smokeExecutable = buildSteps.find(
    (step) => step.name === "Smoke test Windows executable",
  );
  const candidateUpload = buildSteps.find((step) =>
    step.uses?.startsWith("actions/upload-artifact@"),
  );
  const uploadIndex = buildSteps.findIndex((step) =>
    step.uses?.startsWith("actions/upload-artifact@"),
  );
  const enforcementIndex = buildSteps.findIndex(
    (step) => step.id === "enforce-performance",
  );
  const enforcement = buildSteps[enforcementIndex];
  const performanceRun = String(performance?.run ?? "");
  const benchmarkLines = performanceRun
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.includes("benchmark:cold-start"));
  if (
    performance?.["continue-on-error"] !== true ||
    benchmarkLines.length !== 1 ||
    benchmarkLines[0] !== CANDIDATE_COLD_START_COMMAND ||
    performanceRun.includes("*>") ||
    enforcementIndex <= uploadIndex ||
    !String(enforcement?.if ?? "").includes("!cancelled()") ||
    !String(enforcement?.run ?? "").includes("steps.performance.outcome")
  ) {
    errors.push(
      "Candidate performance diagnostics must upload before a blocking final gate.",
    );
  }
  const packageRun = String(packageCandidate?.run ?? "");
  if (
    !packageRun.includes(
      "pnpm run pack:npm-candidate --output artifacts/npm --commit $env:REQUESTED_COMMIT",
    ) ||
    !packageRun.includes("pnpm run build:compliance") ||
    !packageRun.includes("artifacts/compliance/mcp/THIRD_PARTY_NOTICES.txt") ||
    !packageRun.includes("artifacts/compliance/mcp/bom.cdx.json") ||
    !packageRun.includes("artifacts/compliance/mcp/NODEJS_LICENSE.txt") ||
    !packageRun.includes("artifacts/compliance/web/THIRD_PARTY_NOTICES.txt") ||
    !packageRun.includes("artifacts/compliance/web/bom.cdx.json") ||
    packageRun.includes("artifacts/compliance/web/NODEJS_LICENSE.txt") ||
    (packageRun.match(/Copy-Item LICENSE/gu) ?? []).length !== 2
  ) {
    errors.push(
      "Candidate archives must include project, runtime, third-party, and SBOM compliance material.",
    );
  }
  const smokeRun = String(smokeExecutable?.run ?? "");
  if (
    !smokeRun.includes(
      "example:smoke --executable artifacts/bin/sumi-docs-mcp.exe",
    ) ||
    smokeRun.includes("example:smoke -- --executable")
  ) {
    errors.push(
      "Candidate smoke validation must execute the built SEA binary.",
    );
  }
  const expectedCandidateArtifacts = [
    "artifacts/cold-start.json",
    "artifacts/npm/npm-candidate.json",
    "artifacts/npm/*.tgz",
    "artifacts/npm/*.tgz.sha256",
    "artifacts/sumi-docs-mcp-*.zip",
    "artifacts/sumi-docs-mcp-*.zip.sha256",
    "artifacts/sumi-docs-web-*.zip",
    "artifacts/sumi-docs-web-*.zip.sha256",
  ];
  const candidateArtifactPaths = String(candidateUpload?.with?.path ?? "")
    .trim()
    .split(/\r?\n/u)
    .map((path) => path.trim())
    .filter(Boolean);
  if (
    JSON.stringify(candidateArtifactPaths) !==
    JSON.stringify(expectedCandidateArtifacts)
  ) {
    errors.push(
      "Candidate artifacts must use the reviewed structured allowlist.",
    );
  }
  if (
    attest?.environment !== "candidate-attestation" ||
    !String(attest?.if ?? "").includes("ENABLE_ATTESTATION") ||
    !String(attest?.if ?? "").includes("refs/heads/main")
  ) {
    errors.push("Attestation must be explicit, protected, and main-only.");
  }
  if (
    !sameKeys(attest?.permissions, [
      "actions",
      "attestations",
      "contents",
      "id-token",
    ]) ||
    attest.permissions.actions !== "read" ||
    attest.permissions.contents !== "read" ||
    attest.permissions["id-token"] !== "write" ||
    attest.permissions.attestations !== "write"
  ) {
    errors.push("Attestation job permissions are not least-privilege.");
  }
  const attestSteps = workflowSteps({ jobs: { attest } });
  const checksumVerification = attestSteps.find(
    (step) => step.name === "Verify candidate checksums",
  );
  const attestation = attestSteps.find((step) =>
    step.uses?.startsWith("actions/attest@"),
  );
  if (
    !attestSteps.some((step) =>
      step.uses?.startsWith("actions/download-artifact@"),
    )
  ) {
    errors.push("Attestation must download the exact build artifact.");
  }
  if (!attestSteps.some((step) => step.uses?.startsWith("actions/attest@"))) {
    errors.push("Attestation job is missing provenance generation.");
  }
  if (
    !String(checksumVerification?.run ?? "").includes("-Recurse") ||
    String(attestation?.with?.["subject-path"] ?? "").trim() !==
      [
        "candidate-artifact/*.zip",
        "candidate-artifact/npm/npm-candidate.json",
        "candidate-artifact/npm/*.tgz",
      ].join("\n")
  ) {
    errors.push(
      "Attestation must verify and bind both binary and npm candidate bytes.",
    );
  }

  const observe = operations.jobs?.observe;
  validatePnpmLifecycle("Operations", "observe", observe, errors);
  if (
    !String(observe?.if ?? "").includes("refs/heads/main") ||
    !String(observe?.if ?? "").includes("!cancelled()")
  ) {
    errors.push(
      "Operations observation must be current-main and cancellation aware.",
    );
  }
  const observeSteps = workflowSteps({ jobs: { observe } });
  const health = observeSteps.find(
    (step) => step.name === "Observe product health",
  );
  const freshness = observeSteps.find((step) => step.id === "freshness");
  const upload = observeSteps.find((step) =>
    step.uses?.startsWith("actions/upload-artifact@"),
  );
  if (!freshness || !String(freshness.if ?? "").includes("!cancelled()")) {
    errors.push("Operations observation is missing its final freshness check.");
  }
  if (
    !String(upload?.if ?? "").includes("!cancelled()") ||
    !String(upload?.if ?? "").includes("freshness.outputs.current")
  ) {
    errors.push(
      "Operations upload must reject cancelled or superseded observations.",
    );
  }
  if (
    String(health?.run ?? "").includes("tee ") ||
    String(health?.run ?? "").includes("2>&1") ||
    upload?.with?.path !== "artifacts/operations/observation.json"
  ) {
    errors.push(
      "Operations artifacts must contain only the structured observation.",
    );
  }

  if (
    !sameKeys(pages.permissions, ["actions", "contents"]) ||
    pages.permissions.actions !== "read" ||
    pages.permissions.contents !== "read"
  ) {
    errors.push("Production workflow authority must default to read only.");
  }
  if (
    pages.concurrency?.group !== "production-documentation-main" ||
    pages.concurrency?.["cancel-in-progress"] !== false
  ) {
    errors.push("Production releases must be serialized without cancellation.");
  }

  const productionJobs = pages.jobs ?? {};
  const expectedProductionJobs = [
    "preflight",
    "remote-preflight",
    "build",
    "publish-image",
    "deploy-mcp",
    "observe-switch",
    "deploy-pages",
    "final-acceptance",
    "finalize-mcp",
    "release-checkpoint",
    "compensation-plan",
    "rollback-pages",
    "rollback-mcp",
  ];
  if (!sameKeys(productionJobs, expectedProductionJobs)) {
    errors.push("Production workflow contains a missing or unreviewed job.");
  }
  const needsExactly = (job, expected) => {
    const actual = Array.isArray(job?.needs)
      ? job.needs
      : job?.needs
        ? [job.needs]
        : [];
    return (
      JSON.stringify([...actual].sort()) ===
      JSON.stringify([...expected].sort())
    );
  };

  const preflight = productionJobs.preflight;
  const preflightSteps = preflight?.steps ?? [];
  const modePreflight = preflightSteps.find(
    (step) => step.name === "Select Pages-only or remote MCP mode",
  );
  const remotePreflight = productionJobs["remote-preflight"];
  const remotePreflightSteps = remotePreflight?.steps ?? [];
  const endpointPreflight = remotePreflightSteps.find(
    (step) => step.name === "Validate public endpoint configuration",
  );
  const sshPreflight = remotePreflightSteps.find(
    (step) => step.name === "Require protected SSH material",
  );
  if (
    preflight?.environment !== undefined ||
    !String(preflight?.if ?? "").includes("refs/heads/main") ||
    preflight?.outputs?.["remote-enabled"] !==
      "${{ steps.mode.outputs.enabled }}" ||
    modePreflight?.env?.ENABLE_REMOTE_MCP !== "${{ vars.ENABLE_REMOTE_MCP }}" ||
    !String(modePreflight?.run ?? "").includes("enabled=false") ||
    !String(modePreflight?.run ?? "").includes("enabled=true") ||
    !needsExactly(remotePreflight, ["preflight"]) ||
    remotePreflight?.environment !== "production-mcp" ||
    !String(remotePreflight?.if ?? "").includes(
      "needs.preflight.outputs.remote-enabled == 'true'",
    ) ||
    endpointPreflight?.env?.DEPLOY_PUBLIC_MCP_URL !==
      "${{ vars.DEPLOY_PUBLIC_MCP_URL }}" ||
    endpointPreflight?.env?.DEPLOY_PUBLIC_MCP_READINESS_URL !==
      "${{ vars.DEPLOY_PUBLIC_MCP_READINESS_URL }}" ||
    sshPreflight?.env?.DEPLOY_SSH_PRIVATE_KEY !==
      "${{ secrets.DEPLOY_SSH_PRIVATE_KEY }}" ||
    sshPreflight?.env?.DEPLOY_SSH_KNOWN_HOSTS !==
      "${{ secrets.DEPLOY_SSH_KNOWN_HOSTS }}" ||
    !String(sshPreflight?.run ?? "").includes("test -n")
  ) {
    errors.push(
      "Remote MCP preflight must be explicitly enabled and fail closed on absent reviewed endpoints or protected SSH material.",
    );
  }

  const pagesBuild = productionJobs.build;
  validatePnpmLifecycle("Production", "build", pagesBuild, errors);
  const pagesBuildSteps = pagesBuild?.steps ?? [];
  const prior = pagesBuildSteps.find(
    (step) =>
      step.name === "Observe the prior site and preserve its Pages artifact",
  );
  const buildTuple = pagesBuildSteps.find(
    (step) => step.name === "Build and verify the release tuple",
  );
  const buildImage = pagesBuildSteps.find(
    (step) =>
      step.name === "Build the production image from the sealed projection",
  );
  const imageAcceptance = pagesBuildSteps.find(
    (step) => step.name === "Exercise the embedded production corpus",
  );
  const uploadPages = pagesBuildSteps.find(
    (step) => step.name === "Upload verified Pages artifact",
  );
  const uploadPreservedRollback = pagesBuildSteps.find(
    (step) => step.name === "Upload preserved Pages rollback artifact",
  );
  const uploadBootstrapRollback = pagesBuildSteps.find(
    (step) => step.name === "Upload bootstrap Pages rollback artifact",
  );
  const uploadImage = pagesBuildSteps.find(
    (step) => step.name === "Upload exact OCI input",
  );
  const priorRun = String(prior?.run ?? "");
  const buildTupleRun = String(buildTuple?.run ?? "");
  const buildImageRun = String(buildImage?.run ?? "");
  if (
    !needsExactly(pagesBuild, ["preflight", "remote-preflight"]) ||
    pagesBuild?.environment !== undefined ||
    !String(pagesBuild?.if ?? "").includes(
      "needs.preflight.outputs.remote-enabled == 'false'",
    ) ||
    !String(pagesBuild?.if ?? "").includes(
      "needs.remote-preflight.result == 'success'",
    ) ||
    !priorRun.includes("verify-production-deployment.mjs prior-manifest") ||
    !priorRun.includes("actions/workflows/pages.yml/runs") ||
    !priorRun.includes(".head_sha == $commit") ||
    !priorRun.includes("actions/runs/$run_id/artifacts") ||
    !priorRun.includes("cmp -s artifacts/prior-locator.json") ||
    !priorRun.includes("_mcp/server.json") ||
    !priorRun.includes("prior-discovery") ||
    !priorRun.includes("ALLOW_BOOTSTRAP") ||
    !priorRun.includes("artifact.tar") ||
    !priorRun.includes(".expired == false") ||
    !priorRun.includes('tar -tf "$artifact_tar" > "$archive_members_raw"') ||
    !priorRun.includes('tar -tvf "$artifact_tar" > "$archive_details"') ||
    !priorRun.includes("sed 's#^\\./##' \"$archive_members_raw\"") ||
    !priorRun.includes(
      'uniq -d "$archive_members_sorted" "$archive_duplicates"',
    ) ||
    !priorRun.includes('locator_member="./$locator_member"') ||
    /tar\s+-t[v]?f[^\n|]*\|\s*grep\s+[^\n]*-q/u.test(priorRun) ||
    pagesBuild?.outputs?.["pages-artifact"] !==
      "github-pages-${{ github.run_id }}-${{ github.run_attempt }}" ||
    pagesBuild?.outputs?.["image-artifact"] !==
      "mcp-image-${{ github.run_id }}-${{ github.run_attempt }}" ||
    pagesBuild?.outputs?.["rollback-artifact"] !==
      "github-pages-rollback-${{ github.run_id }}-${{ github.run_attempt }}" ||
    uploadPreservedRollback?.with?.name !==
      "github-pages-rollback-${{ github.run_id }}-${{ github.run_attempt }}" ||
    uploadBootstrapRollback?.with?.name !==
      "github-pages-rollback-${{ github.run_id }}-${{ github.run_attempt }}" ||
    buildTuple?.env?.PUBLIC_MCP_URL !==
      "${{ needs.remote-preflight.outputs.mcp-url }}" ||
    buildTuple?.env?.PUBLIC_MCP_READINESS_URL !==
      "${{ needs.remote-preflight.outputs.readiness-url }}" ||
    !buildTupleRun.includes("pnpm run verify") ||
    !buildTupleRun.includes("@sumi-os/docs-web verify:mcp") ||
    !buildTupleRun.includes("test ! -e apps/web/dist/_mcp/server.json") ||
    !buildTupleRun.includes("test -f apps/web/dist/_mcp/server.json") ||
    !buildImageRun.includes("--build-context corpus=apps/web/dist/_mcp") ||
    !buildImageRun.includes("--target production") ||
    !String(buildImage?.if ?? "").includes("remote-enabled == 'true'") ||
    !String(imageAcceptance?.if ?? "").includes("remote-enabled == 'true'") ||
    !String(imageAcceptance?.run ?? "").includes(
      ".corpus.revision == $corpus",
    ) ||
    uploadPages?.with?.name !==
      "github-pages-${{ github.run_id }}-${{ github.run_attempt }}" ||
    uploadPages?.with?.path !== "apps/web/dist" ||
    !String(uploadImage?.with?.path ?? "").includes(
      "artifacts/deployment/image.tar",
    ) ||
    !String(uploadImage?.if ?? "").includes("remote-enabled == 'true'")
  ) {
    errors.push(
      "Production build must preserve rollback evidence and bind one Web projection into the OCI artifact.",
    );
  }

  const publishImage = productionJobs["publish-image"];
  const publishSteps = publishImage?.steps ?? [];
  const push = publishSteps.find(
    (step) =>
      step.name ===
      "Publish by immutable commit tag and capture registry digest",
  );
  if (
    !needsExactly(publishImage, ["build"]) ||
    !String(publishImage?.if ?? "").includes(
      "needs.build.outputs.remote-enabled == 'true'",
    ) ||
    !sameKeys(publishImage?.permissions, ["actions", "contents", "packages"]) ||
    publishImage?.permissions?.actions !== "read" ||
    publishImage?.permissions?.contents !== "read" ||
    publishImage?.permissions?.packages !== "write" ||
    !String(push?.run ?? "").includes("docker push") ||
    !String(push?.run ?? "").includes(".RepoDigests") ||
    !String(push?.run ?? "").includes(
      "verify-production-deployment.mjs create-record",
    )
  ) {
    errors.push(
      "GHCR publication must have isolated packages write authority and emit a digest-pinned record.",
    );
  }

  const deployMcp = productionJobs["deploy-mcp"];
  const deploySteps = deployMcp?.steps ?? [];
  const remoteSwitch = deploySteps.find(
    (step) =>
      step.name ===
      "Switch only after candidate readiness and probe the public MCP",
  );
  const switchRun = String(remoteSwitch?.run ?? "");
  const recordVerification = deploySteps.find(
    (step) => step.name === "Verify deployment record",
  );
  const recordRun = String(recordVerification?.run ?? "");
  const switchUpload = deploySteps.find(
    (step) => step.name === "Upload validated switch evidence",
  );
  if (
    !needsExactly(deployMcp, ["build", "publish-image"]) ||
    !String(deployMcp?.if ?? "").includes(
      "needs.build.outputs.remote-enabled == 'true'",
    ) ||
    deployMcp?.environment !== "production-mcp" ||
    !sameKeys(deployMcp?.permissions, ["actions", "contents"]) ||
    !switchRun.includes("StrictHostKeyChecking=yes") ||
    !switchRun.includes("ssh-keygen -F") ||
    !switchRun.includes("deploy-remote-mcp.sh") ||
    deployMcp?.outputs?.switched !== "${{ steps.switch.outputs.switched }}" ||
    remoteSwitch?.id !== "switch" ||
    !switchRun.includes("trap 'rollback $?' ERR") ||
    !switchRun.includes("trap 'rollback 130' INT") ||
    !switchRun.includes("trap 'rollback 143' TERM") ||
    !switchRun.includes("trap 'rollback 129' HUP") ||
    !switchRun.includes('"$prior_state"') ||
    !switchRun.includes("verify-production-deployment.mjs switch") ||
    !switchRun.includes("switch --json") ||
    !switchRun.includes("switch.validated.json") ||
    !switchRun.includes("jq -er .value.changed") ||
    !switchRun.includes('echo "switched=$switched"') ||
    switchRun.includes("echo 'switched=true'") ||
    !switchUpload?.uses?.startsWith("actions/upload-artifact@") ||
    switchUpload?.with?.name !==
      "mcp-switch-${{ github.run_id }}-${{ github.run_attempt }}" ||
    switchUpload?.with?.path !== "artifacts/deployment/switch.json" ||
    !recordRun.includes('--repository "$GITHUB_REPOSITORY"') ||
    !recordRun.includes('--commit "$GITHUB_SHA"') ||
    !recordRun.includes('--corpus-revision "$CORPUS_REVISION"') ||
    !recordRun.includes('--image "$IMAGE_REF"') ||
    !recordRun.includes('--image-id "$(tr') ||
    !switchRun.includes("tools/list") ||
    !switchRun.includes("DEPLOY_PUBLIC_MCP_READINESS_URL")
  ) {
    errors.push(
      "Remote MCP deployment must use strict SSH, candidate evidence, a real MCP probe, and immediate compensation.",
    );
  }

  const pagesDeploy = productionJobs["deploy-pages"];
  const pagesDeploySteps = pagesDeploy?.steps ?? [];
  if (
    !needsExactly(pagesDeploy, ["build", "deploy-mcp", "observe-switch"]) ||
    !String(pagesDeploy?.if ?? "").includes(
      "needs.build.outputs.remote-enabled == 'false'",
    ) ||
    !String(pagesDeploy?.if ?? "").includes(
      "needs.deploy-mcp.result == 'success'",
    ) ||
    pagesDeploy?.environment?.name !== "github-pages" ||
    !sameKeys(pagesDeploy?.permissions, ["contents", "id-token", "pages"]) ||
    pagesDeploy?.permissions?.contents !== "read" ||
    pagesDeploy?.permissions?.pages !== "write" ||
    pagesDeploy?.permissions?.["id-token"] !== "write" ||
    pagesDeploySteps.length !== 1 ||
    !pagesDeploySteps[0]?.uses?.startsWith("actions/deploy-pages@") ||
    pagesDeploySteps[0]?.with?.artifact_name !==
      "${{ needs.build.outputs.pages-artifact }}"
  ) {
    errors.push(
      "Pages promotion must follow MCP acceptance and hold only Pages authority.",
    );
  }

  const finalAcceptance = productionJobs["final-acceptance"];
  const pagesReadback = finalAcceptance?.steps?.find(
    (step) => step.name === "Verify the public Pages publication",
  );
  const finalRun = String(pagesReadback?.run ?? "");
  const remoteReadback = finalAcceptance?.steps?.find(
    (step) =>
      step.name ===
      "Verify readiness and document retrieval from the remote MCP",
  );
  const remoteReadbackRun = String(remoteReadback?.run ?? "");
  const finalizeMcp = productionJobs["finalize-mcp"];
  const finalizeRun = String(
    finalizeMcp?.steps?.find(
      (step) => step.name === "Finalize the remote switch",
    )?.run ?? "",
  );
  if (
    !needsExactly(finalAcceptance, [
      "build",
      "publish-image",
      "deploy-mcp",
      "deploy-pages",
    ]) ||
    finalAcceptance?.environment !== undefined ||
    !String(finalAcceptance?.if ?? "").includes(
      "needs.build.outputs.remote-enabled == 'false'",
    ) ||
    !String(finalAcceptance?.if ?? "").includes(
      "needs.deploy-pages.result == 'success'",
    ) ||
    !finalRun.includes('site_root="${SITE_ORIGIN%/}${SITE_BASE_PATH}"') ||
    finalRun.includes("starsumi.github.io") ||
    !finalRun.includes("_mcp/v2/current.json") ||
    !finalRun.includes("_mcp/server.json") ||
    !finalRun.includes('server_status" = 404') ||
    !String(remoteReadback?.if ?? "").includes("remote-enabled == 'true'") ||
    !remoteReadbackRun.includes("fetch_doc") ||
    !remoteReadbackRun.includes("verify-production-deployment.mjs ready") ||
    !needsExactly(finalizeMcp, [
      "build",
      "publish-image",
      "deploy-mcp",
      "deploy-pages",
      "final-acceptance",
    ]) ||
    finalizeMcp?.environment !== "production-mcp" ||
    !String(finalizeMcp?.if ?? "").includes("remote-enabled == 'true'") ||
    !finalizeRun.includes("StrictHostKeyChecking=yes") ||
    !finalizeRun.includes(" finalize ")
  ) {
    errors.push(
      "Final acceptance must verify Pages-only absence or the complete remote tuple before protected finalization.",
    );
  }

  const releaseCheckpoint = productionJobs["release-checkpoint"];
  const checkpointSteps = releaseCheckpoint?.steps ?? [];
  const checkpointObservation = checkpointSteps.find(
    (step) => step.name === "Observe and seal the public release tuple",
  );
  const checkpointUpload = checkpointSteps.find(
    (step) => step.name === "Upload immutable release checkpoint",
  );
  const checkpointRun = String(checkpointObservation?.run ?? "");
  if (
    !needsExactly(releaseCheckpoint, [
      "build",
      "final-acceptance",
      "finalize-mcp",
    ]) ||
    releaseCheckpoint?.environment !== undefined ||
    !sameKeys(releaseCheckpoint?.permissions, ["contents"]) ||
    releaseCheckpoint?.permissions?.contents !== "read" ||
    !String(releaseCheckpoint?.if ?? "").includes("always()") ||
    !String(releaseCheckpoint?.if ?? "").includes(
      "needs.final-acceptance.result == 'success'",
    ) ||
    !String(releaseCheckpoint?.if ?? "").includes(
      "needs.build.outputs.remote-enabled == 'false'",
    ) ||
    !String(releaseCheckpoint?.if ?? "").includes(
      "needs.finalize-mcp.result == 'success'",
    ) ||
    !checkpointRun.includes("release-checkpoint.mjs") ||
    !checkpointRun.includes("observe") ||
    !checkpointRun.includes("verify") ||
    !checkpointRun.includes("GITHUB_RUN_ID") ||
    !checkpointRun.includes("GITHUB_RUN_ATTEMPT") ||
    !checkpointRun.includes("CORPUS_REVISION") ||
    !checkpointRun.includes("DEPLOY_PUBLIC_MCP_READINESS_URL") ||
    !checkpointRun.includes(
      'site_root="${SITE_ORIGIN%/}${SITE_BASE_PATH%/}/"',
    ) ||
    checkpointUpload?.with?.name !==
      "release-checkpoint-${{ github.run_id }}-${{ github.run_attempt }}" ||
    checkpointUpload?.with?.path !==
      "artifacts/checkpoint/release-checkpoint.json" ||
    checkpointUpload?.with?.["if-no-files-found"] !== "error" ||
    checkpointUpload?.with?.["retention-days"] !== 90
  ) {
    errors.push(
      "Release checkpoint must follow public readback and bind the exact run attempt and corpus generation.",
    );
  }

  const rollbackPages = productionJobs["rollback-pages"];
  const rollbackMcp = productionJobs["rollback-mcp"];
  const observeSwitch = productionJobs["observe-switch"];
  const compensationPlan = productionJobs["compensation-plan"];
  const compensationRun = String(
    compensationPlan?.steps?.find(
      (step) => step.name === "Compute the table-driven compensation plan",
    )?.run ?? "",
  );
  const rollbackPagesSteps = rollbackPages?.steps ?? [];
  const rollbackMcpRun = String(
    rollbackMcp?.steps?.find(
      (step) =>
        step.name === "Restore the old container only after Pages rollback",
    )?.run ?? "",
  );
  const rollbackReadbackRun = String(
    rollbackMcp?.steps?.find(
      (step) => step.name === "Verify the compensated public tuple",
    )?.run ?? "",
  );
  const rollbackCleanup = rollbackMcp?.steps?.find(
    (step) => step.name === "Complete the compensated remote transaction",
  );
  const rollbackCleanupRun = String(rollbackCleanup?.run ?? "");
  if (
    !needsExactly(compensationPlan, [
      "build",
      "publish-image",
      "deploy-mcp",
      "observe-switch",
      "deploy-pages",
      "final-acceptance",
      "finalize-mcp",
    ]) ||
    !String(compensationPlan?.if ?? "").includes("always()") ||
    !compensationRun.includes(
      "verify-production-deployment.mjs compensation-plan",
    ) ||
    !compensationRun.includes("pages-phase") ||
    !compensationRun.includes("MCP_ROLLBACK_PENDING") ||
    compensationPlan?.outputs?.["restore-pages"] !==
      "${{ steps.plan.outputs.restore-pages }}" ||
    compensationPlan?.outputs?.["rollback-mcp"] !==
      "${{ steps.plan.outputs.rollback-mcp }}" ||
    !needsExactly(rollbackPages, ["build", "compensation-plan"]) ||
    !String(rollbackPages?.if ?? "").includes("always()") ||
    !String(rollbackPages?.if ?? "").includes(
      "needs.compensation-plan.outputs.restore-pages == 'true'",
    ) ||
    !sameKeys(rollbackPages?.permissions, ["contents", "id-token", "pages"]) ||
    rollbackPages?.permissions?.contents !== "read" ||
    rollbackPages?.permissions?.pages !== "write" ||
    rollbackPages?.permissions?.["id-token"] !== "write" ||
    rollbackPagesSteps[0]?.with?.artifact_name !==
      "${{ needs.build.outputs.rollback-artifact }}" ||
    !needsExactly(rollbackMcp, [
      "build",
      "publish-image",
      "observe-switch",
      "compensation-plan",
      "rollback-pages",
    ]) ||
    !String(rollbackMcp?.if ?? "").includes("always()") ||
    !String(rollbackMcp?.if ?? "").includes(
      "needs.observe-switch.outputs.rollback-required == 'true'",
    ) ||
    !String(rollbackMcp?.if ?? "").includes(
      "needs.compensation-plan.outputs.rollback-mcp == 'true'",
    ) ||
    !String(rollbackMcp?.if ?? "").includes(
      "needs.rollback-pages.result == 'success'",
    ) ||
    !String(rollbackMcp?.if ?? "").includes(
      "needs.rollback-pages.result == 'skipped'",
    ) ||
    observeSwitch?.outputs?.["rollback-required"] !==
      "${{ steps.observe.outputs.rollback-required }}" ||
    !String(rollbackMcp?.steps?.[0]?.run ?? "").includes(
      "ROLLBACK_PAGES_RESULT",
    ) ||
    !rollbackMcpRun.includes("StrictHostKeyChecking=yes") ||
    !rollbackMcpRun.includes(" rollback ") ||
    !rollbackMcpRun.includes('"$prior_state"') ||
    !rollbackMcpRun.includes("verify-production-deployment.mjs rollback") ||
    !rollbackReadbackRun.includes("_mcp/v2/current.json") ||
    !rollbackReadbackRun.includes("archive-members-raw.txt") ||
    !rollbackReadbackRun.includes('locator_member="./$locator_member"') ||
    !rollbackReadbackRun.includes("cmp -s") ||
    !rollbackReadbackRun.includes("verify-production-deployment.mjs ready") ||
    !rollbackCleanupRun.includes("StrictHostKeyChecking=yes") ||
    !rollbackCleanupRun.includes(" complete-rollback ") ||
    !rollbackCleanup ||
    rollbackMcp?.steps?.indexOf(rollbackCleanup) <=
      rollbackMcp?.steps?.findIndex(
        (step) => step.name === "Verify the compensated public tuple",
      )
  ) {
    errors.push(
      "Production compensation must restore the preserved Pages artifact before the old MCP container.",
    );
  }

  const allProductionRun = workflowSteps(pages)
    .map((step) => String(step.run ?? ""))
    .join("\n");
  if (
    /gh\s+variable\s+(?:set|delete)|actions\/variables/iu.test(allProductionRun)
  ) {
    errors.push(
      "Production automation must not mutate reviewed remote-discovery variables.",
    );
  }
  if (RAW_DEPLOYMENT_EVIDENCE_JQ.test(allProductionRun)) {
    errors.push(
      "Production workflow outputs must consume validated evidence envelopes instead of re-reading raw deployment JSON.",
    );
  }

  const recoveryJobs = recovery?.jobs ?? {};
  const recoveryObserve = recoveryJobs.observe;
  const recoveryObserveRun = String(
    recoveryObserve?.steps?.find((step) => step.id === "evidence")?.run ?? "",
  );
  const recoverySwitch = recoveryJobs["observe-switch"];
  const recoveryRecordRun = String(
    recoverySwitch?.steps?.find((step) => step.id === "record")?.run ?? "",
  );
  const recoverySwitchRun = String(
    recoverySwitch?.steps?.find((step) => step.id === "observe")?.run ?? "",
  );
  const recoveryPages = recoveryJobs["restore-pages"];
  const recoveryVerifyPages = recoveryJobs["verify-pages"];
  const recoveryArchiveRun = String(
    recoveryObserve?.steps?.find(
      (step) => step.name === "Verify the preserved Pages archive",
    )?.run ?? "",
  );
  const recoveryPagesReadbackRun = String(
    recoveryVerifyPages?.steps?.find(
      (step) =>
        step.name === "Match the public locator to the preserved artifact",
    )?.run ?? "",
  );
  const recoveryMcp = recoveryJobs["restore-mcp"];
  const recoveryMcpRestoreRun = String(
    recoveryMcp?.steps?.find((step) => step.id === "restore")?.run ?? "",
  );
  const recoveryMcpReadbackRun = String(
    recoveryMcp?.steps?.find(
      (step) => step.name === "Verify both public tuples after recovery",
    )?.run ?? "",
  );
  const allRecoveryRun = workflowSteps(recovery)
    .map((step) => String(step.run ?? ""))
    .join("\n");
  if (
    !sameKeys(recoveryJobs, [
      "observe",
      "observe-switch",
      "restore-pages",
      "verify-pages",
      "restore-mcp",
    ]) ||
    recovery?.concurrency?.group !== "production-documentation-main" ||
    recovery?.concurrency?.["cancel-in-progress"] !== false ||
    !String(recoveryObserve?.if ?? "").includes(
      "workflow_run.conclusion != 'success'",
    ) ||
    !recoveryObserveRun.includes(
      "actions/runs/$FAILED_RUN_ID/attempts/$FAILED_RUN_ATTEMPT/jobs",
    ) ||
    !recoveryObserveRun.includes(
      "verify-production-deployment.mjs pages-phase",
    ) ||
    !recoveryObserveRun.includes("pages_phase") ||
    /rollback_count[^]*pages-required=true/u.test(recoveryObserveRun) ||
    !recoveryObserveRun.includes("actions/runs/$FAILED_RUN_ID/artifacts") ||
    !recoveryObserveRun.includes("record_count") ||
    !recoveryObserveRun.includes("switch_count") ||
    !recoveryObserveRun.includes("rollback_count") ||
    !needsExactly(recoverySwitch, ["observe"]) ||
    recoverySwitch?.environment !== "production-mcp" ||
    !String(recoverySwitch?.if ?? "").includes("record-present == 'true'") ||
    !recoveryRecordRun.includes("record --json") ||
    !recoveryRecordRun.includes("deployment.validated.json") ||
    !recoveryRecordRun.includes(".value.image") ||
    !recoverySwitchRun.includes("StrictHostKeyChecking=yes") ||
    !recoverySwitchRun.includes(" switch-observation ") ||
    !recoverySwitchRun.includes(" observe ") ||
    !recoverySwitchRun.includes("switch-observation --json") ||
    !recoverySwitchRun.includes("switch-observation.validated.json") ||
    recoverySwitch?.outputs?.["rollback-required"] !==
      "${{ steps.observe.outputs.rollback-required }}" ||
    !String(recoveryPages?.if ?? "").includes(
      "needs.observe.outputs.pages-required == 'true'",
    ) ||
    recoveryPages?.steps?.[0]?.with?.artifact_name !==
      "${{ needs.observe.outputs.rollback-artifact }}" ||
    !sameKeys(recoveryPages?.permissions, ["contents", "id-token", "pages"]) ||
    recoveryPages?.permissions?.contents !== "read" ||
    recoveryPages?.permissions?.pages !== "write" ||
    recoveryPages?.permissions?.["id-token"] !== "write" ||
    !needsExactly(recoveryVerifyPages, ["observe", "restore-pages"]) ||
    !String(recoveryVerifyPages?.if ?? "").includes(
      "needs.restore-pages.result == 'success'",
    ) ||
    !String(recoveryVerifyPages?.steps?.at(-1)?.run ?? "").includes(
      "_mcp/v2/current.json",
    ) ||
    !String(recoveryVerifyPages?.steps?.at(-1)?.run ?? "").includes("cmp -s") ||
    !recoveryArchiveRun.includes("archive-members-raw.txt") ||
    !recoveryArchiveRun.includes("archive-members-sorted.txt") ||
    !recoveryArchiveRun.includes("archive-duplicates.txt") ||
    /tar\s+-t[v]?f[^\n|]*\|\s*grep\s+[^\n]*-q/u.test(recoveryArchiveRun) ||
    !recoveryPagesReadbackRun.includes("archive-members-raw.txt") ||
    !recoveryPagesReadbackRun.includes('locator_member="./$locator_member"') ||
    !needsExactly(recoveryMcp, ["observe", "observe-switch", "verify-pages"]) ||
    !String(recoveryMcp?.if ?? "").includes(
      "needs.observe-switch.outputs.rollback-required == 'true'",
    ) ||
    !String(recoveryMcp?.if ?? "").includes(
      "needs.verify-pages.result == 'success'",
    ) ||
    !String(recoveryMcp?.if ?? "").includes(
      "needs.verify-pages.result == 'skipped'",
    ) ||
    !recoveryMcpRestoreRun.includes("StrictHostKeyChecking=yes") ||
    !recoveryMcpRestoreRun.includes(" observe ") ||
    !recoveryMcpRestoreRun.includes(" rollback ") ||
    !recoveryMcpRestoreRun.includes(".rollbackRequired") ||
    !recoveryMcpRestoreRun.includes("rollback --json") ||
    !recoveryMcpRestoreRun.includes("rollback.validated.json") ||
    !recoveryMcpRestoreRun.includes(
      "verify-production-deployment.mjs rollback",
    ) ||
    !recoveryMcpReadbackRun.includes("_mcp/v2/current.json") ||
    !recoveryMcpReadbackRun.includes(
      "verify-production-deployment.mjs ready",
    ) ||
    !recoveryMcpReadbackRun.includes("locator_status")
  ) {
    errors.push(
      "Cancelled or failed production runs must recover from their exact evidence under the production lock.",
    );
  }
  if (RAW_DEPLOYMENT_EVIDENCE_JQ.test(allRecoveryRun)) {
    errors.push(
      "Recovery workflow outputs must consume validated evidence envelopes instead of re-reading raw deployment JSON.",
    );
  }

  return errors;
}

export function findNestedWorkflowPaths(root) {
  const result = spawnSync(
    "git",
    [
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "-z",
      "--",
      "apps",
      "packages",
    ],
    { cwd: root, encoding: "utf8", windowsHide: true },
  );
  if (result.status !== 0) {
    throw new Error(
      result.stderr.trim() || "Unable to enumerate repository workflow files.",
    );
  }
  return result.stdout
    .split("\0")
    .filter((path) =>
      /^(?:apps|packages)\/[^\0]*\/\.github\/workflows\/.+\.ya?ml$/iu.test(
        path,
      ),
    )
    .sort();
}

export function loadWorkflowPolicyInput(root = process.cwd()) {
  const workflowRoot = join(root, ".github", "workflows");
  const load = (name) => parse(readFileSync(join(workflowRoot, name), "utf8"));
  return {
    ci: load("ci.yml"),
    candidate: load("candidate.yml"),
    dependabotPolicy: load("dependabot-policy.yml"),
    operations: load("operations-observe.yml"),
    pages: load("pages.yml"),
    recovery: load("production-recovery.yml"),
    releaseIntent: load("release-intent.yml"),
    rootWorkflowNames: readdirSync(workflowRoot)
      .filter((name) => /\.ya?ml$/iu.test(name))
      .sort(),
    nestedWorkflowPaths: findNestedWorkflowPaths(root),
  };
}

function main() {
  const errors = validateWorkflowPolicy(loadWorkflowPolicyInput());
  if (errors.length > 0) throw new Error(errors.join("\n"));
  process.stdout.write("Verified active workflow trust boundaries.\n");
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
