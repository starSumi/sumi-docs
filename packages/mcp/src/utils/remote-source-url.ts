const MANIFEST_FILE_NAME = "sumi-docs-manifest.json";

export function isRemoteDocsSource(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function isLoopback(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "::1"
  );
}

export function normalizeRemoteManifestUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Remote documentation source must be an absolute URL.");
  }

  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && isLoopback(url.hostname))
  ) {
    throw new Error(
      "Remote documentation requires HTTPS; HTTP is allowed only on loopback.",
    );
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(
      "Remote documentation URL must not contain credentials, a query, or a fragment.",
    );
  }
  if (!url.pathname.toLowerCase().endsWith(".json")) {
    if (!url.pathname.endsWith("/")) url.pathname += "/";
    url.pathname += MANIFEST_FILE_NAME;
  }
  return url;
}

export function isRemoteV2LocatorSource(source: string | URL): boolean {
  const url =
    source instanceof URL ? source : normalizeRemoteManifestUrl(source);
  return url.pathname.endsWith("/_mcp/v2/current.json");
}
