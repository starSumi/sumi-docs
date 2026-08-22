---
title: 参与贡献
description: 从议题提案到评审、验证和合并的完整流程。
---

本仓库同时维护面向人的文档站和 Sumi-Docs-MCP 使用的公开机器投影。只有当这两个
界面及其两种语言保持一致时，一项贡献才算可以合并。

## 先建立议题

如果改动涉及发布契约、语言或路由模型、受信内容边界、生产依赖、部署流程，或者
Skill 与 Agent 集成，请先建立 issue。说明实际问题、预期外部行为、备选方案、兼容性
影响和验收证据。安全漏洞应按 `SECURITY.md` 私下报告，不要建立公开 issue。

对于范围明确的内容纠错、只改测试的增强，或不改变公开行为的内部修复，可以直接
提交 pull request。

尚未解决的公开设计使用功能提案 issue 表单，可复现缺陷使用 bug 表单。
[工程记录](../product/engineering-records/)说明产品需求、提案、ADR、可执行规范、基准、
安全通告和 Pull Request 分别在何时具有权威性。

## 准备 Pull Request

从当前默认分支建立主题分支，每个 pull request 只处理一个概念性改动。设计、内容、
测试或翻译尚未完成时使用 Draft。每个公开英文页面都必须有简体中文对应页面，并在
经过审阅的 `apps/web/src/content-catalog.ts` 中配置明确的源文件到页面路由映射。

按照 pull request 模板说明：

- 改了什么、为什么需要、具体如何实现；
- 关联 issue，或说明为何不需要 issue；
- 对内容、路由、语言、安全、依赖和部署的影响；
- 实际执行的验证命令和结果；
- 有运行影响时的回滚方法。

提交信息使用 Conventional Commits。私有主题分支落后时可以 rebase，但不要重写已被
其他贡献者使用的提交。

首次 0.1.0 npm bootstrap 完成后，如果 Pull Request 改变任一公开包的已发布行为，
运行 `pnpm changeset`，选择所有受影响的包并写明面向用户的发布说明。只改文档、测试、
仓库工具或私有 Web 应用时不需要空 changeset。changeset 只记录发布意图，不授予发布权。

## 验证完整投影

运行：

```powershell
pnpm run verify
pnpm run verify:integration
```

`verify` 检查格式、测试、Astro 诊断、构建、语言与路由配对以及生产依赖。
`verify:integration` 会让四个 MCP 工具读取构建后的远程语料，并验证每个返回的人类页面 URL。
任何失败或跳过的门禁都必须明确报告。

只有在必需检查通过、文档与 changelog 已更新、评审讨论已解决后，才能把 pull request
标记为 Ready。GitHub 已禁用 merge commit；维护者根据提交序列是否有独立评审价值选择
squash 或 rebase merge。

进一步阅读[开发](../development/)、[发布](../releasing/)和
[Skills、MCP 与编排](../skills-and-orchestration/)。

具备仓库上下文的 Agent 可以使用 `$sumi-docs-pr` 来分类记录、定位改动所属门禁并准备
Pull Request 正文；该 Skill 不会发布或合并 Pull Request。
