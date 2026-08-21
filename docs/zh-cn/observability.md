---
title: 可观测性与跟踪
description: Sumi 文档自动记录什么，以及遥测应归属哪一层。
---

运行证据应由拥有该操作的系统自动产生，而不是依赖用户事后补写。本项目将产品遥测、
文档内容和 Agent 记忆分开管理。

## 当前行为

- MCP 核心是无状态、只读的。它只保留进程内 corpus snapshot，不保存用户时间线或持久
  事件日志。
- 面向 client 的响应提供受限协议元数据和经过清洗的错误码，详细诊断只写入 stderr。
- CI 记录绑定 commit 的测试、构建、打包、安全和部署证据。验收 commit 与不可变 artifact
  组成发布记录。
- 默认不启用 OpenTelemetry exporter 或远程分析收集器。

## 所有权边界

| 信号                               | 所有者                | 默认策略                                              |
| ---------------------------------- | --------------------- | ----------------------------------------------------- |
| 工具延迟、错误类别、传输状态       | MCP host 或部署服务   | 用户显式启用，限制保留时间，不包含文档正文。          |
| 模型、token 和 prompt trace        | Agent host 或模型网关 | 由宿主和供应商策略控制；只读 MCP 核心不产生这些数据。 |
| Corpus revision、digest 和发布状态 | Publisher 与 CI       | 绑定 commit、可复现的证据。                           |
| 业务分析                           | 使用方应用            | 不属于本仓库契约。                                    |

启用遥测时，应使用 OpenTelemetry resource 和 semantic convention 名称，清洗绝对路径
与凭据，并明确采样、导出和保留策略。trace ID 可以把宿主操作与 MCP 调用关联起来，但
不能因此把 MCP server 变成 session store。

## 扩展规则

增加 SDK instrumentation 或远程收集器前，必须用架构决策记录字段、同意、清洗、失败行为、
成本、保留和回滚。首个扩展点应是宿主或 Streamable HTTP 服务边界；stdio 在无网络环境下
仍可用。这样四个只读工具可以保持可移植，也不会强迫本地用户运行观测后端。
