---
title: Agent 宿主集成
description: 在不强制要求 Skill 的前提下连接 Codex、Claude Code 和 VS Code。
---

# Agent 宿主集成

克隆仓库后先构建一次：

```powershell
pnpm install --frozen-lockfile
pnpm run build
node packages/mcp/dist/index.js doctor --json
```

之后，仓库通过各宿主原生、可审阅的项目配置提供同一个 stdio 服务。

| 宿主        | 项目配置             | 信任行为                                         |
| ----------- | -------------------- | ------------------------------------------------ |
| Codex       | `.codex/config.toml` | 只有受信项目才应用项目配置。                     |
| Claude Code | `.mcp.json`          | 使用项目前需要批准项目级服务。                   |
| VS Code     | `.vscode/mcp.json`   | 编辑器会在启动 workspace 定义的 MCP 服务前询问。 |

将仓库根目录作为 workspace 打开。Codex 使用 pnpm workspace 启动器，因此会话从仓库
子目录启动时命令仍然有效。Claude Code 和 VS Code 使用各自记录的项目根变量，直接启动
编译后的入口，不经过包管理器的 stdout 包装。

修改配置或重新构建 MCP package 后，在宿主中重启 MCP 服务。每个服务进程只保留一个
只读语料快照，不进行 live reload。

## 项目级 Skill 与直接使用 MCP

当任务描述匹配时，Codex 会从 `.agents/skills/` 发现经过评审的 `$sumi-docs-use`、
`$sumi-docs-pr` 和 `$sumi-docs-audit` 工作流；Claude Code 可通过仓库 instructions
读取同一份规范文件。它们分别覆盖安装运行、Pull Request 准备以及只读的仓库或发布
审计，但普通文档查询不依赖它们。

## 直接使用 MCP

宿主配置本身已经足够。Agent 无需加载 Skill，就可以调用 `list_docs`、按关键词搜索、
按列表中的精确路径获取文档，以及查询 OpenAPI。MCP 初始化 instructions 会说明这套流程
以及只读、进程快照边界。

对于产品使用、架构、运维和稳定决策问题，Agent 应先查询这份经过审阅的投影，再直接
搜索文档文件。实现改动仍以当前源码和测试为准。MCP 服务只约束自身的四工具表面，
不会授予、撤销或取代 Agent 宿主的文件系统权限与 sandbox。

Agent 宿主就是 MCP client。远程部署时，支持 Streamable HTTP 的宿主直接连接
`https://mcp.example.com/mcp` 这类服务 URL，不再启动本地进程。工具名称、严格 schema、
初始化 instructions 与语料 identity 保持一致。

可选的 `$sumi-docs-maintain` Skill 只负责维护路由：帮助 Agent 判断仓库改动属于哪个
package、需要哪些验证门。它不是协议依赖，也不会通过 MCP 写入文档。

## 自然语言请求

自然语言交互属于 Agent host。宿主可以把“如何配置远程 corpus？”转换为受限的调用序列：

1. 在未知 corpus 身份时调用 `list_docs`；
2. 用用户关键词调用 `search_docs`；
3. 对选中的 source 调用 `fetch_doc`，并保留返回的 path 作为引用；
4. 只有请求涉及已发布 API 时才调用 `get_openapi_spec`。

宿主负责生成答案，并引用返回的文档 path 或公开 URL。Sumi-Docs-MCP 不解析 prompt、不
选择模型、不保存对话历史，也不要求 API key。未来类似 Codex 的集成可以在同一 MCP 契约
外增加 Agent 或 provider adapter，而无需修改 server 或经过审阅的语料。

当模型把返回的段落作为上下文时，这一步属于 retrieval-augmented generation。当前实现
是确定性的词法检索，不是 embedding 或向量数据库。微调既不是必需项，也不是保持文档最新
的机制；应更新语料、重新构建或重启进程，再由宿主检索新的 revision。

## 默认目录与导航

未提供 CLI source 时，`sumi-docs.config.json` 选择根 `docs/`。如果没有该文件，发现逻辑
回退到最近可信 Git 项目根目录的 `docs/`。在 Git 之外不会向父目录搜索，因此父级
`.sumi` workspace 容器不会被误认为产品状态目录。

MCP 没有展示导航，`list_docs` 以确定顺序返回所有 Markdown 或 MDX 路径。网站使用经过
审阅的 catalog 管理标签、顺序、语言配对和路由。新增根文档会有意触发 Web omissions
门失败，直到两个语言版本都完成登记。
