import {
  canonicalJson,
  createCurrentLocatorV2,
  describeIntegrity,
  parseCurrentLocatorV2,
  parseLocatedManifestV2,
  parseManifestV1,
  revisionDirectory,
  sealManifestV2,
  sha256Hex,
} from "@sumi-os/corpus-contract";
import { execFile as execFileCallback } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  readFile,
  mkdir,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import {
  dirname,
  extname,
  isAbsolute,
  posix,
  relative,
  resolve,
  sep,
} from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { catalogPublisherDocuments } from "../src/content-catalog.ts";

const OPENAPI_PATH = /^[a-zA-Z0-9_/-]+\.json$/;
const SEMVER =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const FULL_COMMIT = /^[a-f0-9]{40}$/;
const execFile = promisify(execFileCallback);

function assertContained(root, candidate) {
  const normalizedRoot = root.endsWith(sep) ? root : `${root}${sep}`;
  if (candidate !== root && !candidate.startsWith(normalizedRoot)) {
    throw new Error("Publishing path escapes its configured root.");
  }
}

function assertOpenApiPath(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 1024 ||
    !OPENAPI_PATH.test(value) ||
    value.startsWith("/") ||
    value.includes("//") ||
    value.split("/").includes("..")
  ) {
    throw new Error("OpenAPI source must be a restricted relative path.");
  }
}

