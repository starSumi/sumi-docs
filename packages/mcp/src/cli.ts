import minimist from "minimist";
import type { DoctorReport } from "./doctor.js";
import type { ParsedCLIOptions } from "./types/index.js";
import { normalizeBaseUrl } from "./utils/document-url.js";
import { sanitizeDiagnostic } from "./utils/diagnostics.js";
import { isLocalV2LocatorPath } from "./utils/local-source-path.js";
import {
  isRemoteDocsSource,
  normalizeRemoteManifestUrl,
} from "./utils/remote-source-url.js";
import { VERSION } from "./version.js";

function printHelp(): void {
  console.log(`Sumi-Docs-MCP ${VERSION} - Read-only MCP server for documentation

Usage:
  sumi-docs-mcp serve [docs-source] [--config <path>] [--openapi <path>] [--base-url <url>] [--transport <type>]
  sumi-docs-mcp doctor [docs-source] [--config <path>] [--json] [--show-paths]

Options:
  [docs-source]          Local directory, local _mcp/v2/current.json, or
                         remote HTTPS manifest/base URL
                         (default: project config, then <project-root>/docs)
  --config <path>        Explicit sumi-docs.config.json path
  --openapi <path>       Path to an OpenAPI JSON specification
                         (local directory mode only; manifests declare it)
  --base-url <url>       Public HTTP(S) prefix for clickable document URLs
  --transport <type>     Transport: stdio (default) or streamable-http
  --http-host <host>     HTTP bind host (default: 127.0.0.1)
  --http-port <port>     HTTP listen port (default: 3000)
  --http-path <path>     MCP endpoint path (default: /mcp)
  --allowed-host <host>  Allowed HTTP Host hostname; repeatable
  --allowed-origin <host> Allowed browser Origin hostname; repeatable
  --allow-public-network Acknowledge a non-loopback HTTP bind
  --verbose              Enable verbose diagnostics
  --json                 Emit a machine-readable doctor report
  --show-paths           Show resolved local paths in doctor output
  --help, -h             Show this help
  --version, -v          Show the version`);
}

export function parseCliOptions(argv: string[]): ParsedCLIOptions | null {
  if (argv.some((argument) => argument.startsWith("--show-paths"))) {
    throw new Error("--show-paths is supported only by the doctor command.");
  }
  const args = minimist(argv, {
    string: [
      "config",
      "openapi",
      "base-url",
      "transport",
      "http-host",
      "http-port",
      "http-path",
      "allowed-host",
      "allowed-origin",
    ],
    boolean: ["help", "version", "verbose", "allow-public-network"],
    alias: { h: "help", v: "version" },
    "--": true,
  });
  if (args.help || args.version) return null;
  for (const option of [
    "config",
    "openapi",
    "base-url",
    "transport",
    "http-host",
    "http-port",
    "http-path",
    "allowed-host",
    "allowed-origin",
  ]) {
    const value = args[option];
    const hasNonEmptyValue = Array.isArray(value)
      ? value.length > 0 &&
        value.every(
          (entry) => typeof entry === "string" && entry.trim().length > 0,
        )
      : typeof value === "string" && value.trim().length > 0;
    if (
      argv.some(
        (argument) =>
          argument === `--${option}` || argument.startsWith(`--${option}=`),
      ) &&
      !hasNonEmptyValue
    ) {
      throw new Error(`--${option} requires a non-empty value.`);
    }
  }
  if (
    args._[0] !== "serve" ||
    (args._[1] !== undefined && typeof args._[1] !== "string") ||
    args._.length > 2
  ) {
    throw new Error(
      "Usage: sumi-docs-mcp serve [docs-source] [--config <path>] [--openapi <path>] [--base-url <url>] [--transport stdio]",
    );
  }
  const transport = args.transport ?? "stdio";
  if (transport !== "stdio" && transport !== "streamable-http") {
    throw new Error(
      `Unsupported transport '${transport}'; use stdio or streamable-http.`,
    );
  }
  const httpOptionNames = [
    "http-host",
    "http-port",
    "http-path",
    "allowed-host",
    "allowed-origin",
    "allow-public-network",
  ];
  const hasHttpOption = httpOptionNames.some((name) =>
    argv.some(
      (argument) =>
        argument === `--${name}` || argument.startsWith(`--${name}=`),
    ),
  );
  if (transport === "stdio" && hasHttpOption) {
    throw new Error("HTTP options require --transport streamable-http.");
  }
  const docsSource = args._[1] as string | undefined;
  if (docsSource && isRemoteDocsSource(docsSource)) {
    normalizeRemoteManifestUrl(docsSource);
    if (args.openapi) {
      throw new Error(
        "Remote documentation must declare OpenAPI in its manifest; --openapi is local-only.",
      );
    }
  }
  if (docsSource && isLocalV2LocatorPath(docsSource) && args.openapi) {
    throw new Error(
      "Manifest-backed documentation must declare OpenAPI in its manifest; --openapi is directory-only.",
    );
  }
  const options: ParsedCLIOptions = {
    docsSource,
    openApiPath: args.openapi,
    baseUrl:
      typeof args["base-url"] === "string"
        ? normalizeBaseUrl(args["base-url"])
        : undefined,
    transport,
    verbose: Boolean(args.verbose),
  };
  if (transport === "streamable-http") {
    const host = normalizeHostname(
      args["http-host"] ?? "127.0.0.1",
      "--http-host",
    );
    const port = parseHttpPort(args["http-port"] ?? "3000");
    const path = normalizeHttpPath(args["http-path"] ?? "/mcp");
    const allowedHosts = normalizeHostnameList(
      args["allowed-host"],
      "--allowed-host",
    );
    const allowedOrigins = normalizeHostnameList(
      args["allowed-origin"],
      "--allowed-origin",
    );
    const allowPublicNetwork = Boolean(args["allow-public-network"]);
    if (!isLoopbackHost(host) && !allowPublicNetwork) {
      throw new Error(
        "A non-loopback HTTP bind requires --allow-public-network.",
      );
    }
    if (!isLoopbackHost(host) && allowedHosts.length === 0) {
      throw new Error(
        "A non-loopback HTTP bind requires at least one --allowed-host.",
      );
    }
    options.http = {
      host,
      port,
      path,
      allowedHosts,
      allowedOrigins,
      allowPublicNetwork,
    };
  }
  if (typeof args.config === "string") options.configPath = args.config;
  return options;
}

