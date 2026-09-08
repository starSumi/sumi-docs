import { createServer } from "node:http";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import {
  isAbsolute,
  posix as posixPath,
  relative,
  resolve,
  sep,
} from "node:path";
import { unified } from "unified";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import minimist from "minimist";

const args = minimist(process.argv.slice(2), {
  string: ["docs", "openapi", "port"],
  boolean: ["help"],
});

if (args.help) {
  console.log(`Usage:
  node scripts/preview-docs.js --docs <directory> [--openapi <path>] [--port 4173]

The preview binds to 127.0.0.1 and serves a read-only remote-source manifest,
Markdown/MDX files, and an optional OpenAPI JSON document.`);
  process.exit(0);
}

const docsArgument = args.docs ?? "examples/basic/docs";
if (typeof docsArgument !== "string" || docsArgument.trim() === "") {
  console.error("--docs must name one documentation directory.");
  process.exit(1);
}

const portText = args.port ?? "4173";
const port = Number(portText);
if (!Number.isInteger(port) || port < 0 || port > 65_535) {
  console.error("--port must be an integer between 0 and 65535.");
  process.exit(1);
}

const root = await realpath(resolve(docsArgument));
if (!(await stat(root)).isDirectory()) {
  console.error("--docs must name one documentation directory.");
  process.exit(1);
}

const markdownProcessor = unified()
  .use(remarkParse)
  .use(remarkFrontmatter, ["yaml", "toml"])
  .use(remarkGfm);

const STYLE = [
  ":root{color-scheme:light;--ink:#182230;--muted:#617084;--line:#d9e0e8;--panel:#f6f8fb;--accent:#166534;--accent-soft:#e8f5ed;--code:#f1f4f7}",
  "*{box-sizing:border-box}",
  "html{background:#fff}",
  'body{margin:0;color:var(--ink);font:16px/1.65 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}',
  "a{color:#075985;text-decoration-thickness:.08em;text-underline-offset:.16em}",
  "a:hover{color:#0c4a6e}",
  ".app{display:grid;grid-template-columns:minmax(220px,280px) minmax(0,1fr);min-height:100vh}",
  ".sidebar{border-right:1px solid var(--line);background:var(--panel);padding:24px 18px;position:sticky;top:0;height:100vh;overflow:auto}",
  ".brand{display:block;color:var(--ink);font-weight:800;font-size:1.05rem;text-decoration:none;margin:0 8px 20px}",
  ".eyebrow{color:var(--muted);font-size:.75rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;margin:0 8px 12px}",
  ".search{display:flex;gap:8px;margin:0 0 24px}",
  ".search input{min-width:0;flex:1;border:1px solid var(--line);border-radius:6px;padding:8px 9px;background:#fff;color:var(--ink);font:inherit}",
  ".search button{border:1px solid #14532d;border-radius:6px;padding:8px 11px;background:var(--accent);color:#fff;font:inherit;font-weight:700;cursor:pointer}",
  ".search button:hover{background:#14532d}",
  ".nav{list-style:none;padding:0;margin:0}",
  ".nav li{margin:2px 0}",
  ".nav a{display:block;border-radius:5px;padding:6px 8px;color:#334155;text-decoration:none;font-size:.9rem;overflow-wrap:anywhere}",
  '.nav a:hover,.nav a[aria-current="page"]{background:var(--accent-soft);color:#14532d}',
  ".main{min-width:0;padding:38px clamp(20px,5vw,72px) 72px}",
  ".content{max-width:920px;margin:0 auto}",
  ".meta{color:var(--muted);font-size:.88rem;margin:0 0 22px}",
  ".doc-title{font-size:clamp(1.8rem,3vw,2.55rem);line-height:1.15;margin:0 0 8px;letter-spacing:0}",
  ".lead{font-size:1.08rem;color:#435268}",
  ".doc{margin-top:28px}",
  ".doc h1,.doc h2,.doc h3,.doc h4,.doc h5,.doc h6{line-height:1.25;margin:1.6em 0 .55em;scroll-margin-top:20px}",
  ".doc h1{font-size:2rem}.doc h2{font-size:1.5rem}.doc h3{font-size:1.22rem}.doc h4,.doc h5,.doc h6{font-size:1.05rem}",
  ".doc p{margin:0 0 1em}",
  ".doc ul,.doc ol{padding-left:1.55rem;margin:0 0 1em}",
  ".doc li{margin:.28em 0}",
  ".doc blockquote{border-left:3px solid #94a3b8;color:#475569;margin:1.2em 0;padding:2px 0 2px 18px}",
  ".doc pre{overflow:auto;border:1px solid var(--line);border-radius:7px;background:var(--code);padding:14px 16px;line-height:1.5}",
  '.doc code{border-radius:4px;background:var(--code);padding:.12em .3em;font:.9em ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace}',
  ".doc pre code{padding:0;background:transparent}",
  ".doc hr{border:0;border-top:1px solid var(--line);margin:2em 0}",
  ".doc table{border-collapse:collapse;display:block;overflow:auto;margin:1.25em 0;max-width:100%}",
  ".doc th,.doc td{border:1px solid var(--line);padding:7px 10px;text-align:left;vertical-align:top}",
  ".doc th{background:var(--panel);font-weight:700}",
  ".raw-markup{color:#64748b;font-style:italic;white-space:pre-wrap}",
  ".image-placeholder{border:1px dashed #94a3b8;color:#64748b;display:inline-block;padding:2px 8px}",
  ".catalog{display:grid;gap:12px;margin-top:26px}",
  ".catalog a{display:block;border:1px solid var(--line);border-radius:7px;padding:14px 16px;text-decoration:none;background:#fff}",
  ".catalog a:hover{border-color:#86efac;background:var(--accent-soft)}",
  ".catalog strong{display:block;color:var(--ink);font-size:1.03rem}",
  ".catalog small{display:block;color:var(--muted);margin-top:2px;overflow-wrap:anywhere}",
  ".empty{color:var(--muted);border:1px dashed var(--line);padding:18px;border-radius:7px}",
  ".footer{color:var(--muted);font-size:.8rem;margin-top:52px;padding-top:16px;border-top:1px solid var(--line)}",
  "@media (max-width:760px){.app{display:block}.sidebar{position:static;height:auto;border-right:0;border-bottom:1px solid var(--line);padding:18px 16px}.nav{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:2px}.main{padding:26px 16px 52px}.search{max-width:520px}}",
].join("");

