import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import sumiDocsPublisher from "../integrations/sumi-docs-publisher.mjs";
import {
  assertGitProvenance,
  buildMachineProjection,
  normalizeMachineProjectionRequest,
} from "../scripts/build-machine-projection.mjs";
import { contentCatalog } from "../src/content-catalog.ts";

const webRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(webRoot, "..", "..");
const contentRoot = resolve(workspaceRoot, "docs");
const publicDir = resolve(webRoot, "public");
const repository = "https://github.com/starSumi/sumi-docs";
const commit = "a".repeat(40);
const execFile = promisify(execFileCallback);

async function files(root, relative = "") {
  const entries = await readdir(resolve(root, relative), {
    withFileTypes: true,
  });
  const result = [];
  for (const entry of entries) {
    const path = relative ? `${relative}/${entry.name}` : entry.name;
    assert.equal(
      entry.isSymbolicLink(),
      false,
      `Unexpected symlink '${path}'.`,
    );
    if (entry.isDirectory()) result.push(...(await files(root, path)));
    else result.push(path);
  }
  return result.sort((left, right) => left.localeCompare(right, "en"));
}

async function assertTreesEqual(left, right) {
  const expected = await files(left);
  assert.deepEqual(await files(right), expected);
  for (const path of expected) {
    assert.deepEqual(
      await readFile(resolve(right, ...path.split("/"))),
      await readFile(resolve(left, ...path.split("/"))),
      `Projected bytes differ for '${path}'.`,
    );
  }
}

test("machine projection requires clean, explicit, full source provenance", () => {
  assert.deepEqual(
    normalizeMachineProjectionRequest(
      {
        output: resolve(tmpdir(), "sumi-machine-projection"),
        repository: `${repository}.git/`,
        commit,
        dirty: false,
      },
      { workspaceRoot, contentRoot, publicDir },
    ).provenance,
    { repository, commit, dirty: false },
  );

  for (const candidate of [
    { repository, commit: commit.slice(0, 12), dirty: false },
    { repository, commit: commit.toUpperCase(), dirty: false },
    { repository, commit, dirty: true },
    { repository: "http://github.com/example/repo", commit, dirty: false },
    { repository: "https://user@example.com/repo", commit, dirty: false },
    { repository: "https://example.com/repo?ref=main", commit, dirty: false },
  ]) {
    assert.throws(
      () =>
        normalizeMachineProjectionRequest(
          {
            output: resolve(tmpdir(), "sumi-machine-projection"),
            ...candidate,
          },
          { workspaceRoot, contentRoot, publicDir },
        ),
      /provenance|repository|commit|dirty/i,
    );
  }
});

test("machine projection binds provenance to a clean Git checkout", async () => {
  const responses = new Map([
    ["rev-parse --show-toplevel", `${workspaceRoot}\n`],
    ["rev-parse HEAD", `${commit}\n`],
    ["status --porcelain=v1 --untracked-files=all", ""],
    ["config --get remote.origin.url", `${repository}.git\n`],
  ]);
  const git = async (args) => {
    const value = responses.get(args.join(" "));
    assert.notEqual(
      value,
      undefined,
      `Unexpected Git probe: ${args.join(" ")}`,
    );
    return value;
  };
  const provenance = { repository, commit, dirty: false };

  await assert.doesNotReject(
    assertGitProvenance(provenance, workspaceRoot, git),
  );

  responses.set("rev-parse HEAD", `${"b".repeat(40)}\n`);
  await assert.rejects(
    assertGitProvenance(provenance, workspaceRoot, git),
    /does not match the current Git HEAD/,
  );
  responses.set("rev-parse HEAD", `${commit}\n`);
  responses.set(
    "status --porcelain=v1 --untracked-files=all",
    " M docs/a.md\n",
  );
  await assert.rejects(
    assertGitProvenance(provenance, workspaceRoot, git),
    /clean Git working tree/,
  );
  responses.set("status --porcelain=v1 --untracked-files=all", "");
  responses.set(
    "config --get remote.origin.url",
    "https://github.com/example/other.git\n",
  );
  await assert.rejects(
    assertGitProvenance(provenance, workspaceRoot, git),
    /does not match the Git origin/,
  );
});

test("machine projection rejects output roots that overlap owned inputs", () => {
  for (const output of [
    resolve(workspaceRoot),
    resolve(workspaceRoot, "docs", "generated"),
    resolve(webRoot, "public", "generated"),
    dirname(workspaceRoot),
  ]) {
    assert.throws(
      () =>
        normalizeMachineProjectionRequest(
          { output, repository, commit, dirty: false },
          { workspaceRoot, contentRoot, publicDir },
        ),
      /output/i,
    );
  }
});

