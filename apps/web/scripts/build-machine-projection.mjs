import { lstat } from "node:fs/promises";
import { execFile as execFileCallback } from "node:child_process";
import { parseArgs } from "node:util";
import { dirname, isAbsolute, parse, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  capturePublicationInputs,
  normalizePublisherOptions,
  publishProjection,
} from "../integrations/sumi-docs-publisher.mjs";
import { contentCatalog } from "../src/content-catalog.ts";

const FULL_COMMIT = /^[a-f0-9]{40}$/;
const execFile = promisify(execFileCallback);
const defaultWorkspaceRoot = resolve(
  fileURLToPath(new URL("../../../", import.meta.url)),
);
const defaultContentRoot = resolve(defaultWorkspaceRoot, "docs");
const defaultPublicDir = resolve(
  fileURLToPath(new URL("../public/", import.meta.url)),
);

function isContained(root, candidate) {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

function normalizeRepository(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("Machine projection provenance repository is required.");
  }
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error(
      "Machine projection provenance repository must be an absolute HTTPS URL.",
    );
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "Machine projection provenance repository must use HTTPS without credentials, query, or fragment.",
    );
  }
  let pathname = url.pathname.replace(/\/+$/u, "");
  if (pathname.endsWith(".git")) pathname = pathname.slice(0, -4);
  if (!pathname || pathname === "/") {
    throw new Error(
      "Machine projection provenance repository must identify a repository path.",
    );
  }
  url.pathname = pathname;
  return url.href;
}

function normalizeGitRemote(value) {
  const trimmed = value.trim();
  const scpLike = /^git@([^:]+):(.+)$/u.exec(trimmed);
  if (scpLike) {
    return normalizeRepository(`https://${scpLike[1]}/${scpLike[2]}`);
  }
  if (trimmed.startsWith("ssh://git@")) {
    const url = new URL(trimmed);
    return normalizeRepository(`https://${url.host}${url.pathname}`);
  }
  return normalizeRepository(trimmed);
}

async function runGit(args, workspaceRoot) {
  try {
    const { stdout } = await execFile("git", ["-C", workspaceRoot, ...args], {
      encoding: "utf8",
      windowsHide: true,
      env: Object.fromEntries(
        Object.entries(process.env).filter(
          ([key]) => !["GIT_DIR", "GIT_WORK_TREE"].includes(key),
        ),
      ),
    });
    return stdout;
  } catch {
    throw new Error("Machine projection Git provenance could not be verified.");
  }
}

export async function assertGitProvenance(
  provenance,
  workspaceRoot = defaultWorkspaceRoot,
  git = runGit,
) {
  const root = resolve(workspaceRoot);
  const actualRoot = resolve(
    (await git(["rev-parse", "--show-toplevel"], root)).trim(),
  );
  if (actualRoot !== root) {
    throw new Error(
      "Machine projection workspace must be the verified Git repository root.",
    );
  }

  const head = (await git(["rev-parse", "HEAD"], root)).trim();
  if (head !== provenance.commit) {
    throw new Error(
      "Machine projection provenance commit does not match the current Git HEAD.",
    );
  }

  const status = (
    await git(["status", "--porcelain=v1", "--untracked-files=all"], root)
  ).trim();
  if (status) {
    throw new Error(
      "Machine projection requires a clean Git working tree and index.",
    );
  }

  const origin = normalizeGitRemote(
    (await git(["config", "--get", "remote.origin.url"], root)).trim(),
  );
  if (origin !== provenance.repository) {
    throw new Error(
      "Machine projection provenance repository does not match the Git origin.",
    );
  }
}

function assertSafeOutputRoot(outputRoot, paths) {
  if (outputRoot === parse(outputRoot).root) {
    throw new Error("Machine projection output must not be a filesystem root.");
  }
  if (
    outputRoot === paths.workspaceRoot ||
    isContained(outputRoot, paths.workspaceRoot) ||
    isContained(paths.contentRoot, outputRoot) ||
    isContained(outputRoot, paths.contentRoot) ||
    isContained(paths.publicDir, outputRoot) ||
    isContained(outputRoot, paths.publicDir)
  ) {
    throw new Error(
      "Machine projection output must not overlap the workspace root or publication inputs.",
    );
  }
}

