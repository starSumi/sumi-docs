# Sumi Docs

[English](README.md) | 简体中文

Sumi Docs 将一套经过评审的文档语料发布给两类使用者：

- 人通过 Astro 和 Starlight 网站浏览；
- Agent 通过只读 MCP 服务器查询同一套语料。

经过审阅的根 `docs/` 树与 content catalog 是语义事实源。Web 站点和 MCP 服务是可独立
寻址的投影，Agent 宿主是 MCP client。

[源码仓库](https://github.com/starSumi/sumi-docs)和
[文档站](https://starsumi.github.io/sumi-docs/)已公开并处于持续开发阶段。目前
尚未发布 npm package、带 tag 的 GitHub Release 或受支持的二进制文件。

## 前置要求

- Node.js 25.5.0 或更高版本
- 通过 Corepack 使用 pnpm 10.26.0，或使用 `packageManager` 声明的版本
- 加载仓库提供的 Agent 宿主配置前，先信任当前 checkout

## 首次运行

```powershell
pnpm install --frozen-lockfile
pnpm run build
node packages/mcp/dist/index.js doctor --json
```

Doctor 默认只报告项目相对路径或外部来源占位符。仅在本地诊断时添加
`--show-paths`；不要把该输出附加到公开 issue 或构建产物中。

检入的 `sumi-docs.config.json` 选择根目录 `docs/` 和示例 OpenAPI 文档。
启动面向人的网站：

```powershell
pnpm --filter @sumi-os/docs-web dev
```

打开 `http://127.0.0.1:4321`。Codex、Claude Code 和 VS Code 的项目适配器见
[Agent 宿主集成](docs/zh-cn/agent-hosts.md)。它们无需可选的维护 Skill，即可暴露
四个 MCP 工具。

若要在回环 Streamable HTTP endpoint 上提供同一语料：

```powershell
node packages/mcp/dist/index.js serve --transport streamable-http
```

兼容的 MCP client 连接 `http://127.0.0.1:3000/mcp`。静态 Web 站点与 `_mcp` 语料投影
本身不会运行该 endpoint。

若要在强化的本地容器中提供同一份根语料：

```powershell
docker compose up --build
```

MCP 地址为 `http://localhost:3000/mcp`，`/healthz` 用于存活探测，`/readyz` 用于语料
就绪探测。源码开发不强制使用 Docker；公开部署仍须终止 HTTPS 并配置明确的 Host 策略。

仓库还在 `.agents/skills/` 下提供三个可选的项目工作流：`$sumi-docs-use` 用于安装和
运行，`$sumi-docs-pr` 用于提案与 Pull Request 准备，`$sumi-docs-audit` 用于只读、
证据绑定的仓库与发布审计。它们只负责路由工作，不替代 MCP，也不会发布远程改动。

## 工作区

```text
apps/web/                   Astro/Starlight 网站和语料发布器
packages/mcp/               stdio 与 Streamable HTTP MCP 服务器和 CLI
packages/corpus-contract/   Manifest schema 和一致性 fixture
docs/                       产品手册和默认语料
.agents/skills/             可选的项目使用与贡献工作流
```

| 模式              | 命令                                                                | 用途                               |
| ----------------- | ------------------------------------------------------------------- | ---------------------------------- |
| Web 开发          | `pnpm --filter @sumi-os/docs-web dev`                               | 支持热更新的本地网站               |
| MCP 开发          | `pnpm --filter @sumi-os/docs-mcp dev`                               | 针对示例语料运行 TypeScript 服务器 |
| 生产构建          | `pnpm run build`                                                    | 构建契约、MCP 和静态网站           |
| 编译后 MCP        | `node packages/mcp/dist/index.js serve`                             | 通过 stdio 提供自动发现的项目语料  |
| 远程 MCP endpoint | `node packages/mcp/dist/index.js serve --transport streamable-http` | 在回环 HTTP 提供同一语料           |
| 验证              | `pnpm run verify`                                                   | 运行 package 质量、测试和依赖门禁  |
| 跨产品验证        | `pnpm run verify:integration`                                       | 通过 MCP 验证 Web 生成的语料       |

本地运行与默认的 Pages-only 发布不要求运行时 secret。只有构建网站发布候选时才要求
`SITE_URL`。启用可选的生产 Streamable HTTP 服务前，必须在受保护的 `production-mcp`
environment 中配置经过评审的 endpoint 变量和 SSH 材料。容器接受文档化的
`SUMI_DOCS_*` 部署变量；生成输出、本地状态、日志、缓存和 `.env` 文件保持忽略。

各 workspace 的专用说明保留在其自身目录中。当前架构决策位于所属 workspace 的
`docs/decisions/` 目录；根手册只呈现面向使用者的结果，不复制决策记录。

源码和站点可见性不会同时发布 tag、package 或二进制文件；这些产物仍须通过文档规定的
发布门禁。