function normalizePublicHttpsUrl(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be an absolute HTTPS URL.`);
  }
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error(`${label} must be an absolute HTTPS URL.`);
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      `${label} must use HTTPS without credentials, query, or fragment.`,
    );
  }
  return url.href;
}

export function normalizeRemoteMcp(value) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some(
      (key) => !["url", "readinessUrl", "version"].includes(key),
    ) ||
    Object.keys(value).length !== 3
  ) {
    throw new Error(
      "Publisher remote MCP configuration requires only url, readinessUrl, and version.",
    );
  }

  const url = normalizePublicHttpsUrl(value.url, "Publisher remote MCP URL");
  const readinessUrl = normalizePublicHttpsUrl(
    value.readinessUrl,
    "Publisher remote MCP readiness URL",
  );
  if (typeof value.version !== "string" || !SEMVER.test(value.version)) {
    throw new Error(
      "Publisher remote MCP version must be a valid SemVer value.",
    );
  }
  return { url, readinessUrl, version: value.version };
}

export function resolveRemoteMcpEnvironment({
  publicMcpUrl,
  publicMcpReadinessUrl,
  version,
}) {
  const url = publicMcpUrl?.trim();
  const readinessUrl = publicMcpReadinessUrl?.trim();
  if (Boolean(url) !== Boolean(readinessUrl)) {
    throw new Error(
      "PUBLIC_MCP_URL and PUBLIC_MCP_READINESS_URL must be configured together.",
    );
  }
  if (!url) return undefined;
  return normalizeRemoteMcp({ url, readinessUrl, version });
}

export function createRemoteServerMetadata(remoteMcp) {
  const normalized = normalizeRemoteMcp(remoteMcp);
  return {
    $schema:
      "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
    name: "io.github.starsumi/sumi-docs-mcp",
    title: "Sumi Docs MCP",
    description:
      "Read-only MCP access to the reviewed Sumi Docs documentation corpus.",
    repository: {
      url: "https://github.com/starSumi/sumi-docs",
      source: "github",
      subfolder: "packages/mcp",
    },
    version: normalized.version,
    remotes: [{ type: "streamable-http", url: normalized.url }],
  };
}

export function serializeRemoteServerMetadata(remoteMcp) {
  return `${JSON.stringify(createRemoteServerMetadata(remoteMcp), null, 2)}\n`;
}

export function normalizePublisherOptions(options = {}) {
  if (!options.catalog) {
    throw new Error("Publisher requires a reviewed content catalog.");
  }
  if (
    Object.keys(options).some(
      (key) =>
        ![
          "catalog",
          "contentRoot",
          "openapi",
          "provenance",
          "requiredProvenance",
          "remoteMcp",
        ].includes(key),
    )
  ) {
    throw new Error("Publisher options contain an unknown field.");
  }
  const documents = catalogPublisherDocuments(options.catalog);
  if (documents.length === 0 || documents.length > 1000) {
    throw new Error("Publisher requires between 1 and 1000 catalog variants.");
  }
  if (options.openapi !== undefined) assertOpenApiPath(options.openapi);
  if (
    options.contentRoot !== undefined &&
    (typeof options.contentRoot !== "string" ||
      options.contentRoot.length === 0)
  ) {
    throw new Error("Publisher contentRoot must be a non-empty path string.");
  }
  const remoteMcp =
    options.remoteMcp === undefined
      ? undefined
      : normalizeRemoteMcp(options.remoteMcp);
  if (options.provenance && options.requiredProvenance) {
    throw new Error(
      "Publisher provenance and requiredProvenance are mutually exclusive.",
    );
  }
  const requiredProvenance =
    options.requiredProvenance === undefined
      ? undefined
      : resolveRequiredProvenanceEnvironment(options.requiredProvenance);
  return {
    catalog: options.catalog,
    documents,
    ...(options.contentRoot && { contentRoot: options.contentRoot }),
    ...(options.openapi && { openapi: options.openapi }),
    ...(options.provenance && { provenance: options.provenance }),
    ...(requiredProvenance && { requiredProvenance }),
    ...(remoteMcp && { remoteMcp }),
  };
}

function sourcePath(root, path) {
  const candidate = resolve(root, ...path.split("/"));
  assertContained(root, candidate);
  return candidate;
}

async function discoverMarkdown(root, relative = "") {
  const directory = relative ? sourcePath(root, relative) : root;
  const entries = await readdir(directory, { withFileTypes: true });
  const documents = [];
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name, "en"),
  )) {
    const path = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) {
      throw new Error(
        `Reviewed content must not contain a symlink: '${path}'.`,
      );
    }
    if (entry.isDirectory()) {
      documents.push(...(await discoverMarkdown(root, path)));
    } else if (
      entry.isFile() &&
      [".md", ".mdx"].includes(extname(entry.name).toLowerCase())
    ) {
      documents.push(path);
    }
  }
  return documents;
}

export async function capturePublicationInputs({
  contentRoot,
  publicDir,
  options,
}) {
  const byPath = (left, right) => left.localeCompare(right, "en");
  const discovered = (await discoverMarkdown(contentRoot)).sort(byPath);
  const reviewed = options.documents.map(({ source }) => source).sort(byPath);
  if (
    discovered.length !== reviewed.length ||
    discovered.some((path, index) => path !== reviewed[index])
  ) {
    const omitted = discovered.filter((path) => !reviewed.includes(path));
    const missing = reviewed.filter((path) => !discovered.includes(path));
    throw new Error(
      `Reviewed catalog does not match content sources. Omitted: ${omitted.join(", ") || "none"}; missing: ${missing.join(", ") || "none"}.`,
    );
  }
  const documents = await Promise.all(
    options.documents.map(async (document) => ({
      ...document,
      bytes: await readFile(sourcePath(contentRoot, document.source)),
    })),
  );
  const openapi = options.openapi
    ? {
        path: options.openapi,
        bytes: await readFile(sourcePath(publicDir, options.openapi)),
      }
    : undefined;
  return { documents, ...(openapi && { openapi }) };
}

export async function assertPublicationInputsUnchanged({
  contentRoot,
  publicDir,
  options,
  captured,
}) {
  const current = await capturePublicationInputs({
    contentRoot,
    publicDir,
    options,
  });
  for (let index = 0; index < captured.documents.length; index += 1) {
    const before = captured.documents[index];
    const after = current.documents[index];
    if (before.source !== after.source || !before.bytes.equals(after.bytes)) {
      throw new Error(
        `Source drift detected during build for '${before.source}'.`,
      );
    }
  }
  if (
    captured.openapi?.path !== current.openapi?.path ||
    (captured.openapi && !captured.openapi.bytes.equals(current.openapi.bytes))
  ) {
    throw new Error("Source drift detected during build for OpenAPI input.");
  }
}

function normalizeRepositoryUrl(value) {
  if (!value) return null;
  const trimmed = value.trim().replace(/\.git$/, "");
  const scp = /^git@github\.com:([^/]+\/[^/]+)$/.exec(trimmed);
  if (scp) return `https://github.com/${scp[1]}`;
  try {
    const url = new URL(trimmed);
    if (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    ) {
      let pathname = url.pathname.replace(/\/+$/u, "");
      if (pathname.endsWith(".git")) pathname = pathname.slice(0, -4);
      if (!pathname || pathname === "/") return null;
      url.pathname = pathname;
      return url.href.replace(/\/$/, "");
    }
    if (url.protocol === "ssh:" && url.hostname === "github.com") {
      return `https://github.com${url.pathname}`.replace(/\/$/, "");
    }
  } catch {
    return null;
  }
  return null;
}

