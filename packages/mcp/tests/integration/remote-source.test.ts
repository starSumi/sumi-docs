import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import {
  canonicalJson,
  createCurrentLocatorV2,
  describeIntegrity,
  sealManifestV2,
} from "@sumi-os/corpus-contract";
import { DocsMcpServer } from "../../src/mcp/server.js";
import { parseCliOptions } from "../../src/cli.js";
import { createDoctorReport } from "../../src/doctor.js";
import { DocsVault } from "../../src/vfs/DocsVault.js";

const manifest = JSON.stringify({
  version: 1,
  documents: ["guide.md", "api/reference.mdx"],
  openapi: "openapi.json",
});

const openApi = JSON.stringify({
  openapi: "3.1.0",
  info: { title: "Remote API", version: "1.0.0" },
  paths: { "/health": { get: { responses: { "200": {} } } } },
});

function waitForMessage(
  transport: InMemoryTransport,
  id: number,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for response ${id}`)),
      1_000,
    );
    transport.onmessage = (message) => {
      if (
        message &&
        typeof message === "object" &&
        "id" in message &&
        message.id === id
      ) {
        clearTimeout(timer);
        resolve(message as Record<string, unknown>);
      }
    };
  });
}

async function callTool(
  transport: InMemoryTransport,
  id: number,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const pending = waitForMessage(transport, id);
  await transport.send({
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name, arguments: args },
  });
  const response = await pending;
  const result = response.result as Record<string, unknown>;
  const text = (result.content as Array<{ text: string }>)[0]?.text;
  assert.equal(typeof text, "string");
  return JSON.parse(text ?? "null");
}

test("DocsVault loads a complete remote corpus from a manifest", async () => {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(request.url ?? "");
    const routes: Record<string, { body: string; type: string }> = {
      "/docs/sumi-docs-manifest.json": {
        body: manifest,
        type: "application/json",
      },
      "/docs/guide.md": {
        body: "# Remote Guide\n\nInstall from the remote corpus.",
        type: "text/markdown",
      },
      "/docs/api/reference.mdx": {
        body: "# Remote API Reference\n\nUse the health endpoint.",
        type: "text/markdown",
      },
      "/docs/openapi.json": { body: openApi, type: "application/json" },
    };
    const route = routes[request.url ?? ""];
    if (!route) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      "content-type": route.type,
      "last-modified": "Wed, 13 Aug 2026 00:00:00 GMT",
    });
    response.end(route.body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const docsUrl = `http://127.0.0.1:${port}/docs`;

  try {
    const vault = new DocsVault();
    await vault.loadFromRemoteManifest(docsUrl);

    assert.deepEqual(
      vault.listTree().map(({ path, sourceUrl }) => ({ path, sourceUrl })),
      [
        {
          path: "api/reference.mdx",
          sourceUrl: `http://127.0.0.1:${port}/docs/api/reference.mdx`,
        },
        {
          path: "guide.md",
          sourceUrl: `http://127.0.0.1:${port}/docs/guide.md`,
        },
      ],
    );
    assert.equal(
      vault.search("install")[0]?.sourceUrl,
      `http://127.0.0.1:${port}/docs/guide.md`,
    );
    assert.equal(
      vault.getDoc("guide.md")?.sourceUrl,
      `http://127.0.0.1:${port}/docs/guide.md`,
    );
    assert.equal(vault.getOpenApiSpec()?.info.title, "Remote API");
    assert.deepEqual(
      new Set(requests),
      new Set([
        "/docs/sumi-docs-manifest.json",
        "/docs/guide.md",
        "/docs/api/reference.mdx",
        "/docs/openapi.json",
      ]),
    );

    const doctor = await createDoctorReport(
      parseCliOptions(["serve", docsUrl])!,
      process.cwd(),
      "25.5.0",
    );
    assert.equal(doctor.source.kind, "remote");
    assert.equal(doctor.source.format, "manifest-v1");

    const mcp = new DocsMcpServer(vault);
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await mcp.connect(serverTransport);
    await clientTransport.start();
    try {
      const initialized = waitForMessage(clientTransport, 1);
      await clientTransport.send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "remote-source-test", version: "1.0.0" },
        },
      });
      await initialized;
      await clientTransport.send({
        jsonrpc: "2.0",
        method: "notifications/initialized",
        params: {},
      });

      const listed = (await callTool(
        clientTransport,
        2,
        "list_docs",
        {},
      )) as Array<{ path: string; url: string }>;
      assert.equal(listed[0]?.url, `${docsUrl}/api/reference.mdx`);

      const searched = (await callTool(clientTransport, 3, "search_docs", {
        query: "install",
      })) as Array<{ path: string; snippet: string; url: string }>;
      assert.equal(searched[0]?.path, "guide.md");
      assert.equal(searched[0]?.url, `${docsUrl}/guide.md`);
      assert.match(
        searched[0]?.snippet ?? "",
        /Install from the remote corpus/,
      );

      const fetched = (await callTool(clientTransport, 4, "fetch_doc", {
        path: "guide.md",
      })) as { content: string; url: string };
      assert.match(fetched.content, /remote corpus/);
      assert.equal(fetched.url, `${docsUrl}/guide.md`);

      const spec = (await callTool(
        clientTransport,
        5,
        "get_openapi_spec",
        {},
      )) as { info: { title: string } };
      assert.equal(spec.info.title, "Remote API");
    } finally {
      await mcp.close();
      await clientTransport.close();
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("DocsVault verifies and loads an immutable v2 corpus snapshot", async () => {
  const guide = "# Remote Guide\n\nInstall from the verified v2 corpus.";
  const reference = "# Remote API Reference\n\nUse the health endpoint.";
  const v2Manifest = sealManifestV2({
    version: 2,
    defaultLocale: "en",
    locales: ["en"],
    documents: [
      {
        id: "guide",
        locale: "en",
        path: "guide.md",
        route: "/guide/",
        mediaType: "text/markdown",
        ...describeIntegrity(guide),
        nav: { sectionId: "start", sectionOrder: 10, order: 10 },
      },
      {
        id: "api-reference",
        locale: "en",
        path: "api/reference.mdx",
        route: "/api/reference/",
        mediaType: "text/mdx",
        ...describeIntegrity(reference),
        nav: { sectionId: "reference", sectionOrder: 20, order: 10 },
      },
    ],
    openapi: { path: "openapi.json", ...describeIntegrity(openApi) },
    provenance: { repository: null, commit: null, dirty: true },
  });
  const manifestBytes = canonicalJson(v2Manifest);
  const locator = createCurrentLocatorV2(v2Manifest);
  let servedGuide = guide;
  const server = createServer((request, response) => {
    const snapshotPrefix = `/docs/_mcp/v2/${locator.manifest.replace(/manifest\.json$/, "")}`;
    const routes: Record<string, string> = {
      "/docs/_mcp/v2/current.json": JSON.stringify(locator),
      [`/docs/_mcp/v2/${locator.manifest}`]: manifestBytes,
      [`${snapshotPrefix}docs/guide.md`]: servedGuide,
      [`${snapshotPrefix}docs/api/reference.mdx`]: reference,
      [`${snapshotPrefix}docs/openapi.json`]: openApi,
    };
    const body = routes[request.url ?? ""];
    if (body === undefined) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": "application/octet-stream" });
    response.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const locatorUrl = `http://127.0.0.1:${port}/docs/_mcp/v2/current.json`;

  try {
    const vault = new DocsVault();
    await vault.loadFromRemoteManifest(locatorUrl);
    assert.deepEqual(
      vault.listTree().map(({ path }) => path),
      ["api/reference.mdx", "guide.md"],
    );
    assert.match(vault.getDoc("guide.md")?.content ?? "", /verified v2/);
    assert.equal(vault.getStats().corpusRevision, locator.revision);
    assert.equal(vault.getDoc("guide.md")?.route, "/guide/");
    assert.equal(vault.getOpenApiSpec()?.info.title, "Remote API");
    assert.match(
      vault.getDoc("guide.md")?.sourceUrl ?? "",
      /\/snapshots\/[a-f0-9]{64}\/docs\/guide\.md$/,
    );

    const doctor = await createDoctorReport(
      parseCliOptions(["serve", locatorUrl])!,
      process.cwd(),
      "25.5.0",
    );
    assert.equal(doctor.source.kind, "remote");
    assert.equal(doctor.source.format, "manifest-v2");
    assert.equal(doctor.source.corpusRevision, locator.revision);

    servedGuide = `${guide}\ncorrupted`;
    await assert.rejects(
      new DocsVault().loadFromRemoteManifest(locatorUrl),
      /byte count mismatch|SHA-256 mismatch/i,
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("remote manifests reject non-relative paths and redirects", async () => {
  let invalidDocument = "../secret.md";
  const server = createServer((request, response) => {
    if (request.url === "/redirect.json") {
      response.writeHead(302, { location: "/bad.json" }).end();
      return;
    }
    response
      .writeHead(200, { "content-type": "application/json" })
      .end(JSON.stringify({ version: 1, documents: [invalidDocument] }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  try {
    await assert.rejects(
      new DocsVault().loadFromRemoteManifest(
        `http://127.0.0.1:${port}/bad.json`,
      ),
      /restricted portable relative path/i,
    );
    invalidDocument = "/escape.md";
    await assert.rejects(
      new DocsVault().loadFromRemoteManifest(
        `http://127.0.0.1:${port}/bad.json`,
      ),
      /restricted portable relative path/i,
    );
    await assert.rejects(
      new DocsVault().loadFromRemoteManifest(
        `http://127.0.0.1:${port}/redirect.json`,
      ),
      /redirect/i,
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
