import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

function validate(siteUrl, basePath, publicMcpUrl, publicMcpReadinessUrl) {
  const env = { ...process.env };
  if (siteUrl === undefined) delete env.SITE_URL;
  else env.SITE_URL = siteUrl;
  if (basePath === undefined) delete env.BASE_PATH;
  else env.BASE_PATH = basePath;
  if (publicMcpUrl === undefined) delete env.PUBLIC_MCP_URL;
  else env.PUBLIC_MCP_URL = publicMcpUrl;
  if (publicMcpReadinessUrl === undefined) {
    delete env.PUBLIC_MCP_READINESS_URL;
  } else {
    env.PUBLIC_MCP_READINESS_URL = publicMcpReadinessUrl;
  }

  return spawnSync(process.execPath, ["scripts/validate-release-env.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env,
  });
}

test("accepts a public HTTPS origin", () => {
  const result = validate("https://docs.example.com");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /https:\/\/docs\.example\.com\//);
});

test("accepts and normalizes a separate deployment base path", () => {
  const result = validate("https://starsumi.github.io", "/sumi-docs");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /https:\/\/starsumi\.github\.io\/sumi-docs\//);
});

test("accepts explicit MCP and readiness endpoints as a pair", () => {
  const result = validate(
    "https://docs.example.com",
    "/",
    "https://mcp.example.com/mcp",
    "https://status.example.com/readyz",
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Remote MCP readiness: configured/u);
});

for (const [name, publicMcpUrl, publicMcpReadinessUrl] of [
  ["MCP URL without readiness URL", "https://mcp.example.com/mcp", undefined],
  [
    "readiness URL without MCP URL",
    undefined,
    "https://mcp.example.com/readyz",
  ],
  [
    "HTTP MCP URL",
    "http://mcp.example.com/mcp",
    "https://mcp.example.com/readyz",
  ],
  [
    "credentialed readiness URL",
    "https://mcp.example.com/mcp",
    "https://user:secret@mcp.example.com/readyz",
  ],
  [
    "queried readiness URL",
    "https://mcp.example.com/mcp",
    "https://mcp.example.com/readyz?token=secret",
  ],
  [
    "fragmented readiness URL",
    "https://mcp.example.com/mcp",
    "https://mcp.example.com/readyz#details",
  ],
]) {
  test(`rejects ${name}`, () => {
    const result = validate(
      "https://docs.example.com",
      "/",
      publicMcpUrl,
      publicMcpReadinessUrl,
    );
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stderr, /secret/u);
  });
}

for (const [name, value] of [
  ["missing URL", undefined],
  ["HTTP URL", "http://docs.example.com"],
  ["credentials", "https://user:secret@docs.example.com"],
  ["query", "https://docs.example.com?preview=true"],
  ["subpath", "https://docs.example.com/product/"],
]) {
  test(`rejects ${name}`, () => {
    const result = validate(value);
    assert.notEqual(result.status, 0);
  });
}

for (const basePath of [
  "sumi-docs",
  "//sumi-docs/",
  "/sumi-docs/../private/",
  "/sumi-docs?preview=true",
  "https://example.com/sumi-docs/",
]) {
  test(`rejects ambiguous base path '${basePath}'`, () => {
    const result = validate("https://starsumi.github.io", basePath);
    assert.notEqual(result.status, 0);
  });
}
