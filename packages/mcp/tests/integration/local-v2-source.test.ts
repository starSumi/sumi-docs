import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { createInterface } from "node:readline";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { test } from "node:test";
import {
  MAX_DOCUMENT_BYTES,
  MAX_DOCUMENTS,
  canonicalJson,
  describeIntegrity,
} from "@sumi-os/corpus-contract";
import { DocsVault } from "../../src/vfs/DocsVault.js";
import { writeV2Projection } from "../helpers/v2-projection.js";

const requestMeta = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientInfo": {
    name: "local-v2-source-test",
    version: "1.0.0",
  },
  "io.modelcontextprotocol/clientCapabilities": {},
};

async function withFixture(
  run: (root: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "sumi-docs-local-v2-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("DocsVault verifies and atomically loads a local v2 projection", async () => {
  await withFixture(async (root) => {
    const fixture = await writeV2Projection(root);
    const vault = new DocsVault();

    await vault.loadFromLocalManifest(fixture.locatorPath);

    assert.deepEqual(
      vault.listTree().map(({ path, route, sourceUrl }) => ({
        path,
        route,
        sourceUrl,
      })),
      [{ path: "guide.md", route: "/guide/", sourceUrl: undefined }],
    );
    assert.match(vault.getDoc("guide.md")?.content ?? "", /sealed projection/u);
    assert.equal(vault.getOpenApiSpec()?.info.title, "Projection API");
    assert.equal(vault.getStats().corpusRevision, fixture.revision);

    await writeFile(fixture.guidePath, "# Tampered\n");
    await assert.rejects(
      vault.loadFromLocalManifest(fixture.locatorPath),
      /byte count mismatch|SHA-256 mismatch/iu,
    );

    assert.match(vault.getDoc("guide.md")?.content ?? "", /sealed projection/u);
    assert.equal(vault.getStats().corpusRevision, fixture.revision);
    assert.equal(vault.getOpenApiSpec()?.info.title, "Projection API");
  });
});

test("stdio and Streamable HTTP consume the same local v2 locator", async () => {
  await withFixture(async (root) => {
    const fixture = await writeV2Projection(root);
    const stdio = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        "src/index.ts",
        "serve",
        fixture.locatorPath,
        "--base-url",
        "https://docs.example.com/product/",
      ],
      {
        cwd: process.cwd(),
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    const stdioLines = createInterface({ input: stdio.stdout });
    const response = new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("Timed out waiting for the stdio local-v2 response."));
      }, 10_000);
      stdioLines.on("line", (line) => {
        const value = JSON.parse(line) as Record<string, unknown>;
        if (value.id === 1) {
          clearTimeout(timer);
          resolve(value);
        }
      });
      stdio.once("error", reject);
      stdio.once("exit", (code) => {
        if (code !== null && code !== 0) {
          reject(new Error(`stdio server exited with code ${code}.`));
        }
      });
    });
    stdio.stdin.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "list_docs",
          arguments: {},
          _meta: requestMeta,
        },
      })}\n`,
    );

    try {
      const payload = await response;
      const result = payload.result as {
        content: Array<{ text: string }>;
      };
      const documents = JSON.parse(result.content[0]?.text ?? "[]") as Array<{
        path: string;
        url: string;
      }>;
      assert.deepEqual(documents, [
        {
          path: "guide.md",
          title: "Local Guide",
          url: "https://docs.example.com/product/guide/",
        },
      ]);
    } finally {
      stdioLines.close();
      stdio.kill();
    }

    const reservation = createServer();
    await new Promise<void>((resolve) =>
      reservation.listen(0, "127.0.0.1", resolve),
    );
    const address = reservation.address();
    assert(address && typeof address === "object");
    const port = address.port;
    await new Promise<void>((resolve) => reservation.close(() => resolve()));

    const http = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        "src/index.ts",
        "serve",
        fixture.locatorPath,
        "--transport",
        "streamable-http",
        "--http-port",
        String(port),
        "--base-url",
        "https://docs.example.com/product/",
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          SUMI_DOCS_BUILD_REVISION: "0123456789abcdef0123456789abcdef01234567",
          SUMI_DOCS_EXPECTED_CORPUS_REVISION: fixture.revision,
        },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    const httpErrors = createInterface({ input: http.stderr });
    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(new Error("Timed out waiting for the HTTP local-v2 server.")),
        10_000,
      );
      httpErrors.on("line", (line) => {
        if (line.includes('"event":"sumi_docs_mcp.ready"')) {
          clearTimeout(timer);
          resolve();
        }
      });
      http.once("error", reject);
      http.once("exit", (code) => {
        if (code !== null && code !== 0) {
          reject(new Error(`HTTP server exited with code ${code}.`));
        }
      });
    });

    try {
      await ready;
      const readiness = await fetch(`http://127.0.0.1:${port}/readyz`);
      assert.equal(readiness.status, 200);
      const readinessPayload = (await readiness.json()) as {
        corpus: { revision: string; documentCount: number };
      };
      assert.deepEqual(readinessPayload.corpus, {
        revision: fixture.revision,
        documentCount: 1,
      });

      const toolsResponse = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
          "mcp-method": "tools/call",
          "mcp-name": "list_docs",
          "mcp-protocol-version": "2026-07-28",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "list_docs",
            arguments: {},
            _meta: requestMeta,
          },
        }),
      });
      const toolsPayload = (await toolsResponse.json()) as {
        result: { content: Array<{ text: string }> };
      };
      assert.equal(toolsResponse.status, 200, JSON.stringify(toolsPayload));
      const documents = JSON.parse(
        toolsPayload.result.content[0]?.text ?? "[]",
      ) as Array<{ path: string; title: string; url: string }>;
      assert.deepEqual(documents, [
        {
          path: "guide.md",
          title: "Local Guide",
          url: "https://docs.example.com/product/guide/",
        },
      ]);
    } finally {
      httpErrors.close();
      http.kill();
    }
  });
});

