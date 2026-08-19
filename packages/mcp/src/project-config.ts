import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { ParsedCLIOptions, ResolvedCLIOptions } from "./types/index.js";
import { normalizeBaseUrl } from "./utils/document-url.js";
import { isLocalV2LocatorPath } from "./utils/local-source-path.js";
import {
  isRemoteDocsSource,
  isRemoteV2LocatorSource,
  normalizeRemoteManifestUrl,
} from "./utils/remote-source-url.js";

export const PROJECT_CONFIG_NAME = "sumi-docs.config.json";

export interface ProjectConfig {
  version?: 1;
  source?: string;
  openapi?: string;
  baseUrl?: string;
}

interface ProjectContext {
  projectRoot: string;
  configPath?: string;
}

function isContained(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate);
  return (
    relativePath !== ".." &&
    !relativePath.startsWith(`..${sep}`) &&
    !isAbsolute(relativePath)
  );
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error.code === "ENOENT" || error.code === "ENOTDIR")
    ) {
      return false;
    }
    throw error;
  }
}

async function findGitRoot(startDirectory: string): Promise<string | null> {
  let current = resolve(startDirectory);
  while (true) {
    if (await pathExists(join(current, ".git"))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

async function findImplicitConfig(
  cwd: string,
  boundary: string,
): Promise<string | undefined> {
  let current = cwd;
  while (true) {
    const candidate = join(current, PROJECT_CONFIG_NAME);
    if (await pathExists(candidate)) return candidate;
    if (current === boundary) return undefined;
    const parent = dirname(current);
    if (parent === current || !isContained(boundary, parent)) return undefined;
    current = parent;
  }
}

async function resolveProjectContext(
  cwd: string,
  selectedConfigPath?: string,
): Promise<ProjectContext> {
  const normalizedCwd = resolve(cwd);
  if (selectedConfigPath) {
    const configPath = resolve(normalizedCwd, selectedConfigPath);
    const configRoot = dirname(configPath);
    const gitRoot = await findGitRoot(configRoot);
    return { projectRoot: gitRoot ?? configRoot, configPath };
  }

  const gitRoot = await findGitRoot(normalizedCwd);
  const projectRoot = gitRoot ?? normalizedCwd;
  const configPath = await findImplicitConfig(normalizedCwd, projectRoot);
  return { projectRoot, ...(configPath && { configPath }) };
}

export async function readProjectConfig(path: string): Promise<ProjectConfig> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    throw new Error(
      `Cannot read project config ${path}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(
      `Project config ${path} contains an unknown or invalid field: root must be an object.`,
    );
  }
  const candidate = parsed as Record<string, unknown>;
  const allowedFields = new Set(["version", "source", "openapi", "baseUrl"]);
  const unknownField = Object.keys(candidate).find(
    (field) => !allowedFields.has(field),
  );
  if (unknownField) {
    throw new Error(
      `Project config ${path} contains an unknown or invalid field: ${unknownField}.`,
    );
  }
  if (candidate.version !== undefined && candidate.version !== 1) {
    throw new Error(`Project config ${path} supports only version 1.`);
  }
  for (const field of ["source", "openapi", "baseUrl"] as const) {
    const value = candidate[field];
    if (
      value !== undefined &&
      (typeof value !== "string" || value.trim().length === 0)
    ) {
      throw new Error(
        `Project config ${path} contains an unknown or invalid field: ${field} must be a non-empty string.`,
      );
    }
  }
  return {
    ...(candidate.version === 1 && { version: 1 as const }),
    ...(typeof candidate.source === "string" && {
      source: candidate.source.trim(),
    }),
    ...(typeof candidate.openapi === "string" && {
      openapi: candidate.openapi.trim(),
    }),
    ...(typeof candidate.baseUrl === "string" && {
      baseUrl: candidate.baseUrl.trim(),
    }),
  };
}

function resolveConfigLocalPath(
  configuredPath: string,
  configPath: string,
  projectRoot: string,
): string {
  const candidate = resolve(dirname(configPath), configuredPath);
  if (!isContained(projectRoot, candidate)) {
    throw new Error(
      `Configured path '${configuredPath}' resolves outside the project root.`,
    );
  }
  return candidate;
}

async function assertRealPathContained(
  candidate: string,
  projectRoot: string,
): Promise<void> {
  let resolvedCandidate: string;
  let resolvedRoot: string;
  try {
    [resolvedCandidate, resolvedRoot] = await Promise.all([
      realpath(candidate),
      realpath(projectRoot),
    ]);
  } catch {
    return;
  }
  if (!isContained(resolvedRoot, resolvedCandidate)) {
    throw new Error(`Configured path resolves outside the project root.`);
  }
}

async function containsMarkdown(directory: string): Promise<boolean> {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && /\.mdx?$/i.test(entry.name)) return true;
  }
  for (const entry of entries) {
    if (
      entry.isDirectory() &&
      entry.name !== "node_modules" &&
      !entry.name.startsWith(".") &&
      (await containsMarkdown(join(directory, entry.name)))
    ) {
      return true;
    }
  }
  return false;
}

async function validateLocalSource(
  source: string,
): Promise<"local-directory" | "local-v2"> {
  let sourceStats;
  try {
    sourceStats = await stat(source);
  } catch (error) {
    throw new Error(
      `Cannot access documentation source ${source}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  if (sourceStats.isFile()) {
    if (isLocalV2LocatorPath(source)) return "local-v2";
    throw new Error(
      "A local documentation file must be the exact _mcp/v2/current.json locator.",
    );
  }
  if (!sourceStats.isDirectory()) {
    throw new Error(
      `Documentation source is not a directory or v2 locator: ${source}`,
    );
  }
  try {
    if (!(await containsMarkdown(source))) {
      throw new Error(
        `Documentation source does not contain any Markdown or MDX files: ${source}`,
      );
    }
  } catch (error) {
    if (error instanceof Error && /does not contain/.test(error.message)) {
      throw error;
    }
    throw new Error(
      `Cannot read documentation source ${source}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  return "local-directory";
}

/** Resolve CLI, tracked config, and convention defaults into one runnable source. */
export async function resolveCliOptions(
  options: ParsedCLIOptions,
  cwd: string = process.cwd(),
): Promise<ResolvedCLIOptions> {
  const normalizedCwd = resolve(cwd);
  const context = await resolveProjectContext(
    normalizedCwd,
    options.configPath,
  );
  const config = context.configPath
    ? await readProjectConfig(context.configPath)
    : {};

  let docsSource: string;
  let sourceOrigin: ResolvedCLIOptions["sourceOrigin"];
  if (options.docsSource) {
    docsSource = isRemoteDocsSource(options.docsSource)
      ? normalizeRemoteManifestUrl(options.docsSource).href
      : resolve(normalizedCwd, options.docsSource);
    sourceOrigin = "cli";
  } else if (config.source && context.configPath) {
    docsSource = isRemoteDocsSource(config.source)
      ? normalizeRemoteManifestUrl(config.source).href
      : resolveConfigLocalPath(
          config.source,
          context.configPath,
          context.projectRoot,
        );
    sourceOrigin = "config";
  } else {
    docsSource = join(context.projectRoot, "docs");
    sourceOrigin = "default";
  }

  let openApiPath: string | undefined;
  if (options.openApiPath) {
    openApiPath = resolve(normalizedCwd, options.openApiPath);
  } else if (
    config.openapi &&
    context.configPath &&
    !(
      sourceOrigin === "cli" &&
      (isRemoteDocsSource(docsSource) || isLocalV2LocatorPath(docsSource))
    )
  ) {
    openApiPath = resolveConfigLocalPath(
      config.openapi,
      context.configPath,
      context.projectRoot,
    );
    await assertRealPathContained(openApiPath, context.projectRoot);
  }

  let sourceKind: ResolvedCLIOptions["sourceKind"];
  if (isRemoteDocsSource(docsSource)) {
    sourceKind = "remote";
    if (openApiPath) {
      throw new Error(
        "Remote documentation must declare OpenAPI in its manifest; --openapi and configured OpenAPI paths are local-only.",
      );
    }
  } else {
    if (sourceOrigin === "config") {
      await assertRealPathContained(docsSource, context.projectRoot);
    }
    sourceKind = await validateLocalSource(docsSource);
    if (sourceKind === "local-v2" && openApiPath) {
      throw new Error(
        "Manifest-backed documentation must declare OpenAPI in its manifest; --openapi and configured OpenAPI paths are directory-only.",
      );
    }
  }

  const configuredBaseUrl = options.baseUrl ?? config.baseUrl;
  const baseUrl = configuredBaseUrl
    ? normalizeBaseUrl(configuredBaseUrl)
    : undefined;

  return {
    docsSource,
    openApiPath,
    baseUrl,
    transport: options.transport,
    ...(options.http && { http: options.http }),
    verbose: options.verbose,
    projectRoot: context.projectRoot,
    sourceOrigin,
    sourceKind,
    sourceFormat:
      sourceKind === "local-directory"
        ? "directory"
        : sourceKind === "local-v2" || isRemoteV2LocatorSource(docsSource)
          ? "manifest-v2"
          : "manifest-v1",
    ...(context.configPath && { configPath: context.configPath }),
  };
}
