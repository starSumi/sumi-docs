import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parse as parseYaml } from "yaml";

const paths = {
  dockerignore: ".dockerignore",
  dockerfile: "Dockerfile.mcp",
  compose: "compose.yaml",
  entrypoint: "packages/mcp/scripts/container-entrypoint.mjs",
  collection:
    "packages/mcp/examples/postman/sumi-docs-mcp.postman_collection.json",
};

function read(path) {
  return readFileSync(path, "utf8");
}

function requireCondition(condition, message, errors) {
  if (!condition) errors.push(message);
}

function isIgnoredBuildInput(path, patterns) {
  let ignored = false;
  for (const pattern of patterns) {
    const negate = pattern.startsWith("!");
    const candidate = negate ? pattern.slice(1) : pattern;
    let matches =
      path === candidate ||
      path.startsWith(`${candidate}/`) ||
      (candidate === ".env.*" && path.startsWith(".env."));
    if (candidate.startsWith("**/")) {
      const suffix = candidate.slice(3);
      matches =
        path === suffix ||
        path.startsWith(`${suffix}/`) ||
        path.includes(`/${suffix}/`) ||
        path.endsWith(`/${suffix}`);
    }
    if (candidate === "**/*.log") matches = path.endsWith(".log");
    if (matches) ignored = !negate;
  }
  return ignored;
}

