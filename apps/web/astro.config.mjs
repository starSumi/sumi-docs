import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import starlightTypeDoc, { typeDocSidebarGroup } from "starlight-typedoc";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import sumiDocsPublisher, {
  resolveRemoteMcpEnvironment,
} from "./integrations/sumi-docs-publisher.mjs";
import { catalogSidebar, contentCatalog } from "./src/content-catalog.ts";
import { contentRoot } from "./src/content-root.ts";
import { canonicalTypeDocRoutes } from "./src/typedoc-routes.ts";
import sumiBrowserComponents from "./integrations/sumi-browser-components.mjs";
import {
  normalizeSiteBasePath,
  normalizeSiteOrigin,
  resolveGitHubReleaseProvenance,
} from "./src/site-config.ts";

const site = process.env.SITE_URL
  ? normalizeSiteOrigin(process.env.SITE_URL)
  : "http://127.0.0.1:4321";
const base = normalizeSiteBasePath(process.env.BASE_PATH);
const mcpPackage = JSON.parse(
  readFileSync(
    new URL("../../packages/mcp/package.json", import.meta.url),
    "utf8",
  ),
);
const remoteMcp = resolveRemoteMcpEnvironment({
  publicMcpUrl: process.env.PUBLIC_MCP_URL,
  publicMcpReadinessUrl: process.env.PUBLIC_MCP_READINESS_URL,
  version: mcpPackage.version,
});
const requiredProvenance = resolveGitHubReleaseProvenance(process.env);
const portableFilePath = (url) => fileURLToPath(url).replaceAll("\\", "/");

export default defineConfig({
  site,
  base,
  vite: {
    plugins: [sumiBrowserComponents()],
  },
  integrations: [
    starlight({
      title: {
        en: "Sumi Docs",
        "zh-CN": "Sumi 文档",
      },
      description:
        "Human and machine-readable documentation from one reviewed source.",
      defaultLocale: "root",
      locales: {
        root: {
          label: "English",
          lang: "en",
        },
        "zh-cn": {
          label: "简体中文",
          lang: "zh-CN",
        },
      },
      logo: {
        src: "./src/assets/sumi-docs-mark.png",
        alt: "Sumi Docs",
      },
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/starSumi/sumi-docs",
        },
      ],
      expressiveCode: {
        themes: ["starlight-dark", "starlight-light"],
        useStarlightDarkModeSwitch: true,
      },
      customCss: ["./src/styles/custom.css"],
      components: {
        SiteTitle: "./src/components/SiteTitle.astro",
      },
      plugins: [
        starlightTypeDoc({
          entryPoints: [
            portableFilePath(
              new URL(
                "../../packages/corpus-contract/src/index.ts",
                import.meta.url,
              ),
            ),
          ],
          tsconfig: portableFilePath(
            new URL(
              "../../packages/corpus-contract/tsconfig.json",
              import.meta.url,
            ),
          ),
          output: "reference/api/corpus-contract",
          sidebar: {
            label: "API Reference",
            collapsed: true,
          },
          typeDoc: {
            name: "@sumi-os/corpus-contract",
            entryFileName: "readme",
            readme: portableFilePath(
              new URL(
                "../../packages/corpus-contract/README.md",
                import.meta.url,
              ),
            ),
            disableSources: true,
            entryPointStrategy: "resolve",
            excludeExternals: true,
            excludeInternal: true,
            excludePrivate: true,
            excludeProtected: true,
            treatWarningsAsErrors: true,
            validation: {
              invalidLink: true,
              notDocumented: true,
              notExported: true,
            },
            requiredToBeDocumented: [
              "Enum",
              "EnumMember",
              "Variable",
              "Function",
              "Class",
              "Interface",
              "Property",
              "Method",
              "TypeAlias",
            ],
            packagesRequiringDocumentation: ["@sumi-os/corpus-contract"],
          },
        }),
        canonicalTypeDocRoutes(),
      ],
      sidebar: [...catalogSidebar(contentCatalog), typeDocSidebarGroup],
    }),
    sumiDocsPublisher({
      catalog: contentCatalog,
      contentRoot,
      openapi: "openapi.json",
      ...(requiredProvenance && { requiredProvenance }),
      ...(remoteMcp && { remoteMcp }),
    }),
  ],
});
