/**
 * @file VFS Module Entry Point
 */

export { DocsVault } from "./DocsVault.js";
export { isLocalV2LocatorPath } from "../utils/local-source-path.js";
export { loadLocalCorpus } from "./local-source.js";
export {
  isRemoteDocsSource,
  normalizeRemoteManifestUrl,
} from "./remote-source.js";