function normalizeHostname(value: string, option: string): string {
  const normalized = value.trim().toLowerCase();
  const bracketedIpv6 = /^\[[0-9a-f:]+\]$/i.test(normalized);
  const hostname =
    /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(
      normalized,
    );
  const ipv4 = /^(?:\d{1,3}\.){3}\d{1,3}$/.test(normalized);
  const ipv6 = /^[0-9a-f:]+$/i.test(normalized) && normalized.includes(":");
  if (!hostname && !ipv4 && !ipv6 && !bracketedIpv6) {
    throw new Error(
      `${option} must be a hostname or IP address without a scheme, port, or path.`,
    );
  }
  if (ipv4 && normalized.split(".").some((part) => Number(part) > 255)) {
    throw new Error(`${option} contains an invalid IPv4 address.`);
  }
  return normalized;
}

function normalizeHostnameList(
  value: string | string[] | undefined,
  option: string,
): string[] {
  if (value === undefined) return [];
  const values = Array.isArray(value) ? value : [value];
  return [...new Set(values.map((entry) => normalizeHostname(entry, option)))];
}

function parseHttpPort(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error("--http-port must be an integer between 1 and 65535.");
  }
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("--http-port must be an integer between 1 and 65535.");
  }
  return port;
}

function normalizeHttpPath(value: string): string {
  const path = value.trim();
  if (
    !path.startsWith("/") ||
    path.length > 256 ||
    path.includes("?") ||
    path.includes("#") ||
    path.includes("\\") ||
    path.includes("//") ||
    path.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    throw new Error("--http-path must be one unambiguous absolute URL path.");
  }
  if (path === "/healthz" || path === "/readyz") {
    throw new Error(
      "--http-path must not replace a reserved operational endpoint.",
    );
  }
  return path;
}

export function normalizeBuildRevision(
  value: string | undefined,
): string | undefined {
  if (value === undefined || value.trim().length === 0) return undefined;
  const revision = value.trim().toLowerCase();
  if (!/^(?:[a-f0-9]{40}|sha256:[a-f0-9]{64})$/u.test(revision)) {
    throw new Error(
      "SUMI_DOCS_BUILD_REVISION must be a full Git SHA or sha256 revision.",
    );
  }
  return revision;
}

export function normalizeExpectedCorpusRevision(
  value: string | undefined,
): string | undefined {
  if (value === undefined || value.trim().length === 0) return undefined;
  const revision = value.trim().toLowerCase();
  if (!/^sha256:[a-f0-9]{64}$/u.test(revision)) {
    throw new Error(
      "SUMI_DOCS_EXPECTED_CORPUS_REVISION must be a sha256 corpus revision.",
    );
  }
  return revision;
}

function isLoopbackHost(host: string): boolean {
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "[::1]"
  );
}

export function parseDoctorOptions(argv: string[]): {
  options: ParsedCLIOptions;
  json: boolean;
  showPaths: boolean;
} {
  if (argv[0] !== "doctor") {
    throw new Error(
      "Usage: sumi-docs-mcp doctor [docs-source] [--config <path>] [--json] [--show-paths]",
    );
  }
  const json = argv.includes("--json");
  const showPaths = argv.includes("--show-paths");
  if (argv.some((argument) => argument.startsWith("--show-paths="))) {
    throw new Error("--show-paths does not accept a value.");
  }
  const serveArgv = [
    "serve",
    ...argv
      .slice(1)
      .filter(
        (argument) => argument !== "--json" && argument !== "--show-paths",
      ),
  ];
  const options = parseCliOptions(serveArgv);
  if (!options) {
    throw new Error(
      "Usage: sumi-docs-mcp doctor [docs-source] [--config <path>] [--json] [--show-paths]",
    );
  }
  return { options, json, showPaths };
}