function validateDockerAssets(errors) {
  const dockerignore = read(paths.dockerignore);
  const ignorePatterns = dockerignore
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
  const dockerfile = read(paths.dockerfile);
  const compose = parseYaml(read(paths.compose));
  const service = compose?.services?.mcp;

  for (const ignored of [
    ".git",
    ".agents",
    ".codex",
    ".env",
    "**/node_modules",
    "**/dist",
    "**/artifacts",
  ]) {
    requireCondition(
      dockerignore.split(/\r?\n/u).includes(ignored),
      `.dockerignore must exclude ${ignored}.`,
      errors,
    );
  }
  for (const input of [
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    ".npmrc",
    "packages/corpus-contract/package.json",
    "packages/corpus-contract/tsconfig.json",
    "packages/corpus-contract/src/index.ts",
    "packages/mcp/package.json",
    "packages/mcp/tsconfig.json",
    "packages/mcp/src/index.ts",
    "packages/mcp/scripts/container-entrypoint.mjs",
    "docs/getting-started.md",
  ]) {
    requireCondition(
      existsSync(input) && !isIgnoredBuildInput(input, ignorePatterns),
      `.dockerignore excludes a required build input: ${input}.`,
      errors,
    );
  }

  requireCondition(
    (dockerfile.match(/^FROM node:25\.5\.0-bookworm-slim AS /gmu) ?? [])
      .length === 2,
    "Dockerfile.mcp must use Node.js 25.5.0 for both stages.",
    errors,
  );
  requireCondition(
    dockerfile.includes("npm install --global --ignore-scripts") &&
      dockerfile.includes("--registry https://registry.npmjs.org") &&
      dockerfile.includes("pnpm@10.26.0"),
    "Dockerfile.mcp must install pnpm 10.26.0 from the approved registry without lifecycle scripts.",
    errors,
  );
  requireCondition(
    dockerfile.includes("--frozen-lockfile") &&
      dockerfile.includes("--ignore-scripts"),
    "Dockerfile.mcp must use a frozen, script-free dependency install.",
    errors,
  );
  requireCondition(
    dockerfile.indexOf("@sumi-os/corpus-contract build") <
      dockerfile.indexOf("@sumi-os/docs-mcp build") &&
      /pnpm --ignore-scripts\s+\\?\s*--filter @sumi-os\/docs-mcp deploy/u.test(
        dockerfile,
      ) &&
      dockerfile.includes("--prod") &&
      dockerfile.includes("--legacy"),
    "Dockerfile.mcp must build the workspace dependency before a script-free production package deploy.",
    errors,
  );
  requireCondition(
    /^USER node$/mu.test(dockerfile) &&
      dockerfile.includes(
        'ENTRYPOINT ["node", "scripts/container-entrypoint.mjs"]',
      ),
    "The MCP image must run the Node entrypoint as the non-root node user.",
    errors,
  );
  requireCondition(
    dockerfile.includes("/data/docs/") &&
      dockerfile.includes("/readyz") &&
      dockerfile.includes("SUMI_DOCS_ALLOWED_HOSTS=localhost,127.0.0.1"),
    "The local MCP image must include the default corpus and a readiness probe.",
    errors,
  );
  requireCondition(
    dockerfile.includes("FROM runtime-base AS local") &&
      dockerfile.includes("FROM runtime-base AS production") &&
      dockerfile.includes(
        "SUMI_DOCS_SOURCE=/opt/sumi-docs/corpus/_mcp/v2/current.json",
      ) &&
      dockerfile.includes(
        "COPY --from=corpus --chown=node:node . /opt/sumi-docs/corpus/_mcp/",
      ) &&
      !dockerfile.includes("build-machine-projection.mjs"),
    "The production image must consume one externally sealed corpus context without publishing another projection.",
    errors,
  );

  requireCondition(
    service?.build?.dockerfile === "Dockerfile.mcp" &&
      service?.build?.target === "local",
    "compose.yaml must build the local Dockerfile.mcp target.",
    errors,
  );
  requireCondition(
    service?.environment?.SUMI_DOCS_ALLOWED_HOSTS ===
      "${SUMI_DOCS_ALLOWED_HOSTS:-localhost,127.0.0.1}",
    "compose.yaml must preserve both documented loopback hostnames by default.",
    errors,
  );
  requireCondition(
    service?.environment?.SUMI_DOCS_HTTP_HOST === "0.0.0.0" &&
      service?.environment?.SUMI_DOCS_HTTP_PATH === "/mcp" &&
      String(service?.environment?.SUMI_DOCS_ALLOWED_HOSTS ?? "").length > 0,
    "Compose must explicitly bind HTTP and configure allowed hosts.",
    errors,
  );
  requireCondition(
    service?.ports?.includes("127.0.0.1:${SUMI_DOCS_MCP_PORT:-3000}:3000"),
    "Compose must publish the MCP port on loopback by default.",
    errors,
  );
  requireCondition(
    service?.read_only === true &&
      service?.cap_drop?.includes("ALL") &&
      service?.security_opt?.includes("no-new-privileges:true"),
    "Compose must use a read-only filesystem, drop capabilities, and prevent privilege escalation.",
    errors,
  );
  const corpusMount = service?.volumes?.find(
    (volume) => volume?.target === "/data/docs",
  );
  requireCondition(
    corpusMount?.type === "bind" && corpusMount?.read_only === true,
    "Compose must mount /data/docs from a read-only bind source.",
    errors,
  );
  requireCondition(
    service?.tmpfs?.some(
      (value) => value.startsWith("/tmp:") && value.includes("noexec"),
    ) && service?.healthcheck?.test?.join(" ").includes("/readyz"),
    "Compose must provide a constrained temporary filesystem and readiness healthcheck.",
    errors,
  );
}

