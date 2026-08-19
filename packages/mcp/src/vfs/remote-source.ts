import {
  assertIntegrity,
  parseCurrentLocatorV2,
  parseLocatedManifestV2,
  parseManifestV1,
} from "@sumi-os/corpus-contract";
import type {
  IntegrityDescriptor,
  ManifestV1,
  ManifestV2,
} from "@sumi-os/corpus-contract";
import {
  isRemoteDocsSource,
  isRemoteV2LocatorSource,
  normalizeRemoteManifestUrl,
} from "../utils/remote-source-url.js";

const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;
const MAX_OPENAPI_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_DOCUMENT_BYTES = 64 * 1024 * 1024;
const DOWNLOAD_CONCURRENCY = 8;
const FETCH_TIMEOUT_MS = 10_000;

export interface RemoteDocument {
  path: string;
  content: string;
  sourceUrl: string;
  route?: string;
  lastModified?: Date;
}

export interface RemoteCorpus {
  documents: RemoteDocument[];
  openApiContent?: string;
  revision?: string;
}

export { isRemoteDocsSource, normalizeRemoteManifestUrl };

export { isRemoteV2LocatorSource } from "../utils/remote-source-url.js";

async function readBoundedResponse(
  response: Response,
  maxBytes: number,
): Promise<{ bytes: Uint8Array; text: string; size: number }> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error(`Remote response exceeds ${maxBytes} bytes.`);
  }
  if (!response.body) return { bytes: new Uint8Array(), text: "", size: 0 };

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error(`Remote response exceeds ${maxBytes} bytes.`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = Buffer.concat(
    chunks.map((chunk) => Buffer.from(chunk)),
    size,
  );
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("Remote documentation response must be valid UTF-8.");
  }
  return { bytes, text, size };
}

async function fetchText(
  url: URL,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<{
  bytes: Uint8Array;
  text: string;
  size: number;
  lastModified?: Date;
}> {
  const response = await fetch(url, {
    redirect: "manual",
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)])
      : AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { accept: "text/markdown, application/json, text/plain;q=0.9" },
  });
  if (response.status >= 300 && response.status < 400) {
    throw new Error("Remote documentation redirects are not allowed.");
  }
  if (!response.ok) {
    throw new Error(
      `Remote documentation request failed with HTTP ${response.status}.`,
    );
  }

  const result = await readBoundedResponse(response, maxBytes);
  const lastModifiedValue = response.headers.get("last-modified");
  const lastModified = lastModifiedValue
    ? new Date(lastModifiedValue)
    : undefined;
  return {
    ...result,
    ...(lastModified &&
      !Number.isNaN(lastModified.getTime()) && { lastModified }),
  };
}

interface RemoteDocumentEntry {
  path: string;
  urlPath?: string;
  route?: string;
  integrity?: IntegrityDescriptor;
}

async function downloadCorpus(
  documentsToLoad: RemoteDocumentEntry[],
  openApiToLoad: RemoteDocumentEntry | undefined,
  contentBaseUrl: URL,
): Promise<RemoteCorpus> {
  const documents = new Array<RemoteDocument>(documentsToLoad.length);

  const downloads = new AbortController();
  let nextIndex = 0;
  let totalBytes = 0;
  const workers = Array.from(
    { length: Math.min(DOWNLOAD_CONCURRENCY, documentsToLoad.length) },
    async () => {
      while (nextIndex < documentsToLoad.length) {
        const index = nextIndex++;
        const entry = documentsToLoad[index];
        if (!entry) continue;
        const sourceUrl = new URL(entry.urlPath ?? entry.path, contentBaseUrl);
        const response = await fetchText(
          sourceUrl,
          MAX_DOCUMENT_BYTES,
          downloads.signal,
        );
        if (entry.integrity) {
          assertIntegrity(response.bytes, entry.integrity, entry.path);
        }
        totalBytes += response.size;
        if (totalBytes > MAX_TOTAL_DOCUMENT_BYTES) {
          throw new Error(
            `Remote documentation exceeds ${MAX_TOTAL_DOCUMENT_BYTES} total bytes.`,
          );
        }
        documents[index] = {
          path: entry.path,
          content: response.text,
          sourceUrl: sourceUrl.href,
          ...(entry.route && { route: entry.route }),
          ...(response.lastModified && { lastModified: response.lastModified }),
        };
      }
    },
  );
  try {
    await Promise.all(workers);
  } catch (error) {
    downloads.abort();
    await Promise.allSettled(workers);
    throw error;
  }

  let openApiContent: string | undefined;
  if (openApiToLoad) {
    const response = await fetchText(
      new URL(openApiToLoad.urlPath ?? openApiToLoad.path, contentBaseUrl),
      MAX_OPENAPI_BYTES,
      downloads.signal,
    );
    if (openApiToLoad.integrity) {
      assertIntegrity(
        response.bytes,
        openApiToLoad.integrity,
        openApiToLoad.path,
      );
    }
    openApiContent = response.text;
  }
  return {
    documents,
    ...(openApiContent !== undefined && { openApiContent }),
  };
}

function v1Entries(manifest: ManifestV1): {
  documents: RemoteDocumentEntry[];
  openapi?: RemoteDocumentEntry;
} {
  return {
    documents: manifest.documents.map((path) => ({ path })),
    ...(manifest.openapi && { openapi: { path: manifest.openapi } }),
  };
}

function v2Entries(manifest: ManifestV2): {
  documents: RemoteDocumentEntry[];
  openapi?: RemoteDocumentEntry;
} {
  return {
    documents: manifest.documents.map(({ path, route, bytes, sha256 }) => ({
      path,
      urlPath: `docs/${path}`,
      route,
      integrity: { bytes, sha256 },
    })),
    ...(manifest.openapi && {
      openapi: {
        path: manifest.openapi.path,
        urlPath: `docs/${manifest.openapi.path}`,
        integrity: {
          bytes: manifest.openapi.bytes,
          sha256: manifest.openapi.sha256,
        },
      },
    }),
  };
}

export async function loadRemoteCorpus(source: string): Promise<RemoteCorpus> {
  const manifestUrl = normalizeRemoteManifestUrl(source);
  const initialResponse = await fetchText(manifestUrl, MAX_MANIFEST_BYTES);
  let initialValue: unknown;
  try {
    initialValue = JSON.parse(initialResponse.text);
  } catch {
    throw new Error("Remote documentation manifest is not valid JSON.");
  }

  if (!isRemoteV2LocatorSource(manifestUrl)) {
    const entries = v1Entries(parseManifestV1(initialValue));
    return downloadCorpus(entries.documents, entries.openapi, manifestUrl);
  }

  const locator = parseCurrentLocatorV2(initialValue);
  const immutableManifestUrl = new URL(locator.manifest, manifestUrl);
  const immutableManifestResponse = await fetchText(
    immutableManifestUrl,
    MAX_MANIFEST_BYTES,
  );
  const manifest = parseLocatedManifestV2(
    locator,
    immutableManifestResponse.bytes,
  );
  const entries = v2Entries(manifest);
  const corpus = await downloadCorpus(
    entries.documents,
    entries.openapi,
    immutableManifestUrl,
  );
  return { ...corpus, revision: locator.revision };
}
