---
title: 规范与引用
description: 定义 Sumi 文档兼容边界的外部规范。
---

以下链接列出 Sumi 文档使用的外部契约权威。它们是引用，不代表认证或背书。Sumi
只采用本地 schema、测试和架构记录明确覆盖的部分。

## 协议与数据契约

| 领域                           | 权威来源                                                                                                 | 在 Sumi 文档中的用途                                               |
| ------------------------------ | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| MCP 消息、生命周期、工具和传输 | [Model Context Protocol 规范](https://modelcontextprotocol.io/specification/)                            | 定义 JSON-RPC 交互，以及 Agent 宿主、MCP client 和 server 的边界。 |
| HTTP 传输行为                  | [MCP transport 规范](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)          | 定义 stdio 与 Streamable HTTP 语义；Sumi 仍以 stdio 为默认。       |
| Schema 词汇                    | [JSON Schema Draft 2020-12](https://json-schema.org/draft/2020-12/json-schema-core)                      | 定义 corpus manifest 和一致性 schema 的词汇。                      |
| HTTP API 描述                  | [OpenAPI Specification](https://spec.openapis.org/oas/latest.html)                                       | 描述 `get_openapi_spec` 可选返回的 OpenAPI 文档。                  |
| 规范性措辞                     | [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119) 与 [RFC 8174](https://www.rfc-editor.org/rfc/rfc8174) | 解释项目契约中的大写 MUST、SHOULD 和 MAY。                         |

## Web、语言与运维

| 领域             | 权威来源                                                                                                                                                     | 在 Sumi 文档中的用途                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| 浏览器无障碍     | [WCAG 2.2](https://www.w3.org/TR/WCAG22/)                                                                                                                    | 规定面向人的文档站点的无障碍目标。                               |
| TypeScript 语言  | [TypeScript 文档](https://www.typescriptlang.org/docs/)                                                                                                      | 说明 Node workspace 和生成的 TypeDoc 参考使用的语言。            |
| Rust parity 线路 | [Rust Reference](https://doc.rust-lang.org/reference/)                                                                                                       | 只适用于未来受支持的原生实现，不改变当前 Node 契约。             |
| 运行时遥测       | [OpenTelemetry 规范](https://opentelemetry.io/docs/specs/otel/) 与 [语义约定](https://opentelemetry.io/docs/specs/semconv/)                                  | 为可选的宿主或服务遥测提供词汇，不向只读 MCP 核心加入 exporter。 |
| 工作流安全       | [GitHub Actions security hardening](https://docs.github.com/en/actions/security-for-github-actions/security-hardening-for-github-actions)                    | 指导最小权限 workflow 和发布证据处理。                           |
| 依赖更新         | [Dependabot configuration](https://docs.github.com/en/code-security/dependabot/dependabot-version-updates/configuration-options-for-the-dependabot.yml-file) | 定义生态发现、计划、分组与 PR 行为。                             |
| 依赖审查         | [GitHub dependency review](https://docs.github.com/en/code-security/supply-chain-security/understanding-your-software-supply-chain/about-dependency-review)  | 定义用于拒绝新引入漏洞依赖的 PR 差异审查。                       |

## 如何应用引用

外部链接不会覆盖仓库契约。提案必须指出受影响的本地 schema、实现、测试和回滚路径。
如果外部规范与项目锁定行为不一致，应先在架构决策中记录差异，再开始实现。

参阅[工程记录](../product/engineering-records/)选择记录类型，并参阅[架构](../architecture/)
了解当前兼容边界。
