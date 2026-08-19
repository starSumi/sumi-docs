const MARKDOWN_EXTENSION = /\.mdx?$/i;

/** Validate and canonicalize the public site prefix used for document links. */
export function normalizeBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Base URL must be an absolute HTTP(S) URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Base URL must use HTTP or HTTPS.");
  }
  if (url.username || url.password) {
    throw new Error("Base URL must not contain credentials.");
  }
  if (url.search || url.hash) {
    throw new Error("Base URL must not contain a query string or fragment.");
  }

  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url.href;
}

/** Map a corpus-relative Markdown path to its public, extensionless page URL. */
export function buildDocumentUrl(
  baseUrl: string,
  documentPath: string,
  route?: string,
): string {
  if (route) {
    const base = new URL(baseUrl);
    const relativeRoute = route === "/" ? "" : route.replace(/^\/+/, "");
    const resolved = new URL(relativeRoute ? `./${relativeRoute}` : "", base);
    if (
      resolved.protocol !== base.protocol ||
      resolved.origin !== base.origin
    ) {
      throw new Error("Document route must remain within the base URL origin.");
    }
    return resolved.href;
  }

  const segments = documentPath
    .replace(/\\/g, "/")
    .replace(MARKDOWN_EXTENSION, "")
    .split("/");
  if (segments.at(-1)?.toLowerCase() === "index") segments.pop();

  const pagePath = segments
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const relativeUrl = pagePath ? `${pagePath}/` : "";

  return new URL(relativeUrl, baseUrl).href;
}
