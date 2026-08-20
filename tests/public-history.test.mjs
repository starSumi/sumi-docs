import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  isPublicEmail,
  verifyPublicHistory,
} from "../scripts/verify-public-history.mjs";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const verifierPath = resolve(
  repositoryRoot,
  "scripts/verify-public-history.mjs",
);

function git(cwd, args, env = {}) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env },
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr);
}

test("public history verifier accepts noreply identities and redacts failures", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "sumi-public-history-"));
  try {
    git(directory, ["init", "--quiet"]);
    git(directory, ["config", "user.name", "Sumi Maintainer"]);
    git(directory, [
      "config",
      "user.email",
      "maintainer@users.noreply.github.com",
    ]);
    git(directory, [
      "commit",
      "--quiet",
      "--allow-empty",
      "-m",
      "chore: allowed identity",
    ]);

    assert.equal(isPublicEmail("noreply@github.com"), true);
    assert.equal(isPublicEmail("maintainer@users.noreply.github.com"), true);
    assert.equal(isPublicEmail("private@example.test"), false);
    assert.equal(verifyPublicHistory({ cwd: directory }).passed, true);

    git(
      directory,
      ["commit", "--quiet", "--allow-empty", "-m", "chore: private identity"],
      {
        GIT_AUTHOR_EMAIL: "private@example.test",
        GIT_COMMITTER_EMAIL: "private@example.test",
      },
    );
    const report = verifyPublicHistory({ cwd: directory });
    assert.equal(report.passed, false);
    assert.equal(report.violationCount, 2);
    assert.deepEqual(report.violations.map(({ role }) => role).sort(), [
      "author",
      "committer",
    ]);

    const cli = spawnSync(process.execPath, [verifierPath, "--ref", "HEAD"], {
      cwd: directory,
      encoding: "utf8",
      windowsHide: true,
    });
    assert.equal(cli.status, 1);
    assert.match(cli.stderr, /2 non-public identity field/u);
    assert.doesNotMatch(cli.stderr, /private@example\.test/u);
    assert.doesNotMatch(cli.stdout, /private@example\.test/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