export function resolveRequiredProvenanceEnvironment(value = {}) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !["repository", "commit"].includes(key))
  ) {
    throw new Error("Release provenance configuration is invalid.");
  }
  if (
    (value.repository !== undefined && typeof value.repository !== "string") ||
    (value.commit !== undefined && typeof value.commit !== "string")
  ) {
    throw new Error("Release provenance configuration is invalid.");
  }
  const repositoryValue = value.repository?.trim();
  const commitValue = value.commit?.trim();
  if (!repositoryValue && !commitValue) return undefined;
  const repository = normalizeRepositoryUrl(repositoryValue);
  if (!repository || !FULL_COMMIT.test(commitValue ?? "")) {
    throw new Error(
      "Release provenance requires a canonical HTTPS repository and full lowercase commit.",
    );
  }
  return { repository, commit: commitValue, dirty: false };
}

async function git(projectRoot, args) {
  try {
    const { stdout } = await execFile("git", ["-C", projectRoot, ...args], {
      encoding: "utf8",
      windowsHide: true,
    });
    return stdout.trim();
  } catch {
    return null;
  }
}

export async function resolveProvenance(
  projectRoot,
  explicit,
  required,
  command = git,
) {
  if (explicit && required) {
    throw new Error("Release provenance could not be verified.");
  }
  if (explicit) return explicit;
  if (required) {
    try {
      const [root, remote, head, status] = await Promise.all([
        command(projectRoot, ["rev-parse", "--show-toplevel"]),
        command(projectRoot, ["config", "--get", "remote.origin.url"]),
        command(projectRoot, ["rev-parse", "HEAD"]),
        command(projectRoot, [
          "status",
          "--porcelain=v1",
          "--untracked-files=all",
        ]),
      ]);
      const actualRepository = normalizeRepositoryUrl(remote);
      const projectPath = relative(resolve(root ?? ""), resolve(projectRoot));
      if (
        !root ||
        projectPath.startsWith("..") ||
        isAbsolute(projectPath) ||
        actualRepository !== required.repository ||
        head !== required.commit ||
        status !== ""
      ) {
        throw new Error("mismatch");
      }
      return required;
    } catch {
      throw new Error("Release provenance could not be verified.");
    }
  }
  const [remote, head, status] = await Promise.all([
    git(projectRoot, ["remote", "get-url", "origin"]),
    git(projectRoot, ["rev-parse", "HEAD"]),
    git(projectRoot, ["status", "--porcelain=v1", "--untracked-files=normal"]),
  ]);
  const repository = normalizeRepositoryUrl(remote);
  const commit = repository && /^[a-f0-9]{40}$/.test(head ?? "") ? head : null;
  return {
    repository,
    commit,
    dirty: status === null || status.length > 0,
  };
}

export function createPublication({ options, captured, provenance }) {
  const v1 = parseManifestV1({
    version: 1,
    documents: options.documents.map(({ source }) => source),
    ...(captured.openapi && { openapi: captured.openapi.path }),
  });
  const routes = Object.fromEntries(
    options.documents.map(({ source, page }) => [source, page]),
  );
  const core = {
    version: 2,
    defaultLocale: options.catalog.defaultLocale,
    locales: options.catalog.locales,
    documents: captured.documents.map((document) => {
      const integrity = describeIntegrity(document.bytes);
      return {
        id: document.id,
        locale: document.locale,
        path: document.source,
        route: document.page,
        mediaType:
          extname(document.source).toLowerCase() === ".mdx"
            ? "text/mdx"
            : "text/markdown",
        ...integrity,
        nav: document.nav,
      };
    }),
    ...(captured.openapi && {
      openapi: {
        path: captured.openapi.path,
        ...describeIntegrity(captured.openapi.bytes),
      },
    }),
    provenance,
  };
  const v2 = sealManifestV2(core);
  const manifestBytes = Buffer.from(canonicalJson(v2));
  const directory = revisionDirectory(v2.revision);
  const current = createCurrentLocatorV2(v2);
  return { v1, routes, v2, manifestBytes, current, directory };
}

async function writeSnapshot(snapshotRoot, publication, captured) {
  for (const document of captured.documents) {
    const destination = sourcePath(
      resolve(snapshotRoot, "docs"),
      document.source,
    );
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, document.bytes);
  }
  if (captured.openapi) {
    const destination = sourcePath(
      resolve(snapshotRoot, "docs"),
      captured.openapi.path,
    );
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, captured.openapi.bytes);
  }
  await mkdir(snapshotRoot, { recursive: true });
  await writeFile(
    resolve(snapshotRoot, "manifest.json"),
    publication.manifestBytes,
  );
}

