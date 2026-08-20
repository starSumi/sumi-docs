import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { test } from "node:test";

import { parse } from "yaml";

import {
  catalogPublisherDocuments,
  contentCatalog,
} from "../apps/web/src/content-catalog.ts";

import {
  ALLOWED_HOST_FILES,
  isHostControlledPath,
  parseIndexEntries,
  validateHostEntries,
} from "../scripts/verify-host-files.mjs";
import { validateLockfile } from "../scripts/verify-lockfile.mjs";
import { readNodeRuntimeLicense } from "../scripts/node-runtime-license.mjs";
import {
  createSbom,
  noticeSection,
} from "../scripts/build-compliance-artifacts.mjs";
import {
  REQUIRED_PNPM_VERSION,
  validatePackageManager,
} from "../scripts/enforce-package-manager.mjs";
import {
  verifyDependencyGraph,
  verifyNotices,
} from "../scripts/verify-compliance-artifacts.mjs";
import {
  loadWorkflowPolicyInput,
  validateWorkflowPolicy,
} from "../scripts/verify-workflows.mjs";
import {
  classifyPagesPhaseEvidence,
  createEvidenceEnvelope,
  decideProductionCompensation,
  deriveAllowedOriginHosts,
  mayRollbackMcp,
  productionArtifactNames,
  selectRecoveryArtifacts,
  validateDeploymentRecord,
  validateExpectedDeploymentRecord,
  validatePriorDiscovery,
  validatePriorSiteManifest,
  validateProductionEndpointConfiguration,
  validateReadyEvidence,
  validateRollbackRecord,
  validateSwitchObservation,
  validateSwitchRecord,
} from "../scripts/verify-production-deployment.mjs";
import {
  DOC_TRANSLATION_PATHS,
  gitBlobHash,
  validatePairRecord,
} from "../scripts/verify-translation-pairing.mjs";

test("host adapters use an exact case-sensitive allowlist", () => {
  for (const path of ALLOWED_HOST_FILES) {
    assert.equal(isHostControlledPath(path), true);
    assert.deepEqual(validateHostEntries([{ mode: "100644", path }]), []);
  }

  for (const path of [
    ".claude/projects/session.jsonl",
    ".codex/sessions/rollout.jsonl",
    ".agent/state.json",
    ".agents/logs/trace.json",
    ".agents/skills/sumi-docs-audit/README.md",
    ".agents/skills/sumi-docs-audit/reports/latest.md",
    ".vscode/settings.json",
    ".Claude/skills/sumi-docs-maintain/SKILL.md",
    ".MCP.json",
    ".mcp.local.json",
  ]) {
    assert.equal(isHostControlledPath(path), true);
    assert.match(
      validateHostEntries([{ mode: "100644", path }])[0],
      /not allowlisted/u,
    );
  }
});

test("host adapters reject symlinks and executable file modes", () => {
  const path = ".codex/config.toml";
  assert.match(validateHostEntries([{ mode: "120000", path }])[0], /regular/u);
  assert.match(validateHostEntries([{ mode: "100755", path }])[0], /regular/u);
  assert.match(
    validateHostEntries([{ mode: "120000", path: ".mcp.json" }])[0],
    /regular/u,
  );
});

test("tracked host adapter validation requires the complete supported set", () => {
  const complete = [...ALLOWED_HOST_FILES].map((path) => ({
    mode: "100644",
    path,
  }));
  assert.deepEqual(
    validateHostEntries(complete, { requireComplete: true }),
    [],
  );

  const errors = validateHostEntries(complete.slice(1), {
    requireComplete: true,
  });
  assert.deepEqual(errors, [
    `Required host adapter is not tracked: ${complete[0].path}`,
  ]);
});

test("project Skills have canonical metadata and host prompts", () => {
  for (const name of ["sumi-docs-audit", "sumi-docs-use", "sumi-docs-pr"]) {
    const skillPath = `.agents/skills/${name}/SKILL.md`;
    const source = readFileSync(skillPath, "utf8").replaceAll("\r\n", "\n");
    const frontmatterMatch = /^---\n([\s\S]+?)\n---\n/u.exec(source);
    assert.ok(frontmatterMatch, `${skillPath} requires YAML frontmatter.`);
    const frontmatter = parse(frontmatterMatch[1]);
    assert.equal(frontmatter.name, name);
    assert.match(frontmatter.description, /Use when/u);

    const metadataPath = `.agents/skills/${name}/agents/openai.yaml`;
    const metadata = parse(readFileSync(metadataPath, "utf8"));
    assert.equal(typeof metadata.interface.display_name, "string");
    assert.ok(
      metadata.interface.short_description.length >= 25 &&
        metadata.interface.short_description.length <= 64,
    );
    assert.match(
      metadata.interface.default_prompt,
      new RegExp(`\\$${name}`, "u"),
    );
  }
});

test("active SEA smoke instructions pass executable options to pnpm scripts", () => {
  const instructionPaths = [
    "packages/mcp/AGENTS.md",
    "packages/mcp/docs/development.md",
    "packages/mcp/docs/releasing.md",
    "packages/mcp/examples/basic/docs/development.md",
    "packages/mcp/examples/basic/docs/releasing.md",
  ];

  for (const path of instructionPaths) {
    const source = readFileSync(path, "utf8");
    assert.doesNotMatch(source, /example:smoke -- --executable/u, path);
    assert.match(source, /example:smoke --executable/u, path);
  }
});

test("GitHub issue forms preserve unique structured inputs", () => {
  for (const file of ["bug-report.yml", "feature-proposal.yml"]) {
    const form = parse(readFileSync(`.github/ISSUE_TEMPLATE/${file}`, "utf8"));
    assert.equal(typeof form.name, "string");
    assert.equal(typeof form.description, "string");
    assert.ok(Array.isArray(form.body) && form.body.length > 0);
    const ids = form.body.flatMap((entry) =>
      typeof entry.id === "string" ? [entry.id] : [],
    );
    assert.equal(new Set(ids).size, ids.length);
  }

  const config = parse(
    readFileSync(".github/ISSUE_TEMPLATE/config.yml", "utf8"),
  );
  assert.equal(config.blank_issues_enabled, false);
  assert.match(config.contact_links[0].url, /\/security\/advisories\/new$/u);
});

test("git index parsing is NUL-safe", () => {
  const output =
    "100644 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 0\t.codex/config.toml\0" +
    "100644 bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb 0\t.vscode/name\nwith-newline.json\0";
  assert.deepEqual(parseIndexEntries(output), [
    { mode: "100644", path: ".codex/config.toml" },
    { mode: "100644", path: ".vscode/name\nwith-newline.json" },
  ]);
});

test("lockfile policy rejects mirrors, weak integrity, and external links", () => {
  const base = {
    lockfileVersion: "9.0",
    importers: { ".": {} },
    packages: {
      "good@1.0.0": {
        resolution: { integrity: `sha512-${"A".repeat(86)}==` },
      },
    },
  };
  assert.deepEqual(validateLockfile(base).errors, []);

  for (const metadata of [
    {
      resolution: {
        tarball: "https://registry.npmmirror.com/bad/-/bad-1.0.0.tgz",
        integrity: `sha512-${"A".repeat(86)}==`,
      },
    },
    {
      resolution: {
        tarball: "http://registry.npmjs.org/bad/-/bad-1.0.0.tgz",
        integrity: `sha512-${"A".repeat(86)}==`,
      },
    },
    {
      resolution: { integrity: "sha1-weak" },
    },
    { resolution: { git: "https://example.invalid/repository.git" } },
  ]) {
    const result = validateLockfile({
      lockfileVersion: "9.0",
      importers: { ".": {} },
      packages: { "bad@1.0.0": metadata },
    });
    assert.ok(result.errors.length > 0);
  }
});