const defaultOpenApi =
  args.docs === undefined && args.openapi === undefined
    ? "examples/basic/openapi.json"
    : undefined;
const openApiArgument = args.openapi ?? defaultOpenApi;
let openApiPath;
if (openApiArgument !== undefined) {
  if (typeof openApiArgument !== "string" || openApiArgument.trim() === "") {
    console.error("--openapi must name one JSON file.");
    process.exit(1);
  }
  openApiPath = await realpath(resolve(openApiArgument));
  if (!(await stat(openApiPath)).isFile() || !/\.json$/i.test(openApiPath)) {
    console.error("--openapi must name one JSON file.");
    process.exit(1);
  }
}

function isInsideRoot(candidate) {
  const pathFromRoot = relative(root, candidate);
  return (
    pathFromRoot === "" ||
    (!pathFromRoot.startsWith(`..${sep}`) &&
      pathFromRoot !== ".." &&
      !isAbsolute(pathFromRoot))
  );
}

function securityHeaders(contentType) {
  return {
    "cache-control": "no-store",
    "content-security-policy":
      "default-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; img-src 'none'; object-src 'none'; style-src 'unsafe-inline'",
    "content-type": contentType,
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  };
}

function send(response, method, status, body, headers = {}) {
  response.writeHead(status, {
    ...securityHeaders("text/plain; charset=utf-8"),
    ...headers,
    "content-length": Buffer.byteLength(body),
  });
  response.end(method === "HEAD" ? undefined : body);
}

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character],
  );
}

function documentRoute(documentPath) {
  const withoutExtension = documentPath.replace(/\.mdx?$/i, "");
  const basename = posixPath.basename(withoutExtension).toLowerCase();
  if (basename === "index") {
    const directory = posixPath.dirname(withoutExtension);
    return directory === "." ? "/" : "/" + directory + "/";
  }
  return "/" + withoutExtension;
}

function documentHref(documentPath) {
  return documentRoute(documentPath)
    .split("/")
    .map((segment, index) =>
      index === 0 ? segment : encodeURIComponent(segment),
    )
    .join("/");
}

