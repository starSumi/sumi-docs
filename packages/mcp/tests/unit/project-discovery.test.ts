import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { createDoctorReport } from "../../src/doctor.js";
import {
  readProjectConfig,
  resolveCliOptions,
} from "../../src/project-config.js";
import { parseCliOptions } from "../../src/cli.js";
import { writeV2Projection } from "../helpers/v2-projection.js";

async function writeDocument(root: string, path = "index.md"): Promise<void> {
  const target = join(root, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, "# Test documentation\n");
}

async function withFixture(
  run: (root: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "sumi-docs-discovery-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("nearest config is discovered without crossing a Git directory boundary", async () => {
  await withFixture(async (root) => {
    const project = join(root, "project");
    const nested = join(project, "src", "feature");
    await mkdir(join(project, ".git"), { recursive: true });
    await mkdir(nested, { recursive: true });
    await writeDocument(join(project, "manual"));
    await writeFile(
      join(project, "sumi-docs.config.json"),
      JSON.stringify({ version: 1, source: "manual" }),
    );

    const resolvedOptions = await resolveCliOptions(
      parseCliOptions(["serve"])!,
      nested,
    );

    assert.equal(resolvedOptions.docsSource, join(project, "manual"));
    assert.equal(
      resolvedOptions.configPath,
      join(project, "sumi-docs.config.json"),
    );
    assert.equal(resolvedOptions.projectRoot, project);
    assert.equal(resolvedOptions.sourceOrigin, "config");
  });
});

test("a Git worktree file is also a discovery boundary", async () => {
  await withFixture(async (root) => {
    const project = join(root, "worktree");
    const nested = join(project, "nested");
    await mkdir(nested, { recursive: true });
    await writeFile(join(project, ".git"), "gitdir: ../git/worktrees/test\n");
    await writeDocument(join(project, "docs"));

    const resolvedOptions = await resolveCliOptions(
      parseCliOptions(["serve"])!,
      nested,
    );

    assert.equal(resolvedOptions.docsSource, join(project, "docs"));
    assert.equal(resolvedOptions.projectRoot, project);
    assert.equal(resolvedOptions.sourceOrigin, "default");
  });
});

test("without Git, discovery stays in cwd and ignores a parent .sumi", async () => {
  await withFixture(async (root) => {
    const workspace = join(root, ".sumi");
    const project = join(workspace, "consumer");
    await writeDocument(join(workspace, "docs"), "wrong.md");
    await writeFile(
      join(workspace, "sumi-docs.config.json"),
      JSON.stringify({ version: 1, source: "docs" }),
    );
    await writeDocument(join(project, "docs"), "right.md");

    const resolvedOptions = await resolveCliOptions(
      parseCliOptions(["serve"])!,
      project,
    );

    assert.equal(resolvedOptions.docsSource, join(project, "docs"));
    assert.equal(resolvedOptions.configPath, undefined);
    assert.equal(resolvedOptions.projectRoot, project);
  });
});

test("without Git, a parent corpus is not used when cwd has no docs", async () => {
  await withFixture(async (root) => {
    const workspace = join(root, ".sumi");
    const project = join(workspace, "consumer");
    await writeDocument(join(workspace, "docs"));
    await mkdir(project, { recursive: true });

    await assert.rejects(
      resolveCliOptions(parseCliOptions(["serve"])!, project),
      new RegExp(resolve(join(project, "docs")).replace(/\\/g, "\\\\")),
    );
  });
});

test("explicit CLI source wins and may be outside the project root", async () => {
  await withFixture(async (root) => {
    const project = join(root, "project");
    const external = join(root, "external-docs");
    await mkdir(join(project, ".git"), { recursive: true });
    await writeDocument(join(project, "configured-docs"));
    await writeDocument(external);
    await writeFile(
      join(project, "sumi-docs.config.json"),
      JSON.stringify({
        version: 1,
        source: "configured-docs",
        baseUrl: "https://docs.example.com/project",
      }),
    );

    const resolvedOptions = await resolveCliOptions(
      parseCliOptions(["serve", external])!,
      project,
    );

    assert.equal(resolvedOptions.docsSource, external);
    assert.equal(resolvedOptions.sourceOrigin, "cli");
    assert.equal(resolvedOptions.baseUrl, "https://docs.example.com/project/");
  });
});

test("explicit remote source does not inherit a configured local OpenAPI path", async () => {
  await withFixture(async (root) => {
    const project = join(root, "project");
    await mkdir(join(project, ".git"), { recursive: true });
    await writeDocument(join(project, "configured-docs"));
    await writeFile(join(project, "openapi.json"), "{}\n");
    await writeFile(
      join(project, "sumi-docs.config.json"),
      JSON.stringify({
        version: 1,
        source: "configured-docs",
        openapi: "openapi.json",
      }),
    );

    const resolvedOptions = await resolveCliOptions(
      parseCliOptions([
        "serve",
        "https://docs.example.com/sumi-docs-manifest.json",
      ])!,
      project,
    );

    assert.equal(
      resolvedOptions.docsSource,
      "https://docs.example.com/sumi-docs-manifest.json",
    );
    assert.equal(resolvedOptions.openApiPath, undefined);
    assert.equal(resolvedOptions.sourceOrigin, "cli");
  });
});

