import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readNodeRuntimeLicense } from "./node-runtime-license.mjs";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const outputRoot = join(projectRoot, "artifacts", "compliance");
const seaMetafilePath = join(
  projectRoot,
  "packages",
  "mcp",
  ".sea",
  "esbuild-metafile.json",
);
const browserManifestPath = join(
  projectRoot,
  "apps",
  "web",
  "dist",
  "_compliance",
  "browser-components.json",
);
const packageManagerCli = process.env.npm_execpath;

const pagefindLicenseText = `Copyright 2022 Pagefind

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
`;

const mitLicenseText = `MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

export const reviewedLicenseOverrides = new Map([
  ...["pagefind@1.5.2", "@pagefind/default-ui@1.5.2"].map((identity) => [
    identity,
    {
      license: "MIT",
      source: "https://github.com/Pagefind/pagefind/blob/v1.5.2/LICENSE",
      sha256:
        "4736929bfded122bd969f0621a0d917484b126d981270d68a63ed42cb55503d5",
      text: pagefindLicenseText,
      evidence: [],
    },
  ]),
  [
    "format@0.2.2",
    {
      license: "MIT",
      source:
        "https://registry.npmjs.org/format/-/format-0.2.2.tgz (package metadata and source attribution)",
      sha256:
        "1847e0e0698142ed4347c1441a9fa81c8fbddd44b1d8bbcd5e3647f991759d7f",
      text: mitLicenseText,
      evidence: [
        {
          file: "package.json",
          sha256:
            "0754698e3180d26da07fa0ca1fbfce331c0e1652db512aee35b443204bdec553",
        },
        {
          file: "format.js",
          sha256:
            "666bd4da85e596b4e3e119f201ea5c69dae64e2e9f75a5758de777b9550a6155",
          attribution: "Copyright 2010 - 2013 Sami Samhuri <sami@samhuri.net>",
        },
        {
          file: "Readme.md",
          sha256:
            "e078ab4217332db9ac446cdf23e932eabd21d6db7c239a6495df4d3802251f20",
          attribution: "Copyright 2010 - 2014 Sami Samhuri sami@samhuri.net",
        },
      ],
    },
  ],
]);

function readManifest(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

export function loadLicenseInventory(packageName) {
  if (!packageManagerCli || !existsSync(packageManagerCli)) {
    throw new Error("Run this command through the pinned pnpm package script.");
  }
  const result = spawnSync(
    process.execPath,
    [
      packageManagerCli,
      "--filter",
      packageName,
      "licenses",
      "list",
      "--prod",
      "--json",
    ],
    {
      cwd: projectRoot,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
    },
  );
  if (result.status !== 0) {
    throw new Error(
      result.stderr.trim() || `Unable to inventory ${packageName} licenses.`,
    );
  }

  const components = new Map();
  for (const [license, entries] of Object.entries(JSON.parse(result.stdout))) {
    for (const entry of entries) {
      if (entry.versions.length !== entry.paths.length) {
        throw new Error(`License inventory path mismatch for ${entry.name}.`);
      }
      entry.versions.forEach((version, index) => {
        const identity = `${entry.name}@${version}`;
        const component = {
          identity,
          name: entry.name,
          version,
          license,
          author: entry.author ?? null,
          homepage: entry.homepage ?? null,
          path: entry.paths[index],
        };
        const previous = components.get(identity);
        if (previous && previous.license !== component.license) {
          throw new Error(`Conflicting license metadata for ${identity}.`);
        }
        components.set(identity, previous ?? component);
      });
    }
  }
  if (components.size === 0) {
    throw new Error(
      `Production dependency inventory is empty for ${packageName}.`,
    );
  }
  return components;
}

function packageIdentityForInput(input) {
  let cursor = dirname(resolve(projectRoot, "packages", "mcp", input));
  for (;;) {
    try {
      const manifest = readManifest(join(cursor, "package.json"));
      if (manifest.name && manifest.version) {
        return {
          identity: `${manifest.name}@${manifest.version}`,
          manifest,
          path: cursor,
        };
      }
    } catch {
      // Continue to the enclosing package boundary.
    }
    const parent = dirname(cursor);
    if (parent === cursor) return undefined;
    cursor = parent;
  }
}

export function loadMcpArtifact(inventory) {
  const manifestPath = join(projectRoot, "packages", "mcp", "package.json");
  const manifest = readManifest(manifestPath);
  const rootIdentity = `${manifest.name}@${manifest.version}`;
  const seaMetafile = readManifest(seaMetafilePath);
  const components = new Set();
  const firstParty = new Map();

  for (const input of Object.keys(seaMetafile.inputs ?? {})) {
    const packageEntry = packageIdentityForInput(input);
    if (!packageEntry || packageEntry.identity === rootIdentity) continue;
    if (input.replaceAll("\\", "/").includes("/node_modules/")) {
      if (!inventory.has(packageEntry.identity)) {
        throw new Error(
          `SEA dependency is absent from the MCP production inventory: ${packageEntry.identity}`,
        );
      }
      components.add(packageEntry.identity);
    } else if (packageEntry.manifest.name.startsWith("@sumi-labs/")) {
      firstParty.set(packageEntry.identity, packageEntry);
    } else {
      throw new Error(`Unexpected non-workspace SEA input: ${input}`);
    }
  }
  if (components.size === 0) throw new Error("The SEA component set is empty.");

  return {
    key: "mcp",
    artifactRole: "embedded-sea-input",
    manifest,
    manifestPath,
    rootIdentity,
    components,
    firstParty,
    includeNode: true,
  };
}

function singleIdentityForName(inventory, name) {
  const matches = [...inventory.values()].filter(
    (component) => component.name === name,
  );
  if (matches.length !== 1) {
    throw new Error(
      `Expected one ${name} production component, found ${matches.length}.`,
    );
  }
  return matches[0].identity;
}

export function loadWebArtifact(inventory) {
  const manifestPath = join(projectRoot, "apps", "web", "package.json");
  const manifest = readManifest(manifestPath);
  const emitted = readManifest(browserManifestPath);
  if (
    emitted.version !== 1 ||
    emitted.basis !== "vite-client-chunk-modules" ||
    !Array.isArray(emitted.components) ||
    emitted.components.length === 0 ||
    new Set(emitted.components).size !== emitted.components.length ||
    JSON.stringify(emitted.components) !==
      JSON.stringify(
        [...emitted.components].sort((left, right) =>
          left.localeCompare(right),
        ),
      )
  ) {
    throw new Error("The Web browser component manifest is invalid.");
  }

  const components = new Set(emitted.components);
  const pagefindOutputs = [
    ["pagefind", "pagefind.js"],
    ["@pagefind/default-ui", "pagefind-ui.js"],
  ];
  for (const [name, output] of pagefindOutputs) {
    if (
      !existsSync(join(projectRoot, "apps", "web", "dist", "pagefind", output))
    ) {
      throw new Error(`Expected Pagefind output is missing: ${output}`);
    }
    components.add(singleIdentityForName(inventory, name));
  }
  for (const identity of components) {
    if (!inventory.has(identity)) {
      throw new Error(
        `Browser component is absent from the Web production inventory: ${identity}`,
      );
    }
  }

  return {
    key: "web",
    artifactRole: "emitted-browser-component",
    manifest,
    manifestPath,
    rootIdentity: `${manifest.name}@${manifest.version}`,
    components,
    firstParty: new Map(),
    includeNode: false,
  };
}

const licenseTextFilePattern = /^(?:licen[cs]e|copying)(?:[._-]|$)/iu;
const supplementalNoticeFilePattern = /^notice(?:[._-]|$)/iu;

function evidenceFiles(component, pattern) {
  return readdirSync(component.path)
    .filter((name) => pattern.test(name))
    .filter((name) => statSync(join(component.path, name)).isFile())
    .map((name) => ({
      name,
      content: readFileSync(join(component.path, name), "utf8"),
    }))
    .filter(({ content }) => content.trim().length > 0)
    .sort((left, right) => left.name.localeCompare(right.name));
}

function verifyOverrideEvidence(component, override) {
  for (const evidence of override.evidence ?? []) {
    if (!/^[^/\\]+$/u.test(evidence.file)) {
      throw new Error(
        `Reviewed license evidence path is invalid for ${component.identity}.`,
      );
    }
    const content = readFileSync(join(component.path, evidence.file));
    if (sha256(content) !== evidence.sha256) {
      throw new Error(
        `Reviewed license evidence drifted for ${component.identity}: ${evidence.file}.`,
      );
    }
  }
}

export function noticeSection(
  component,
  artifactRole,
  overrides = reviewedLicenseOverrides,
) {
  const licenseFiles = evidenceFiles(component, licenseTextFilePattern);
  const supplementalNotices = evidenceFiles(
    component,
    supplementalNoticeFilePattern,
  );
  const lines = [
    component.identity,
    `Declared license: ${component.license}`,
    `Artifact role: ${artifactRole}`,
  ];
  if (component.homepage) lines.push(`Homepage: ${component.homepage}`);

  if (licenseFiles.length > 0) {
    lines.push("License evidence: package-file");
    for (const { name, content } of licenseFiles) {
      lines.push(
        `License source: ${name}`,
        `License source SHA-256: ${sha256(content)}`,
        "",
        `----- ${name} -----`,
        content.trim(),
      );
    }
    for (const { name, content } of supplementalNotices) {
      lines.push(
        `Supplemental notice source: ${name}`,
        `Supplemental notice SHA-256: ${sha256(content)}`,
        "",
        `----- ${name} -----`,
        content.trim(),
      );
    }
    return lines.join("\n");
  }

  const override = overrides.get(component.identity);
  if (override) {
    if (
      override.license !== component.license ||
      sha256(override.text) !== override.sha256
    ) {
      throw new Error(
        `Reviewed license override drifted for ${component.identity}.`,
      );
    }
    verifyOverrideEvidence(component, override);
    lines.push(
      "License evidence: reviewed-override",
      `Reviewed license source: ${override.source}`,
      `Reviewed license SHA-256: ${override.sha256}`,
    );
    for (const evidence of override.evidence ?? []) {
      lines.push(
        `Reviewed evidence file: ${evidence.file}`,
        `Reviewed evidence SHA-256: ${evidence.sha256}`,
      );
      if (evidence.attribution) {
        lines.push(`Reviewed attribution: ${evidence.attribution}`);
      }
    }
    lines.push("", override.text.trim());
    for (const { name, content } of supplementalNotices) {
      lines.push(
        `Supplemental notice source: ${name}`,
        `Supplemental notice SHA-256: ${sha256(content)}`,
        "",
        `----- ${name} -----`,
        content.trim(),
      );
    }
    return lines.join("\n");
  }

  throw new Error(
    `No non-empty license file or exact reviewed override is available for ${component.identity} (${component.license}).`,
  );
}

function npmPurl(name, version) {
  if (name.startsWith("@")) {
    const [scope, packageName] = name.split("/");
    return `pkg:npm/${encodeURIComponent(scope)}/${packageName}@${version}`;
  }
  return `pkg:npm/${name}@${version}`;
}

function packageEntryForResolvedPath(resolvedPath, dependencyName) {
  let cursor = dirname(resolvedPath);
  for (;;) {
    try {
      const manifest = readManifest(join(cursor, "package.json"));
      if (manifest.name === dependencyName && manifest.version) {
        return {
          identity: `${manifest.name}@${manifest.version}`,
          manifest,
          path: cursor,
        };
      }
    } catch {
      // Continue to the enclosing package boundary.
    }
    const parent = dirname(cursor);
    if (parent === cursor) return undefined;
    cursor = parent;
  }
}

export function resolveDependencyEntry(componentPath, dependencyName) {
  let cursor = componentPath;
  for (;;) {
    const installedManifestPath = join(
      cursor,
      "node_modules",
      dependencyName,
      "package.json",
    );
    try {
      const manifest = readManifest(installedManifestPath);
      if (manifest.name === dependencyName && manifest.version) {
        return {
          identity: `${manifest.name}@${manifest.version}`,
          manifest,
          path: dirname(installedManifestPath),
        };
      }
    } catch {
      // Continue through Node's ancestor node_modules search order.
    }
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }

  const requireFromComponent = createRequire(
    join(componentPath, "package.json"),
  );
  for (const request of [`${dependencyName}/package.json`, dependencyName]) {
    try {
      const resolvedPath = requireFromComponent.resolve(request);
      const entry = packageEntryForResolvedPath(resolvedPath, dependencyName);
      if (entry) return entry;
    } catch {
      // Package exports can hide package.json; try the package entry point.
    }
  }
  return undefined;
}

function includedNames(includedComponents) {
  const names = new Map();
  for (const component of includedComponents.values()) {
    const identities = names.get(component.name) ?? new Set();
    identities.add(component.identity);
    names.set(component.name, identities);
  }
  return names;
}

export function dependencyRefs(manifest, componentPath, includedComponents) {
  const names = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
  ]);
  const selectedByName = includedNames(includedComponents);
  const dependencies = [];
  for (const name of names) {
    const selectedIdentities = selectedByName.get(name);
    if (!selectedIdentities) continue;
    const resolved = resolveDependencyEntry(componentPath, name);
    if (!resolved) {
      throw new Error(
        `Selected dependency ${name} cannot be resolved from ${manifest.name}@${manifest.version}.`,
      );
    }
    if (!includedComponents.has(resolved.identity)) {
      throw new Error(
        `Resolved dependency ${resolved.identity} is outside the selected component graph for ${manifest.name}@${manifest.version}.`,
      );
    }
    dependencies.push(resolved.identity);
  }
  return dependencies.sort((left, right) => left.localeCompare(right));
}

export function expectedDependencyEntries(artifact, selectedComponents) {
  const firstPartyComponents = [...artifact.firstParty.values()].sort(
    (left, right) => left.identity.localeCompare(right.identity),
  );
  const includedComponents = new Map([
    ...firstPartyComponents.map((component) => [
      component.identity,
      {
        identity: component.identity,
        name: component.manifest.name,
        manifest: component.manifest,
        path: component.path,
      },
    ]),
    ...selectedComponents.map((component) => [component.identity, component]),
  ]);
  const dependencies = [
    {
      ref: artifact.rootIdentity,
      dependsOn: dependencyRefs(
        artifact.manifest,
        dirname(artifact.manifestPath),
        includedComponents,
      ),
    },
    ...firstPartyComponents.map((component) => ({
      ref: component.identity,
      dependsOn: dependencyRefs(
        component.manifest,
        component.path,
        includedComponents,
      ),
    })),
    ...selectedComponents.map((component) => ({
      ref: component.identity,
      dependsOn: dependencyRefs(
        readManifest(join(component.path, "package.json")),
        component.path,
        includedComponents,
      ),
    })),
  ];

  if (artifact.includeNode) {
    const nodeRef = `runtime:node@${process.versions.node}`;
    dependencies[0].dependsOn = [...dependencies[0].dependsOn, nodeRef].sort(
      (left, right) => left.localeCompare(right),
    );
    dependencies.push({ ref: nodeRef, dependsOn: [] });
  }
  return dependencies;
}

export function createSbom(artifact, selectedComponents) {
  const firstPartyComponents = [...artifact.firstParty.values()].sort(
    (left, right) => left.identity.localeCompare(right.identity),
  );
  const components = [
    ...firstPartyComponents.map((component) => ({
      type: "library",
      name: component.manifest.name,
      version: component.manifest.version,
      "bom-ref": component.identity,
      purl: npmPurl(component.manifest.name, component.manifest.version),
      licenses: [{ license: { name: component.manifest.license } }],
      properties: [
        { name: "io.sumi.docs/artifact-role", value: artifact.artifactRole },
        { name: "io.sumi.docs/ownership", value: "first-party" },
      ],
    })),
    ...selectedComponents.map((component) => ({
      type: "library",
      name: component.name,
      version: component.version,
      "bom-ref": component.identity,
      purl: npmPurl(component.name, component.version),
      licenses: [{ license: { name: component.license } }],
      ...(component.homepage
        ? { externalReferences: [{ type: "website", url: component.homepage }] }
        : {}),
      properties: [
        { name: "io.sumi.docs/artifact-role", value: artifact.artifactRole },
      ],
    })),
  ];
  const dependencies = expectedDependencyEntries(artifact, selectedComponents);

  if (artifact.includeNode) {
    const nodeRef = `runtime:node@${process.versions.node}`;
    components.unshift({
      type: "framework",
      name: "Node.js",
      version: process.versions.node,
      "bom-ref": nodeRef,
      purl: `pkg:generic/nodejs@${process.versions.node}`,
      hashes: [
        {
          alg: "SHA-256",
          content: sha256(readFileSync(process.execPath)),
        },
      ],
      licenses: [
        {
          license: { name: "Node.js runtime license (see NODEJS_LICENSE.txt)" },
        },
      ],
      externalReferences: [{ type: "website", url: "https://nodejs.org/" }],
      properties: [
        { name: "io.sumi.docs/embedded-sea-runtime", value: "true" },
      ],
    });
  }

  return {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    version: 1,
    metadata: {
      component: {
        type: "application",
        name: artifact.manifest.name,
        version: artifact.manifest.version,
        "bom-ref": artifact.rootIdentity,
      },
      properties: [
        {
          name: "io.sumi.docs/inventory-basis",
          value:
            artifact.key === "mcp"
              ? "esbuild-sea-metafile"
              : "vite-client-chunks-and-pagefind-output",
        },
      ],
      tools: {
        components: [
          {
            type: "application",
            name: "sumi-docs-compliance-builder",
            version: "1",
          },
        ],
      },
    },
    components,
    dependencies,
  };
}

function writeArtifactCompliance(artifact, inventory) {
  const selectedComponents = [...artifact.components].map((identity) =>
    inventory.get(identity),
  );
  if (selectedComponents.some((component) => !component)) {
    throw new Error(`${artifact.key} contains an unresolved component.`);
  }
  selectedComponents.sort((left, right) =>
    left.identity.localeCompare(right.identity),
  );
  const notices = [
    "THIRD-PARTY SOFTWARE NOTICES",
    "",
    `Artifact: ${artifact.rootIdentity}`,
    "This inventory is generated from the pinned artifact component graph.",
    "Upstream license terms remain controlling.",
    "",
    ...selectedComponents.flatMap((component) => [
      noticeSection(component, artifact.artifactRole),
      "",
      "=".repeat(80),
      "",
    ]),
  ].join("\n");
  const target = join(outputRoot, artifact.key);
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, "THIRD_PARTY_NOTICES.txt"), notices, "utf8");
  writeFileSync(
    join(target, "bom.cdx.json"),
    `${JSON.stringify(createSbom(artifact, selectedComponents), null, 2)}\n`,
    "utf8",
  );
  if (artifact.includeNode) {
    const nodeLicense = readNodeRuntimeLicense();
    copyFileSync(nodeLicense.path, join(target, "NODEJS_LICENSE.txt"));
  }
  process.stdout.write(
    `Generated ${artifact.key} compliance artifacts for ${selectedComponents.length} third-party component(s).\n`,
  );
}

export function buildComplianceArtifacts() {
  rmSync(outputRoot, { recursive: true, force: true });
  const mcpInventory = loadLicenseInventory("@sumi-labs/docs-mcp");
  const webInventory = loadLicenseInventory("@sumi-labs/docs-web");
  writeArtifactCompliance(loadMcpArtifact(mcpInventory), mcpInventory);
  writeArtifactCompliance(loadWebArtifact(webInventory), webInventory);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  buildComplianceArtifacts();
}
