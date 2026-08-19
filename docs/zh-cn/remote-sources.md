---
title: 远程文档源
description: 为只读远程文档发布受限的 manifest。
---

远程 source 模式通过严格 manifest 下载不可变文档 snapshot，不会爬取网站。source
模式与传输相互独立；同一语料可以通过 stdio 或 Streamable HTTP 提供。

## Manifest

每次生产构建都会生成 `_mcp/sumi-docs-manifest.json`：

```json
{
  "version": 1,
  "documents": ["getting-started.md", "configuration.md"],
  "openapi": "openapi.json"
}
```

文档路径必须是受限的相对 Markdown 或 MDX 路径。OpenAPI 是可选的受限相对 JSON 路径。未知字段、重复项、重定向、超大响应和跨源路径都会被 Sumi-Docs-MCP 拒绝。

同一次构建还会生成 `_mcp/v2/current.json` 和按摘要寻址的不可变快照。需要完整性校验时，应传入精确的 v2 locator：

```powershell
node packages/mcp/dist/index.js serve http://127.0.0.1:4321/_mcp/v2/current.json --base-url http://127.0.0.1:4321/
```

MCP loader 会校验规范化 manifest、revision、字节数和 SHA-256 摘要。目录 URL 与 v1 manifest URL 继续作为向后兼容入口。

Web 构建或 artifact 解压后，也可以从精确的本地 locator 读取同一份 v2 投影：

```powershell
node packages/mcp/dist/index.js serve ./apps/web/dist/_mcp/v2/current.json --base-url http://127.0.0.1:4321/
```

本地与远程 v2 source 共享同一份 manifest 和完整性契约。本地路径还会经过词法路径与
真实路径包含校验。locator 是唯一受支持的 v2 入口，OpenAPI 由其 manifest 提供。

投影包含经过审阅的 Markdown 或 MDX。通用 HTML 爬取、DOM 执行和启发式 AST 清洗
不属于 MCP 核心。独立 ingestion 系统必须先完成规范化、记录 provenance，并提交经过
审阅的内容，publisher 才能接受。

## 人类页面路由

旁边的 `_mcp/sumi-docs-routes.json` 将每个 corpus 路径映射到渲染页面。它是部署校验产物，不属于 MCP manifest 协议。构建会在映射页面或原始文件缺失时失败。

## Source、页面与 endpoint

这些地址由不同层负责：

```text
https://docs.example.com/                       面向人类的渲染页面
https://docs.example.com/_mcp/v2/current.json  不可变语料 locator
https://mcp.example.com/mcp                    Streamable HTTP MCP endpoint
```

GitHub Pages 可以托管前两个静态表面。MCP endpoint 需要运行中的 Node 服务或另一份
兼容 runtime，通常位于 TLS 反向代理之后。它可以挂载到同一域名，但不是 `_mcp` locator。

## 本地演练

构建并预览站点，然后使用本地机器投影：

```powershell
pnpm run build
pnpm run preview
node dist/index.js serve http://127.0.0.1:4321/_mcp/ --base-url http://127.0.0.1:4321/
```

若要同时验证远程 source 与远程 transport：

```powershell
node packages/mcp/dist/index.js serve http://127.0.0.1:4321/_mcp/v2/current.json --base-url http://127.0.0.1:4321/ --transport streamable-http
```

客户端连接 `http://127.0.0.1:3000/mcp`。

回环 HTTP 仅用于开发。生产远程文档源必须使用 HTTPS，并且不支持凭据、Cookie、重定向、查询字符串或片段。
