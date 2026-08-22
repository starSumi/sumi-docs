import { pathToFileURL } from "node:url";

export const REQUIRED_PNPM_VERSION = "10.26.0";
export const REQUIRED_NODE_VERSION = "25.5.0";

function parseStableVersion(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/u.exec(version ?? "");
  return match?.slice(1).map(Number);
}

export function validateNodeVersion(version) {
  const current = parseStableVersion(version);
  const required = parseStableVersion(REQUIRED_NODE_VERSION);
  if (!current || !required) {
    return `Use a stable Node.js ${REQUIRED_NODE_VERSION} or newer runtime.`;
  }
  for (let index = 0; index < required.length; index += 1) {
    if (current[index] > required[index]) return undefined;
    if (current[index] < required[index]) {
      return `Expected Node.js ${REQUIRED_NODE_VERSION} or newer, received ${version}.`;
    }
  }
  return undefined;
}

export function validatePackageManager(userAgent) {
  const match = /^pnpm\/([^\s]+)(?:\s|$)/u.exec(userAgent ?? "");
  if (!match) {
    return `Use pnpm ${REQUIRED_PNPM_VERSION} to install this workspace.`;
  }
  if (match[1] !== REQUIRED_PNPM_VERSION) {
    return `Expected pnpm ${REQUIRED_PNPM_VERSION}, received pnpm ${match[1]}.`;
  }
  return undefined;
}

function main() {
  const error =
    validateNodeVersion(process.version) ??
    validatePackageManager(process.env.npm_config_user_agent);
  if (error) throw new Error(error);
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
