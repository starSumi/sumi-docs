---
title: 工程记录
description: 为需求、提案、决策、规范、基准、安全报告或 Pull Request 选择正确的持久记录。
---

不同工程记录服务于变更的不同阶段。只创建能够保存决策及其证据的最小记录，不要维护
可能与可执行契约发生漂移的平行说明。

## 记录映射

| 问题                                   | 记录           | 规范位置                                                   | 生命周期                                     |
| -------------------------------------- | -------------- | ---------------------------------------------------------- | -------------------------------------------- |
| 哪些产品结果必须长期成立？             | 产品需求       | `docs/product/product-requirements.md`                     | 持久范围或验收条件变化时更新                 |
| 项目是否应采用这项外部行为或设计方向？ | 提案 issue     | 通过功能提案表单建立的 GitHub issue                        | 实现前建立；以最终决策或 Pull Request 收口   |
| 为什么接受或拒绝一项持久权衡？         | 架构决策记录   | 所有权 package 的 `docs/decisions/` 目录                   | 保留决策历史，通过显式 supersede 演进        |
| 机器可读契约接受和输出什么？           | 可执行规范     | JSON Schema、TypeScript 类型、MCP 工具 schema 与一致性测试 | 随公开契约一起版本化                         |
| 在指定方法下，性能门是否通过？         | 基准策略与证据 | 策略 ADR 与绑定提交的 CI artifact                          | 方法长期保留；每个候选重新生成原始证据       |
| 如何协调漏洞披露？                     | 私有安全通告   | `SECURITY.md` 指向的 GitHub Security Advisory              | 协调披露前保持私有；仅在适用时申请或分配 CVE |
| 哪个经过评审的实现会被合并？           | Pull Request   | GitHub Pull Request 及其 checks                            | 引用相关 issue、决策、规范与证据             |

## 提案与决策的边界

提案描述尚未解决的问题、预期外部行为、备选方案、兼容影响和验收证据，它并不是已经
接受的架构决策。对于不改变公开行为的范围明确纠错，可以直接提交 Pull Request。

ADR 在权衡明确后记录一项持久决策。它应放在拥有该边界的 workspace 中，包含状态、
日期、背景、决策、后果、验证和回滚。需要改变旧决策时应显式 supersede，而不是静默
改写历史结论。

本项目在决策前使用 proposal issue，不另建一套重复的 RFC 文档树。只有当提案确实需要
脱离 issue 生命周期进行长期、版本化评审时，才引入 RFC 流程；该变更本身也需要一份
带所有者和迁移方案的架构决策。

## 规范与生成参考

Schema、导出类型、工具输入定义和测试共同构成可执行规范。面向人的文档说明如何使用
这些契约。API 参考由经过评审的 TypeScript 导出生成，属于 Web 界面，不会自动进入
MCP 语料。

公开契约发生变化时，必须在同一个 Pull Request 中同步兼容的 schema 与类型改动、先红
后绿的一致性测试、当前文档、示例和 changelog。

## 当前契约权威

| 表面                | 权威来源                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------ |
| MCP 消息与传输      | 版本化 [Model Context Protocol 规范](https://modelcontextprotocol.io/specification/)和已安装的官方 SDK |
| 工具参数            | MCP package 中的严格 Zod 定义；官方 SDK 将其发布为 JSON Schema                                         |
| Corpus manifest     | `@sumi-labs/corpus-contract` 中的 Draft 2020-12 schema、canonicalization 与 fixture                    |
| TypeScript API 参考 | 导出 declaration 与自动生成的 TypeDoc 页面                                                             |
| 未来 Rust API 参考  | 只有在受支持的 parity 实现存在后，才以导出 Rust item 与 rustdoc 为准                                   |
| 浏览器可访问性      | 已发布的 Web 标准与 [WCAG 2.2](https://www.w3.org/TR/WCAG22/)                                          |

LSP 不是本项目契约；它是面向编辑器的语言服务协议。与 MCP 同用 JSON-RPC 并不会让
本服务成为 LSP 实现。未来 Rust runtime 必须消费同一套语言无关 schema 与 fixture，
不能重新定义 wire contract。

## 基准与安全证据

性能结论必须注明实现、运行时、平台、样本数、排序方法、阈值和原始结果 artifact。
本地报告和生成测量值不作为产品状态提交；候选证据由 CI 绑定到被测提交并保存。

疑似漏洞应通过 `SECURITY.md` 中的私有渠道报告。不要公开利用细节，也不要创建占位 CVE。
公开安全通告和 CVE 记录应在漏洞完成验证并协调披露后产生，而不是在初次报告时产生。

实现与评审流程见[参与贡献](../../contributing/)。
