---
title: 评估矩阵
description: 阻断能力、命令、阈值、证据和回滚责任。
---

# 评估矩阵

先运行范围最小的失败 eval，再运行根产品门。通过结论只对记录的源 commit、运行时、
配置和 artifact 摘要有效。

| 门    | 能力                                  | 命令或证据                                           | 阻断规则                                                                                                            |
| ----- | ------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| E-L01 | 静态分析策略                          | `pnpm run lint` 加 `pnpm run typecheck`              | Oxlint 无 error 或 warning，固定的根策略是唯一 lint 配置，并且编译器检查独立通过。                                  |
| E-Q01 | 重复代码增长                          | `pnpm run duplication`                               | 手写的非测试代码保持在仓库 5% 阈值以内。                                                                            |
| E-C01 | 契约 schema 与规范 revision           | `pnpm run verify:contract`                           | 所有 fixture 和规范化测试通过。                                                                                     |
| E-W01 | Catalog、语言、路由和 artifact 提交   | `pnpm run verify:web`                                | 无遗漏、重复身份、源漂移、现有输出替换或不完整 artifact 可见。                                                      |
| E-M01 | MCP 协议、无状态、路径、Unicode、诊断 | `pnpm run verify:mcp`                                | 所有 package 门通过，客户端与 stderr 错误已脱敏。                                                                   |
| E-N01 | Rust 原生协议探针                     | `pnpm run verify:native`                             | 固定 toolchain、格式、Clippy、locked tests 和真实 stdio `tools/list` 往返通过；这不代表已经满足 R0-R6 parity。      |
| E-I01 | Web 投影由 MCP 消费                   | `pnpm run verify:integration`                        | v1/v2、URL、语言、摘要和四个稳定 tools 一致。                                                                       |
| E-H01 | Codex、Claude Code、VS Code 适配器    | `pnpm run verify:hosts` 加人工 trust 检查            | 命令可移植、在 allowlist 内、不重复且经宿主批准。                                                                   |
| E-S01 | 依赖与仓库策略                        | lock/workflow/host policy verifier 加官方 pnpm audit | 仅批准 registry、固定 action、最小权限且无本地状态。                                                                |
| E-P01 | MCP package 边界                      | `pnpm run pack:mcp`                                  | 预览只包含声明的分发文件。                                                                                          |
| E-X01 | Windows 可执行文件                    | SEA 构建、版本与可执行 smoke                         | 当前源码构建出的 hash 通过协议 smoke。                                                                              |
| E-X02 | 校准冷启动                            | raw、SDK 与产品每类交错运行 100 次                   | 无 error/timeout；产品中位数 <=200 ms、p95 <=350 ms；相对 SDK 的中位数增量 <=35 ms、倍数 <=1.30，p95 增量 <=75 ms。 |
| E-R01 | 候选来源                              | 验收候选 workflow 与摘要读回                         | 构建无特权；提升绑定最新 main、受保护且绑定 commit。                                                                |
| E-R02 | 签名与公开隐私                        | 签名验证与全 refs 身份扫描                           | 签名和公开邮箱策略通过，或有负责人接受的例外。                                                                      |
| E-U01 | 人工验收                              | CP6 记录                                             | 一名负责人在测试 Web/MCP 后接受一个 commit 与摘要集合。                                                             |

## 失败处理

阻断门失败会把交付状态改为 `BLOCKED`，并保存原始证据与回滚。重试必须针对同一源
commit；源码变化会使 CP2 及之后证据失效。`continue-on-error` 可以收集诊断，但不能把
阻断失败改成通过。

## 环境覆盖

CI 证明 clean checkout 行为。维护者还要验证 Windows 原生 Node 25.5、SEA 可执行文件、
真实浏览器桌面/移动布局和原生宿主 trust prompt。脚本独立启动三个命令，不能证明每个
IDE 都避免重复发现，也不能证明用户已接受 workspace trust。