test("--config selects a strict config and CLI values override it", async () => {
  await withFixture(async (root) => {
    const project = join(root, "project");
    const configDirectory = join(project, "config");
    await mkdir(join(project, ".git"), { recursive: true });
    await writeDocument(join(project, "manual"));
    await writeFile(
      join(project, "openapi.json"),
      JSON.stringify({
        openapi: "3.1.0",
        info: { title: "API", version: "1" },
        paths: {},
      }),
    );
    await mkdir(configDirectory, { recursive: true });
    await writeFile(
      join(configDirectory, "selected.json"),
      JSON.stringify({
        version: 1,
        source: "../manual",
        openapi: "../openapi.json",
        baseUrl: "https://config.example.com/",
      }),
    );

    const resolvedOptions = await resolveCliOptions(
      parseCliOptions([
        "serve",
        "--config",
        "config/selected.json",
        "--base-url",
        "https://cli.example.com/docs",
      ])!,
      project,
    );

    assert.equal(resolvedOptions.docsSource, join(project, "manual"));
    assert.equal(resolvedOptions.openApiPath, join(project, "openapi.json"));
    assert.equal(resolvedOptions.baseUrl, "https://cli.example.com/docs/");
  });
});

test("config rejects unknown fields, unsupported versions, and traversal", async () => {
  await withFixture(async (root) => {
    const unknown = join(root, "unknown.json");
    const unsupported = join(root, "unsupported.json");
    const invalidShape = join(root, "array.json");
    const emptySource = join(root, "empty-source.json");
    const traversal = join(root, "traversal.json");
    await writeFile(unknown, JSON.stringify({ version: 1, extra: true }));
    await writeFile(unsupported, JSON.stringify({ version: 2 }));
    await writeFile(invalidShape, JSON.stringify([]));
    await writeFile(emptySource, JSON.stringify({ source: "  " }));
    await writeFile(
      traversal,
      JSON.stringify({ version: 1, source: "../outside" }),
    );

    await assert.rejects(readProjectConfig(unknown), /unknown/i);
    await assert.rejects(readProjectConfig(unsupported), /version/i);
    await assert.rejects(readProjectConfig(invalidShape), /must be an object/i);
    await assert.rejects(readProjectConfig(emptySource), /non-empty string/i);
    await assert.rejects(
      resolveCliOptions(
        parseCliOptions(["serve", "--config", traversal])!,
        root,
      ),
      /outside the project root/i,
    );
  });
});

test("empty or non-document local sources fail before serving", async () => {
  await withFixture(async (root) => {
    const docs = join(root, "docs");
    await mkdir(docs, { recursive: true });
    await writeFile(join(docs, "notes.txt"), "not a document\n");

    await assert.rejects(
      resolveCliOptions(parseCliOptions(["serve", docs])!, root),
      /does not contain any Markdown or MDX/i,
    );
  });
});

test("doctor reports runtime, discovery, and a loadable corpus", async () => {
  await withFixture(async (root) => {
    await mkdir(join(root, ".git"), { recursive: true });
    await writeDocument(join(root, "docs"), "guide.md");

    const report = await createDoctorReport(
      parseCliOptions(["serve"])!,
      root,
      "25.5.0",
    );

    assert.equal(report.ok, true);
    assert.equal(report.project.root, ".");
    assert.equal(report.source.value, "docs");
    assert.deepEqual(report.node, {
      current: "25.5.0",
      required: ">=25.5.0",
      compatible: true,
    });
    assert.equal(report.source.origin, "default");
    assert.equal(report.source.kind, "local");
    assert.equal(report.source.documentCount, 1);
    assert.equal(report.source.loadable, true);
  });
});

test("config and doctor recognize an exact local v2 current locator", async () => {
  await withFixture(async (root) => {
    const project = join(root, "project");
    await mkdir(join(project, ".git"), { recursive: true });
    const fixture = await writeV2Projection(project);
    await writeFile(
      join(project, "sumi-docs.config.json"),
      JSON.stringify({ version: 1, source: "_mcp/v2/current.json" }),
    );

    const parsed = parseCliOptions(["serve"])!;
    const resolved = await resolveCliOptions(parsed, project);
    assert.equal(resolved.docsSource, fixture.locatorPath);
    assert.equal(resolved.sourceKind, "local-v2");
    assert.equal(resolved.sourceFormat, "manifest-v2");

    const report = await createDoctorReport(parsed, project, "25.5.0");
    assert.equal(report.source.kind, "local");
    assert.equal(report.source.format, "manifest-v2");
    assert.equal(report.source.corpusRevision, fixture.revision);
    assert.equal(report.source.documentCount, 1);
    assert.equal(report.source.openApiLoaded, true);
  });
});

test("local v2 locator rejects configured or CLI OpenAPI", async () => {
  await withFixture(async (root) => {
    const project = join(root, "project");
    await mkdir(join(project, ".git"), { recursive: true });
    await writeV2Projection(project);
    await writeFile(join(project, "openapi.json"), "{}\n");
    await writeFile(
      join(project, "sumi-docs.config.json"),
      JSON.stringify({
        version: 1,
        source: "_mcp/v2/current.json",
        openapi: "openapi.json",
      }),
    );

    await assert.rejects(
      resolveCliOptions(parseCliOptions(["serve"])!, project),
      /must declare OpenAPI in its manifest/iu,
    );
  });
});

test("explicit local v2 locator does not inherit directory OpenAPI config", async () => {
  await withFixture(async (root) => {
    const project = join(root, "project");
    const external = join(root, "external");
    await mkdir(join(project, ".git"), { recursive: true });
    await writeDocument(join(project, "docs"));
    await writeFile(join(project, "openapi.json"), "{}\n");
    await writeFile(
      join(project, "sumi-docs.config.json"),
      JSON.stringify({
        version: 1,
        source: "docs",
        openapi: "openapi.json",
      }),
    );
    const fixture = await writeV2Projection(external);

    const resolved = await resolveCliOptions(
      parseCliOptions(["serve", fixture.locatorPath])!,
      project,
    );
    assert.equal(resolved.sourceKind, "local-v2");
    assert.equal(resolved.openApiPath, undefined);
  });
});