test("machine build fails closed on source drift and removes staging output", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "sumi-machine-drift-"));
  const fixtureRoot = resolve(temporary, "fixture");
  const fixtureContent = resolve(fixtureRoot, "docs");
  const fixturePublic = resolve(fixtureRoot, "apps", "web", "public");
  const outputRoot = resolve(temporary, "output");
  try {
    await Promise.all([
      cp(contentRoot, fixtureContent, { recursive: true }),
      mkdir(fixturePublic, { recursive: true }),
      mkdir(outputRoot, { recursive: true }),
    ]);
    await cp(
      resolve(publicDir, "openapi.json"),
      resolve(fixturePublic, "openapi.json"),
    );

    await assert.rejects(
      buildMachineProjection(
        { output: outputRoot, repository, commit, dirty: false },
        {
          workspaceRoot: fixtureRoot,
          contentRoot: fixtureContent,
          publicDir: fixturePublic,
          afterCapture: async () => {
            await writeFile(
              resolve(fixtureContent, "getting-started.md"),
              "# Changed after capture\n",
            );
          },
        },
      ),
      /Source drift detected/,
    );
    await assert.rejects(
      readFile(resolve(outputRoot, "_mcp", "v2", "current.json")),
      /ENOENT/,
    );
    assert.deepEqual(
      (await readdir(outputRoot)).filter((name) => name.startsWith("._mcp-")),
      [],
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("machine build preserves an existing conflicting projection", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "sumi-machine-cas-"));
  const outputRoot = resolve(temporary, "output");
  try {
    await mkdir(resolve(outputRoot, "_mcp"), { recursive: true });
    await writeFile(resolve(outputRoot, "_mcp", "owner.txt"), "previous\n");
    await assert.rejects(
      buildMachineProjection({
        output: outputRoot,
        repository,
        commit,
        dirty: false,
      }),
      /CAS_CONFLICT/,
    );
    assert.equal(
      await readFile(resolve(outputRoot, "_mcp", "owner.txt"), "utf8"),
      "previous\n",
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("machine build is deterministic and byte-identical to the Astro integration", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "sumi-machine-parity-"));
  const machineOutput = resolve(temporary, "machine");
  const repeatedOutput = resolve(temporary, "repeated");
  const astroOutput = resolve(temporary, "astro");
  const provenance = { repository, commit, dirty: false };
  try {
    const first = await buildMachineProjection({
      output: machineOutput,
      ...provenance,
    });
    const repeated = await buildMachineProjection({
      output: repeatedOutput,
      ...provenance,
    });
    assert.equal(repeated.v2.revision, first.v2.revision);

    const integration = sumiDocsPublisher({
      catalog: contentCatalog,
      contentRoot,
      openapi: "openapi.json",
      provenance,
    });
    integration.hooks["astro:config:done"]({
      config: {
        root: pathToFileURL(`${webRoot}/`),
        publicDir: pathToFileURL(`${publicDir}/`),
      },
    });
    await integration.hooks["astro:build:start"]();
    await integration.hooks["astro:build:done"]({
      dir: pathToFileURL(`${astroOutput}/`),
      logger: { info() {} },
    });

    await assertTreesEqual(
      resolve(machineOutput, "_mcp"),
      resolve(repeatedOutput, "_mcp"),
    );
    await assertTreesEqual(
      resolve(machineOutput, "_mcp"),
      resolve(astroOutput, "_mcp"),
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("machine projection CLI rejects unverified and unknown provenance state", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "sumi-machine-cli-"));
  const script = resolve(webRoot, "scripts", "build-machine-projection.mjs");
  try {
    await assert.rejects(
      execFile(
        process.execPath,
        [
          script,
          "--output",
          temporary,
          "--repository",
          repository,
          "--commit",
          commit,
        ],
        { encoding: "utf8", windowsHide: true },
      ),
      /does not match the current Git HEAD/,
    );

    await assert.rejects(
      execFile(
        process.execPath,
        [
          script,
          "--output",
          resolve(temporary, "other"),
          "--repository",
          repository,
          "--commit",
          commit,
          "--dirty",
        ],
        { encoding: "utf8", windowsHide: true },
      ),
      /Unknown option '--dirty'/,
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
