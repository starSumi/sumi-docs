import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DocsVault } from "../../src/vfs/DocsVault.js";

test("the checked-in basic example is a usable documentation corpus", async () => {
  const vault = new DocsVault();
  await vault.loadFromDirectory("examples/basic/docs");
  await vault.loadOpenApi("examples/basic/openapi.json");

  const paths = vault.listTree().map((document) => document.path);
  assert.ok(paths.includes("api/authentication.mdx"));
  assert.ok(paths.includes("getting-started.md"));
  assert.ok(paths.includes("contributing.md"));
  assert.ok(paths.includes("skills-and-orchestration.md"));
  assert.ok(paths.includes("remote-sources.md"));
  assert.equal(vault.search("token")[0]?.path, "api/authentication.mdx");
  assert.match(
    vault.getDoc("getting-started.md")?.content ?? "",
    /remote HTTPS host with a Sumi documentation manifest/i,
  );
  assert.deepEqual(Object.keys(vault.getOpenApiSpec("/health")?.paths ?? {}), [
    "/health",
  ]);
});

test("self-hosted operator documents stay synchronized", async () => {
  for (const file of [
    "architecture.md",
    "configuration.md",
    "contributing.md",
    "decisions/0001-astro-starlight-dual-surface.md",
    "decisions/0002-polyrepo-and-package-manager.md",
    "decisions/0003-localized-content-projection.md",
    "decisions/0004-authoritative-repository-initialization.md",
    "decisions/0005-project-discovery-and-local-state-placement.md",
    "decisions/0006-immutable-content-projection.md",
    "decisions/0007-native-agent-host-integration.md",
    "decisions/0008-product-workspace-topology.md",
    "decisions/0009-reconciliation-and-control-plane-state.md",
    "decisions/0010-runtime-migration-gate.md",
    "decisions/0011-calibrated-cold-start-policy.md",
    "decisions/0012-dual-transport-and-address-model.md",
    "decisions/0013-standards-and-schema-authority.md",
    "decisions/0014-single-build-dual-target-publication.md",
    "decisions/0015-rust-core-and-npm-launcher.md",
    "development.md",
    "getting-started.md",
    "git-workflow.md",
    "releasing.md",
    "remote-sources.md",
    "skills-and-orchestration.md",
    "tool-reference.md",
    "troubleshooting.md",
  ]) {
    const [authoritative, example] = await Promise.all([
      readFile(`docs/${file}`, "utf8"),
      readFile(`examples/basic/docs/${file}`, "utf8"),
    ]);
    assert.equal(example, authoritative, `${file} has drifted from docs/`);
  }
});
