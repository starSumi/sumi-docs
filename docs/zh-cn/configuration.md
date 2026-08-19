---
title: 配置
description: 配置来源发现、公开页面 URL、运行模式和状态放置。
---

CLI 支持显式参数和严格的受版本控制项目配置：

```text
sumi-docs-mcp serve [docs-source] [--config <path>] [--openapi <path>] [--base-url <url>] [--transport <stdio|streamable-http>] [HTTP options] [--verbose]
sumi-docs-mcp doctor [docs-source] [--config <path>] [--json] [--show-paths]
```

解析顺序为：显式 CLI source、显式 `--config`、当前 Git 边界内最近的
`sumi-docs.config.json`，最后是可信项目根的 `docs/`。没有 Git 时不会向父目录搜索。

显式 CLI source 选择本地 v2 locator 或远程 manifest 时，配置中的目录 `openapi` 属于
已被替换的 source，因此会被忽略。这两种 manifest-backed source 都会拒绝显式 CLI
`--openapi`；OpenAPI 应在 manifest 中声明。

## 地址模型

`docs-source` 决定机器读取的内容，可以是本地 Markdown/MDX 目录、Web publisher 生成的
精确本地 `_mcp/v2/current.json` locator，也可以是远程 HTTPS manifest 或其目录地址。
任意本地 JSON 文件与直接 v2 manifest 路径都会被拒绝。

`--base-url` 决定 MCP 结果中供人打开的 URL。它不会托管内容，也不会改变 MCP 传输。
Markdown 扩展名会被移除，末段为 `index.md` 或 `index.mdx` 时映射到所在目录页面。

`--transport` 决定 Agent 客户端如何访问 MCP。`stdio` 启动本地子进程；
`streamable-http` 默认在 `127.0.0.1:3000` 暴露 `/mcp`。语料来源 URL、页面 URL 和 MCP
endpoint 是相互独立的地址。

HTTP 参数包括 `--http-host`、`--http-port`、`--http-path`、可重复的
`--allowed-host`、可重复的 `--allowed-origin` 与 `--allow-public-network`。非回环绑定
必须显式确认并配置至少一个允许的 Host。公开服务的 TLS 与请求速率策略由反向代理负责。

`GET /healthz` 是轻量存活探测。HTTP 启动完成后，`GET /readyz` 报告文档数量；若 source
是本地或远程不可变 v2 投影，还会报告其 corpus revision。本地目录和 v1 source 的
revision 为 `null`。v2 部署可以通过 `SUMI_DOCS_EXPECTED_CORPUS_REVISION` 指定完整的
`sha256:` revision；缺失或不匹配时进程会在 listener 就绪前失败。

构建 Web workspace 后，可以不启动 HTTP source server，直接从磁盘读取同一份密封投影：

```powershell
node packages/mcp/dist/index.js serve ./apps/web/dist/_mcp/v2/current.json --base-url http://127.0.0.1:4321/
```

本地 loader 会在提交内存快照前校验 locator、规范化 manifest、字节数、SHA-256 摘要与
真实路径包含关系。OpenAPI 由 manifest 提供，因此不要再传 `--openapi`。

## 开发和分发

| 模式           | 入口                                           | 用途                                  |
| -------------- | ---------------------------------------------- | ------------------------------------- |
| MCP 源码开发   | `pnpm --filter @sumi-os/docs-mcp dev`          | 使用受版本控制的示例开发 TypeScript   |
| Web 源码开发   | `pnpm --filter @sumi-os/docs-web dev`          | 运行支持 reload 的本地 Starlight 站点 |
| Node 分发      | `node packages/mcp/dist/index.js`              | 从本 workspace 运行编译后的 package   |
| 独立可执行文件 | `packages/mcp/artifacts/bin/sumi-docs-mcp.exe` | 不依赖外部 Node 安装运行              |

Node 分发和维护的容器支持两种传输。独立可执行文件在 HTTP 打包获得单独验收前仍是
stdio artifact。

本地运行与 Pages-only 发布不要求运行时 secret。`SITE_URL` 属于 Web release build。
可选的生产远程阶段把 SSH 凭据与 known-hosts 材料保存在受保护的 `production-mcp`
environment 中。容器把文档化的 `SUMI_DOCS_*` 变量映射到经过校验的 CLI 选项；build 与
预期 corpus revision 是新鲜度守卫，不是凭据。每个服务进程保留一个只读语料快照，
因此源内容变化后必须重启。

Web release build 将 `PUBLIC_MCP_URL` 与 `PUBLIC_MCP_READINESS_URL` 作为一组可选
配置。两者都必须是无凭据、query 和 fragment 的绝对 HTTPS URL。publisher 不会从
Streamable HTTP endpoint 推导 readiness endpoint。配置后，它会根据已安装 MCP package
的身份生成 `<BASE_PATH>_mcp/server.json`；项目 Pages 部署中的公开路径是
`/sumi-docs/_mcp/server.json`。没有配置这组变量时，不会生成远程 server metadata，
也会跳过 readiness 探针。

配置后的 Pages artifact 上传前，release 探针要求远程 `/readyz` 返回预期的 service、
package version、protocol version，以及与构建产物 `_mcp/v2/current.json` 完全一致的
revision。存在 `GITHUB_SHA` 时，远程 `buildRevision` 还必须指向同一个 commit。探针采用
10 秒超时和 64 KiB 响应上限，不记录上游响应正文或错误详情。该 revision 保证只适用于
从 Web v2 projection 加载语料的远程 MCP 服务；本地目录 source 没有 immutable corpus
revision，应通过字节与 tool contract 验证。

`doctor` 会报告选中的 source format（`directory`、`manifest-v1` 或 `manifest-v2`）以及
存在时的 corpus revision。路径默认只显示为项目相对路径或明确的外部路径占位符。
`--show-paths` 只用于本机交互诊断；即使启用，凭据和调用栈仍会被净化。`serve` 会拒绝
该参数。

## 状态放置

不要创建产品 `.sumi/` 目录；父目录可能已经是 operator workspace 容器。受版本控制的
默认值放在 `sumi-docs.config.json`。未来可变 cursor、cache、lease、checkpoint 或
database 状态应位于仓库外的平台用户数据目录。
