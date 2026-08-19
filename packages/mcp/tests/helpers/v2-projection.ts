import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  canonicalJson,
  createCurrentLocatorV2,
  describeIntegrity,
  sealManifestV2,
} from "@sumi-os/corpus-contract";

const DEFAULT_OPENAPI = JSON.stringify({
  openapi: "3.1.0",
  info: { title: "Projection API", version: "1.0.0" },
  paths: {},
});

export interface ProjectionFixture {
  locatorPath: string;
  revision: string;
  guidePath: string;
  manifestPath: string;
  openApiPath: string;
}

export async function writeV2Projection(
  root: string,
  guide = "# Local Guide\n\nLoaded from a sealed projection.\n",
): Promise<ProjectionFixture> {
  const manifest = sealManifestV2({
    version: 2,
    defaultLocale: "en",
    locales: ["en"],
    documents: [
      {
        id: "guide",
        locale: "en",
        path: "guide.md",
        route: "/guide/",
        mediaType: "text/markdown",
        ...describeIntegrity(guide),
        nav: { sectionId: "start", sectionOrder: 10, order: 10 },
      },
    ],
    openapi: {
      path: "openapi.json",
      ...describeIntegrity(DEFAULT_OPENAPI),
    },
    provenance: { repository: null, commit: null, dirty: true },
  });
  const locator = createCurrentLocatorV2(manifest);
  const v2Root = join(root, "_mcp", "v2");
  const manifestPath = join(v2Root, ...locator.manifest.split("/"));
  const snapshotRoot = dirname(manifestPath);
  const guidePath = join(snapshotRoot, "docs", "guide.md");
  const openApiPath = join(snapshotRoot, "docs", "openapi.json");
  const locatorPath = join(v2Root, "current.json");

  await mkdir(dirname(guidePath), { recursive: true });
  await writeFile(manifestPath, canonicalJson(manifest));
  await writeFile(guidePath, guide);
  await writeFile(openApiPath, DEFAULT_OPENAPI);
  await writeFile(locatorPath, JSON.stringify(locator));

  return {
    locatorPath,
    revision: locator.revision,
    guidePath,
    manifestPath,
    openApiPath,
  };
}
