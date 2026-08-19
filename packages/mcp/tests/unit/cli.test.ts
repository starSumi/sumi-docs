import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeBuildRevision,
  normalizeExpectedCorpusRevision,
  parseCliOptions,
  parseDoctorOptions,
} from "../../src/cli.js";

test("parseCliOptions accepts the documented stdio command", () => {
  assert.deepEqual(
    parseCliOptions([
      "serve",
      "examples/basic/docs",
      "--openapi",
      "examples/basic/openapi.json",
      "--base-url",
      "https://docs.example.com/product",
      "--transport",
      "stdio",
      "--verbose",
    ]),
    {
      docsSource: "examples/basic/docs",
      openApiPath: "examples/basic/openapi.json",
      baseUrl: "https://docs.example.com/product/",
      transport: "stdio",
      verbose: true,
    },
  );
});

test("parseCliOptions accepts a remote documentation manifest", () => {
  assert.deepEqual(
    parseCliOptions([
      "serve",
      "https://raw.example.com/docs/sumi-docs-manifest.json",
    ]),
    {
      docsSource: "https://raw.example.com/docs/sumi-docs-manifest.json",
      openApiPath: undefined,
      baseUrl: undefined,
      transport: "stdio",
      verbose: false,
    },
  );
});

test("parseCliOptions accepts a local v2 locator and rejects external OpenAPI", () => {
  assert.deepEqual(
    parseCliOptions(["serve", "projection/_mcp/v2/current.json"]),
    {
      docsSource: "projection/_mcp/v2/current.json",
      openApiPath: undefined,
      baseUrl: undefined,
      transport: "stdio",
      verbose: false,
    },
  );
  assert.throws(
    () =>
      parseCliOptions([
        "serve",
        "projection/_mcp/v2/current.json",
        "--openapi",
        "openapi.json",
      ]),
    /must declare OpenAPI in its manifest/iu,
  );
});

test("parseCliOptions accepts a loopback Streamable HTTP endpoint", () => {
  assert.deepEqual(
    parseCliOptions([
      "serve",
      "examples/basic/docs",
      "--transport",
      "streamable-http",
      "--http-port",
      "4310",
      "--http-path",
      "/mcp",
    ]),
    {
      docsSource: "examples/basic/docs",
      openApiPath: undefined,
      baseUrl: undefined,
      transport: "streamable-http",
      verbose: false,
      http: {
        host: "127.0.0.1",
        port: 4310,
        path: "/mcp",
        allowedHosts: [],
        allowedOrigins: [],
        allowPublicNetwork: false,
      },
    },
  );
});

test("deployment revisions require complete immutable identifiers", () => {
  const gitRevision = "A".repeat(40);
  const corpusRevision = `sha256:${"B".repeat(64)}`;

  assert.equal(normalizeBuildRevision(gitRevision), gitRevision.toLowerCase());
  assert.equal(
    normalizeBuildRevision(corpusRevision),
    corpusRevision.toLowerCase(),
  );
  assert.equal(
    normalizeExpectedCorpusRevision(corpusRevision),
    corpusRevision.toLowerCase(),
  );
  assert.equal(normalizeBuildRevision("  "), undefined);
  assert.equal(normalizeExpectedCorpusRevision(undefined), undefined);

  for (const invalid of ["main", "abc123", `sha256:${"a".repeat(63)}`]) {
    assert.throws(
      () => normalizeBuildRevision(invalid),
      /full Git SHA|sha256/u,
    );
  }
  assert.throws(
    () => normalizeExpectedCorpusRevision("a".repeat(40)),
    /sha256 corpus revision/u,
  );
});

test("parseCliOptions requires an explicit network boundary for remote HTTP", () => {
  assert.deepEqual(
    parseCliOptions([
      "serve",
      "https://docs.example.com/_mcp/v2/current.json",
      "--transport",
      "streamable-http",
      "--http-host",
      "0.0.0.0",
      "--http-port",
      "8080",
      "--http-path",
      "/mcp",
      "--allowed-host",
      "mcp.example.com",
      "--allowed-origin",
      "docs.example.com",
      "--allow-public-network",
    ]),
    {
      docsSource: "https://docs.example.com/_mcp/v2/current.json",
      openApiPath: undefined,
      baseUrl: undefined,
      transport: "streamable-http",
      verbose: false,
      http: {
        host: "0.0.0.0",
        port: 8080,
        path: "/mcp",
        allowedHosts: ["mcp.example.com"],
        allowedOrigins: ["docs.example.com"],
        allowPublicNetwork: true,
      },
    },
  );

  assert.throws(
    () =>
      parseCliOptions([
        "serve",
        "examples/basic/docs",
        "--transport",
        "streamable-http",
        "--http-host",
        "0.0.0.0",
        "--allowed-host",
        "mcp.example.com",
      ]),
    /allow-public-network/i,
  );
  assert.throws(
    () =>
      parseCliOptions([
        "serve",
        "examples/basic/docs",
        "--transport",
        "streamable-http",
        "--http-host",
        "0.0.0.0",
        "--allow-public-network",
      ]),
    /allowed-host/i,
  );
});

