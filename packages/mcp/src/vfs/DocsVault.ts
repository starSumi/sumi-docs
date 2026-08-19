/**
 * @file DocsVault - Read-Only In-Memory Documentation Store
 *
 * Core Principles:
 * - Stateless: Every query is independent
 * - Read-Only: No mutation operations exposed
 * - Immutable: All data structures are frozen after loading
 */

import { readdir, readFile, stat } from "node:fs/promises";
import type { Stats } from "node:fs";
import { join, resolve } from "node:path";
import type { DocNode, SearchResult } from "../types/index.js";
import {
  filterByEndpoint,
  parseMarkdown,
  parseOpenApi,
  parseOpenApiContent,
} from "../parser/index.js";
import type { OpenAPISpec } from "../parser/index.js";
import { loadRemoteCorpus } from "./remote-source.js";
import { loadLocalCorpus } from "./local-source.js";
import {
  toRelativePath,
  isMarkdownFile,
  sanitizeQuery,
} from "../utils/path.js";
import { extractSnippet, calculateRelevanceScore } from "../utils/text.js";
import { processBatched } from "../utils/concurrency.js";

interface DocsVaultFileSystem {
  readTextFile: (path: string) => Promise<string>;
  stat: (path: string) => Promise<Stats>;
}

const defaultFileSystem: DocsVaultFileSystem = {
  readTextFile: (path) => readFile(path, "utf-8"),
  stat: (path) => stat(path),
};

/**
 * DocsVault: In-memory read-only documentation store
 */
export class DocsVault {
  private nodes: Map<string, DocNode> = new Map();
  private openApiSpec: OpenAPISpec | null = null;
  private rootPath: string = "";
  private corpusRevision: string | undefined;

  constructor(
    private readonly fileSystem: DocsVaultFileSystem = defaultFileSystem,
  ) {}

  /**
   * Load documentation from directory
   *
   * @param dirPath - Absolute path to documentation root
   * @throws Error if directory doesn't exist or is not accessible
   */
  async loadFromDirectory(dirPath: string): Promise<void> {
    const nextRootPath = resolve(dirPath);

    try {
      const stats = await this.fileSystem.stat(nextRootPath);
      if (!stats.isDirectory()) {
        throw new Error(`Path is not a directory: ${dirPath}`);
      }
    } catch (error) {
      throw new Error(
        `Cannot access directory: ${dirPath} (${error instanceof Error ? error.message : String(error)})`,
        { cause: error },
      );
    }

    const nextNodes = new Map<string, DocNode>();
    await this.scanDirectory(nextRootPath, nextRootPath, nextNodes);

    // Commit only after successful load
    this.rootPath = nextRootPath;
    this.nodes = nextNodes;
    this.corpusRevision = undefined;
  }

  /** Load a bounded read-only corpus declared by a remote JSON manifest. */
  async loadFromRemoteManifest(manifestUrl: string): Promise<void> {
    const corpus = await loadRemoteCorpus(manifestUrl);
    await this.commitCorpus(corpus);
  }

  /** Load a verified immutable corpus from a local v2 current locator. */
  async loadFromLocalManifest(locatorPath: string): Promise<void> {
    const corpus = await loadLocalCorpus(locatorPath);
    await this.commitCorpus(corpus);
  }

  private async commitCorpus(corpus: {
    documents: Array<{
      path: string;
      content: string;
      route?: string;
      lastModified?: Date;
      sourceUrl?: string;
    }>;
    openApiContent?: string;
    revision?: string;
  }): Promise<void> {
    const nextNodes = new Map<string, DocNode>();

    for (const document of corpus.documents) {
      const parsed = await parseMarkdown(document.content);
      nextNodes.set(document.path, {
        path: document.path,
        title: parsed.title,
        content: parsed.content,
        headings: parsed.headings.map((heading) => heading.text),
        frontmatter: parsed.frontmatter,
        lastModified: document.lastModified,
        sourceUrl: document.sourceUrl,
        route: document.route,
      });
    }
    let nextOpenApiSpec: OpenAPISpec | null = null;
    if (corpus.openApiContent !== undefined) {
      nextOpenApiSpec = parseOpenApiContent(corpus.openApiContent);
    }

    // Commit only after successful parse
    this.nodes = nextNodes;
    this.openApiSpec = nextOpenApiSpec;
    this.corpusRevision = corpus.revision;
  }