function printDoctorReport(report: DoctorReport): void {
  console.log(`Sumi Docs doctor: ${report.ok ? "OK" : "FAILED"}`);
  console.log(
    `Node.js: ${report.node.current} (required ${report.node.required})`,
  );
  console.log(`Project root: ${report.project.root}`);
  console.log(`Config: ${report.project.configPath ?? "not found"}`);
  console.log(
    `Source: ${report.source.value} (${report.source.origin}, ${report.source.kind})`,
  );
  console.log(`Documents: ${report.source.documentCount}`);
  console.log(
    `OpenAPI: ${report.source.openApiLoaded ? "loaded" : "not configured"}`,
  );
}

export async function run(argv: string[]): Promise<void> {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return;
  }
  if (argv.includes("--version") || argv.includes("-v")) {
    console.log(VERSION);
    return;
  }

  if (argv[0] === "doctor") {
    const doctor = parseDoctorOptions(argv);
    try {
      const { createDoctorReport } = await import("./doctor.js");
      const report = await createDoctorReport(
        doctor.options,
        process.cwd(),
        process.versions.node,
        doctor.showPaths,
      );
      if (doctor.json) console.log(JSON.stringify(report, null, 2));
      else printDoctorReport(report);
      if (!report.ok) process.exitCode = 1;
    } catch (error) {
      if (!doctor.json) throw error;
      console.log(
        JSON.stringify(
          {
            ok: false,
            error: {
              message: sanitizeDiagnostic(error, {
                showPaths: doctor.showPaths,
              }),
            },
          },
          null,
          2,
        ),
      );
      process.exitCode = 1;
    }
    return;
  }

  const parsedOptions = parseCliOptions(argv);
  if (!parsedOptions) return;
  const { resolveCliOptions } = await import("./project-config.js");
  const options = await resolveCliOptions(parsedOptions);
  const { DocsMcpServer } = await import("./mcp/server.js");

  let vaultReady: Promise<import("./vfs/DocsVault.js").DocsVault> | undefined;
  const loadVault = (): Promise<import("./vfs/DocsVault.js").DocsVault> =>
    (vaultReady ??= (async () => {
      const { DocsVault } = await import("./vfs/DocsVault.js");
      const vault = new DocsVault();
      if (options.sourceKind === "remote") {
        await vault.loadFromRemoteManifest(options.docsSource);
      } else if (options.sourceKind === "local-v2") {
        await vault.loadFromLocalManifest(options.docsSource);
      } else {
        await vault.loadFromDirectory(options.docsSource);
        if (options.openApiPath) await vault.loadOpenApi(options.openApiPath);
      }
      return vault;
    })());

  const serverFactory = () =>
    new DocsMcpServer(loadVault, { baseUrl: options.baseUrl }).server;
  if (options.transport === "stdio") {
    const { serveStdio } = await import("@modelcontextprotocol/server/stdio");
    serveStdio(serverFactory, { legacy: "reject" });
    return;
  }

  if (!options.http)
    throw new Error("Streamable HTTP options were not resolved.");
  const buildRevision = normalizeBuildRevision(
    process.env.SUMI_DOCS_BUILD_REVISION,
  );
  const expectedCorpusRevision = normalizeExpectedCorpusRevision(
    process.env.SUMI_DOCS_EXPECTED_CORPUS_REVISION,
  );
  const vault = await loadVault();
  const stats = vault.getStats();
  if (expectedCorpusRevision !== undefined) {
    if (stats.corpusRevision !== expectedCorpusRevision) {
      throw new Error(
        "The loaded corpus revision does not match SUMI_DOCS_EXPECTED_CORPUS_REVISION.",
      );
    }
  }
  const { serveStreamableHttp } = await import("./mcp/streamable-http.js");
  const handle = await serveStreamableHttp(serverFactory, {
    ...options.http,
    buildRevision,
    readiness: {
      documentCount: stats.documentCount,
      ...(stats.corpusRevision && {
        corpusRevision: stats.corpusRevision,
      }),
    },
  });
  console.error(
    JSON.stringify({
      event: "sumi_docs_mcp.ready",
      transport: "streamable-http",
      url: handle.url,
      version: VERSION,
      buildRevision: buildRevision ?? null,
      corpusRevision: stats.corpusRevision ?? null,
      documentCount: stats.documentCount,
    }),
  );
  let closing = false;
  const close = (): void => {
    if (closing) return;
    closing = true;
    void handle.close().catch((error) => {
      console.error(`HTTP shutdown failed: ${sanitizeDiagnostic(error)}`);
      process.exitCode = 1;
    });
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}

export function reportCliError(error: unknown): void {
  console.error(sanitizeDiagnostic(error));
  process.exitCode = 1;
}