test("parseCliOptions accepts repeated HTTP allowlist options", () => {
  const result = parseCliOptions([
    "serve",
    "examples/basic/docs",
    "--transport",
    "streamable-http",
    "--http-host",
    "0.0.0.0",
    "--allowed-host",
    "localhost",
    "--allowed-host",
    "127.0.0.1",
    "--allowed-origin",
    "docs.example.com",
    "--allowed-origin",
    "admin.example.com",
    "--allow-public-network",
  ]);

  assert.deepEqual(result?.http?.allowedHosts, ["localhost", "127.0.0.1"]);
  assert.deepEqual(result?.http?.allowedOrigins, [
    "docs.example.com",
    "admin.example.com",
  ]);
});

test("parseCliOptions accepts discovery and explicit config", () => {
  assert.deepEqual(parseCliOptions(["serve"]), {
    docsSource: undefined,
    openApiPath: undefined,
    baseUrl: undefined,
    transport: "stdio",
    verbose: false,
  });
  assert.deepEqual(
    parseCliOptions(["serve", "--config", "config/sumi-docs.json"]),
    {
      docsSource: undefined,
      openApiPath: undefined,
      baseUrl: undefined,
      configPath: "config/sumi-docs.json",
      transport: "stdio",
      verbose: false,
    },
  );
});

test("parseDoctorOptions accepts the JSON diagnostic mode", () => {
  assert.deepEqual(parseDoctorOptions(["doctor", "--json"]), {
    options: {
      docsSource: undefined,
      openApiPath: undefined,
      baseUrl: undefined,
      transport: "stdio",
      verbose: false,
    },
    json: true,
    showPaths: false,
  });
});

test("parseDoctorOptions supports explicit path disclosure only for doctor", () => {
  assert.deepEqual(parseDoctorOptions(["doctor", "--show-paths"]), {
    options: {
      docsSource: undefined,
      openApiPath: undefined,
      baseUrl: undefined,
      transport: "stdio",
      verbose: false,
    },
    json: false,
    showPaths: true,
  });
  assert.throws(
    () => parseCliOptions(["serve", "--show-paths"]),
    /only by the doctor command/i,
  );
  assert.throws(
    () => parseDoctorOptions(["doctor", "--show-paths=true"]),
    /does not accept a value/i,
  );
});

test("config path requires a value", () => {
  assert.throws(
    () => parseCliOptions(["serve", "--config"]),
    /--config requires/i,
  );
});

test("parseCliOptions rejects missing commands and unsupported transports", () => {
  assert.throws(() => parseCliOptions(["--transport", "stdio"]), /Usage:/);
  assert.throws(
    () =>
      parseCliOptions(["serve", "examples/basic/docs", "--transport", "http"]),
    /stdio or streamable-http/,
  );
});

test("Streamable HTTP reserves operational endpoints", () => {
  for (const path of ["/healthz", "/readyz"]) {
    assert.throws(
      () =>
        parseCliOptions([
          "serve",
          "examples/basic/docs",
          "--transport",
          "streamable-http",
          "--http-path",
          path,
        ]),
      /reserved/u,
    );
  }
});

test("parseCliOptions rejects unsafe or ambiguous base URLs", () => {
  for (const baseUrl of [
    "file:///C:/docs",
    "https://user:secret@docs.example.com",
    "https://docs.example.com?version=latest",
    "https://docs.example.com#start",
    "not-a-url",
  ]) {
    assert.throws(
      () =>
        parseCliOptions([
          "serve",
          "examples/basic/docs",
          "--base-url",
          baseUrl,
        ]),
      /base URL/i,
    );
  }
});

test("parseCliOptions rejects unsafe remote documentation URLs eagerly", () => {
  for (const docsSource of [
    "http://docs.example.com/product/",
    "https://user:secret@docs.example.com/product/",
    "https://docs.example.com/product/?revision=latest",
    "https://docs.example.com/product/#start",
  ]) {
    assert.throws(
      () => parseCliOptions(["serve", docsSource]),
      /remote documentation/i,
    );
  }

  assert.throws(
    () =>
      parseCliOptions([
        "serve",
        "https://docs.example.com/product/",
        "--openapi",
        "openapi.json",
      ]),
    /local-only/i,
  );
});
