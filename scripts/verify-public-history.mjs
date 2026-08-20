import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const USER_NOREPLY_SUFFIX = "@users.noreply.github.com";
const GITHUB_SERVICE_EMAIL = "noreply@github.com";

function runGit(args, cwd) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    const detail = result.stderr.trim() || "Git command failed.";
    throw new Error(detail);
  }
  return result.stdout;
}

export function isPublicEmail(email) {
  const normalized = email.trim().toLowerCase();
  return (
    normalized.endsWith(USER_NOREPLY_SUFFIX) ||
    normalized === GITHUB_SERVICE_EMAIL
  );
}

export function verifyPublicHistory({
  cwd = process.cwd(),
  refs = ["HEAD"],
} = {}) {
  if (!Array.isArray(refs) || refs.length === 0) {
    throw new Error("At least one Git ref is required.");
  }
  for (const ref of refs) {
    if (typeof ref !== "string" || ref.length === 0 || ref.startsWith("-")) {
      throw new Error(
        "Git refs must be non-empty and must not start with '-'.",
      );
    }
  }

  const output = runGit(
    [
      "log",
      "--no-show-signature",
      "--format=%H%x00%ae%x00%ce",
      "--end-of-options",
      ...refs,
    ],
    cwd,
  );
  const violations = [];
  let commits = 0;

  for (const line of output.split(/\r?\n/u)) {
    if (!line) continue;
    const [commit, authorEmail, committerEmail, ...extra] = line.split("\0");
    if (!commit || !authorEmail || !committerEmail || extra.length > 0) {
      throw new Error("Git returned an unexpected identity record.");
    }
    commits += 1;
    if (!isPublicEmail(authorEmail))
      violations.push({ commit, role: "author" });
    if (!isPublicEmail(committerEmail)) {
      violations.push({ commit, role: "committer" });
    }
  }

  return {
    schemaVersion: "sumi.public-history.v1",
    refs: [...refs],
    commits,
    identityFields: commits * 2,
    violationCount: violations.length,
    violations,
    passed: violations.length === 0,
  };
}

function parseArgs(argv) {
  const refs = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== "--ref" || !argv[index + 1]) {
      throw new Error("Usage: verify-public-history.mjs [--ref <git-ref>]...");
    }
    refs.push(argv[index + 1]);
    index += 1;
  }
  return refs.length > 0 ? refs : ["HEAD"];
}

function main() {
  const report = verifyPublicHistory({
    refs: parseArgs(process.argv.slice(2)),
  });
  if (!report.passed) {
    console.error(
      `Public history identity check failed: ${report.violationCount} non-public identity field(s) across ${report.commits} commit(s).`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    `Public history identity check passed (${report.commits} commits, ${report.identityFields} identity fields).`,
  );
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  try {
    main();
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "History verification failed.",
    );
    process.exitCode = 1;
  }
}