function safeDocumentHref(value, currentDocumentPath) {
  const href = String(value).trim();
  if (href === "") return undefined;
  if (href.startsWith("#")) return href;
  if (href.startsWith("//")) return undefined;

  const scheme = href.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase();
  if (scheme) {
    return scheme === "http" || scheme === "https" || scheme === "mailto"
      ? href
      : undefined;
  }
  if (href.includes("\\")) return undefined;

  const match = href.match(/^([^?#]*)(.*)$/s);
  const target = match?.[1] ?? href;
  const suffix = match?.[2] ?? "";
  const currentDirectory = posixPath.dirname(currentDocumentPath);
  const joined = target.startsWith("/")
    ? posixPath.normalize(target.replace(/^\/+/, ""))
    : posixPath.normalize(posixPath.join(currentDirectory, target));
  if (joined === ".." || joined.startsWith("../") || joined.startsWith("/")) {
    return undefined;
  }

  const route = /\.mdx?$/i.test(joined)
    ? documentRoute(joined)
    : "/" + (joined === "." ? "" : joined);
  return route + suffix;
}

function textContent(node) {
  if (!node || typeof node !== "object") return "";
  if (typeof node.value === "string") return node.value;
  if (!Array.isArray(node.children)) return "";
  return node.children.map(textContent).join(" ");
}

function firstHeading(node) {
  if (!node || typeof node !== "object") return undefined;
  if (node.type === "heading") return textContent(node).trim();
  if (!Array.isArray(node.children)) return undefined;
  for (const child of node.children) {
    const heading = firstHeading(child);
    if (heading) return heading;
  }
  return undefined;
}

function renderInline(node, currentDocumentPath) {
  if (!node || typeof node !== "object") return "";
  const children = Array.isArray(node.children)
    ? node.children
        .map((child) => renderInline(child, currentDocumentPath))
        .join("")
    : "";
  switch (node.type) {
    case "text":
      return escapeHtml(node.value ?? "");
    case "inlineCode":
      return "<code>" + escapeHtml(node.value ?? "") + "</code>";
    case "emphasis":
      return "<em>" + children + "</em>";
    case "strong":
      return "<strong>" + children + "</strong>";
    case "delete":
      return "<del>" + children + "</del>";
    case "break":
      return "<br>";
    case "link": {
      const href = safeDocumentHref(node.url ?? "", currentDocumentPath);
      if (!href) return "<span>" + children + "</span>";
      const external = /^(?:https?:|mailto:)/i.test(href);
      return (
        '<a href="' +
        escapeHtml(href) +
        '"' +
        (external ? ' target="_blank" rel="noopener noreferrer"' : "") +
        ">" +
        children +
        "</a>"
      );
    }
    case "image":
      return (
        '<span class="image-placeholder">Image: ' +
        escapeHtml(node.alt ?? "") +
        "</span>"
      );
    case "html":
    case "mdxTextExpression":
    case "mdxJsxTextElement":
      return (
        '<code class="raw-markup">' +
        escapeHtml(node.value ?? textContent(node)) +
        "</code>"
      );
    default:
      if (node.value) return escapeHtml(node.value);
      return children;
  }
}

function renderTableRow(row, currentDocumentPath, header) {
  const tag = header ? "th" : "td";
  return (
    "<tr>" +
    (row.children ?? [])
      .map(
        (cell) =>
          "<" +
          tag +
          ">" +
          (cell.children
            ?.map((child) => renderInline(child, currentDocumentPath))
            .join("") ?? "") +
          "</" +
          tag +
          ">",
      )
      .join("") +
    "</tr>"
  );
}

function renderBlock(node, currentDocumentPath) {
  if (!node || typeof node !== "object") return "";
  const children = Array.isArray(node.children)
    ? node.children
        .map((child) => renderBlock(child, currentDocumentPath))
        .join("\n")
    : "";
  switch (node.type) {
    case "root":
      return children;
    case "yaml":
    case "toml":
      return "";
    case "heading":
      return (
        "<h" +
        node.depth +
        ">" +
        node.children
          .map((child) => renderInline(child, currentDocumentPath))
          .join("") +
        "</h" +
        node.depth +
        ">"
      );
    case "paragraph":
      return (
        "<p>" +
        node.children
          .map((child) => renderInline(child, currentDocumentPath))
          .join("") +
        "</p>"
      );
    case "blockquote":
      return "<blockquote>" + children + "</blockquote>";
    case "list": {
      const tag = node.ordered ? "ol" : "ul";
      const start =
        node.ordered && node.start && node.start !== 1
          ? ' start="' + node.start + '"'
          : "";
      return "<" + tag + start + ">" + children + "</" + tag + ">";
    }
    case "listItem":
      return "<li>" + children + "</li>";
    case "code": {
      const language = node.lang
        ? ' class="language-' + escapeHtml(node.lang) + '"'
        : "";
      return (
        "<pre><code" +
        language +
        ">" +
        escapeHtml(node.value ?? "") +
        "</code></pre>"
      );
    }
    case "thematicBreak":
      return "<hr>";
    case "break":
      return "<br>";
    case "html":
      return (
        '<pre class="raw-markup"><code>' +
        escapeHtml(node.value ?? "") +
        "</code></pre>"
      );
    case "table": {
      const rows = node.children ?? [];
      const header = rows[0]
        ? "<thead>" +
          renderTableRow(rows[0], currentDocumentPath, true) +
          "</thead>"
        : "";
      const body =
        rows.length > 1
          ? "<tbody>" +
            rows
              .slice(1)
              .map((row) => renderTableRow(row, currentDocumentPath, false))
              .join("") +
            "</tbody>"
          : "";
      return "<table>" + header + body + "</table>";
    }
    case "definition":
    case "footnoteDefinition":
      return "";
    default:
      if (node.type === "linkReference" || node.type === "imageReference") {
        return (
          "<p>" +
          (node.children
            ?.map((child) => renderInline(child, currentDocumentPath))
            .join("") ?? "") +
          "</p>"
        );
      }
      if (node.children) return children;
      return node.value ? "<p>" + escapeHtml(node.value) + "</p>" : "";
  }
}

function parsePreviewDocument(raw, documentPath) {
  try {
    const tree = markdownProcessor.parse(raw);
    const title =
      firstHeading(tree) ||
      posixPath.basename(documentPath).replace(/\.mdx?$/i, "");
    return {
      html: renderBlock(tree, documentPath),
      searchText: textContent(tree),
      title,
    };
  } catch {
    return {
      html:
        '<pre class="raw-markup"><code>' + escapeHtml(raw) + "</code></pre>",
      searchText: raw,
      title: posixPath.basename(documentPath).replace(/\.mdx?$/i, ""),
    };
  }
}

async function listDocumentPaths(directory = root) {
  const documents = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const candidate = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      documents.push(...(await listDocumentPaths(candidate)));
      continue;
    }
    if (!entry.isFile() || !/\.mdx?$/i.test(entry.name)) continue;
    const actualPath = await realpath(candidate);
    if (!isInsideRoot(actualPath)) continue;
    documents.push(relative(root, actualPath).split(sep).join("/"));
  }
  return documents.sort((left, right) => left.localeCompare(right));
}

async function resolveDocument(pathname) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }

  const relativePath = decodedPath.replace(/^\/+/, "").replace(/\/+$/, "");
  const hasMarkdownExtension = /\.mdx?$/i.test(relativePath);
  if (
    relativePath === "" ||
    relativePath.includes("\\") ||
    relativePath.includes("\0") ||
    relativePath
      .split("/")
      .some((segment) => segment === "." || segment === "..")
  ) {
    return undefined;
  }

  const candidates = hasMarkdownExtension
    ? [resolve(root, relativePath)]
    : [
        resolve(root, `${relativePath}.md`),
        resolve(root, `${relativePath}.mdx`),
        resolve(root, relativePath, "index.md"),
        resolve(root, relativePath, "index.mdx"),
      ];
  for (const candidate of candidates) {
    if (!isInsideRoot(candidate)) continue;
    try {
      const actualPath = await realpath(candidate);
      if (!isInsideRoot(actualPath) || !(await stat(actualPath)).isFile())
        continue;
      return actualPath;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return undefined;
}

async function loadPreviewDocuments() {
  const paths = await listDocumentPaths();
  return Promise.all(
    paths.map(async (path) => {
      const documentPath = await resolveDocument(`/${path}`);
      if (!documentPath) return undefined;
      const raw = await readFile(documentPath, "utf8");
      const parsed = parsePreviewDocument(raw, path);
      return {
        ...parsed,
        path,
        route: documentHref(path),
      };
    }),
  ).then((documents) => documents.filter(Boolean));
}

function renderDocumentNav(documents, currentPath) {
  return documents
    .map(
      (document) =>
        `<li><a href="${escapeHtml(document.route)}"${document.path === currentPath ? ' aria-current="page"' : ""}>${escapeHtml(document.title)}<small>${escapeHtml(document.path)}</small></a></li>`,
    )
    .join("");
}

function renderPage({ documents, title, content, currentPath, query = "" }) {
  const searchValue = escapeHtml(query);
  const pageTitle = `${title} - Sumi Docs Preview`;
  return [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    `<meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(pageTitle)}</title>`,
    `<style>${STYLE}</style></head><body><div class="app">`,
    `<aside class="sidebar"><a class="brand" href="/">Sumi Docs Preview</a>`,
    `<p class="eyebrow">Local corpus</p><form class="search" method="get" action="/" role="search">`,
    `<input name="q" type="search" value="${searchValue}" placeholder="Search documents" aria-label="Search documents">`,
    '<button type="submit">Search</button></form>',
    `<nav aria-label="Documents"><ul class="nav">${renderDocumentNav(documents, currentPath)}</ul></nav></aside>`,
    `<main class="main"><div class="content">${content}<p class="footer">Read-only loopback preview. Explicit <code>.md</code> and <code>.mdx</code> URLs return source text.</p></div></main>`,
    "</div></body></html>",
  ].join("");
}

function renderCatalog(documents, query) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matches = normalizedQuery
    ? documents.filter(
        (document) =>
          document.title.toLocaleLowerCase().includes(normalizedQuery) ||
          document.path.toLocaleLowerCase().includes(normalizedQuery) ||
          document.searchText.toLocaleLowerCase().includes(normalizedQuery),
      )
    : documents;
  const heading = normalizedQuery
    ? `Search results for "${query.trim()}"`
    : "Documentation";
  const intro = normalizedQuery
    ? `${matches.length} matching document${matches.length === 1 ? "" : "s"}`
    : "A local, read-only view of the supplied Markdown and MDX corpus.";
  const cards = matches.length
    ? `<div class="catalog">${matches
        .map(
          (document) =>
            `<a href="${escapeHtml(document.route)}"><strong>${escapeHtml(document.title)}</strong><small>${escapeHtml(document.path)}</small></a>`,
        )
        .join("")}</div>`
    : '<p class="empty">No documents match this search.</p>';
  return `<header><p class="eyebrow">Sumi Docs</p><h1 class="doc-title">${escapeHtml(heading)}</h1><p class="lead">${escapeHtml(intro)}</p></header>${cards}`;
}