test("the install lifecycle requires the pinned pnpm version", () => {
  const rootPackage = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(rootPackage.packageManager, `pnpm@${REQUIRED_PNPM_VERSION}`);
  assert.equal(rootPackage.engines.pnpm, REQUIRED_PNPM_VERSION);
  assert.equal(
    rootPackage.scripts.preinstall,
    "node scripts/enforce-package-manager.mjs",
  );
  assert.equal(
    validatePackageManager(
      `pnpm/${REQUIRED_PNPM_VERSION} npm/? node/v25.5.0 win32 x64`,
    ),
    undefined,
  );
  assert.match(validatePackageManager("npm/11.15.0 node/v25.5.0"), /Use pnpm/u);
  assert.match(validatePackageManager("pnpm/10.25.0 npm/?"), /Expected pnpm/u);

  for (const workspacePackagePath of [
    "apps/web/package.json",
    "packages/corpus-contract/package.json",
    "packages/mcp/package.json",
  ]) {
    const workspacePackage = JSON.parse(
      readFileSync(workspacePackagePath, "utf8"),
    );
    assert.deepEqual(workspacePackage.volta, {
      extends: "../../package.json",
    });
  }

  const packageFiles = [
    "package.json",
    "apps/web/package.json",
    "packages/corpus-contract/package.json",
    "packages/mcp/package.json",
  ];
  for (const packageFile of packageFiles) {
    const manifest = JSON.parse(readFileSync(packageFile, "utf8"));
    for (const [name, command] of Object.entries(manifest.scripts ?? {})) {
      assert.doesNotMatch(
        command,
        /(?:^|&&|\|\|)\s*pnpm(?:\s+run)?\b/u,
        `${packageFile} script ${name} recursively invokes pnpm`,
      );
    }
  }

  for (const hookPath of [
    ".husky/commit-msg",
    ".husky/pre-commit",
    ".husky/pre-push",
  ]) {
    const hook = readFileSync(hookPath, "utf8");
    assert.match(hook, /command -v volta/u);
    assert.match(hook, /volta run --node 25\.5\.0 -- pnpm run/u);
    assert.match(hook, /else\n {2}pnpm run (?:commitlint|lint:staged|verify)/u);
  }

  const rootPackageManifest = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(
    rootPackageManifest.scripts["build:compliance"],
    "node scripts/build-compliance-artifacts.mjs && node scripts/verify-compliance-artifacts.mjs",
  );

  const accepted = spawnSync(
    process.execPath,
    ["scripts/enforce-package-manager.mjs"],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        npm_config_user_agent: `pnpm/${REQUIRED_PNPM_VERSION} npm/? node/v25.5.0 win32 x64`,
      },
    },
  );
  assert.equal(accepted.status, 0, accepted.stderr);

  const rejected = spawnSync(
    process.execPath,
    ["scripts/enforce-package-manager.mjs"],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        npm_config_user_agent: "npm/11.15.0 node/v25.5.0",
      },
    },
  );
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /Use pnpm/u);
});

