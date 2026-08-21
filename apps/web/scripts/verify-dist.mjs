import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import { extname, resolve } from "node:path";
import {
  assertIntegrity,
  parseCurrentLocatorV2,
  parseLocatedManifestV2,
} from "@sumi-os/corpus-contract";
import {
  catalogPublisherDocuments,
  contentCatalog,
} from "../src/content-catalog.ts";
import { contentRoot } from "../src/content-root.ts";
import {
  normalizeSiteBasePath,
  prefixSiteRoute,
  resolveSiteDeployment,
} from "../src/site-config.ts";
import {
  resolveRemoteMcpEnvironment,
  resolveRequiredProvenanceEnvironment,
  serializeRemoteServerMetadata,
} from "../integrations/sumi-docs-publisher.mjs";

const outputRoot = resolve("dist");
const basePath = normalizeSiteBasePath(process.env.BASE_PATH);
const publicBaseUrl = process.env.SITE_URL
  ? resolveSiteDeployment(process.env.SITE_URL, basePath).publicBaseUrl
  : new URL(basePath, "http://127.0.0.1:4321/").href;
const machineRoot = resolve(outputRoot, "_mcp");
const mcpPackage = JSON.parse(
  await readFile(resolve("../../packages/mcp/package.json"), "utf8"),
);
const remoteMcp = resolveRemoteMcpEnvironment({
  publicMcpUrl: process.env.PUBLIC_MCP_URL,
  publicMcpReadinessUrl: process.env.PUBLIC_MCP_READINESS_URL,
  version: mcpPackage.version,
});
const requiredProvenance = resolveRequiredProvenanceEnvironment({
  repository:
    process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY
      ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}`
      : undefined,
  commit: process.env.GITHUB_SHA,
});
const manifest = JSON.parse(
  await readFile(resolve(machineRoot, "sumi-docs-manifest.json"), "utf8"),
);
const routeMap = JSON.parse(
  await readFile(resolve(machineRoot, "sumi-docs-routes.json"), "utf8"),
);
const current = parseCurrentLocatorV2(
  JSON.parse(
    await readFile(resolve(machineRoot, "v2", "current.json"), "utf8"),
  ),
);
const manifestV2Path = resolve(
  machineRoot,
  "v2",
  ...current.manifest.split("/"),
);
const manifestV2Bytes = await readFile(manifestV2Path);
const manifestV2 = parseLocatedManifestV2(current, manifestV2Bytes);
assert.equal(manifestV2.revision, current.revision);
if (requiredProvenance) {
  assert.deepEqual(
    manifestV2.provenance,
    requiredProvenance,
    "Published manifest is not bound to the required clean Git provenance",
  );
}
const snapshotRoot = resolve(manifestV2Path, "..");

async function discoverProjectedDocuments(root, relative = "") {
  const entries = await readdir(
    resolve(root, ...relative.split("/").filter(Boolean)),
    {
      withFileTypes: true,
    },
  );
  const documents = [];
  for (const entry of entries) {
    const path = relative ? `${relative}/${entry.name}` : entry.name;
    assert.equal(
      entry.isSymbolicLink(),
      false,
      `Projection contains symlink '${path}'`,
    );
    if (entry.isDirectory()) {
      documents.push(...(await discoverProjectedDocuments(root, path)));
    } else if ([".md", ".mdx"].includes(extname(entry.name).toLowerCase())) {
      documents.push(path);
    }
  }
  return documents.sort((left, right) => left.localeCompare(right, "en"));
}

async function discoverFiles(root, relative = "") {
  const entries = await readdir(
    resolve(root, ...relative.split("/").filter(Boolean)),
    { withFileTypes: true },
  );
  const files = [];
  for (const entry of entries) {
    const path = relative ? `${relative}/${entry.name}` : entry.name;
    assert.equal(
      entry.isSymbolicLink(),
      false,
      `Output contains symlink '${path}'`,
    );
    if (entry.isDirectory()) files.push(...(await discoverFiles(root, path)));
    else files.push(path);
  }
  return files.sort((left, right) => left.localeCompare(right, "en"));
}

assert.deepEqual(Object.keys(manifest).sort(), [
  "documents",
  "openapi",
  "version",
]);
assert.equal(manifest.version, 1);
assert.ok(Array.isArray(manifest.documents) && manifest.documents.length > 0);
assert.equal(new Set(manifest.documents).size, manifest.documents.length);
assert.equal(routeMap.version, 1);
assert.equal(manifestV2.documents.length, manifest.documents.length);
assert.deepEqual(
  manifestV2.documents.map(({ path }) => path).sort(),
  [...manifest.documents].sort(),
);
const expectedDocuments = [...manifest.documents].sort((left, right) =>
  left.localeCompare(right, "en"),
);
const catalogDocuments = catalogPublisherDocuments(contentCatalog);
assert.deepEqual(
  await discoverProjectedDocuments(contentRoot),
  catalogDocuments
    .map(({ source }) => source)
    .sort((left, right) => left.localeCompare(right, "en")),
  "Reviewed source files and catalog entries differ",
);
const manifestDocumentsByPath = new Map(
  manifestV2.documents.map((document) => [document.path, document]),
);
for (const expected of catalogDocuments) {
  const actual = manifestDocumentsByPath.get(expected.source);
  assert.ok(actual, `Manifest v2 omits catalog source '${expected.source}'`);
  assert.deepEqual(
    {
      id: actual.id,
      locale: actual.locale,
      path: actual.path,
      route: actual.route,
      nav: actual.nav,
    },
    {
      id: expected.id,
      locale: expected.locale,
      path: expected.source,
      route: expected.page,
      nav: expected.nav,
    },
    `Manifest v2 metadata differs from catalog for '${expected.source}'`,
  );
  assert.equal(routeMap.routes[expected.source], expected.page);
}
const compatibilityDocuments = (
  await discoverProjectedDocuments(machineRoot)
).filter((path) => !path.startsWith("v2/"));
const immutableDocuments = await discoverProjectedDocuments(
  resolve(snapshotRoot, "docs"),
);
assert.deepEqual(compatibilityDocuments, expectedDocuments);
assert.deepEqual(immutableDocuments, expectedDocuments);

const englishDocuments = manifest.documents
  .filter((document) => !document.startsWith("zh-cn/"))
  .sort();
const chineseDocuments = manifest.documents
  .filter((document) => document.startsWith("zh-cn/"))
  .map((document) => document.slice("zh-cn/".length))
  .sort();
assert.deepEqual(chineseDocuments, englishDocuments);

const pageFile = (page) =>
  page === "/" ? "index.html" : `${page.slice(1)}index.html`;
const deployedRoute = (route) => prefixSiteRoute(route, basePath);
const logicalRoute = (deployedPath) => {
  if (basePath === "/") return deployedPath;
  const baseWithoutTrailingSlash = basePath.slice(0, -1);
  assert.ok(
    deployedPath === baseWithoutTrailingSlash ||
      deployedPath.startsWith(basePath),
    `Root-absolute reference escapes BASE_PATH: '${deployedPath}'`,
  );
  return deployedPath === baseWithoutTrailingSlash
    ? "/"
    : `/${deployedPath.slice(basePath.length)}`;
};
const outputFiles = new Set(await discoverFiles(outputRoot));

const expectedRemoteServer = remoteMcp
  ? serializeRemoteServerMetadata(remoteMcp)
  : undefined;
let actualRemoteServer;
try {
  actualRemoteServer = await readFile(
    resolve(machineRoot, "server.json"),
    "utf8",
  );
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
assert.equal(
  actualRemoteServer,
  expectedRemoteServer,
  remoteMcp
    ? "Remote MCP discovery metadata differs from the configured endpoint"
    : "Remote MCP discovery metadata exists without endpoint configuration",
);

for (const document of manifest.documents) {
  assert.match(document, /^[a-zA-Z0-9_/-]+\.mdx?$/);
  await access(resolve(machineRoot, ...document.split("/")));
  const page = routeMap.routes[document];
  assert.match(page, /^(?:\/$|\/[a-zA-Z0-9_/-]+\/$)/);
  assert.ok(
    outputFiles.has(pageFile(page)),
    `Rendered route has no exact-case output file: '${page}'`,
  );
}

for (const document of manifestV2.documents) {
  const [source, compatibility, immutable] = await Promise.all([
    readFile(resolve(contentRoot, ...document.path.split("/"))),
    readFile(resolve(machineRoot, ...document.path.split("/"))),
    readFile(resolve(snapshotRoot, "docs", ...document.path.split("/"))),
  ]);
  assert.deepEqual(
    compatibility,
    source,
    `Compatibility document differs from source: '${document.path}'`,
  );
  assert.deepEqual(
    immutable,
    source,
    `Immutable document differs from source: '${document.path}'`,
  );
  assertIntegrity(immutable, document, `Document '${document.path}'`);
  assert.equal(routeMap.routes[document.path], document.route);
}

assert.deepEqual(
  Object.keys(routeMap.routes).sort(),
  [...manifest.documents].sort(),
);
if (manifest.openapi) {
  const [source, compatibility, immutable] = await Promise.all([
    readFile(resolve("public", manifest.openapi)),
    readFile(resolve(machineRoot, manifest.openapi)),
    readFile(
      resolve(snapshotRoot, "docs", ...manifestV2.openapi.path.split("/")),
    ),
  ]);
  assert.deepEqual(compatibility, source, "Compatibility OpenAPI differs");
  assert.deepEqual(immutable, source, "Immutable OpenAPI differs");
  assertIntegrity(immutable, manifestV2.openapi, "OpenAPI document");
}

const englishHome = await readFile(resolve(outputRoot, "index.html"), "utf8");
const chineseHome = await readFile(
  resolve(outputRoot, "zh-cn", "index.html"),
  "utf8",
);
const apiReference = await readFile(
  resolve(
    outputRoot,
    "reference",
    "api",
    "corpus-contract",
    "readme",
    "index.html",
  ),
  "utf8",
);
const chineseApiFallback = await readFile(
  resolve(
    outputRoot,
    "zh-cn",
    "reference",
    "api",
    "corpus-contract",
    "readme",
    "index.html",
  ),
  "utf8",
);

const apiHtmlFiles = [...outputFiles].filter((path) =>
  /^(?:zh-cn\/)?reference\/api\/corpus-contract\/.*\/index\.html$/u.test(path),
);
assert.ok(apiHtmlFiles.length > 0, "No generated API reference pages found");
for (const file of apiHtmlFiles) {
  assert.equal(
    file,
    file.toLowerCase(),
    `Generated API route is not canonical lowercase: '${file}'`,
  );
  const html = await readFile(resolve(outputRoot, ...file.split("/")), "utf8");
  for (const match of html.matchAll(/\shref="([^"]+)"/gu)) {
    const href = match[1].split(/[?#]/u, 1)[0];
    const logicalHref = href.startsWith("/") ? logicalRoute(href) : href;
    if (
      !/^\/(?:zh-cn\/)?reference\/api\/corpus-contract\//u.test(logicalHref)
    ) {
      continue;
    }
    assert.ok(
      logicalHref.endsWith("/"),
      `API link is not canonical: '${href}'`,
    );
    const target = pageFile(decodeURIComponent(logicalHref));
    assert.ok(
      outputFiles.has(target),
      `API link '${href}' from '${file}' has no exact-case output file`,
    );
  }
}

for (const file of [...outputFiles].filter((path) => path.endsWith(".html"))) {
  const html = await readFile(resolve(outputRoot, ...file.split("/")), "utf8");
  const canonical = html.match(
    /<link[^>]+rel="canonical"[^>]+href="([^"]+)"/u,
  )?.[1];
  assert.ok(canonical, `Rendered page has no canonical URL: '${file}'`);
  assert.ok(
    canonical.startsWith(publicBaseUrl),
    `Canonical URL escapes the public site base: '${canonical}'`,
  );

  for (const match of html.matchAll(/\s(?:href|src)="([^"]+)"/gu)) {
    const reference = match[1];
    if (/^(?:data|javascript|mailto|tel):/u.test(reference)) continue;
    const pageRoute =
      file === "index.html"
        ? "/"
        : file.endsWith("/index.html")
          ? `/${file.slice(0, -"index.html".length)}`
          : `/${file}`;
    const resolvedReference = new URL(
      reference,
      new URL(deployedRoute(pageRoute), publicBaseUrl),
    );
    if (resolvedReference.origin !== new URL(publicBaseUrl).origin) continue;
    const logicalReference = decodeURIComponent(
      logicalRoute(resolvedReference.pathname),
    );
    const directTarget = logicalReference.slice(1);
    const targets = logicalReference.endsWith("/")
      ? [pageFile(logicalReference), `${directTarget.slice(0, -1)}.html`]
      : [directTarget, `${directTarget}/index.html`];
    if (file === "404.html" && logicalReference.endsWith("/404/")) {
      targets.push("404.html");
    }
    assert.ok(
      targets.some((target) => outputFiles.has(target)),
      `Local reference '${reference}' from '${file}' has no exact-case output file`,
    );
  }
}

for (const sitemap of [...outputFiles].filter((path) =>
  /(?:^|\/)sitemap[^/]*\.xml$/u.test(path),
)) {
  const xml = await readFile(
    resolve(outputRoot, ...sitemap.split("/")),
    "utf8",
  );
  for (const [, location] of xml.matchAll(/<loc>([^<]+)<\/loc>/gu)) {
    assert.ok(
      location.startsWith(publicBaseUrl),
      `Sitemap URL escapes the public site base: '${location}'`,
    );
  }
}

assert.match(englishHome, /<main[^>]+lang="en"/);
assert.match(englishHome, /href="getting-started\/"/);
assert.match(englishHome, /href="configuration\/"/);
assert.match(englishHome, /href="https:\/\/github\.com\/starSumi\/sumi-docs"/);
assert.match(chineseHome, /<main[^>]+lang="zh-CN"/);
assert.match(chineseHome, />Sumi 文档<\/h1>/);
assert.match(chineseHome, /href="getting-started\/"/);
assert.match(chineseHome, /href="configuration\/"/);
assert.match(chineseHome, /href="https:\/\/github\.com\/starSumi\/sumi-docs"/);
assert.match(apiReference, /@sumi-os\/corpus-contract/);
assert.match(apiReference, /<main[^>]+lang="en"/);
assert.doesNotMatch(apiReference, /[A-Z]:\\/u);
assert.match(chineseApiFallback, /<main[^>]+lang="en"/);
assert.match(chineseApiFallback, /API 语言/);
assert.match(chineseApiFallback, /API 参考目前以英文为规范源/);
assert.doesNotMatch(chineseApiFallback, /此内容尚不支持你的语言/);

for (const document of englishDocuments) {
  const chineseDocument = `zh-cn/${document}`;
  const englishRoute = routeMap.routes[document];
  const chineseRoute = routeMap.routes[chineseDocument];
  const englishPage = await readFile(
    resolve(outputRoot, ...pageFile(englishRoute).split("/")),
    "utf8",
  );
  const chinesePage = await readFile(
    resolve(outputRoot, ...pageFile(chineseRoute).split("/")),
    "utf8",
  );

  assert.match(englishPage, /<main[^>]+lang="en"/);
  assert.ok(englishPage.includes(`value="${deployedRoute(chineseRoute)}"`));
  assert.match(chinesePage, /<main[^>]+lang="zh-CN"/);
  assert.ok(chinesePage.includes(`value="${deployedRoute(englishRoute)}"`));
}

console.log(
  `Verified ${manifest.documents.length} source documents byte-for-byte across v1, v2, rendered routes, and immutable revision ${manifestV2.revision}.`,
);