const server = createServer(async (request, response) => {
  const method = request.method ?? "GET";
  if (method !== "GET" && method !== "HEAD") {
    send(response, method, 405, "Method not allowed.\n", {
      allow: "GET, HEAD",
    });
    return;
  }

  try {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    if (requestUrl.pathname === "/sumi-docs-manifest.json") {
      const manifest = {
        version: 1,
        documents: await listDocumentPaths(),
        ...(openApiPath && { openapi: "openapi.json" }),
      };
      send(response, method, 200, `${JSON.stringify(manifest, null, 2)}\n`, {
        "content-type": "application/json; charset=utf-8",
      });
      return;
    }

    if (requestUrl.pathname === "/openapi.json" && openApiPath) {
      send(response, method, 200, await readFile(openApiPath, "utf8"), {
        "content-type": "application/json; charset=utf-8",
      });
      return;
    }

    const documents = await loadPreviewDocuments();
    if (requestUrl.pathname === "/") {
      const query = (requestUrl.searchParams.get("q") ?? "").slice(0, 200);
      const body = renderPage({
        content: renderCatalog(documents, query),
        documents,
        query,
        title: query ? "Search" : "Documentation",
      });
      send(response, method, 200, body, {
        "content-type": "text/html; charset=utf-8",
      });
      return;
    }

    const documentPath = await resolveDocument(requestUrl.pathname);
    if (!documentPath) {
      send(response, method, 404, "Document not found.\n");
      return;
    }

    const raw = await readFile(documentPath, "utf8");
    let decodedPath;
    try {
      decodedPath = decodeURIComponent(requestUrl.pathname);
    } catch {
      decodedPath = requestUrl.pathname;
    }
    if (/\.mdx?$/i.test(decodedPath)) {
      send(response, method, 200, raw, {
        "content-type": "text/markdown; charset=utf-8",
      });
      return;
    }

    const currentPath = relative(root, documentPath).split(sep).join("/");
    const parsed = parsePreviewDocument(raw, currentPath);
    const entry = documents.find((document) => document.path === currentPath);
    const body = renderPage({
      content: `<article class="doc"><p class="meta">${escapeHtml(currentPath)}</p><h1 class="doc-title">${escapeHtml(entry?.title ?? parsed.title)}</h1><div class="doc">${parsed.html}</div></article>`,
      currentPath,
      documents,
      title: entry?.title ?? parsed.title,
    });
    send(response, method, 200, body, {
      "content-type": "text/html; charset=utf-8",
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    send(response, method, 500, "Unable to read the document.\n");
  }
});

server.listen(port, "127.0.0.1", () => {
  const address = server.address();
  const activePort =
    typeof address === "object" && address ? address.port : port;
  console.error(`Preview server listening at http://127.0.0.1:${activePort}/`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => server.close(() => process.exit(0)));
}
