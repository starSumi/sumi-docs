---
title: 发布
description: 构建、验收、提升和回滚不可变的站点候选产物。
---

公开源代码、npm 包发布和发布产品是三个不同事件。代码提交可以公开，但已部署站点、
Git 标签或 GitHub Release 仍然可以不存在；包发布使用的 scope 也可能不同于当前
checkout 的 manifest。

## 发布意图与包版本

第一次公开 npm bootstrap 已于 2026-08-23 在 `@sumi-labs` scope 完成：最初查询
`@sumi-os/*` 返回 404，随后 PR #10 修改了 scope。公开的 0.1.0 包为：

| Package                            | 第一次公开观察时间（UTC） |
| ---------------------------------- | ------------------------- |
| `@sumi-labs/corpus-contract@0.1.0` | 2026-08-23 06:57:02       |
| `@sumi-labs/docs-mcp@0.1.0`        | 2026-08-23 07:03:35       |

当前 checkout 的 manifest 仍声明 `@sumi-os/corpus-contract` 和
`@sumi-os/docs-mcp`。这些名称不是已发布 `@sumi-labs` 包的 alias。提升任何新候选
之前，发布者必须把包名、workspace 依赖、changeset 和 provenance 与公开 scope
重新对齐；仅有源码 checkout 不能证明某个 npm identity 可以发布。
发布证据还必须记录精确的 registry 查询和已验收 tarball 的摘要；实时 package 列表不能
证明当前 checkout 与已发布源代码相同。

0.1.0 bootstrap 完成后，如果 Pull Request 改变了 `@sumi-labs/corpus-contract` 或
`@sumi-labs/docs-mcp` 产品 identity 的已发布行为，就运行 `pnpm changeset`，记录受影响
的包、semver 影响和客观的发布说明。两个包独立版本化；只有 contract 改动同时改变 MCP
行为或兼容性时才选择两者。只改文档、测试、仓库工具或私有 Web 应用时，不需要空
changeset。

发布意图合入 `main` 后，`Release intent` 工作流只维护一个经过评审的版本 Pull Request。
它可以更新公开包版本、内部依赖元数据和包级 changelog，但不会发布包、创建标签、构建
候选产物或进入受保护的发布 environment。版本 Pull Request 合并后，必须从该精确提交
构建并验收不可变候选产物，之后才能提升任何包。

使用明确的公开源地址构建生产候选：

```powershell
$env:SITE_URL = "https://docs.example.com"
$env:BASE_PATH = "/"
pnpm --filter @sumi-os/docs-web verify:release
pnpm run verify:integration
```

手动 `Acceptance candidate` 工作流只接受 `main` 最新提交的完整 40 位 SHA、公开源地址和
部署基础路径。
它在没有 OIDC 或 attestation 权限的 job 中运行发布套件，并上传静态归档、SHA-256
校验和、原始性能证据、项目与运行时许可证、第三方声明和 CycloneDX 组件清单。它还会
一起打包 corpus contract 和 MCP package，把精确 tarball 安装到干净的临时 consumer，
并将摘要记录在 npm candidate manifest 中；它不会部署站点或发布到 npm。

来源证明由独立的受保护 job 生成。只有仓库变量 `ENABLE_ATTESTATION` 为 `true`，且
`candidate-attestation` environment 已存在并受到保护时才会运行。若仓库无法落实该
边界，应保持变量未设置；跳过来源证明是未关闭的发布门，不是成功。

人工验收必须覆盖两种语言、所有主题模式、规范 URL、机器清单、原始文档、OpenAPI、
所有映射页面和 MCP 跨项目验证。提升前记录已接受的提交、工作流运行、源地址、
校验和、验收人和时间。

保留上一个已验收的不可变产物。回滚时恢复该产物或部署，然后重新验证根页面、
本地化路由和 `/_mcp/` 投影。

`Production documentation release` 工作流会部署经过验证的最新 `main` 提交。
`ENABLE_REMOTE_MCP` 未设置或为 `false` 时，它只发布 Pages：不会访问远程 environment、
SSH secret、容器镜像或 MCP discovery record。工作流从 Pages 配置取得公开源地址和基础
路径，并要求 `_mcp/server.json` 不存在。

将仓库变量 `ENABLE_REMOTE_MCP` 设为 `true` 后，工作流才会进入经过评审的双目标阶段。
受保护的 `production-mcp` environment 必须提供公开 MCP 与 readiness URL、Host 与 Origin
策略、SSH 目标、私钥和固定的 known-hosts 材料。一次绑定 commit 的构建只密封一次机器
投影，再把相同的 v2 字节放入 Pages artifact 与 OCI image，并记录 corpus revision、
image digest 和 image ID。

提升前，工作流保留精确的旧 Pages artifact，并保留旧 MCP container，直到公开读回成功。
它先切换 MCP candidate，再部署 Pages，然后验证公开 locator 以及 discovery metadata 的
缺失或精确内容，最后完成远程切换。后续步骤失败时，先恢复 Pages，再恢复 MCP。运行中断
时，recovery workflow 使用同一次运行绑定的证据进行补偿，不会重新构建旧产物。第一次
发布站点因没有旧产物，必须手动 dispatch 并明确确认 `bootstrap`。

该生产工作流不会发布 npm package、Windows 可执行文件、Git tag 或 GitHub Release。

后续 npm 发布是独立的提升操作。它要求已经证明对公开的 `@sumi-labs` scope（或经过明确
批准的 scope 迁移）的控制权并启用双因素认证，先发布已验收的精确 corpus-contract tarball，
再发布已验收的精确 MCP tarball。后续版本使用受保护的 npm trusted publisher、staged
publishing 和人工批准。两条路径都不得重新构建已验收的 tarball，也不得使用未经评审的
长期 registry 写入 token。

两条路径都不使用 `changeset publish`。publisher 只能消费已验收的 tarball，并核对其
提交和校验和；不得从版本 Pull Request 重新构建。