async function verifySnapshot(snapshotRoot, publication, captured) {
  const manifestBytes = await readFile(resolve(snapshotRoot, "manifest.json"));
  parseLocatedManifestV2(publication.current, manifestBytes);
  if (!manifestBytes.equals(publication.manifestBytes)) {
    throw new Error("Existing immutable snapshot manifest differs.");
  }
  for (const document of captured.documents) {
    const bytes = await readFile(
      sourcePath(resolve(snapshotRoot, "docs"), document.source),
    );
    if (!bytes.equals(document.bytes)) {
      throw new Error(
        `Existing immutable snapshot differs for '${document.source}'.`,
      );
    }
  }
  if (captured.openapi) {
    const bytes = await readFile(
      sourcePath(resolve(snapshotRoot, "docs"), captured.openapi.path),
    );
    if (!bytes.equals(captured.openapi.bytes)) {
      throw new Error("Existing immutable snapshot differs for OpenAPI input.");
    }
  }
}

async function ensureImmutableSnapshot(machineRoot, publication, captured) {
  const snapshotsRoot = resolve(machineRoot, "v2", "snapshots");
  const snapshotRoot = resolve(snapshotsRoot, publication.directory);
  const temporaryRoot = resolve(
    snapshotsRoot,
    `.tmp-${publication.directory}-${process.pid}-${randomUUID()}`,
  );
  assertContained(machineRoot, snapshotRoot);
  assertContained(machineRoot, temporaryRoot);
  await mkdir(snapshotsRoot, { recursive: true });
  try {
    await writeSnapshot(temporaryRoot, publication, captured);
    await verifySnapshot(temporaryRoot, publication, captured);
    try {
      await rename(temporaryRoot, snapshotRoot);
    } catch (error) {
      if (!["EEXIST", "ENOTEMPTY", "EPERM"].includes(error?.code)) throw error;
      await verifySnapshot(snapshotRoot, publication, captured);
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
  await verifySnapshot(snapshotRoot, publication, captured);
}

async function readCurrentState(currentPath) {
  let bytes;
  try {
    bytes = await readFile(currentPath);
  } catch (error) {
    if (error?.code === "ENOENT") return { token: "ABSENT", locator: null };
    throw error;
  }
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("Current locator is not valid JSON.");
  }
  const locator = parseCurrentLocatorV2(value);
  return { token: sha256Hex(canonicalJson(locator)), locator };
}

async function writeMutableProjection(machineRoot, publication, captured) {
  for (const document of captured.documents) {
    const destination = sourcePath(machineRoot, document.source);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, document.bytes);
  }
  if (captured.openapi) {
    const destination = sourcePath(machineRoot, captured.openapi.path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, captured.openapi.bytes);
  }
  await writeFile(
    resolve(machineRoot, "sumi-docs-routes.json"),
    `${JSON.stringify({ version: 1, routes: publication.routes }, null, 2)}\n`,
  );
  await writeFile(
    resolve(machineRoot, "sumi-docs-manifest.json"),
    `${JSON.stringify(publication.v1, null, 2)}\n`,
  );
  if (publication.remoteMcp) {
    await writeFile(
      resolve(machineRoot, "server.json"),
      serializeRemoteServerMetadata(publication.remoteMcp),
    );
  }
}

async function writeCompleteProjection(machineRoot, publication, captured) {
  await mkdir(machineRoot, { recursive: false });
  await writeMutableProjection(machineRoot, publication, captured);
  await ensureImmutableSnapshot(machineRoot, publication, captured);
  const currentPath = resolve(machineRoot, "v2", "current.json");
  await writeFile(
    currentPath,
    `${JSON.stringify(publication.current, null, 2)}\n`,
  );
}

