---
title: 开始使用
description: 让 Sumi-Docs-MCP 读取本仓库、另一份本地语料或已发布语料。
---

Sumi-Docs-MCP 通过四个只读工具提供文档：列表、搜索、获取文档和 OpenAPI 查询。MCP
客户端可以通过本地 stdio 或无状态 Streamable HTTP 连接。

## 本仓库

从 workspace 根目录安装并构建：

```powershell
pnpm install --frozen-lockfile
pnpm run build
node packages/mcp/dist/index.js doctor --json
node packages/mcp/dist/index.js serve
```

受版本控制的项目配置选择根 `docs/`。这些经过审阅的文件与 content catalog 是事实源，
因此本站本身就是产品的真实自托管示例。MCP 服务是只读查询投影，连接它的 Agent 宿主
是 MCP 客户端。仓库内 Codex、Claude Code 和 VS Code adapter 见
[Agent 宿主集成](../agent-hosts/)。

若要读取另一份本地 Markdown 或 MDX 语料，请显式传入目录：

```powershell
node packages/mcp/dist/index.js serve ./product-docs --openapi ./product-docs/openapi.json
```

构建 Web workspace 后，可以使用精确的本地 v2 locator，验证生产镜像所消费的同一份
不可变投影：

```powershell
node packages/mcp/dist/index.js serve ./apps/web/dist/_mcp/v2/current.json --base-url http://127.0.0.1:4321/
```

v2 manifest 已声明 OpenAPI 与完整性元数据，因此这种 source 不接受 `--openapi`。

直接打开可执行文件只会显示帮助并退出，这是 CLI 的正常行为。

## 已发布语料

站点部署后，使用机器投影作为来源，并使用站点根地址生成供人打开的链接：

```powershell
node packages/mcp/dist/index.js serve https://docs.example.com/_mcp/ --base-url https://docs.example.com/
```

这条命令仍使用 stdio 承载 MCP 流量；HTTPS 只选择有边界的只读语料快照，服务不会
爬取网站。

若要让远程 MCP 客户端访问同一个核心，使用 Node.js 分发启动 Streamable HTTP：

```powershell
node packages/mcp/dist/index.js serve https://docs.example.com/_mcp/v2/current.json --base-url https://docs.example.com/ --transport streamable-http
```

默认回环 endpoint 是 `http://127.0.0.1:3000/mcp`。公开部署需要显式网络绑定策略和 TLS
反向代理。

## 容器部署

仓库提供针对同一 Node.js 服务的多阶段、非 root 容器：

```powershell
docker compose up --build
```

默认只读挂载根 `docs/`。MCP 地址为 `http://localhost:3000/mcp`；`/healthz` 在不加载语料
的情况下检查进程，`/readyz` 标识已加载的快照。通过 `SUMI_DOCS_SOURCE_DIR` 可以挂载另一
份本地语料。`packages/mcp/examples/postman/` 中的 Postman collection 只是人工部署探针，
不是 MCP 客户端配置。

## 客户端配置

配置 MCP 客户端启动 `node` 或独立可执行文件，并传入相同的 `serve` 参数。应优先使用
宿主的项目根变量或 pnpm workspace 启动器，不要提交某台机器的绝对路径。

远程宿主应配置 Streamable HTTP endpoint URL，而不是本地进程命令。查询服务不要求
Skill；初始化 instructions 和 `tools/list` 已经描述可用工具。
