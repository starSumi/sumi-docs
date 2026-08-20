import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(SCRIPT_DIR, "..");
const ARTIFACTS_ROOT = join(REPOSITORY_ROOT, "artifacts");
const FULL_COMMIT = /^[0-9a-f]{40}$/u;
const PUBLIC_REGISTRY = "https://registry.npmjs.org/";

function fail(message) {
  throw new Error(message);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? REPOSITORY_ROOT,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    stdio: options.capture ? "pipe" : "inherit",
    env: options.env ?? process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = options.capture
      ? String(result.stderr || result.stdout || "").trim()
      : "";
    fail(
      `${command} ${args.join(" ")} failed with exit code ${result.status}.${detail ? ` ${detail}` : ""}`,
    );
  }
  return String(result.stdout ?? "");
}

function parseArguments(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key !== "--output" && key !== "--commit") {
      fail(`Unknown argument: ${key}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      fail(`${key} requires a value.`);
    }
    result[key.slice(2)] = value;
    index += 1;
  }
  if (!result.output || !result.commit) {
    fail("--output and --commit are required.");
  }
  return result;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function validatePublishMetadata(contract, mcp) {
  const errors = [];
  for (const [label, packageJson] of [
    ["corpus contract", contract],
    ["MCP", mcp],
  ]) {
    if (packageJson.private !== undefined) {
      errors.push(`${label} package must not declare private.`);
    }
    if (
      packageJson.publishConfig?.access !== "public" ||
      packageJson.publishConfig?.registry !== PUBLIC_REGISTRY
    ) {
      errors.push(
        `${label} package must use the reviewed public npm registry.`,
      );
    }
    if (packageJson.license !== "MIT") {
      errors.push(`${label} package must declare the project MIT license.`);
    }
  }
  if (contract.scripts?.prepack !== "node --run build") {
    errors.push("Corpus contract prepack must rebuild its distribution.");
  }
  if (!contract.files?.includes("LICENSE") || !mcp.files?.includes("LICENSE")) {
    errors.push("Both public packages must include their license file.");
  }
  if (mcp.dependencies?.["@sumi-os/corpus-contract"] !== "workspace:*") {
    errors.push("MCP source dependency must use the workspace protocol.");
  }
  return errors;
}

function assertRepositoryState(commit) {
  if (!FULL_COMMIT.test(commit)) fail("--commit must be a lowercase full SHA.");
  const root = resolve(
    run("git", ["rev-parse", "--show-toplevel"], { capture: true }).trim(),
  );
  if (root.toLowerCase() !== REPOSITORY_ROOT.toLowerCase()) {
    fail("The npm candidate must be built from the repository root.");
  }
  const head = run("git", ["rev-parse", "HEAD"], { capture: true }).trim();
  if (head !== commit) fail("--commit must equal the checked-out HEAD.");
  const status = run(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=all"],
    { capture: true },
  ).trim();
  if (status) fail("The npm candidate requires a clean Git worktree.");
}

function resolveOutput(value) {
  const output = resolve(REPOSITORY_ROOT, value);
  const relation = relative(ARTIFACTS_ROOT, output);
  if (
    !relation ||
    relation === ".." ||
    relation.startsWith(`..${sep}`) ||
    isAbsolute(relation)
  ) {
    fail("--output must be a child of the repository artifacts directory.");
  }
  if (existsSync(output) && readdirSync(output).length > 0) {
    fail("--output must not contain existing files.");
  }
  mkdirSync(output, { recursive: true });
  return output;
}

function pnpm(args) {
  const cli = process.env.npm_execpath;
  if (!cli || !existsSync(cli)) {
    fail("Run this command through the pinned pnpm lifecycle.");
  }
  run(process.execPath, [cli, ...args]);
}

let windowsNpmCli;

export function createNpmEnvironment(source = process.env) {
  const environment = { ...source };
  for (const key of Object.keys(environment)) {
    if (
      /^npm_(?:config|package|lifecycle)_/iu.test(key) ||
      /^(?:npm_command|npm_execpath|npm_node_execpath)$/iu.test(key)
    ) {
      delete environment[key];
    }
  }
  return environment;
}

function resolveWindowsNpmCli() {
  if (windowsNpmCli) return windowsNpmCli;
  const shims = run("where.exe", ["npm.cmd"], { capture: true })
    .split(/\r?\n/u)
    .map((value) => value.trim())
    .filter(Boolean);
  for (const shim of shims) {
    const candidate = join(dirname(shim), "node_modules/npm/bin/npm-cli.js");
    if (existsSync(candidate)) {
      windowsNpmCli = candidate;
      return candidate;
    }
  }
  fail("Unable to resolve npm-cli.js from the Windows PATH.");
}

function npm(args, cwd, capture = false) {
  if (process.platform === "win32") {
    return run(process.execPath, [resolveWindowsNpmCli(), ...args], {
      cwd,
      capture,
      env: createNpmEnvironment(),
    });
  }
  return run("npm", args, {
    cwd,
    capture,
    env: createNpmEnvironment(),
  });
}

function packageManagerVersion() {
  const cli = process.env.npm_execpath;
  if (!cli || !existsSync(cli)) {
    fail("Run this command through the pinned pnpm lifecycle.");
  }
  return run(process.execPath, [cli, "--version"], { capture: true }).trim();
}

function tar(args) {
  return run("tar", args, { capture: true });
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function assertPackedPackage(tarball, expected, contractVersion) {
  const packageJson = JSON.parse(
    tar(["-xOf", tarball, "package/package.json"]),
  );
  if (
    packageJson.name !== expected.name ||
    packageJson.version !== expected.version
  ) {
    fail(`Packed metadata mismatch for ${expected.name}.`);
  }
  if (packageJson.private !== undefined) {
    fail(`${expected.name} tarball still declares private.`);
  }
  if (
    packageJson.publishConfig?.access !== "public" ||
    packageJson.publishConfig?.registry !== PUBLIC_REGISTRY
  ) {
    fail(`${expected.name} tarball has unreviewed publication settings.`);
  }
  const members = new Set(
    tar(["-tf", tarball])
      .split(/\r?\n/u)
      .map((value) => value.replace(/^\.\//u, ""))
      .filter(Boolean),
  );
  if (!members.has("package/LICENSE")) {
    fail(`${expected.name} tarball does not contain LICENSE.`);
  }
  if (
    expected.name === "@sumi-os/docs-mcp" &&
    packageJson.dependencies?.["@sumi-os/corpus-contract"] !== contractVersion
  ) {
    fail("The MCP tarball must pin the packed corpus contract version.");
  }
}

function smokeConsumer(contractTarball, mcpTarball, version) {
  const consumer = mkdtempSync(join(tmpdir(), "sumi-docs-npm-consumer-"));
  try {
    writeFileSync(
      join(consumer, "package.json"),
      `${JSON.stringify({ name: "sumi-docs-candidate-consumer", private: true }, null, 2)}\n`,
    );
    npm(
      [
        "install",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--registry",
        PUBLIC_REGISTRY,
        contractTarball,
        mcpTarball,
      ],
      consumer,
    );
    const versionOutput = run(
      process.execPath,
      [
        join(consumer, "node_modules/@sumi-os/docs-mcp/dist/index.js"),
        "--version",
      ],
      { cwd: consumer, capture: true },
    ).trim();
    if (versionOutput !== version) {
      fail(`Installed CLI reported ${versionOutput || "no version"}.`);
    }
    run(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        "await import('@sumi-os/corpus-contract'); await import('@sumi-os/docs-mcp');",
      ],
      { cwd: consumer, capture: true },
    );
  } finally {
    rmSync(consumer, { recursive: true, force: true });
  }
}

function buildCandidate({ output, commit }) {
  assertRepositoryState(commit);
  const contract = readJson(
    join(REPOSITORY_ROOT, "packages/corpus-contract/package.json"),
  );
  const mcp = readJson(join(REPOSITORY_ROOT, "packages/mcp/package.json"));
  const metadataErrors = validatePublishMetadata(contract, mcp);
  if (metadataErrors.length > 0) fail(metadataErrors.join(" "));

  const target = resolveOutput(output);
  pnpm(["--filter", contract.name, "pack", "--pack-destination", target]);
  pnpm(["--filter", mcp.name, "pack", "--pack-destination", target]);

  const packages = [contract, mcp].map((packageJson) => {
    const filename = `${packageJson.name.slice(1).replace("/", "-")}-${packageJson.version}.tgz`;
    const path = join(target, filename);
    if (!existsSync(path))
      fail(`Expected tarball was not created: ${filename}`);
    assertPackedPackage(path, packageJson, contract.version);
    return {
      name: packageJson.name,
      version: packageJson.version,
      filename,
      bytes: statSync(path).size,
      sha256: sha256(path),
      path,
    };
  });

  smokeConsumer(packages[0].path, packages[1].path, mcp.version);

  for (const packageEntry of packages) {
    writeFileSync(
      `${packageEntry.path}.sha256`,
      `${packageEntry.sha256}  ${packageEntry.filename}\n`,
      "ascii",
    );
    delete packageEntry.path;
  }
  const manifest = {
    schemaVersion: 1,
    repository: "https://github.com/starSumi/sumi-docs",
    commit,
    toolchain: {
      node: process.version,
      pnpm: packageManagerVersion(),
      npm: npm(["--version"], REPOSITORY_ROOT, true).trim(),
    },
    packages,
    consumerSmoke: "passed",
  };
  writeFileSync(
    join(target, "npm-candidate.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  process.stdout.write(`${JSON.stringify(manifest)}\n`);
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    buildCandidate(parseArguments(process.argv.slice(2)));
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