async function assertNoSymlinkSegments(outputRoot) {
  let current = outputRoot;
  while (true) {
    try {
      const status = await lstat(current);
      if (status.isSymbolicLink()) {
        throw new Error(
          "Machine projection output must not traverse a symbolic link.",
        );
      }
      if (current === outputRoot && !status.isDirectory()) {
        throw new Error(
          "Machine projection output must be a directory or a new path.",
        );
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

export function normalizeMachineProjectionRequest(raw, rawPaths = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Machine projection request must be an object.");
  }
  if (
    Object.keys(raw).some(
      (key) => !["output", "repository", "commit", "dirty"].includes(key),
    )
  ) {
    throw new Error("Machine projection request contains an unknown field.");
  }
  if (typeof raw.output !== "string" || raw.output.trim().length === 0) {
    throw new Error("Machine projection output is required.");
  }
  if (typeof raw.commit !== "string" || !FULL_COMMIT.test(raw.commit)) {
    throw new Error(
      "Machine projection provenance commit must be a full lowercase 40-character Git object ID.",
    );
  }
  if (raw.dirty !== false) {
    throw new Error(
      "Machine projection provenance dirty must be explicitly false.",
    );
  }

  const paths = {
    workspaceRoot: resolve(rawPaths.workspaceRoot ?? defaultWorkspaceRoot),
    contentRoot: resolve(rawPaths.contentRoot ?? defaultContentRoot),
    publicDir: resolve(rawPaths.publicDir ?? defaultPublicDir),
  };
  const outputRoot = resolve(raw.output.trim());
  assertSafeOutputRoot(outputRoot, paths);
  return {
    outputRoot,
    paths,
    provenance: {
      repository: normalizeRepository(raw.repository),
      commit: raw.commit,
      dirty: false,
    },
  };
}

export async function buildMachineProjection(raw, context = {}) {
  if (
    !context ||
    typeof context !== "object" ||
    Array.isArray(context) ||
    Object.keys(context).some(
      (key) =>
        !["workspaceRoot", "contentRoot", "publicDir", "afterCapture"].includes(
          key,
        ),
    )
  ) {
    throw new Error("Machine projection build context is invalid.");
  }
  if (
    context.afterCapture !== undefined &&
    typeof context.afterCapture !== "function"
  ) {
    throw new Error("Machine projection afterCapture hook must be a function.");
  }
  const request = normalizeMachineProjectionRequest(raw, context);
  await assertNoSymlinkSegments(request.outputRoot);
  await assertNoSymlinkSegments(resolve(request.outputRoot, "_mcp"));

  const options = normalizePublisherOptions({
    catalog: contentCatalog,
    openapi: "openapi.json",
  });
  const captured = await capturePublicationInputs({
    contentRoot: request.paths.contentRoot,
    publicDir: request.paths.publicDir,
    options,
  });
  await context.afterCapture?.();
  return publishProjection({
    outputRoot: request.outputRoot,
    contentRoot: request.paths.contentRoot,
    publicDir: request.paths.publicDir,
    options,
    captured,
    provenance: request.provenance,
  });
}

function usage() {
  return [
    "Build the reviewed Sumi Docs machine projection.",
    "",
    "Usage:",
    "  node scripts/build-machine-projection.mjs --output <path> --repository <https-url> --commit <full-sha>",
  ].join("\n");
}

async function main() {
  const { values } = parseArgs({
    options: {
      output: { type: "string" },
      repository: { type: "string" },
      commit: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
    allowPositionals: false,
  });
  if (values.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const request = normalizeMachineProjectionRequest({
    output: values.output,
    repository: values.repository,
    commit: values.commit,
    dirty: false,
  });
  await assertGitProvenance(request.provenance, request.paths.workspaceRoot);
  const publication = await buildMachineProjection({
    output: request.outputRoot,
    ...request.provenance,
  });
  process.stdout.write(
    `${JSON.stringify({ revision: publication.v2.revision, documents: publication.v2.documents.length, locator: "_mcp/v2/current.json" })}\n`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
