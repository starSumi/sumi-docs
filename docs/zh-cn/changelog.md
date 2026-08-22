---
title: 版本演进
description: Sumi 文档 Web 投影的用户可见演进记录。
---

本页是面向读者的产品演进摘要。逐文件的发布记录仍以各 workspace 的 changelog
为准：

- [Web changelog](https://github.com/starSumi/sumi-docs/blob/main/apps/web/CHANGELOG.md)
- [Corpus contract changelog](https://github.com/starSumi/sumi-docs/blob/main/packages/corpus-contract/CHANGELOG.md)
- [MCP changelog](https://github.com/starSumi/sumi-docs/blob/main/packages/mcp/CHANGELOG.md)

## Unreleased

- 增加可评审的包发布意图和自动版本 Pull Request，但不授予包发布或创建标签的权限。
- 用一份经过审阅的 content catalog 统一侧栏和发布映射。
- 在保留 manifest v1 的同时，增加包含 locale、route、digest、导航和来源溯源信息的
  immutable manifest v2 投影。
- 在投影提升前增加源文件漂移检查，并使用明确的 origin 和 base path 校验 GitHub
  Pages 发布。
- 增加 canonical URL、sitemap、API 路由和本地 HTML 引用的生成物校验。
- 明确 TypeDoc API 参考在经过审阅的翻译 API 语料发布前，以英文为规范源。
- 公开 benchmark 方法和可复现参考测量，包括 runtime、环境、workload、source commit
  和 release evidence 边界。

## 0.1.0 - 2026-08-14

- 增加包含英文和简体中文路由的 Astro/Starlight 站点、明暗和自动主题，以及受限的
  MCP 投影。
- 增加 manifest、原始语料、OpenAPI、路由映射、渲染 URL 和四个 MCP 工具的构建校验。
- 增加贡献、安全、发布和 Agent 宿主集成指南。

本页不是可变运行时状态存储。发布候选仍由 Git commit、不可变 CI artifact 和
[发布流程](../releasing/) 中记录的人工验收共同确定。
