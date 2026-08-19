/**
 * Type definitions for MCP tools and resources
 * Following MCP 2026-07-28 specification
 */

/**
 * Metadata included in every MCP v2 request/response
 */
export interface MCPMeta {
  protocolVersion: string;
  capabilities?: string[];
  timestamp?: string;
  [key: string]: unknown;
}

/** Error codes exposed to MCP clients. */
export type MCPErrorCode = "PATH_NOT_FOUND" | "INVALID_INPUT" | "PARSE_ERROR";

/**
 * MCP Tool definition
 */
export interface MCPTool {
  name: string;
  description: string;
  inputSchema: JSONSchema;
}

/**
 * JSON Schema for tool input validation
 */
export interface JSONSchema {
  type: string;
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
  [key: string]: unknown;
}

/**
 * Document node in the VFS
 */
export interface DocNode {
  path: string;
  title: string;
  content: string;
  headings: string[];
  frontmatter?: Record<string, unknown>;
  lastModified?: Date;
  sourceUrl?: string;
  route?: string;
}

/**
 * Search result with snippet
 */
export interface SearchResult {
  path: string;
  title: string;
  headings: string[];
  snippet: string;
  score?: number;
  sourceUrl?: string;
  route?: string;
}

/**
 * VFS configuration
 */
export interface VFSConfig {
  docsRoot: string;
  openApiPath?: string;
  maxFileSize?: number;
}

/**
 * CLI options
 */
export interface CLIOptions {
  transport: "stdio" | "streamable-http";
  docsSource: string;
  openApiPath?: string;
  baseUrl?: string;
  http?: StreamableHttpOptions;
  verbose?: boolean;
}

/** Explicit network boundary for the optional Node.js HTTP distribution. */
export interface StreamableHttpOptions {
  host: string;
  port: number;
  path: string;
  allowedHosts: string[];
  allowedOrigins: string[];
  allowPublicNetwork: boolean;
}

/** Parsed CLI values before project discovery resolves the documentation source. */
export interface ParsedCLIOptions {
  transport: "stdio" | "streamable-http";
  docsSource?: string;
  openApiPath?: string;
  baseUrl?: string;
  configPath?: string;
  http?: StreamableHttpOptions;
  verbose?: boolean;
}

/** Fully resolved CLI values and their discovery provenance. */
export interface ResolvedCLIOptions extends CLIOptions {
  configPath?: string;
  projectRoot: string;
  sourceOrigin: "cli" | "config" | "default";
  sourceKind: "local-directory" | "local-v2" | "remote";
  sourceFormat: "directory" | "manifest-v1" | "manifest-v2";
}
