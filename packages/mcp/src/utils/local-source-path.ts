import { basename, dirname, resolve } from "node:path";

/** Match only the versioned publisher locator, not arbitrary JSON files. */
export function isLocalV2LocatorPath(source: string): boolean {
  const locator = resolve(source);
  const v2Directory = dirname(locator);
  return (
    basename(locator) === "current.json" &&
    basename(v2Directory) === "v2" &&
    basename(dirname(v2Directory)) === "_mcp"
  );
}