  /**
   * Recursively scan directory for markdown files with bounded concurrency
   */
  private async scanDirectory(
    currentPath: string,
    rootPath: string,
    targetNodes: Map<string, DocNode>,
  ): Promise<void> {
    const entries = await readdir(currentPath, { withFileTypes: true });

    const subdirs: string[] = [];
    const files: string[] = [];

    for (const entry of entries) {
      const fullPath = join(currentPath, entry.name);

      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) {
          continue;
        }
        subdirs.push(fullPath);
      } else if (entry.isFile() && isMarkdownFile(entry.name)) {
        files.push(fullPath);
      }
    }

    // Sort for deterministic ordering
    files.sort();
    subdirs.sort();

    // Load files with higher concurrency for cold-start performance
    const MAX_CONCURRENT_FILES = 32;
    await processBatched(files, MAX_CONCURRENT_FILES, async (file) =>
      this.loadDocument(file, rootPath, targetNodes),
    );

    // Recurse into subdirectories sequentially
    for (const subdir of subdirs) {
      await this.scanDirectory(subdir, rootPath, targetNodes);
    }
  }

  /**
   * Load and parse a single document
   */
  private async loadDocument(
    absolutePath: string,
    rootPath: string,
    targetNodes: Map<string, DocNode>,
  ): Promise<void> {
    const rawContent = await this.fileSystem.readTextFile(absolutePath);
    const parsed = await parseMarkdown(rawContent);

    const relativePath = toRelativePath(absolutePath, rootPath);
    const stats = await this.fileSystem.stat(absolutePath);

    const docNode: DocNode = {
      path: relativePath,
      title: parsed.title,
      content: parsed.content,
      headings: parsed.headings.map((h) => h.text),
      frontmatter: parsed.frontmatter,
      lastModified: stats.mtime,
    };

    targetNodes.set(relativePath, docNode);
  }

  /**
   * Load OpenAPI specification
   *
   * @param filePath - Absolute path to OpenAPI JSON file
   */
  async loadOpenApi(filePath: string): Promise<void> {
    this.openApiSpec = await parseOpenApi(filePath);
  }

  /**
   * List all document paths in tree
   *
   * @returns Array of relative paths sorted alphabetically
   */
  listTree(): Array<{
    path: string;
    title: string;
    lastModified?: Date;
    sourceUrl?: string;
    route?: string;
  }> {
    const list = Array.from(this.nodes.values()).map((node) => ({
      path: node.path,
      title: node.title,
      lastModified: node.lastModified,
      sourceUrl: node.sourceUrl,
      route: node.route,
    }));

    return list.sort((a, b) => a.path.localeCompare(b.path));
  }

  /**
   * Get document by relative path
   *
   * @param relativePath - Relative path from docs root
   * @returns Document node or null if not found
   */
  getDoc(relativePath: string): DocNode | null {
    const normalizedPath = relativePath.replace(/\\/g, "/");
    return this.nodes.get(normalizedPath) ?? null;
  }

  /**
   * Search documents by query using lexical substring matching
   *
   * @param query - Search query (case-insensitive substring)
   * @param maxResults - Maximum results to return (default: 10)
   * @returns Array of search results sorted by relevance score (desc), then path (asc)
   */
  search(query: string, maxResults: number = 10): SearchResult[] {
    const sanitized = sanitizeQuery(query);

    if (!sanitized) {
      return [];
    }

    const lowerQuery = sanitized.toLowerCase();
    const results: Array<SearchResult & { score: number }> = [];

    for (const [path, node] of this.nodes.entries()) {
      const lowerContent = node.content.toLowerCase();
      const lowerTitle = node.title.toLowerCase();

      // Lexical substring matching (case-insensitive)
      if (
        lowerContent.includes(lowerQuery) ||
        lowerTitle.includes(lowerQuery)
      ) {
        const score = calculateRelevanceScore(
          node.content,
          node.headings.map((text, index) => ({
            level: index === 0 ? 1 : 2,
            text,
          })),
          sanitized,
        );

        results.push({
          path,
          title: node.title,
          headings: node.headings,
          snippet: extractSnippet(node.content, sanitized, 200),
          score,
          sourceUrl: node.sourceUrl,
          route: node.route,
        });
      }
    }

    // Sort by score descending, then by path ascending for deterministic ordering
    return results
      .sort((a, b) => {
        if (b.score !== a.score) {
          return b.score - a.score;
        }
        return a.path.localeCompare(b.path);
      })
      .slice(0, maxResults)
      .map((result) => ({
        path: result.path,
        title: result.title,
        headings: result.headings,
        snippet: result.snippet,
        sourceUrl: result.sourceUrl,
        route: result.route,
      }));
  }

  /**
   * Get OpenAPI specification
   *
   * @returns OpenAPI spec or null if not loaded
   */
  getOpenApiSpec(endpoint?: string): OpenAPISpec | null {
    if (!this.openApiSpec) {
      return null;
    }
    return endpoint
      ? filterByEndpoint(this.openApiSpec, endpoint)
      : this.openApiSpec;
  }

  /**
   * Get statistics about loaded documentation
   */
  getStats(): {
    documentCount: number;
    hasOpenApiSpec: boolean;
    corpusRevision?: string;
  } {
    return {
      documentCount: this.nodes.size,
      hasOpenApiSpec: this.openApiSpec !== null,
      ...(this.corpusRevision && { corpusRevision: this.corpusRevision }),
    };
  }
}