test("Node runtime license discovery supports archive and Unix layouts", () => {
  const root = mkdtempSync(join(tmpdir(), "sumi-node-license-"));
  try {
    const archiveRoot = join(root, "archive");
    const unixBin = join(root, "unix", "bin");
    mkdirSync(archiveRoot, { recursive: true });
    mkdirSync(unixBin, { recursive: true });
    writeFileSync(join(archiveRoot, "LICENSE"), "archive license\n");
    writeFileSync(join(root, "unix", "LICENSE"), "unix license\n");

    assert.equal(
      readNodeRuntimeLicense(join(archiveRoot, "node.exe")).content.toString(),
      "archive license\n",
    );
    assert.equal(
      readNodeRuntimeLicense(join(unixBin, "node")).content.toString(),
      "unix license\n",
    );
    assert.throws(
      () => readNodeRuntimeLicense(join(root, "missing", "bin", "node")),
      /distribution license was not found/u,
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("compliance dependency edges resolve scoped pnpm-style siblings", () => {
  const root = mkdtempSync(join(tmpdir(), "sumi-compliance-graph-"));
  const appPath = join(root, "app");
  const parentPath = join(appPath, "node_modules", "@fixture", "parent");
  const childPath = join(appPath, "node_modules", "@fixture", "child");
  const writePackage = (path, manifest) => {
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, "package.json"), JSON.stringify(manifest));
    writeFileSync(join(path, "index.js"), "export {};\n");
  };

  try {
    const appManifest = {
      name: "fixture-app",
      version: "1.0.0",
      license: "MIT",
      dependencies: { "@fixture/parent": "1.0.0" },
    };
    const parentManifest = {
      name: "@fixture/parent",
      version: "1.0.0",
      license: "MIT",
      exports: { ".": { import: "./index.js" } },
      dependencies: { "@fixture/child": "1.0.0" },
    };
    const childManifest = {
      name: "@fixture/child",
      version: "1.0.0",
      license: "MIT",
      main: "index.js",
    };
    writePackage(appPath, appManifest);
    writePackage(parentPath, parentManifest);
    writePackage(childPath, childManifest);

    const components = [
      {
        identity: "@fixture/child@1.0.0",
        name: "@fixture/child",
        version: "1.0.0",
        license: "MIT",
        path: childPath,
      },
      {
        identity: "@fixture/parent@1.0.0",
        name: "@fixture/parent",
        version: "1.0.0",
        license: "MIT",
        path: parentPath,
      },
    ];
    const inventory = new Map(
      components.map((component) => [component.identity, component]),
    );
    const artifact = {
      key: "fixture",
      artifactRole: "test-input",
      manifest: appManifest,
      manifestPath: join(appPath, "package.json"),
      rootIdentity: "fixture-app@1.0.0",
      components: new Set(inventory.keys()),
      firstParty: new Map(),
      includeNode: false,
    };
    const bom = createSbom(artifact, components);
    assert.deepEqual(
      bom.dependencies.find((entry) => entry.ref === "fixture-app@1.0.0")
        .dependsOn,
      ["@fixture/parent@1.0.0"],
    );
    assert.deepEqual(
      bom.dependencies.find((entry) => entry.ref === "@fixture/parent@1.0.0")
        .dependsOn,
      ["@fixture/child@1.0.0"],
    );
    assert.doesNotThrow(() => verifyDependencyGraph(bom, artifact, inventory));

    const missingEdge = structuredClone(bom);
    missingEdge.dependencies.find(
      (entry) => entry.ref === "@fixture/parent@1.0.0",
    ).dependsOn = [];
    assert.throws(
      () => verifyDependencyGraph(missingEdge, artifact, inventory),
      /dependency edge set is incorrect/u,
    );

    const missingPath = join(root, "orphan", "@fixture", "missing");
    const missingComponent = {
      identity: "@fixture/missing@1.0.0",
      name: "@fixture/missing",
      version: "1.0.0",
      license: "MIT",
      path: missingPath,
    };
    writePackage(missingPath, {
      name: missingComponent.name,
      version: missingComponent.version,
      license: missingComponent.license,
      main: "index.js",
    });
    writeFileSync(
      join(parentPath, "package.json"),
      JSON.stringify({
        ...parentManifest,
        dependencies: {
          ...parentManifest.dependencies,
          "@fixture/missing": "1.0.0",
        },
      }),
    );
    components.push(missingComponent);
    inventory.set(missingComponent.identity, missingComponent);
    artifact.components.add(missingComponent.identity);
    assert.throws(
      () => createSbom(artifact, components),
      /Selected dependency @fixture\/missing cannot be resolved/u,
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("compliance notices require non-empty license evidence", () => {
  const root = mkdtempSync(join(tmpdir(), "sumi-compliance-license-"));
  const component = {
    identity: "fixture-license@1.0.0",
    name: "fixture-license",
    version: "1.0.0",
    license: "MIT",
    path: root,
  };

  try {
    writeFileSync(join(root, "NOTICE"), "Supplemental attribution.\n");
    assert.throws(
      () => noticeSection(component, "test-input", new Map()),
      /No non-empty license file or exact reviewed override/u,
    );

    writeFileSync(join(root, "LICENSE"), "  \n");
    assert.throws(
      () => noticeSection(component, "test-input", new Map()),
      /No non-empty license file or exact reviewed override/u,
    );

    const badOverride = new Map([
      [
        component.identity,
        {
          license: "MIT",
          source: "https://example.invalid/license",
          sha256: "0".repeat(64),
          text: "Reviewed terms",
          evidence: [],
        },
      ],
    ]);
    assert.throws(
      () => noticeSection(component, "test-input", badOverride),
      /override drifted/u,
    );

    writeFileSync(join(root, "LICENSE"), "Fixture license terms.\n");
    const section = noticeSection(component, "test-input", new Map());
    assert.match(section, /^License evidence: package-file$/mu);
    assert.match(section, /^License source: LICENSE$/mu);
    assert.match(section, /^Supplemental notice source: NOTICE$/mu);

    const noticesPath = join(root, "THIRD_PARTY_NOTICES.txt");
    const bom = {
      components: [
        {
          name: component.name,
          "bom-ref": component.identity,
          properties: [],
        },
      ],
    };
    writeFileSync(
      noticesPath,
      `THIRD-PARTY SOFTWARE NOTICES\n\n${section}\n\n${"=".repeat(80)}\n`,
    );
    assert.doesNotThrow(() => verifyNotices(noticesPath, bom));

    const malformed = section
      .replace("License source: LICENSE", "License source: NOTICE")
      .replace("----- LICENSE -----", "----- NOTICE -----");
    writeFileSync(
      noticesPath,
      `THIRD-PARTY SOFTWARE NOTICES\n\n${malformed}\n\n${"=".repeat(80)}\n`,
    );
    assert.throws(
      () => verifyNotices(noticesPath, bom),
      /package-file evidence is incomplete/u,
    );

    rmSync(join(root, "LICENSE"));
    const reviewedText = "Reviewed license terms";
    const validOverride = new Map([
      [
        component.identity,
        {
          license: "MIT",
          source: "https://example.invalid/license",
          sha256: createHash("sha256").update(reviewedText).digest("hex"),
          text: reviewedText,
          evidence: [],
        },
      ],
    ]);
    assert.match(
      noticeSection(component, "test-input", validOverride),
      /^License evidence: reviewed-override$/mu,
    );
    assert.throws(
      () =>
        noticeSection(
          { ...component, identity: "fixture-license@1.0.1" },
          "test-input",
          validOverride,
        ),
      /No non-empty license file or exact reviewed override/u,
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("product source directories contain TypeScript only", () => {
  const sourceRoots = [
    "apps/web/src",
    "packages/corpus-contract/src",
    "packages/mcp/src",
  ];
  const javascriptSources = [];
  const visitSource = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visitSource(path);
      else if (entry.isFile() && /\.(?:c|m)?js$/u.test(entry.name)) {
        javascriptSources.push(path.replaceAll("\\", "/"));
      }
    }
  };
  for (const root of sourceRoots) visitSource(root);
  assert.deepEqual(javascriptSources, []);
});

test("README translations require an exact confirmed content pair", () => {
  const contents = new Map([
    ["README.md", Buffer.from("English\n")],
    ["README.zh-CN.md", Buffer.from("Chinese\n")],
  ]);
  const record = Object.fromEntries(
    [...contents].map(([path, content]) => [path, gitBlobHash(content)]),
  );
  assert.deepEqual(validatePairRecord(record, contents), []);

  contents.set("README.md", Buffer.from("changed\n"));
  assert.match(validatePairRecord(record, contents)[0], /changed/u);
  assert.ok(
    validatePairRecord({ ...record, extra: "value" }, contents).some((error) =>
      error.includes("only"),
    ),
  );
});

test("the content catalog drives a complete bilingual freshness baseline", () => {
  assert.equal(DOC_TRANSLATION_PATHS.length, 38);
  assert.equal(new Set(DOC_TRANSLATION_PATHS).size, 38);
  assert.ok(DOC_TRANSLATION_PATHS.every((path) => path.startsWith("docs/")));

  const contents = new Map(
    DOC_TRANSLATION_PATHS.map((path) => [path, Buffer.from(`${path}\n`)]),
  );
  const record = Object.fromEntries(
    [...contents].map(([path, content]) => [path, gitBlobHash(content)]),
  );
  assert.deepEqual(
    validatePairRecord(record, contents, DOC_TRANSLATION_PATHS),
    [],
  );
});

test("mutable operational state stays outside Git and the public corpus", () => {
  const mutableStateName =
    /(?:^|\/)(?:current-state|candidate-(?:state|status)|checkpoint|cursor|state)\.[^/]+$/iu;
  const docsFiles = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile())
        docsFiles.push(relative("docs", path).replaceAll("\\", "/"));
    }
  };
  visit("docs");

  assert.deepEqual(
    docsFiles.filter((path) => mutableStateName.test(path)),
    [],
  );
  assert.deepEqual(
    catalogPublisherDocuments(contentCatalog)
      .map(({ source }) => source)
      .filter((path) => mutableStateName.test(path)),
    [],
  );

  const ignore = readFileSync(".gitignore", "utf8");
  assert.match(ignore, /(?:^|\n)\.agent\/(?:\r?\n|$)/u);

  for (const stableDocument of [
    "operations/checkpoints.md",
    "operations/handoff.md",
    "operations/release-readiness.md",
    "operations/evaluation-matrix.md",
  ]) {
    assert.ok(docsFiles.includes(stableDocument));
  }
});

test("Oxlint is the single repository lint engine", () => {
  const rootPackage = JSON.parse(readFileSync("package.json", "utf8"));
  const mcpPackage = JSON.parse(
    readFileSync("packages/mcp/package.json", "utf8"),
  );
  const config = JSON.parse(readFileSync(".oxlintrc.json", "utf8"));

  assert.equal(rootPackage.devDependencies.oxlint, "1.78.0");
  assert.match(rootPackage.scripts.lint, /^oxlint\b/u);
  assert.match(mcpPackage.scripts.lint, /^oxlint\b/u);
  assert.equal(existsSync("packages/mcp/eslint.config.js"), false);

  for (const dependency of ["eslint", "@eslint/js", "typescript-eslint"]) {
    assert.equal(rootPackage.devDependencies[dependency], undefined);
    assert.equal(mcpPackage.devDependencies[dependency], undefined);
  }

  assert.deepEqual(config.plugins, ["typescript"]);
  assert.equal(config.categories.correctness, "off");
  assert.equal(config.rules["no-unused-vars"], "error");
  assert.equal(config.rules["typescript/no-explicit-any"], "error");
  assert.equal(config.options.reportUnusedDisableDirectives, "error");
  const astroOverride = config.overrides.find((override) =>
    override.files?.includes("**/*.astro"),
  );
  assert.deepEqual(astroOverride?.globals, { Astro: "readonly" });
});

test("duplicate-code growth is bounded by one root policy", () => {
  const rootPackage = JSON.parse(readFileSync("package.json", "utf8"));
  const config = JSON.parse(readFileSync(".jscpd.json", "utf8"));

  assert.equal(rootPackage.devDependencies.jscpd, "5.0.12");
  assert.match(rootPackage.scripts.duplication, /^jscpd\b/u);
  assert.ok(rootPackage.scripts.verify.includes("node --run duplication"));
  assert.equal(config.threshold, 5);
  assert.equal(config.minTokens, 60);
  assert.ok(config.ignore.includes("**/tests/**"));
  assert.equal("exitCode" in config, false);
});

test("active workflows enforce privilege and supersession boundaries", () => {
  const input = loadWorkflowPolicyInput();
  assert.deepEqual(validateWorkflowPolicy(input), []);

  const weakened = structuredClone(input);
  weakened.candidate.permissions["id-token"] = "write";
  weakened.operations.jobs.observe.steps.find(
    (step) => step.name === "Upload immutable observation",
  ).if = "always()";
  weakened.candidate.jobs.build.steps =
    weakened.candidate.jobs.build.steps.filter(
      (step) => step.id !== "enforce-performance",
    );
  weakened.operations.jobs.observe.steps.find(
    (step) => step.name === "Observe product health",
  ).run += "\npnpm run verify 2>&1 | tee artifacts/operations/verify.log";
  weakened.candidate.jobs.build.steps.find(
    (step) => step.name === "Upload for human acceptance",
  ).with.path = "artifacts/*";
  weakened.candidate.jobs.build.steps.find(
    (step) => step.id === "performance",
  ).run =
    "pnpm run benchmark:cold-start -- --iterations 100 --output ../../artifacts/cold-start.json";
  weakened.candidate.jobs.build.steps.find(
    (step) => step.name === "Package candidate",
  ).run = [
    "pnpm run build:compliance",
    "Copy-Item artifacts/compliance/web/NODEJS_LICENSE.txt web",
    "Compress-Archive artifacts/bin/sumi-docs-mcp.exe artifacts/mcp.zip",
  ].join("\n");
  weakened.candidate.jobs.build.steps.find(
    (step) => step.name === "Smoke test Windows executable",
  ).run =
    "pnpm --filter @sumi-os/docs-mcp example:smoke -- --executable artifacts/bin/sumi-docs-mcp.exe";
  weakened.ci.jobs.verify.steps = weakened.ci.jobs.verify.steps.filter(
    (step) => step.name !== "Install the pinned package manager",
  );
  weakened.ci.jobs.container.steps.find(
    (step) => step.name === "Exercise the hardened container boundary",
  ).run = "docker run sumi-docs-mcp:acceptance";
  weakened.pages.jobs.build.steps.find(
    (step) => step.name === "Build and verify the release tuple",
  ).env.BASE_PATH = "/unreviewed/";
  delete weakened.pages.jobs.build.steps.find(
    (step) => step.name === "Build and verify the release tuple",
  ).env.PUBLIC_MCP_URL;
  delete weakened.pages.jobs.build.steps.find(
    (step) => step.name === "Build and verify the release tuple",
  ).env.PUBLIC_MCP_READINESS_URL;
  weakened.pages.jobs.build.steps.find(
    (step) =>
      step.name === "Observe the prior site and preserve its Pages artifact",
  ).run = "echo skipped";
  weakened.pages.jobs.build.steps.find(
    (step) => step.name === "Upload verified Pages artifact",
  ).with.path = ".";
  weakened.pages.jobs["deploy-pages"].permissions.contents = "write";
  const errors = validateWorkflowPolicy(weakened);
  assert.ok(errors.some((error) => error.includes("permissions")));
  assert.ok(errors.some((error) => error.includes("cancelled or superseded")));
  assert.ok(errors.some((error) => error.includes("performance diagnostics")));
  assert.ok(errors.some((error) => error.includes("structured allowlist")));
  assert.ok(errors.some((error) => error.includes("structured observation")));
  assert.ok(errors.some((error) => error.includes("compliance material")));
  assert.ok(errors.some((error) => error.includes("built SEA binary")));
  assert.ok(errors.some((error) => error.includes("pinned pnpm")));
  assert.ok(errors.some((error) => error.includes("stateless MCP container")));
  assert.ok(
    errors.some((error) =>
      error.includes("preserve rollback evidence and bind one Web projection"),
    ),
  );
  assert.ok(errors.some((error) => error.includes("Pages promotion")));
});

test("container acceptance builds the corpus contract before projection", () => {
  const weakened = loadWorkflowPolicyInput();
  weakened.ci.jobs.container.steps = weakened.ci.jobs.container.steps.filter(
    (step) => step.name !== "Build the corpus contract",
  );

  assert.ok(
    validateWorkflowPolicy(weakened).some((error) =>
      error.includes("build the corpus contract before machine projection"),
    ),
  );
});

test("production release checkpoint cannot be weakened", () => {
  const missingDependency = loadWorkflowPolicyInput();
  missingDependency.pages.jobs["release-checkpoint"].needs = [
    "build",
    "final-acceptance",
  ];
  assert.ok(
    validateWorkflowPolicy(missingDependency).some((error) =>
      error.includes("Release checkpoint"),
    ),
  );

  const mutableArtifact = loadWorkflowPolicyInput();
  mutableArtifact.pages.jobs["release-checkpoint"].steps.find(
    (step) => step.name === "Upload immutable release checkpoint",
  ).with.name = "release-checkpoint-latest";
  assert.ok(
    validateWorkflowPolicy(mutableArtifact).some((error) =>
      error.includes("Release checkpoint"),
    ),
  );
});

test("production deployment evidence is digest-pinned and corpus-bound", () => {
  const commit = "a".repeat(40);
  const corpusRevision = `sha256:${"b".repeat(64)}`;
  const imageDigest = `sha256:${"c".repeat(64)}`;
  const imageId = `sha256:${"d".repeat(64)}`;
  const record = {
    schemaVersion: 1,
    repository: "starSumi/sumi-docs",
    commit,
    corpusRevision,
    image: `ghcr.io/starsumi/sumi-docs@${imageDigest}`,
    imageId,
  };
  assert.deepEqual(validateDeploymentRecord(record), record);
  assert.deepEqual(
    validateExpectedDeploymentRecord(record, {
      repository: record.repository,
      commit,
      corpusRevision,
      image: record.image,
      imageId,
    }),
    record,
  );

  for (const [field, value] of [
    ["repository", "other/project"],
    ["commit", "f".repeat(40)],
    ["corpusRevision", imageDigest],
    ["image", `ghcr.io/other/project@${imageDigest}`],
    ["imageId", `sha256:${"e".repeat(64)}`],
  ]) {
    const expected = {
      repository: record.repository,
      commit,
      corpusRevision,
      image: record.image,
      imageId,
      [field]: value,
    };
    assert.throws(
      () => validateExpectedDeploymentRecord(record, expected),
      new RegExp(field, "iu"),
    );
  }

  for (const weakened of [
    { ...record, image: "ghcr.io/starsumi/sumi-docs:latest" },
    { ...record, commit: "main" },
    { ...record, corpusRevision: `sha256:${"e".repeat(63)}` },
    { ...record, imageId: "sumi-docs-mcp:local" },
    { ...record, unexpected: true },
  ]) {
    assert.throws(() => validateDeploymentRecord(weakened));
  }

  const ready = {
    status: "ready",
    buildRevision: commit,
    corpus: { documentCount: 38, revision: corpusRevision },
  };
  assert.doesNotThrow(() =>
    validateReadyEvidence(ready, { commit, corpusRevision }),
  );
  assert.throws(
    () =>
      validateReadyEvidence(
        { ...ready, buildRevision: "f".repeat(40) },
        { commit, corpusRevision },
      ),
    /build revision/u,
  );
  assert.throws(
    () =>
      validateReadyEvidence(
        { ...ready, corpus: { ...ready.corpus, revision: imageDigest } },
        { commit, corpusRevision },
      ),
    /corpus revision/u,
  );
});

test("validated deployment envelopes bind exact source bytes", () => {
  const record = {
    schemaVersion: 1,
    repository: "starSumi/sumi-docs",
    commit: "a".repeat(40),
    corpusRevision: `sha256:${"b".repeat(64)}`,
    image: `ghcr.io/starsumi/sumi-docs@sha256:${"c".repeat(64)}`,
    imageId: `sha256:${"d".repeat(64)}`,
  };
  const sourceBytes = Buffer.from(JSON.stringify(record));
  const validated = validateDeploymentRecord(JSON.parse(sourceBytes));
  const envelope = createEvidenceEnvelope(
    "deployment-record",
    sourceBytes,
    validated,
  );
  assert.deepEqual(envelope.value, record);
  assert.equal(
    envelope.evidenceSha256,
    `sha256:${createHash("sha256").update(sourceBytes).digest("hex")}`,
  );

  const replacedBytes = Buffer.from(`${JSON.stringify(record)}\n`);
  assert.notEqual(
    createEvidenceEnvelope(
      "deployment-record",
      replacedBytes,
      validateDeploymentRecord(JSON.parse(replacedBytes)),
    ).evidenceSha256,
    envelope.evidenceSha256,
    "even a byte-preserving semantic replacement must have a different evidence hash",
  );
  assert.equal(envelope.value.image, record.image);
  assert.throws(() =>
    validateDeploymentRecord({ ...record, unknownField: "unreviewed" }),
  );
});

test("production compensation follows the reviewed job-result table", () => {
  const base = {
    remoteEnabled: true,
    mcpRollbackPending: true,
    pagesPhase: "success",
    finalAcceptance: "success",
    finalizeMcp: "success",
  };
  const cases = [
    {
      name: "accepted tuple",
      state: base,
      expected: { restorePages: false, mcpRollbackRequired: false },
    },
    {
      name: "Pages deployment failure after MCP switch",
      state: {
        ...base,
        pagesPhase: "failure",
        finalAcceptance: "skipped",
        finalizeMcp: "skipped",
      },
      expected: { restorePages: true, mcpRollbackRequired: true },
    },
    {
      name: "Pages deployment cancellation after MCP switch",
      state: {
        ...base,
        pagesPhase: "cancelled",
        finalAcceptance: "skipped",
        finalizeMcp: "skipped",
      },
      expected: { restorePages: true, mcpRollbackRequired: true },
    },
    {
      name: "public acceptance failure",
      state: { ...base, finalAcceptance: "failure", finalizeMcp: "skipped" },
      expected: { restorePages: true, mcpRollbackRequired: true },
    },
    {
      name: "remote finalization failure",
      state: { ...base, finalizeMcp: "failure" },
      expected: { restorePages: true, mcpRollbackRequired: true },
    },
    {
      name: "idempotent stage followed by a later failure",
      state: {
        ...base,
        mcpRollbackPending: false,
        finalAcceptance: "failure",
        finalizeMcp: "skipped",
      },
      expected: { restorePages: true, mcpRollbackRequired: false },
    },
    {
      name: "switch succeeded but evidence upload failed before Pages",
      state: {
        ...base,
        pagesPhase: "not-attempted",
        finalAcceptance: "skipped",
        finalizeMcp: "skipped",
      },
      expected: { restorePages: false, mcpRollbackRequired: true },
    },
    {
      name: "publish or deploy failed before Pages without a switch",
      state: {
        ...base,
        mcpRollbackPending: false,
        pagesPhase: "not-attempted",
        finalAcceptance: "skipped",
        finalizeMcp: "skipped",
      },
      expected: { restorePages: false, mcpRollbackRequired: false },
    },
    {
      name: "Pages-only failure before the deploy action",
      state: {
        ...base,
        remoteEnabled: false,
        mcpRollbackPending: false,
        pagesPhase: "not-attempted",
        finalAcceptance: "skipped",
        finalizeMcp: "skipped",
      },
      expected: { restorePages: false, mcpRollbackRequired: false },
    },
  ];

  for (const testCase of cases) {
    assert.deepEqual(
      decideProductionCompensation(testCase.state),
      testCase.expected,
      testCase.name,
    );
  }

  const required = { restorePages: true, mcpRollbackRequired: true };
  assert.equal(mayRollbackMcp(required, "success"), true);
  for (const result of ["failure", "cancelled", "skipped"]) {
    assert.equal(
      mayRollbackMcp(required, result),
      false,
      `MCP rollback must wait when Pages compensation is ${result}`,
    );
  }
  assert.equal(
    mayRollbackMcp(
      { restorePages: false, mcpRollbackRequired: true },
      "skipped",
    ),
    true,
  );
  assert.throws(() =>
    decideProductionCompensation({ ...base, pagesPhase: "unknown" }),
  );
});

test("Pages phase evidence is explicit and unknown combinations fail closed", () => {
  const cases = [
    ["skipped", null, "not-attempted"],
    ["skipped", "skipped", "not-attempted"],
    ["cancelled", "skipped", "not-attempted"],
    ["success", "success", "success"],
    ["failure", "failure", "failure"],
    ["cancelled", "cancelled", "cancelled"],
  ];
  for (const [jobConclusion, stepConclusion, expected] of cases) {
    assert.equal(
      classifyPagesPhaseEvidence({ jobConclusion, stepConclusion }),
      expected,
    );
  }
  for (const evidence of [
    { jobConclusion: "success", stepConclusion: null },
    { jobConclusion: "failure", stepConclusion: "skipped" },
    { jobConclusion: "cancelled", stepConclusion: null },
    { jobConclusion: "success", stepConclusion: "failure" },
  ]) {
    assert.throws(
      () => classifyPagesPhaseEvidence(evidence),
      /Pages phase evidence/u,
    );
  }
});

test("failed-run recovery separates Pages phase from remote rollback evidence", () => {
  const workflows = loadWorkflowPolicyInput();
  const recoveryStep = workflows.recovery.jobs.observe.steps.find(
    (step) => step.id === "evidence",
  );
  const run = String(recoveryStep?.run ?? "");

  assert.match(run, /pages_phase/u);
  assert.match(run, /pages-required=false/u);
  assert.match(run, /record-present=/u);
  assert.doesNotMatch(run, /rollback_count[^]*pages-required=true/u);
  assert.match(
    String(workflows.recovery.jobs["restore-mcp"].if),
    /observe-switch\.outputs\.rollback-required/u,
  );
});

test("production workflows never derive outputs from raw JSON after validation", () => {
  const exact = loadWorkflowPolicyInput();

  const weakenedRelease = structuredClone(exact);
  const releaseSwitch = weakenedRelease.pages.jobs["deploy-mcp"].steps.find(
    (step) => step.id === "switch",
  );
  releaseSwitch.run = releaseSwitch.run.replaceAll(
    "switch.validated.json",
    "switch.json",
  );
  assert.ok(
    validateWorkflowPolicy(weakenedRelease).some((error) =>
      error.includes("validated evidence envelopes"),
    ),
  );

  const weakenedRecovery = structuredClone(exact);
  const recoveryRecord = weakenedRecovery.recovery.jobs[
    "observe-switch"
  ].steps.find((step) => step.id === "record");
  recoveryRecord.run = recoveryRecord.run.replaceAll(
    "deployment.validated.json",
    "deployment.json",
  );
  assert.ok(
    validateWorkflowPolicy(weakenedRecovery).some((error) =>
      error.includes("validated evidence envelopes"),
    ),
  );
});

test("production recovery uses durable switch and explicit Pages phase evidence", () => {
  const workflows = loadWorkflowPolicyInput();
  const pagesJobs = workflows.pages.jobs;
  const switchObservation = pagesJobs["observe-switch"];
  assert.ok(switchObservation);
  assert.match(
    String(
      switchObservation.steps.find(
        (step) => step.name === "Observe the durable remote switch transaction",
      )?.run ?? "",
    ),
    /switch-observation/u,
  );
  assert.ok(pagesJobs["deploy-pages"].needs.includes("observe-switch"));

  const recoveryEvidence = workflows.recovery.jobs.observe.steps.find(
    (step) => step.id === "evidence",
  );
  const recoveryRun = String(recoveryEvidence?.run ?? "");
  assert.match(recoveryRun, /attempts\/\$FAILED_RUN_ATTEMPT\/jobs/u);
  assert.match(recoveryRun, /pages-phase/u);
  assert.doesNotMatch(recoveryRun, /rollback_count[^]*pages-required=true/u);
  assert.ok(workflows.recovery.jobs["observe-switch"]);

  const remoteScript = readFileSync("scripts/deploy-remote-mcp.sh", "utf8");
  const stage = remoteScript.slice(
    remoteScript.indexOf("stage()"),
    remoteScript.indexOf("finalize()"),
  );
  assert.match(remoteScript, /transaction_name/u);
  assert.match(remoteScript, /terminal_name/u);
  assert.match(remoteScript, /write_transaction_terminal/u);
  assert.match(remoteScript, /complete-rollback/u);
  assert.match(remoteScript, /observe\)/u);
  assert.match(remoteScript, /state":"prepared"/u);
  assert.ok(
    stage.indexOf("write_transaction_intent") < stage.indexOf("docker stop"),
    "durable intent must precede mutation of the stable container",
  );
  assert.ok(
    stage.indexOf('wait_until_ready "$stable_name"') <
      stage.indexOf("write_transaction_completion"),
    "completion evidence must follow stable readiness",
  );

  const rollback = remoteScript.slice(
    remoteScript.indexOf("rollback()"),
    remoteScript.indexOf('command="${1:-}"'),
  );
  assert.ok(
    rollback.lastIndexOf("write_transaction_terminal") <
      rollback.lastIndexOf("printf"),
    "rollback terminal evidence must precede the success response",
  );
  const releaseRollback = pagesJobs["rollback-mcp"].steps;
  assert.ok(
    releaseRollback.findIndex(
      (step) => step.name === "Verify the compensated public tuple",
    ) <
      releaseRollback.findIndex(
        (step) => step.name === "Complete the compensated remote transaction",
      ),
    "public rollback readback must precede terminal cleanup",
  );
});

test("production artifact inventory is bound to run ID and attempt", () => {
  const attempt1 = productionArtifactNames("700", "1");
  const attempt2 = productionArtifactNames("700", "2");
  assert.notDeepEqual(attempt1, attempt2);
  const inventory = {
    artifacts: [
      { id: 1, name: attempt1.record, expired: false },
      { id: 2, name: attempt1.switch, expired: false },
      { id: 3, name: attempt1.rollbackPages, expired: false },
      { id: 4, name: attempt2.record, expired: false },
      { id: 5, name: attempt2.switch, expired: false },
      { id: 6, name: attempt2.rollbackPages, expired: false },
      { id: 7, name: attempt2.checkpoint, expired: false },
    ],
  };
  assert.deepEqual(selectRecoveryArtifacts(inventory, "700", "2"), {
    names: attempt2,
    recordIds: [4],
    switchIds: [5],
    rollbackPagesIds: [6],
  });

  const workflows = loadWorkflowPolicyInput();
  assert.equal(
    workflows.pages.jobs.build.outputs["image-artifact"],
    "mcp-image-${{ github.run_id }}-${{ github.run_attempt }}",
  );
  assert.match(
    String(
      workflows.recovery.jobs.observe.steps.find(
        (step) => step.id === "evidence",
      )?.run ?? "",
    ),
    /artifact-inventory[^]*FAILED_RUN_ATTEMPT/u,
  );
});

test("production origins are normalized before the MCP CLI boundary", () => {
  const workflows = loadWorkflowPolicyInput();
  const remotePreflight = workflows.pages.jobs["remote-preflight"];
  assert.equal(
    remotePreflight.outputs["allowed-origin-hosts"],
    "${{ steps.config.outputs.allowed-origin-hosts }}",
  );
  const endpointRun = String(
    remotePreflight.steps.find(
      (step) => step.name === "Validate public endpoint configuration",
    )?.run ?? "",
  );
  assert.match(endpointRun, /origin-hosts/u);
  const switchStep = workflows.pages.jobs["deploy-mcp"].steps.find(
    (step) => step.id === "switch",
  );
  assert.equal(
    switchStep.env.DEPLOY_ALLOWED_ORIGIN_HOSTS,
    "${{ needs.build.outputs.allowed-origin-hosts }}",
  );
  assert.equal(
    switchStep.env.DEPLOY_ALLOWED_HOSTS,
    "${{ needs.build.outputs.allowed-hosts }}",
  );
  assert.doesNotMatch(String(switchStep.run), /\$DEPLOY_ALLOWED_ORIGINS/u);

  const entrypoint = readFileSync(
    "packages/mcp/scripts/container-entrypoint.mjs",
    "utf8",
  );
  assert.match(entrypoint, /commaSeparated\("SUMI_DOCS_ALLOWED_ORIGINS"\)/u);
  assert.match(
    entrypoint,
    /repeatedOption\("--allowed-origin", allowedOrigins\)/u,
  );
  const deployment = readFileSync("scripts/deploy-remote-mcp.sh", "utf8");
  assert.match(deployment, /SUMI_DOCS_ALLOWED_ORIGINS=\$allowed_origin_hosts/u);
  assert.match(deployment, /require_hostname_csv/u);
  assert.match(
    deployment,
    /require_hostname_csv "\$allowed_hosts" "allowed hosts"/u,
  );
  assert.match(
    deployment,
    /require_hostname_csv "\$allowed_origin_hosts" "allowed origin hosts"/u,
  );
});

test("switch and rollback evidence distinguish changed and idempotent stages", () => {
  const expected = {
    commit: "a".repeat(40),
    image: `ghcr.io/starsumi/sumi-docs@sha256:${"b".repeat(64)}`,
    imageId: `sha256:${"c".repeat(64)}`,
  };
  const idempotent = {
    schemaVersion: 1,
    changed: false,
    token: expected.commit.slice(0, 12),
    newImage: expected.image,
    newImageId: expected.imageId,
    oldImage: null,
    oldImageId: null,
  };
  assert.deepEqual(validateSwitchRecord(idempotent, expected), idempotent);
  assert.throws(() =>
    validateSwitchRecord(
      { ...idempotent, oldImageId: `sha256:${"d".repeat(64)}` },
      expected,
    ),
  );

  const changed = {
    ...idempotent,
    changed: true,
    oldImage: `ghcr.io/starsumi/sumi-docs@sha256:${"e".repeat(64)}`,
    oldImageId: `sha256:${"f".repeat(64)}`,
  };
  assert.deepEqual(validateSwitchRecord(changed, expected), changed);
  assert.throws(() =>
    validateSwitchRecord({ ...changed, token: "wrong-token" }, expected),
  );

  assert.deepEqual(
    validateSwitchObservation(
      {
        schemaVersion: 1,
        state: "changed",
        priorState: "present",
        rollbackRequired: true,
        switch: changed,
      },
      expected,
    ),
    {
      schemaVersion: 1,
      state: "changed",
      priorState: "present",
      rollbackRequired: true,
      switch: changed,
    },
  );
  assert.deepEqual(
    validateSwitchObservation(
      {
        schemaVersion: 1,
        state: "idempotent",
        priorState: "absent",
        rollbackRequired: false,
        switch: idempotent,
      },
      expected,
    ),
    {
      schemaVersion: 1,
      state: "idempotent",
      priorState: "absent",
      rollbackRequired: false,
      switch: idempotent,
    },
  );
  assert.deepEqual(
    validateSwitchObservation(
      {
        schemaVersion: 1,
        state: "absent",
        priorState: "absent",
        rollbackRequired: false,
        switch: null,
      },
      expected,
    ),
    {
      schemaVersion: 1,
      state: "absent",
      priorState: "absent",
      rollbackRequired: false,
      switch: null,
    },
  );
  assert.deepEqual(
    validateSwitchObservation(
      {
        schemaVersion: 1,
        state: "prepared",
        priorState: "present",
        rollbackRequired: true,
        switch: null,
      },
      expected,
    ),
    {
      schemaVersion: 1,
      state: "prepared",
      priorState: "present",
      rollbackRequired: true,
      switch: null,
    },
  );
  for (const state of ["committed", "rolled-back"]) {
    const terminal = {
      schemaVersion: 1,
      state,
      priorState: "present",
      rollbackRequired: false,
      switch: null,
    };
    assert.deepEqual(validateSwitchObservation(terminal, expected), terminal);
    assert.throws(() =>
      validateSwitchObservation(
        { ...terminal, rollbackRequired: true },
        expected,
      ),
    );
  }
  assert.throws(() =>
    validateSwitchObservation(
      {
        schemaVersion: 1,
        state: "changed",
        priorState: "present",
        rollbackRequired: true,
        switch: null,
      },
      expected,
    ),
  );

  const rollback = {
    schemaVersion: 1,
    restored: true,
    image: changed.oldImage,
    imageId: changed.oldImageId,
    buildRevision: "d".repeat(40),
    corpusRevision: `sha256:${"e".repeat(64)}`,
  };
  assert.deepEqual(validateRollbackRecord(rollback), rollback);
  assert.throws(() =>
    validateRollbackRecord({ ...rollback, corpusRevision: "unknown" }),
  );
});

test("prior Pages rollback provenance is content-addressed and repository-bound", () => {
  const manifest = JSON.parse(
    readFileSync(
      "packages/corpus-contract/fixtures/valid/manifest-v2.json",
      "utf8",
    ),
  );
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  const revisionHex = manifest.revision.slice("sha256:".length);
  const locatorBytes = Buffer.from(
    JSON.stringify({
      version: 2,
      revision: manifest.revision,
      manifest: `snapshots/${revisionHex}/manifest.json`,
      bytes: manifestBytes.byteLength,
      sha256: createHash("sha256").update(manifestBytes).digest("hex"),
    }),
  );
  assert.deepEqual(
    validatePriorSiteManifest(locatorBytes, manifestBytes, {
      repository: "https://github.com/starSumi/sumi-docs",
    }),
    {
      commit: "a".repeat(40),
      manifest: `snapshots/${revisionHex}/manifest.json`,
    },
  );
  assert.throws(
    () =>
      validatePriorSiteManifest(locatorBytes, manifestBytes, {
        repository: "https://github.com/other/project",
      }),
    /provenance/u,
  );
  const alteredManifest = Buffer.from(manifestBytes);
  alteredManifest[0] ^= 1;
  assert.throws(
    () =>
      validatePriorSiteManifest(locatorBytes, alteredManifest, {
        repository: "https://github.com/starSumi/sumi-docs",
      }),
    /integrity/u,
  );

  const discovery = Buffer.from(
    '{"remotes":[{"type":"streamable-http","url":"https://docs.example/mcp"}]}',
  );
  assert.deepEqual(
    validatePriorDiscovery({
      liveStatus: 200,
      artifactStatus: 200,
      liveBytes: discovery,
      artifactBytes: discovery,
    }),
    { status: 200 },
  );
  assert.deepEqual(
    validatePriorDiscovery({
      liveStatus: 404,
      artifactStatus: 404,
      liveBytes: null,
      artifactBytes: null,
    }),
    { status: 404 },
  );
  assert.throws(() =>
    validatePriorDiscovery({
      liveStatus: 200,
      artifactStatus: 200,
      liveBytes: discovery,
      artifactBytes: Buffer.from(
        '{"remotes":[{"type":"streamable-http","url":"https://other.example/mcp"}]}',
      ),
    }),
  );
  assert.throws(() =>
    validatePriorDiscovery({
      liveStatus: 404,
      artifactStatus: 200,
      liveBytes: null,
      artifactBytes: discovery,
    }),
  );

  const workflows = loadWorkflowPolicyInput();
  const priorRun = String(
    workflows.pages.jobs.build.steps.find(
      (step) =>
        step.name === "Observe the prior site and preserve its Pages artifact",
    )?.run ?? "",
  );
  assert.match(priorRun, /_mcp\/server\.json/u);
  assert.match(priorRun, /prior-discovery/u);
  assert.match(priorRun, /archive-members-raw\.txt/u);
  assert.match(priorRun, /sed 's#\^\\\.\/##'/u);
  assert.match(priorRun, /archive-duplicates\.txt/u);
  assert.match(priorRun, /locator_member="\.\/\$locator_member"/u);
  assert.doesNotMatch(priorRun, /tar\s+-t[v]?f[^\n|]*\|\s*grep\s+[^\n]*-q/u);

  const recoveryArchiveRun = String(
    workflows.recovery.jobs.observe.steps.find(
      (step) => step.name === "Verify the preserved Pages archive",
    )?.run ?? "",
  );
  const mainReadbackRun = String(
    workflows.pages.jobs["rollback-mcp"].steps.find(
      (step) => step.name === "Verify the compensated public tuple",
    )?.run ?? "",
  );
  const recoveryReadbackRun = String(
    workflows.recovery.jobs["verify-pages"].steps.find(
      (step) =>
        step.name === "Match the public locator to the preserved artifact",
    )?.run ?? "",
  );
  assert.match(recoveryArchiveRun, /sed 's#\^\\\.\/##'/u);
  assert.match(recoveryArchiveRun, /archive-duplicates\.txt/u);
  assert.doesNotMatch(
    recoveryArchiveRun,
    /tar\s+-t[v]?f[^\n|]*\|\s*grep\s+[^\n]*-q/u,
  );
  for (const readbackRun of [mainReadbackRun, recoveryReadbackRun]) {
    assert.match(readbackRun, /archive-members-raw\.txt/u);
    assert.match(readbackRun, /locator_member="\.\/\$locator_member"/u);
    assert.doesNotMatch(
      readbackRun,
      /tar\s+-xf[^\n]*\s_mcp\/v2\/current\.json/u,
    );
  }
});

test("production endpoint configuration is explicit HTTPS bootstrap input", () => {
  const configuration = {
    mcpUrl: "https://docs.example.test/mcp",
    readinessUrl: "https://docs.example.test/readyz",
    allowedHosts: "docs.example.test,localhost,127.0.0.1",
    allowedOrigins: "https://docs.example.test",
  };
  assert.deepEqual(
    validateProductionEndpointConfiguration(configuration),
    configuration,
  );
  assert.deepEqual(
    validateProductionEndpointConfiguration({
      ...configuration,
      allowedOrigins: "https://docs.example.test:443",
    }),
    { ...configuration, allowedOrigins: "https://docs.example.test:443" },
  );
  assert.deepEqual(
    deriveAllowedOriginHosts(
      "https://docs.example.test:8443,https://b\u00fccher.example",
    ),
    ["docs.example.test", "xn--bcher-kva.example"],
  );
  for (const origins of [
    "https://docs.example.test,https://docs.example.test:8443",
    "https://b\u00fccher.example,https://xn--bcher-kva.example",
    "https://docs.example.test/path",
    "http://docs.example.test",
  ]) {
    assert.throws(() => deriveAllowedOriginHosts(origins));
  }
  for (const weakened of [
    { ...configuration, mcpUrl: "http://docs.example.test/mcp" },
    { ...configuration, readinessUrl: "https://other.example.test/readyz" },
    { ...configuration, allowedHosts: "localhost,127.0.0.1" },
    { ...configuration, allowedOrigins: "*" },
    { ...configuration, extra: "unreviewed" },
  ]) {
    assert.throws(() => validateProductionEndpointConfiguration(weakened));
  }
});

test("Pages publication fails closed after an upstream failure", () => {
  const input = loadWorkflowPolicyInput();
  const cases = [
    {
      mutate(workflows) {
        workflows.pages.jobs.build.steps.find(
          (step) =>
            step.name ===
            "Observe the prior site and preserve its Pages artifact",
        ).run = "echo site=true >> $GITHUB_OUTPUT";
      },
      expected: "rollback evidence",
    },
    {
      mutate(workflows) {
        workflows.pages.jobs.build.steps.find(
          (step) => step.name === "Upload verified Pages artifact",
        ).with.path = ".";
      },
      expected: "rollback evidence",
    },
    {
      mutate(workflows) {
        workflows.pages.jobs["deploy-pages"].needs = "build";
      },
      expected: "Pages promotion",
    },
    {
      mutate(workflows) {
        const step = workflows.pages.jobs["deploy-mcp"].steps.find(
          (candidate) => candidate.id === "switch",
        );
        step.run = step.run.replace("trap 'rollback 143' TERM", "true");
      },
      expected: "immediate compensation",
    },
    {
      mutate(workflows) {
        const step = workflows.pages.jobs["deploy-mcp"].steps.find(
          (candidate) => candidate.id === "switch",
        );
        step.run = step.run.replace(
          'echo "switched=$switched"',
          "echo 'switched=true'",
        );
      },
      expected: "Remote MCP deployment",
    },
    {
      mutate(workflows) {
        workflows.pages.jobs["compensation-plan"].steps.find(
          (candidate) =>
            candidate.name === "Compute the table-driven compensation plan",
        ).run = "echo restore-pages=false >> $GITHUB_OUTPUT";
      },
      expected: "Production compensation",
    },
    {
      mutate(workflows) {
        workflows.pages.jobs["rollback-mcp"].if = workflows.pages.jobs[
          "rollback-mcp"
        ].if.replace(
          "needs.rollback-pages.result == 'success'",
          "needs.rollback-pages.result != 'success'",
        );
      },
      expected: "Production compensation",
    },
    {
      mutate(workflows) {
        const step = workflows.pages.jobs["final-acceptance"].steps.find(
          (candidate) =>
            candidate.name === "Verify the public Pages publication",
        );
        step.run = step.run.replace(
          'site_root="${SITE_ORIGIN%/}${SITE_BASE_PATH}"',
          'site_root="https://example.invalid"',
        );
      },
      expected: "Final acceptance",
    },
  ];

  for (const testCase of cases) {
    const weakened = structuredClone(input);
    testCase.mutate(weakened);
    assert.ok(
      validateWorkflowPolicy(weakened).some((error) =>
        error.includes(testCase.expected),
      ),
    );
  }
});

test("container acceptance rejects weakened protocol and lifecycle checks", () => {
  const exact = loadWorkflowPolicyInput();
  const variants = [
    ["accept: application/json, text/event-stream", "accept: application/json"],
    [".buildRevision == $revision", '.status == "ready"'],
    ["docker stop --time 10", "docker rm --force"],
    [".State.ExitCode", ".State.Running"],
  ];

  for (const [required, weakenedValue] of variants) {
    const weakened = structuredClone(exact);
    const step = weakened.ci.jobs.container.steps.find(
      (candidate) =>
        candidate.name === "Exercise the hardened container boundary",
    );
    step.run = step.run.replace(required, weakenedValue);
    assert.ok(
      validateWorkflowPolicy(weakened).some((error) =>
        error.includes("stateless MCP container"),
      ),
      required,
    );
  }
});

test("candidate cold-start evidence command rejects weakened or custom baselines", () => {
  const exactCommand = [
    "New-Item -ItemType Directory -Force artifacts | Out-Null",
    "pnpm run benchmark:cold-start --docs examples/basic/docs --iterations 100 --executable artifacts/bin/sumi-docs-mcp.exe --output ../../artifacts/cold-start.json",
    "exit $LASTEXITCODE",
  ].join("\n");
  const variants = [
    exactCommand.replace("--docs examples/basic/docs ", ""),
    exactCommand.replace("--executable artifacts/bin/sumi-docs-mcp.exe ", ""),
    exactCommand.replace("--iterations 100", "--iterations 1"),
    exactCommand.replace(" --output", " --raw-executable custom.exe --output"),
    exactCommand.replace(" --output", " --sdk-executable custom.exe --output"),
    exactCommand.replace(" --output ../../artifacts/cold-start.json", ""),
  ];

  const valid = loadWorkflowPolicyInput();
  valid.candidate.jobs.build.steps.find(
    (step) => step.id === "performance",
  ).run = exactCommand;
  assert.deepEqual(validateWorkflowPolicy(valid), []);

  for (const run of variants) {
    const weakened = structuredClone(valid);
    weakened.candidate.jobs.build.steps.find(
      (step) => step.id === "performance",
    ).run = run;
    assert.ok(
      validateWorkflowPolicy(weakened).some((error) =>
        error.includes("performance diagnostics"),
      ),
      run,
    );
  }
});