async function verifyCompleteProjection(machineRoot, publication, captured) {
  const expectedV1 = `${JSON.stringify(publication.v1, null, 2)}\n`;
  const expectedRoutes = `${JSON.stringify(
    { version: 1, routes: publication.routes },
    null,
    2,
  )}\n`;
  const [actualV1, actualRoutes, current] = await Promise.all([
    readFile(resolve(machineRoot, "sumi-docs-manifest.json"), "utf8"),
    readFile(resolve(machineRoot, "sumi-docs-routes.json"), "utf8"),
    readCurrentState(resolve(machineRoot, "v2", "current.json")),
  ]);
  if (actualV1 !== expectedV1 || actualRoutes !== expectedRoutes) {
    throw new Error("Compatibility projection differs from the candidate.");
  }
  const expectedRemoteServer = publication.remoteMcp
    ? serializeRemoteServerMetadata(publication.remoteMcp)
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
  if (actualRemoteServer !== expectedRemoteServer) {
    throw new Error(
      "Remote MCP discovery metadata differs from the candidate.",
    );
  }
  const desiredToken = sha256Hex(canonicalJson(publication.current));
  if (current.token !== desiredToken) {
    throw new Error("Current locator differs from the candidate.");
  }
  for (const document of captured.documents) {
    const bytes = await readFile(sourcePath(machineRoot, document.source));
    if (!bytes.equals(document.bytes)) {
      throw new Error(`Compatibility document differs: '${document.source}'.`);
    }
  }
  if (captured.openapi) {
    const bytes = await readFile(
      sourcePath(machineRoot, captured.openapi.path),
    );
    if (!bytes.equals(captured.openapi.bytes)) {
      throw new Error("Compatibility OpenAPI input differs.");
    }
  }
  await verifySnapshot(
    resolve(machineRoot, "v2", "snapshots", publication.directory),
    publication,
    captured,
  );
}

export async function publishProjection({
  outputRoot,
  contentRoot,
  publicDir,
  options,
  captured,
  provenance,
}) {
  const publication = {
    ...createPublication({ options, captured, provenance }),
    ...(options.remoteMcp && { remoteMcp: options.remoteMcp }),
  };
  const machineRoot = resolve(outputRoot, "_mcp");
  const stagingRoot = resolve(
    outputRoot,
    `._mcp-${process.pid}-${randomUUID()}`,
  );
  assertContained(outputRoot, machineRoot);
  assertContained(outputRoot, stagingRoot);
  await assertPublicationInputsUnchanged({
    contentRoot,
    publicDir,
    options,
    captured,
  });
  await mkdir(outputRoot, { recursive: true });
  try {
    try {
      await verifyCompleteProjection(machineRoot, publication, captured);
      return publication;
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw new Error(
          "CAS_CONFLICT: output already contains another projection.",
          { cause: error },
        );
      }
    }
    await writeCompleteProjection(stagingRoot, publication, captured);
    await verifyCompleteProjection(stagingRoot, publication, captured);
    await assertPublicationInputsUnchanged({
      contentRoot,
      publicDir,
      options,
      captured,
    });
    try {
      await rename(stagingRoot, machineRoot);
    } catch (error) {
      if (!["EEXIST", "ENOTEMPTY", "EPERM"].includes(error?.code)) throw error;
      try {
        await verifyCompleteProjection(machineRoot, publication, captured);
        return publication;
      } catch (verificationError) {
        throw new Error(
          "CAS_CONFLICT: another projection won the artifact commit.",
          { cause: verificationError },
        );
      }
    }
    await verifyCompleteProjection(machineRoot, publication, captured);
    return publication;
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }
}

export default function sumiDocsPublisher(rawOptions) {
  const options = normalizePublisherOptions(rawOptions);
  let projectRoot;
  let publicDir;
  let contentRoot;
  let captured;

  return {
    name: "sumi-docs-publisher",
    hooks: {
      "astro:config:done": ({ config }) => {
        projectRoot = fileURLToPath(config.root);
        publicDir = fileURLToPath(config.publicDir);
        contentRoot = options.contentRoot
          ? resolve(projectRoot, options.contentRoot)
          : resolve(projectRoot, "src/content/docs");
      },
      "astro:build:start": async () => {
        captured = await capturePublicationInputs({
          contentRoot,
          publicDir,
          options,
        });
      },
      "astro:build:done": async ({ dir, logger }) => {
        if (!captured) throw new Error("Publisher inputs were not captured.");
        const outputRoot = fileURLToPath(dir);
        const provenance = await resolveProvenance(
          projectRoot,
          options.provenance,
          options.requiredProvenance,
        );
        const publication = await publishProjection({
          outputRoot,
          contentRoot,
          publicDir,
          options,
          captured,
          provenance,
        });
        logger.info(
          `Published ${options.documents.length} documents at ${publication.v2.revision} to ${posix.join("_mcp", "v2", "current.json")}.`,
        );
      },
    },
  };
}
