import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildDocumentUrl,
  normalizeBaseUrl,
} from "../../src/utils/document-url.js";

test("document URLs preserve the site prefix and encode each path segment", () => {
  const baseUrl = normalizeBaseUrl("https://docs.example.com/product");

  assert.equal(baseUrl, "https://docs.example.com/product/");
  assert.equal(
    buildDocumentUrl(baseUrl, "guides/first steps.mdx"),
    "https://docs.example.com/product/guides/first%20steps/",
  );
  assert.equal(
    buildDocumentUrl(baseUrl, "部署/入门.md"),
    "https://docs.example.com/product/%E9%83%A8%E7%BD%B2/%E5%85%A5%E9%97%A8/",
  );
});

test("explicit manifest routes override path-derived URLs", () => {
  const baseUrl = normalizeBaseUrl("https://docs.example.com/product");
  const cases = [
    ["/", "https://docs.example.com/product/"],
    [
      "/manual/getting-started/",
      "https://docs.example.com/product/manual/getting-started/",
    ],
    [
      "/javascript:alert(1)/",
      "https://docs.example.com/product/javascript:alert(1)/",
    ],
    [
      "/mailto:user@example.com/",
      "https://docs.example.com/product/mailto:user@example.com/",
    ],
    ["/a:b/", "https://docs.example.com/product/a:b/"],
  ] as const;

  for (const [route, expected] of cases) {
    const actual = buildDocumentUrl(baseUrl, "guides/start.md", route);
    assert.equal(actual, expected);
    assert.equal(new URL(actual).protocol, new URL(baseUrl).protocol);
    assert.equal(new URL(actual).origin, new URL(baseUrl).origin);
  }
});

test("the logical root route resolves to the configured site prefix", () => {
  assert.equal(
    buildDocumentUrl("https://starsumi.github.io/sumi-docs/", "index.mdx", "/"),
    "https://starsumi.github.io/sumi-docs/",
  );
});

test("index documents resolve to their directory page", () => {
  const baseUrl = normalizeBaseUrl("https://docs.example.com/product");

  assert.equal(
    buildDocumentUrl(baseUrl, "index.mdx"),
    "https://docs.example.com/product/",
  );
  assert.equal(
    buildDocumentUrl(baseUrl, "zh-cn/index.md"),
    "https://docs.example.com/product/zh-cn/",
  );
});

test("base URL validation accepts only unambiguous HTTP(S) origins and paths", () => {
  assert.equal(
    normalizeBaseUrl("http://localhost:3000/docs/"),
    "http://localhost:3000/docs/",
  );

  for (const value of [
    "file:///docs",
    "https://user:secret@example.com/docs",
    "https://example.com/docs?lang=en",
    "https://example.com/docs#top",
    "relative/docs",
  ]) {
    assert.throws(() => normalizeBaseUrl(value), /base URL/i);
  }
});