function validateEntrypoint(errors) {
  const entrypoint = read(paths.entrypoint);
  requireCondition(
    entrypoint.includes(
      'import { reportCliError, run } from "../dist/cli.js";',
    ) &&
      entrypoint.includes('"--allow-public-network"') &&
      entrypoint.includes("required: true") &&
      entrypoint.includes("await main().catch(reportCliError);") &&
      entrypoint.includes("await run(args);"),
    "The container entrypoint must call the CLI with explicit public-network acknowledgement and required allowed hosts.",
    errors,
  );
  for (const requiredText of [
    '?? "/data/docs"',
    '?? "0.0.0.0"',
    '?? "3000"',
    '?? "/mcp"',
  ]) {
    requireCondition(
      entrypoint.includes(requiredText),
      `The container entrypoint is missing default ${requiredText}.`,
      errors,
    );
  }
  requireCondition(
    !/(?:child_process|\beval\s*\(|\bexec\s*\(|\bspawn\s*\()/u.test(entrypoint),
    "The container entrypoint must not invoke a shell or evaluate environment text.",
    errors,
  );
}

function parseRequestBody(item) {
  const raw = item.request?.body?.raw;
  if (typeof raw !== "string") return undefined;
  return JSON.parse(
    raw
      .replaceAll("{{protocol_version}}", "2026-07-28")
      .replaceAll("{{search_query}}", "architecture")
      .replaceAll("{{document_path}}", "getting-started.md"),
  );
}

function validatePostman(errors) {
  const source = read(paths.collection);
  const collection = JSON.parse(source);
  const expectedItems = new Map([
    ["Health", { http: "GET" }],
    ["Readiness", { http: "GET" }],
    ["Server discover", { http: "POST", protocol: "server/discover" }],
    ["Tools list", { http: "POST", protocol: "tools/list" }],
    ["List docs", { http: "POST", protocol: "tools/call", tool: "list_docs" }],
    [
      "Search docs",
      { http: "POST", protocol: "tools/call", tool: "search_docs" },
    ],
    ["Fetch doc", { http: "POST", protocol: "tools/call", tool: "fetch_doc" }],
  ]);
  requireCondition(
    collection.info?.schema ===
      "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    "The Postman collection must use schema v2.1.",
    errors,
  );
  requireCondition(
    JSON.stringify(collection.item?.map((item) => item.name)) ===
      JSON.stringify([...expectedItems.keys()]),
    "The Postman collection does not contain the reviewed probe sequence.",
    errors,
  );
  requireCondition(
    !/[A-Za-z]:\\\\/u.test(source) &&
      !/(?:Authorization|Bearer |api[_-]?key|password|secret)/iu.test(source),
    "The Postman collection must not contain credentials or machine-local absolute paths.",
    errors,
  );

  for (const item of collection.item ?? []) {
    const expected = expectedItems.get(item.name);
    if (!expected) continue;
    requireCondition(
      item.request?.method === expected.http,
      `${item.name} uses an unexpected HTTP method.`,
      errors,
    );
    const tests = (item.event ?? [])
      .flatMap((event) => event.script?.exec ?? [])
      .join("\n");
    requireCondition(
      tests.includes("Mcp-Session-Id") && tests.includes("to.be.false"),
      `${item.name} must assert that no MCP session header is returned.`,
      errors,
    );
    if (!expected.protocol) continue;

    const headers = Object.fromEntries(
      (item.request.header ?? []).map((header) => [
        header.key.toLowerCase(),
        header.value,
      ]),
    );
    const body = parseRequestBody(item);
    const meta = body?.params?._meta;
    requireCondition(
      headers["mcp-protocol-version"] === "{{protocol_version}}" &&
        headers["mcp-method"] === expected.protocol &&
        body?.method === expected.protocol &&
        meta?.["io.modelcontextprotocol/protocolVersion"] === "2026-07-28" &&
        typeof meta?.["io.modelcontextprotocol/clientInfo"] === "object" &&
        typeof meta?.["io.modelcontextprotocol/clientCapabilities"] ===
          "object",
      `${item.name} is missing the reviewed 2026 MCP headers or request metadata.`,
      errors,
    );
    if (expected.tool) {
      requireCondition(
        body?.params?.name === expected.tool &&
          headers["mcp-name"] === expected.tool,
        `${item.name} must align the MCP name header with the requested tool.`,
        errors,
      );
    } else {
      requireCondition(
        headers["mcp-name"] === undefined,
        `${item.name} must not send an MCP name header.`,
        errors,
      );
    }
  }
}

export function verifyDeploymentAssets() {
  const errors = [];
  validateDockerAssets(errors);
  validateEntrypoint(errors);
  validatePostman(errors);
  if (errors.length > 0) throw new Error(errors.join("\n"));
}

function main() {
  verifyDeploymentAssets();
  process.stdout.write(
    "Verified Docker, Compose, container entrypoint, and Postman assets.\n",
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
