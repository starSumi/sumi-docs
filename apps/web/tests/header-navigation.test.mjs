import assert from "node:assert/strict";
import test from "node:test";
import { resolveHeaderNavigation } from "../src/header-navigation.ts";

test("resolves stable English navigation from catalog document IDs", () => {
  assert.deepEqual(resolveHeaderNavigation("en", "/", "/tool-reference/"), {
    label: "Primary",
    items: [
      {
        id: "get-started",
        label: "Get started",
        href: "/getting-started/",
        active: false,
      },
      {
        id: "mcp-tools",
        label: "MCP tools",
        href: "/tool-reference/",
        active: true,
      },
      {
        id: "api",
        label: "API",
        href: "/reference/api/corpus-contract/readme/",
        active: false,
      },
      {
        id: "security",
        label: "Security",
        href: "/security/",
        active: false,
      },
      {
        id: "contribute",
        label: "Contribute",
        href: "/contributing/",
        active: false,
      },
    ],
  });
});

test("localizes and prefixes navigation for project deployment", () => {
  assert.deepEqual(
    resolveHeaderNavigation(
      "zh-CN",
      "/sumi-docs/",
      "/sumi-docs/zh-cn/reference/api/corpus-contract/interfaces/manifestv2/",
    ),
    {
      label: "主要导航",
      items: [
        {
          id: "get-started",
          label: "开始使用",
          href: "/sumi-docs/zh-cn/getting-started/",
          active: false,
        },
        {
          id: "mcp-tools",
          label: "MCP 工具",
          href: "/sumi-docs/zh-cn/tool-reference/",
          active: false,
        },
        {
          id: "api",
          label: "API",
          href: "/sumi-docs/zh-cn/reference/api/corpus-contract/readme/",
          active: true,
        },
        {
          id: "security",
          label: "安全",
          href: "/sumi-docs/zh-cn/security/",
          active: false,
        },
        {
          id: "contribute",
          label: "参与贡献",
          href: "/sumi-docs/zh-cn/contributing/",
          active: false,
        },
      ],
    },
  );
});

test("marks contributor pages through stable document IDs", () => {
  const navigation = resolveHeaderNavigation(
    "en",
    "/sumi-docs/",
    "/sumi-docs/skills-and-orchestration/",
  );
  assert.equal(navigation.items.at(-1)?.id, "contribute");
  assert.equal(navigation.items.at(-1)?.active, true);
});

test("mounts the security policy through its catalog identity", () => {
  const navigation = resolveHeaderNavigation(
    "zh-CN",
    "/sumi-docs/",
    "/sumi-docs/zh-cn/security/",
  );
  const security = navigation.items.find(({ id }) => id === "security");
  assert.deepEqual(security, {
    id: "security",
    label: "安全",
    href: "/sumi-docs/zh-cn/security/",
    active: true,
  });
});

test("marks the overview as part of the getting-started surface", () => {
  const navigation = resolveHeaderNavigation(
    "en",
    "/sumi-docs/",
    "/sumi-docs/",
  );
  assert.equal(navigation.items[0].active, true);
});

test("rejects unsupported locales and paths outside the deployment base", () => {
  assert.throws(
    () => resolveHeaderNavigation("fr", "/", "/"),
    /Unsupported header navigation locale/u,
  );
  assert.throws(
    () =>
      resolveHeaderNavigation(
        "en",
        "/sumi-docs/",
        "/different/getting-started/",
      ),
    /outside the site base path/u,
  );
});
