---
title: 架构
description: 将人类展示层与只读 MCP 数据层分离。
---

网站、MCP 服务端和 corpus contract 是同一个 pnpm workspace 中各自负责的 package。
Web 与 MCP 仍可独立部署，但一次公开产品发布必须把两个 artifact 绑定到同一个提交和
同一个机器投影 revision。运行时共享范围只包括 schema、canonicalization 和
conformance helper。

英文继续使用根路径以保持现有链接稳定，简体中文完整站点位于
`/zh-cn/`。Starlight 的语言选择器可以在对应页面之间切换，主题选择器
支持浅色、深色和跟随系统。它们只影响人类展示层，不改变 MCP manifest
或任一种 MCP 传输。

manifest v1 使用 `zh-cn/getting-started.md` 这类显式路径表示中文机器文档，但不提供
locale 元数据、语言协商或回退。并行发布的 manifest v2 增加稳定文档 ID、显式 locale
与 route、内容摘要、导航数据、来源 provenance 和不可变 revision。

```text
经过审阅的 docs/ + content catalog + OpenAPI
        |
        +-- 一次 publisher 构建
              |
              +-- 渲染页面和 Pagefind
              |
              +-- 完全相同的 v1 + 不可变 v2 投影字节
                             /                    \
                         静态 Web artifact       MCP 服务镜像
                                                   |
                                      一个只读 DocsMcpServer 核心
                                          /                 \
                                       stdio          Streamable HTTP
```

## 所有权

网站负责渲染、导航、可访问性、浏览器搜索和已发布的 corpus 投影。corpus-contract package
负责纯 manifest 校验与 canonicalization。Sumi-Docs-MCP 负责有边界的获取、非执行文档
解析、公开工具、输入校验，以及 stdio 与无状态 Streamable HTTP adapter。

一次绑定提交的 publisher 构建只生成一份机器投影。Web artifact 与服务镜像消费完全相同
的 locator、manifest、文档及 OpenAPI 字节；任何目标都不会独立重新计算第二份投影。

## 地址与客户端模型

稳定文档 identity、source acquisition、浏览器 route 和 MCP endpoint 是四个独立层次。
经过审阅的 `docs/` 文件与 catalog 是事实源。Web publisher 从中生成页面与不可变语料
snapshot，MCP 从中生成只读查询面。Agent 宿主是 MCP client，不是另一份内容权威。

stdio 在第一次内容工具调用时加载语料。Streamable HTTP 在开始监听前完成一次有边界的
snapshot 加载，再为每个请求创建新的协议服务实例；这些实例只共享当前进程中不可变的
只读 snapshot。两种 transport 都不保存客户端或对话状态。

本地目录 snapshot 没有 wire revision。因此，只有 MCP 服务通过 Web publisher 的不可变
v2 manifest 获取语料时，才强制校验 revision 相等。本地 source 模式由集成测试对照经过
审阅的 catalog 和工具契约，不另造第二套 revision 算法。

## Workspace 边界

workspace 让 producer 与 consumer 的契约变更可以原子提交，但不会合并信任模型。Web
不导入 MCP parser 或 transport，MCP 也不执行 Astro 或受信 MDX。经过审阅的 content
catalog 是站点导航和投影成员的唯一事实源。

## MDX 信任边界

只有经过审阅的 MDX 才能进入网站构建，因为 Astro 会执行受信任的组件表达式。Sumi-Docs-MCP 将已发布的 MDX 当作文档数据解析，不执行 JSX 或 JavaScript。
