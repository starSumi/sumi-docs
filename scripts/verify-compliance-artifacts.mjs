import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  expectedDependencyEntries,
  loadLicenseInventory,
  loadMcpArtifact,
  loadWebArtifact,
} from "./build-compliance-artifacts.mjs";
import { readNodeRuntimeLicense } from "./node-runtime-license.mjs";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const complianceRoot = join(projectRoot, "artifacts", "compliance");
const localMetadataPatterns = [
  /[A-Za-z]:\\(?:Users|Zero_Base)\\/u,
  /(?:^|[\s"'])\/(?:home|Users)\//mu,
  /starl0top1|@163\.com/iu,
  /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/u,
  /not shipped|missing license/iu,
];

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function property(component, name) {
  return component.properties?.find((entry) => entry.name === name)?.value;
}

function verifyNoLocalMetadata(path) {
  const content = readFileSync(path, "utf8");
  for (const pattern of localMetadataPatterns) {
    if (pattern.test(content)) {
      throw new Error(`Local or incomplete metadata found in ${path}.`);
    }
  }
}

export function verifyBom(path, expectedName) {
  const bom = readJson(path);
  if (
    bom.bomFormat !== "CycloneDX" ||
    bom.specVersion !== "1.6" ||
    bom.version !== 1 ||
    bom.metadata?.component?.name !== expectedName ||
    bom.metadata.component.type !== "application"
  ) {
    throw new Error(`Invalid CycloneDX metadata in ${path}.`);
  }

  const rootRef = bom.metadata.component["bom-ref"];
  const componentRefs = bom.components.map((component) => component["bom-ref"]);
  const dependencyRefs = bom.dependencies.map((entry) => entry.ref);
  if (
    !rootRef ||
    new Set(componentRefs).size !== componentRefs.length ||
    new Set(dependencyRefs).size !== dependencyRefs.length ||
    dependencyRefs.filter((ref) => ref === rootRef).length !== 1
  ) {
    throw new Error(`Duplicate or missing BOM references in ${path}.`);
  }

  const knownRefs = new Set([rootRef, ...componentRefs]);
  for (const dependency of bom.dependencies) {
    if (
      !knownRefs.has(dependency.ref) ||
      !Array.isArray(dependency.dependsOn) ||
      dependency.dependsOn.some((ref) => !knownRefs.has(ref)) ||
      new Set(dependency.dependsOn).size !== dependency.dependsOn.length
    ) {
      throw new Error(`Dangling or duplicate dependency reference in ${path}.`);
    }
  }
  for (const ref of componentRefs) {
    if (!dependencyRefs.includes(ref)) {
      throw new Error(`Component ${ref} has no dependency entry in ${path}.`);
    }
  }

  return bom;
}

function componentNoticeSection(notices, componentRef) {
  const marker = `${componentRef}\nDeclared license:`;
  const matches = notices.split(marker);
  if (matches.length !== 2) {
    throw new Error(
      `NOTICE must contain exactly one section for ${componentRef}.`,
    );
  }
  return `${componentRef}\nDeclared license:${
    matches[1].split("=".repeat(80), 1)[0]
  }`;
}

function verifyNoticeEvidence(section, componentRef) {
  const packageFileEvidence = section.includes(
    "License evidence: package-file",
  );
  const reviewedOverrideEvidence = section.includes(
    "License evidence: reviewed-override",
  );
  if (packageFileEvidence === reviewedOverrideEvidence) {
    throw new Error(
      `NOTICE must identify exactly one license evidence type for ${componentRef}.`,
    );
  }
  if (packageFileEvidence) {
    if (
      !/^License source: (?:licen[cs]e|copying)(?:[._-]|$).*$/imu.test(
        section,
      ) ||
      !/^License source SHA-256: [a-f0-9]{64}$/mu.test(section) ||
      !/^----- (?:licen[cs]e|copying)(?:[._-].*)? -----\n\S/imu.test(section)
    ) {
      throw new Error(
        `NOTICE package-file evidence is incomplete for ${componentRef}.`,
      );
    }
    return;
  }
  if (
    !/^Reviewed license source: \S.*$/mu.test(section) ||
    !/^Reviewed license SHA-256: [a-f0-9]{64}$/mu.test(section) ||
    !/^Reviewed license SHA-256: [a-f0-9]{64}$[\s\S]*\n\n\S/mu.test(section)
  ) {
    throw new Error(
      `NOTICE reviewed-override evidence is incomplete for ${componentRef}.`,
    );
  }
}

export function verifyNotices(path, bom) {
  const notices = readFileSync(path, "utf8");
  const thirdParty = bom.components.filter(
    (component) =>
      component.name !== "Node.js" &&
      property(component, "io.sumi.docs/ownership") !== "first-party",
  );
  for (const component of thirdParty) {
    const section = componentNoticeSection(notices, component["bom-ref"]);
    verifyNoticeEvidence(section, component["bom-ref"]);
  }
  const sectionCount = (notices.match(/^Declared license:/gmu) ?? []).length;
  if (sectionCount !== thirdParty.length) {
    throw new Error(
      `NOTICE section count ${sectionCount} does not match ${thirdParty.length} third-party components.`,
    );
  }
}

function selectedComponents(artifact, inventory) {
  return [...artifact.components]
    .map((identity) => inventory.get(identity))
    .sort((left, right) => left.identity.localeCompare(right.identity));
}

function expectedComponentRefs(artifact) {
  const refs = new Set([...artifact.components, ...artifact.firstParty.keys()]);
  if (artifact.includeNode) {
    refs.add(`runtime:node@${process.versions.node}`);
  }
  return refs;
}

export function verifyDependencyGraph(bom, artifact, inventory) {
  const expectedRefs = expectedComponentRefs(artifact);
  const actualRefs = new Set(
    bom.components.map((component) => component["bom-ref"]),
  );
  if (
    expectedRefs.size !== actualRefs.size ||
    [...expectedRefs].some((ref) => !actualRefs.has(ref))
  ) {
    throw new Error(
      `The ${artifact.key} BOM component set does not match its artifact inputs.`,
    );
  }

  const expected = new Map(
    expectedDependencyEntries(
      artifact,
      selectedComponents(artifact, inventory),
    ).map((entry) => [entry.ref, entry.dependsOn]),
  );
  const actual = new Map(
    bom.dependencies.map((entry) => [entry.ref, entry.dependsOn]),
  );
  if (expected.size !== actual.size) {
    throw new Error(`The ${artifact.key} BOM dependency graph is incomplete.`);
  }
  for (const [ref, dependsOn] of expected) {
    if (JSON.stringify(actual.get(ref)) !== JSON.stringify(dependsOn)) {
      throw new Error(
        `The ${artifact.key} BOM dependency edge set is incorrect for ${ref}.`,
      );
    }
  }
}

function verifyMcp() {
  const root = join(complianceRoot, "mcp");
  const bomPath = join(root, "bom.cdx.json");
  const noticesPath = join(root, "THIRD_PARTY_NOTICES.txt");
  const nodeLicensePath = join(root, "NODEJS_LICENSE.txt");
  const nodeRuntimeLicense = readNodeRuntimeLicense();
  const bom = verifyBom(bomPath, "@sumi-labs/docs-mcp");
  const inventory = loadLicenseInventory("@sumi-labs/docs-mcp");
  const artifact = loadMcpArtifact(inventory);
  verifyDependencyGraph(bom, artifact, inventory);
  const nodeComponents = bom.components.filter(
    (component) => component.name === "Node.js",
  );
  if (
    nodeComponents.length !== 1 ||
    nodeComponents[0].version !== process.versions.node ||
    property(nodeComponents[0], "io.sumi.docs/embedded-sea-runtime") !==
      "true" ||
    nodeComponents[0].hashes?.find((hash) => hash.alg === "SHA-256")
      ?.content !== sha256(readFileSync(process.execPath))
  ) {
    throw new Error("The MCP BOM does not identify the embedded Node runtime.");
  }
  if (
    !existsSync(nodeLicensePath) ||
    !readFileSync(nodeLicensePath).equals(nodeRuntimeLicense.content)
  ) {
    throw new Error(
      "The MCP artifact does not contain the Node runtime license.",
    );
  }
  verifyNotices(noticesPath, bom);
  return bom.components.length;
}

function verifyWeb() {
  const root = join(complianceRoot, "web");
  const bomPath = join(root, "bom.cdx.json");
  const noticesPath = join(root, "THIRD_PARTY_NOTICES.txt");
  const bom = verifyBom(bomPath, "@sumi-labs/docs-web");
  const inventory = loadLicenseInventory("@sumi-labs/docs-web");
  const artifact = loadWebArtifact(inventory);
  verifyDependencyGraph(bom, artifact, inventory);
  if (
    existsSync(join(root, "NODEJS_LICENSE.txt")) ||
    bom.components.some(
      (component) =>
        component.name === "Node.js" ||
        property(component, "io.sumi.docs/embedded-sea-runtime") === "true",
    )
  ) {
    throw new Error(
      "The static Web artifact must not claim an embedded Node runtime.",
    );
  }
  const expectedRefs = expectedComponentRefs(artifact);
  const actualRefs = new Set(
    bom.components.map((component) => component["bom-ref"]),
  );
  if (
    expectedRefs.size !== actualRefs.size ||
    [...expectedRefs].some((ref) => !actualRefs.has(ref))
  ) {
    throw new Error(
      "The Web BOM does not match the emitted browser component graph.",
    );
  }
  verifyNotices(noticesPath, bom);
  return bom.components.length;
}

export function verifyComplianceArtifacts() {
  const allowedLayout = new Set([
    "mcp/NODEJS_LICENSE.txt",
    "mcp/THIRD_PARTY_NOTICES.txt",
    "mcp/bom.cdx.json",
    "web/THIRD_PARTY_NOTICES.txt",
    "web/bom.cdx.json",
  ]);
  const actualLayout = new Set();
  for (const product of readdirSync(complianceRoot)) {
    const productRoot = join(complianceRoot, product);
    if (!statSync(productRoot).isDirectory()) {
      throw new Error(`Unexpected compliance entry: ${product}`);
    }
    for (const file of readdirSync(productRoot)) {
      actualLayout.add(`${product}/${file}`);
      verifyNoLocalMetadata(join(productRoot, file));
    }
  }
  if (
    actualLayout.size !== allowedLayout.size ||
    [...allowedLayout].some((path) => !actualLayout.has(path))
  ) {
    throw new Error(
      "The compliance artifact layout is incomplete or contains extras.",
    );
  }

  const mcpComponents = verifyMcp();
  const webComponents = verifyWeb();
  process.stdout.write(
    `Verified split compliance artifacts: MCP ${mcpComponents} components, Web ${webComponents} components.\n`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  verifyComplianceArtifacts();
}
