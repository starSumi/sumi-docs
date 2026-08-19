export interface SiteDeploymentConfig {
  siteOrigin: string;
  basePath: string;
  publicBaseUrl: string;
}

export interface ReleaseProvenanceInput {
  repository?: string;
  commit?: string;
}

const BASE_SEGMENT = /^[A-Za-z0-9._~-]+$/u;

export function normalizeSiteOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("SITE_URL must be an absolute URL.");
  }

  if (url.protocol !== "https:") {
    throw new Error("SITE_URL must use HTTPS.");
  }
  if (url.username || url.password) {
    throw new Error("SITE_URL must not contain credentials.");
  }
  if (url.search || url.hash) {
    throw new Error("SITE_URL must not contain a query string or fragment.");
  }
  if (url.pathname !== "/") {
    throw new Error("SITE_URL must be an origin without a path.");
  }

  return url.origin;
}

export function normalizeSiteBasePath(value?: string): string {
  const candidate = value?.trim() || "/";
  if (
    !candidate.startsWith("/") ||
    candidate.startsWith("//") ||
    candidate.includes("\\") ||
    candidate.includes("?") ||
    candidate.includes("#") ||
    candidate.includes("%")
  ) {
    throw new Error("BASE_PATH must be a root-relative URL path.");
  }

  const segments = candidate.split("/").filter(Boolean);
  if (
    segments.some(
      (segment) =>
        segment === "." || segment === ".." || !BASE_SEGMENT.test(segment),
    )
  ) {
    throw new Error("BASE_PATH contains an invalid path segment.");
  }

  return segments.length === 0 ? "/" : `/${segments.join("/")}/`;
}

export function resolveSiteDeployment(
  siteUrl: string,
  basePath?: string,
): SiteDeploymentConfig {
  const siteOrigin = normalizeSiteOrigin(siteUrl);
  const normalizedBasePath = normalizeSiteBasePath(basePath);
  return {
    siteOrigin,
    basePath: normalizedBasePath,
    publicBaseUrl: new URL(normalizedBasePath, `${siteOrigin}/`).href,
  };
}

export function resolveGitHubReleaseProvenance(
  environment: Readonly<Record<string, string | undefined>>,
): ReleaseProvenanceInput | undefined {
  const repository =
    environment.GITHUB_SERVER_URL && environment.GITHUB_REPOSITORY
      ? `${environment.GITHUB_SERVER_URL}/${environment.GITHUB_REPOSITORY}`
      : undefined;
  if (!repository && !environment.GITHUB_SHA) return undefined;

  return {
    repository,
    commit: environment.GITHUB_SHA,
  };
}

export function prefixSiteRoute(route: string, basePath: string): string {
  if (!route.startsWith("/") || route.startsWith("//")) {
    throw new Error("Site route must be root-relative.");
  }
  const normalizedBasePath = normalizeSiteBasePath(basePath);
  return normalizedBasePath === "/"
    ? route
    : `${normalizedBasePath.slice(0, -1)}${route}`;
}
