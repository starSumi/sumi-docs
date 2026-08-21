---
title: 性能基准
description: Sumi 文档公开的性能测量方法、阈值和参考结果。
---

Sumi 文档将测量方法、环境、阈值与结果一同公开。缺少 source commit 和 workload 的数字
不能作为性能证据。

## 冷启动契约

冷启动基准测量从创建进程到收到第一个有效 `tools/list` 响应的时间。三个对象按带 seed
的随机顺序交错运行，使机器漂移同时作用于产品与基线：

| 对象                      | 用途                                         |
| ------------------------- | -------------------------------------------- |
| Raw SEA responder         | 只测量进程与协议 framing 开销。              |
| 官方 SDK empty SEA server | 测量安装的官方 MCP SDK，不注册产品工具。     |
| Sumi Docs SEA             | 提供 `examples/basic/docs`，并公开四个工具。 |

每次发布测量对每个对象执行 100 次，依次运行，timeout 为 5 秒，并使用有界终止。发布门
要求 error 和 timeout 均为 0；产品 median 不超过 200 ms，p95 不超过 350 ms；相对 SDK
的 median 增量不超过 35 ms、倍率不超过 1.30，p95 增量不超过 75 ms。p99 和 maximum
仅用于诊断，因为宿主调度可能产生孤立 outlier。

## 参考测量 - 2026-08-21

本地可复现测量使用 MCP 源码 commit
[`5bc5b15`](https://github.com/starSumi/sumi-docs/commit/5bc5b15a1038cde2745b61d130e6b9f78c7bb4de)。
被测 executable 由该源码版本构建。后续文档和仓库策略改动没有改变 MCP runtime bytes，
因此该结果是公开参考，不是已验收的 release evidence。发布 workflow 必须在精确候选
commit 上运行同一命令，并保留原始 JSON artifact。

| 环境                    | 值                                                                 |
| ----------------------- | ------------------------------------------------------------------ |
| Runtime                 | Node.js 25.5.0                                                     |
| Platform                | Windows 11 x64，OS build 26200                                     |
| CPU                     | 12th Gen Intel Core i5-1235U，12 个 logical CPU                    |
| Memory                  | 25,480,912,896 bytes                                               |
| Iterations              | 每个对象 100 次，共 300 次                                         |
| 产品 executable SHA-256 | `5be6dbf1ad40177d9c6c8a427217dc2d68dc66cc65966cd86862d0ad8c86cf50` |

门禁指标：

| 对象               |   Minimum |    Median |       p95 |
| ------------------ | --------: | --------: | --------: |
| Raw SEA            |  69.53 ms |  80.91 ms | 103.71 ms |
| 官方 SDK empty SEA | 126.38 ms | 141.27 ms | 179.59 ms |
| Sumi Docs SEA      | 151.80 ms | 167.10 ms | 214.50 ms |

诊断指标：

| 对象               |       p99 |   Maximum |
| ------------------ | --------: | --------: |
| Raw SEA            | 114.17 ms | 564.30 ms |
| 官方 SDK empty SEA | 214.75 ms | 685.79 ms |
| Sumi Docs SEA      | 238.59 ms | 698.93 ms |

全部 300 次测量均为 0 error、0 timeout。

产品相对 SDK 的 median 增量为 25.83 ms，median 倍率为 1.1828，p95 增量为
34.91 ms。当前 E-X02 的全部阈值均通过。

## 复现

先使用锁定 runtime 构建 executable，再执行测量：

```powershell
volta run --node 25.5.0 -- pnpm run build:sea
volta run --node 25.5.0 -- pnpm run benchmark:cold-start --docs examples/basic/docs --iterations 100 --executable artifacts/bin/sumi-docs-mcp.exe --output ../../artifacts/cold-start.json
```

输出包含完整 schedule、seed、executable 与 source digest、运行环境、每个 sample 和策略
判定。`artifacts/` 保持忽略；候选 workflow 会把原始报告作为不可变 run evidence 上传，
而不是把可变测量值提交到文档 corpus。
