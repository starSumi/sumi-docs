---
title: 开发
description: 开发文档站并验证它与 Sumi-Docs-MCP 的契约。
---

产品使用一个 pnpm workspace 和根 `pnpm-lock.yaml`。使用 Node.js 25.5 或更高版本，并从
workspace 根目录执行安装与跨产品命令。

```powershell
pnpm install --frozen-lockfile
pnpm --filter @sumi-os/docs-web dev
```

面向人的内容位于 workspace 根 `docs/`。经过审阅的
`apps/web/src/content-catalog.ts` 为每个稳定文档 ID 和 locale 明确绑定源文件、渲染
route 与导航位置。Starlight 导航、manifest v1、route map 和不可变 manifest v2
都由该 catalog 生成。

提交前运行仓库门禁：

```powershell
pnpm run verify
pnpm run verify:integration
```

`verify` 检查格式、测试、Astro 诊断、静态构建、路由与语言配对、不可变摘要和
生产依赖。`verify:integration` 会让已编译的 MCP workspace package 读取构建产物，调用工具，
并验证每个返回的页面 URL。

## 依赖维护

Dependabot 按错开的每周计划检查 pnpm workspace、Rust native probe、容器基础镜像和
固定到提交摘要的 GitHub Actions。兼容的 npm 与 Cargo minor 或 patch 更新会分组，
major 更新保持独立并交由维护者评审。

每个依赖 PR 都会运行完整 CI 矩阵和 GitHub dependency review。patch 更新可以进入
squash auto-merge，但只有 commit policy、Linux 与 Windows 验证、容器验收和依赖审查
全部通过后，分支规则才允许合并。GitHub Actions 更新不参与自动合并，避免 workflow
自行批准其执行依赖的变更。minor 和 major 更新始终需要维护者决策。

只有经过审核的 Markdown 和 MDX 才能进入站点构建。不要加入模型凭据、私有文档、
认证抓取或浏览器端 stdio；这些能力需要单独评审的服务端边界。
