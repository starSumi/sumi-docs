---
title: 检查点协议
description: 与 commit 绑定的交付阶段、证据、失效规则和 controller 边界。
---

# 检查点协议

Checkpoint 是不可变证据记录，不是实时数据库，也不是一组未经验证的声明。已完成记录
由 GitHub checks 和候选 artifact 保存；本页只定义其必需结构。

## 交付阶段

| ID  | 阶段           | 退出证据                                             |
| --- | -------------- | ---------------------------------------------------- |
| CP0 | 范围冻结       | 负责人、权限、PRD 范围、源 commit 和回滚边界         |
| CP1 | 设计接受       | 适用 ADR、公开契约、威胁边界和兼容方案               |
| CP2 | 实现完成       | 精确变更路径和 package 局部测试                      |
| CP3 | Package 门通过 | lint、typecheck、单元/集成测试、构建与 package 预览  |
| CP4 | 产品门通过     | 跨产品、安全、宿主、来源、签名和性能结果             |
| CP5 | 候选封存       | 干净 commit、不可变 artifact 摘要、来源和候选 URL    |
| CP6 | 人工接受       | 具名负责人、决定、已接受例外和证据引用               |
| CP7 | 完成提升       | remote refs、release/deployment 标识、读回和回滚证据 |

每条记录绑定 `repository`、`sourceCommit`、`checkpoint`、`generation`、`gateIds`、
不可变证据引用或摘要、阻断项、回滚和下一允许转换。源 commit 或 corpus revision 变化会
使 CP2 及之后记录失效，绝不能静默推进旧候选。

## 转换模型

```text
DISCOVERED -> PLANNED -> IMPLEMENTING -> VERIFYING -> CANDIDATE
           -> BLOCKED -> IMPLEMENTING
CANDIDATE  -> HUMAN_ACCEPTED -> RELEASED
CANDIDATE  -> REJECTED -> IMPLEMENTING
RELEASED   -> ROLLED_BACK -> VERIFYING
```

发布只有一个逻辑写者。提升操作用期望 generation 和已接受源 commit 执行 CAS。CAS 失败
必须阻断提升，不能退化成 last-writer-wins。

## 状态位置

仓库源码保存契约、模板和决策；GitHub 保存评审和与 commit 绑定的 CI 证据；不可变
manifest 保存语料 revision 身份。可变 lease、retry、cursor、process、cache、queue、
SQLite、WAL 和 acknowledgement 必须位于平台用户数据目录，不能进入本仓库、父 `.sumi`
或 Agent 宿主目录。

## 可执行证据

生产 workflow 只有在公共 Pages 读回完成，并在启用远程 MCP 时完成受保护的 MCP
finalization 后，才运行 `scripts/release-checkpoint.mjs observe`。Observer 在同一进程内
采集线上 locator、不可变 manifest、discovery metadata 和 readiness 响应。只有全部
condition 均为 `True` 时，它才生成严格的 CP7 记录，并以
`release-checkpoint-<run-id>-<run-attempt>` artifact 上传。

下载 checkpoint 后，可用 `verify` 将它与期望的 repository、commit、run attempt 和
corpus revision 绑定。维护者可以把手工观测写入已忽略的 `artifacts/`，但 checkpoint
实例不是仓库源码。`observedAt` 只用于诊断，不能充当排序 cursor；run ID、run attempt、
源 commit 和 corpus revision 才构成身份。

CP0-CP4 仍由 Git、PR 和 required checks 提供证据；CP5 是不可变的 acceptance-candidate
artifact；只有具名负责人或受保护 environment 记录接受后才存在 CP6；CP7 是提升后生成
的 checkpoint artifact。这些记录都不授权在只读 MCP server 内保存可变状态。

## 未来受管 controller 门

当前产品不需要后台 controller。只有出现持续 watch、排队 reconcile 或崩溃恢复需求时，
才能通过新 ADR 引入单写者 fencing lease、append-only event、可重建 SQLite WAL 投影、
幂等 replay、CAS 提升和显式 `flush`/`checkpoint`/`shutdown` acknowledgement。

取消应先通过 `AbortSignal` 协同完成，再进入有界硬终止宽限。超时按任务类型配置并通过
测量确定，不能把全局 `10s + 2s` 当成产品不变量。取消、通知丢失/重复、进程死亡、WAL
恢复和过期 fencing token 都不得暴露部分 revision。通知只是 best-effort 唤醒，不是正确性
或 UI 状态来源。