test("local v2 projection rejects manifest and OpenAPI tampering", async () => {
  await withFixture(async (root) => {
    const fixture = await writeV2Projection(root);
    await writeFile(
      fixture.manifestPath,
      `${await readFile(fixture.manifestPath, "utf8")} `,
    );
    await assert.rejects(
      new DocsVault().loadFromLocalManifest(fixture.locatorPath),
      /byte count mismatch|SHA-256 mismatch/iu,
    );

    const second = await writeV2Projection(join(root, "second"));
    await writeFile(second.openApiPath, "{}\n");
    await assert.rejects(
      new DocsVault().loadFromLocalManifest(second.locatorPath),
      /byte count mismatch|SHA-256 mismatch/iu,
    );
  });
});

test("local v2 projection rejects realpath escape through a directory link", async () => {
  await withFixture(async (root) => {
    const fixture = await writeV2Projection(join(root, "projection"));
    const docsDirectory = dirname(fixture.guidePath);
    const outside = join(root, "outside");
    await mkdir(outside, { recursive: true });
    await writeFile(
      join(outside, "guide.md"),
      await readFile(fixture.guidePath),
    );
    await writeFile(
      join(outside, "openapi.json"),
      await readFile(fixture.openApiPath),
    );
    await rm(docsDirectory, { recursive: true, force: true });
    await symlink(
      outside,
      docsDirectory,
      process.platform === "win32" ? "junction" : "dir",
    );

    await assert.rejects(
      new DocsVault().loadFromLocalManifest(fixture.locatorPath),
      /outside the local corpus root/iu,
    );
  });
});

test("local v2 projection applies contract document count and size limits", async () => {
  await withFixture(async (root) => {
    const v2Root = join(root, "_mcp", "v2");
    const revision = `sha256:${"a".repeat(64)}`;
    const manifestPath = join(
      v2Root,
      "snapshots",
      "a".repeat(64),
      "manifest.json",
    );
    const locatorPath = join(v2Root, "current.json");

    const writeInvalidManifest = async (manifest: unknown): Promise<void> => {
      const manifestBytes = canonicalJson(manifest);
      const integrity = describeIntegrity(manifestBytes);
      await mkdir(dirname(manifestPath), { recursive: true });
      await writeFile(manifestPath, manifestBytes);
      await writeFile(
        locatorPath,
        JSON.stringify({
          version: 2,
          revision,
          manifest: `snapshots/${"a".repeat(64)}/manifest.json`,
          ...integrity,
        }),
      );
    };

    const baseDocument = {
      id: "guide",
      locale: "en",
      path: "guide.md",
      route: "/guide/",
      mediaType: "text/markdown",
      bytes: MAX_DOCUMENT_BYTES + 1,
      sha256: "b".repeat(64),
      nav: { sectionId: "start", sectionOrder: 1, order: 1 },
    };
    await writeInvalidManifest({
      version: 2,
      revision,
      defaultLocale: "en",
      locales: ["en"],
      documents: [baseDocument],
      provenance: { repository: null, commit: null, dirty: true },
    });
    await assert.rejects(
      new DocsVault().loadFromLocalManifest(locatorPath),
      /Document bytes must be .* no greater than/iu,
    );

    const documents = Array.from({ length: MAX_DOCUMENTS + 1 }, (_, index) => ({
      ...baseDocument,
      id: `guide-${index}`,
      path: `guide-${index}.md`,
      route: `/guide-${index}/`,
      bytes: 1,
      nav: { sectionId: "start", sectionOrder: 1, order: index },
    }));
    await writeInvalidManifest({
      version: 2,
      revision,
      defaultLocale: "en",
      locales: ["en"],
      documents,
      provenance: { repository: null, commit: null, dirty: true },
    });
    await assert.rejects(
      new DocsVault().loadFromLocalManifest(locatorPath),
      /between 1 and 1000 documents/iu,
    );
  });
});
