import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep, dirname } from "node:path";
import {
  MAX_DOCUMENT_BYTES,
  MAX_MANIFEST_BYTES,
  MAX_OPENAPI_BYTES,
  MAX_TOTAL_DOCUMENT_BYTES,
  assertIntegrity,
  parseCurrentLocatorV2,
  parseLocatedManifestV2,
} from "@sumi-os/corpus-contract";
import type { IntegrityDescriptor, ManifestV2 } from "@sumi-os/corpus-contract";
import { isLocalV2LocatorPath } from "../utils/local-source-path.js";

export interface LocalDocument {
  path: string;
  content: string;
  route: string;
}

export interface LocalCorpus {
  documents: LocalDocument[];
  openApiContent?: string;
  revision: string;
}

interface LocalDocumentEntry {
  path: string;
  route: string;
  integrity: IntegrityDescriptor;
}

interface LocalOpenApiEntry {
  path: string;
  integrity: IntegrityDescriptor;
}

function isContained(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate);
  return (
    relativePath !== ".." &&
    !relativePath.startsWith(`..${sep}`) &&
    !isAbsolute(relativePath)
  );
}

async function readBoundedFile(
  corpusRoot: string,
  candidate: string,
  maxBytes: number,
  label: string,
): Promise<Uint8Array> {
  const normalizedRoot = resolve(corpusRoot);
  const normalizedCandidate = resolve(candidate);
  if (!isContained(normalizedRoot, normalizedCandidate)) {
    throw new Error(`${label} resolves outside the local corpus root.`);
  }

  let realRoot: string;
  let realCandidate: string;
  try {
    [realRoot, realCandidate] = await Promise.all([
      realpath(normalizedRoot),
      realpath(normalizedCandidate),
    ]);
  } catch (error) {
    throw new Error(`${label} cannot be accessed.`, { cause: error });
  }
  if (!isContained(realRoot, realCandidate)) {
    throw new Error(`${label} resolves outside the local corpus root.`);
  }

  let fileStats;
  try {
    fileStats = await stat(realCandidate);
  } catch (error) {
    throw new Error(`${label} cannot be accessed.`, { cause: error });
  }
  if (!fileStats.isFile()) {
    throw new Error(`${label} is not a regular file.`);
  }
  if (fileStats.size > maxBytes) {
    throw new Error(`${label} exceeds ${maxBytes} bytes.`);
  }

  let bytes: Buffer;
  try {
    bytes = await readFile(realCandidate);
  } catch (error) {
    throw new Error(`${label} cannot be read.`, { cause: error });
  }
  if (bytes.byteLength > maxBytes) {
    throw new Error(`${label} exceeds ${maxBytes} bytes.`);
  }
  let finalRealCandidate: string;
  try {
    finalRealCandidate = await realpath(normalizedCandidate);
  } catch (error) {
    throw new Error(`${label} changed while the corpus was being loaded.`, {
      cause: error,
    });
  }
  if (finalRealCandidate !== realCandidate) {
    throw new Error(`${label} changed while the corpus was being loaded.`);
  }
  return bytes;
}

function decodeUtf8(bytes: Uint8Array, label: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${label} must be valid UTF-8.`);
  }
}

function parseJson(bytes: Uint8Array, label: string): unknown {
  const text = decodeUtf8(bytes, label);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${label} must be valid JSON.`);
  }
}

function entries(manifest: ManifestV2): {
  documents: LocalDocumentEntry[];
  openapi?: LocalOpenApiEntry;
} {
  return {
    documents: manifest.documents.map(({ path, route, bytes, sha256 }) => ({
      path,
      route,
      integrity: { bytes, sha256 },
    })),
    ...(manifest.openapi && {
      openapi: {
        path: manifest.openapi.path,
        integrity: {
          bytes: manifest.openapi.bytes,
          sha256: manifest.openapi.sha256,
        },
      },
    }),
  };
}

/** Load one fully sealed local v2 projection without observing partial state. */
export async function loadLocalCorpus(
  locatorPath: string,
): Promise<LocalCorpus> {
  if (!isLocalV2LocatorPath(locatorPath)) {
    throw new Error(
      "A local corpus locator must be the exact _mcp/v2/current.json path.",
    );
  }

  const normalizedLocator = resolve(locatorPath);
  const corpusRoot = dirname(normalizedLocator);
  const locatorBytes = await readBoundedFile(
    corpusRoot,
    normalizedLocator,
    MAX_MANIFEST_BYTES,
    "Current locator",
  );
  const locator = parseCurrentLocatorV2(
    parseJson(locatorBytes, "Current locator"),
  );

  const manifestPath = resolve(corpusRoot, ...locator.manifest.split("/"));
  const manifestBytes = await readBoundedFile(
    corpusRoot,
    manifestPath,
    MAX_MANIFEST_BYTES,
    "Manifest",
  );
  const manifest = parseLocatedManifestV2(locator, manifestBytes);
  const snapshotRoot = dirname(manifestPath);
  const manifestEntries = entries(manifest);

  let totalDocumentBytes = 0;
  const documents: LocalDocument[] = [];
  for (const entry of manifestEntries.documents) {
    const bytes = await readBoundedFile(
      corpusRoot,
      resolve(snapshotRoot, "docs", ...entry.path.split("/")),
      MAX_DOCUMENT_BYTES,
      `Document '${entry.path}'`,
    );
    assertIntegrity(bytes, entry.integrity, entry.path);
    totalDocumentBytes += bytes.byteLength;
    if (totalDocumentBytes > MAX_TOTAL_DOCUMENT_BYTES) {
      throw new Error(
        `Local documentation exceeds ${MAX_TOTAL_DOCUMENT_BYTES} total bytes.`,
      );
    }
    documents.push({
      path: entry.path,
      content: decodeUtf8(bytes, `Document '${entry.path}'`),
      route: entry.route,
    });
  }

  let openApiContent: string | undefined;
  if (manifestEntries.openapi) {
    const openApiBytes = await readBoundedFile(
      corpusRoot,
      resolve(snapshotRoot, "docs", ...manifestEntries.openapi.path.split("/")),
      MAX_OPENAPI_BYTES,
      "OpenAPI document",
    );
    assertIntegrity(
      openApiBytes,
      manifestEntries.openapi.integrity,
      manifestEntries.openapi.path,
    );
    openApiContent = decodeUtf8(openApiBytes, "OpenAPI document");
  }

  return {
    documents,
    ...(openApiContent !== undefined && { openApiContent }),
    revision: locator.revision,
  };
}
