# 构建与发行总览（build & release）

> **本文是 workflow-agent 构建/打包/安装的单一权威说明**。回答：源码怎么变成插件、发行包里有什么、怎么装进 DSH、改一处要跑什么。
> 项目现状与阶段背景见 [`../status.md`](../status.md)；工程纪律见 [`../development/team-conventions.md`](../development/team-conventions.md)。

**适用基线**：DSH `0.1.5-rc.2` · `@workflow-agent/workflow-host` v0.23.0 **单包双端**（Host 插件 + DAG 面板 bundle + preset 随包）

---

## 1. 全链路总图

```
源（三类）
├── Host 源模块（14 项，code/scripts/module-manifest.js 有序表）
│   ├── code/plugins/workflow-host/{apply-prologue, engine, storage, instance-store,
│   │                                builtin-materialize, webserver-routes}.js
│   ├── code/plugins/workflow-host-preset/tools-preset.js
│   └── code/shared/{schema, parser, paths, validate, edit, zip-writer, items-extract}.js
├── Client 面板源
│   └── code/packages/workflow-host/src/client.js
└── Agent Preset（3+1 件，唯一源）
    └── code/agent-presets/workflow-orchestrator/
        ├── system-prompt.md     # persona 单一源（运行时读取）
        ├── persona-file.mjs     # 运行时读上一行并注册 persona 段
        └── agent.cordis.yml + preset.yml
        │   （agent.cordis.yml 挂载 persona-file.mjs 与 workflow_* 工具行）

生成（单一生成器）
├── code/packages/workflow-host/build.js             # Host：源模块 → CJS 交付物
│   ├── lib/index.js                                 #   ← 运行时真正加载（剥离条件导出块）
│   └── dist/workflow-host.mjs                       #   ← --format=esm 按需（本地测试，不随包）
└── code/packages/workflow-host/build-client.mjs     # Client：src/client.js → lib/client.js
                                                      #   ← 浏览器 bundle（__ModuleLoader__.load）

发行（打包 + 断言）
└── code/scripts/build-release.js
    ├── 跑 ①②（Host 双形态 + Client bundle）
    ├── preset 暂存：code/agent-presets/… → packages/workflow-host/presets/（临时，gitignore）
    ├── npm pack → release/@workflow-agent/workflow-host-<ver>.tgz   # ★ 唯一发行物
    ├── 内容断言（lib/client/monitor-entry/preset 三件套/builtin-assets/cordis.patch…）
    └── 版本矩阵断言（两包 engines 对齐 DSH 0.1.5）

安装
└── code/scripts/install.js --profile web --tgz release
    ├── dsh plugin --profile web add <tgz>           # 真实副本进 profile node_modules
    │   （cordis.patch.yml 双行：workflow-host Host 行 + ui-workflow-monitor Client 行）
    └── preset 三/四件套 → ~/.dsh/.agent-presets/workflow-orchestrator/

生效
├── Host 改动 → 重启 dsh.service
└── Client/面板改动 → 刷新浏览器页面
```

## 2. 单包双端的构成

一个 npm 包同时承载两端，DSH 按上下文分别消费：

| 上下文 | 加载入口 | 内容 |
|---|---|---|
| **Host 进程** | 包 `main`（`lib/index.js`，CJS） | 引擎 + `workflow_*` 十工具 + `/wf/*` 路由（经 `cordis.patch.yml` 的 `workflow-host` 行挂载） |
| **浏览器** | `dsh.client`（`exports['./client']` → `lib/client.js`） | `conversation.view` DAG 面板（经 patch 的 `ui-workflow-monitor` 行挂载，行名 = bundle 注册 id = 包名） |

> 历史注记：曾为两个包（workflow-host + client-ui-monitor），阶段 3e 合并为单包——依据是官方 client-ui 全系「同包双端」结构（`main` + `dsh.client` + `exports['./client']`）与 `@linxin666/dsh-web-all` 单包 26 行先例。

## 3. 脚本速查（细节见 `code/scripts/README.md`）

| 命令 | 作用 |
|---|---|
| `node code/packages/workflow-host/build.js` | Host CJS 交付物（默认）；`--format=esm` 产 dist 测试输出；`--check` 新鲜度 |
| `node code/packages/workflow-host/build-client.mjs` | Client 面板 bundle |
| `node code/scripts/build-release.js` | 全量构建 + preset 暂存 + `npm pack` + 内容/版本断言 → `release/*.tgz` |
| `node code/scripts/install.js --profile web --tgz release` | 从发行 tgz 安装（插件 + preset，支持 `--dry-run`/`--preset-only`） |
| `node code/scripts/test-host.js` | 567 单测（对准真实交付物，自动重建陈旧产物） |
| `node code/scripts/verify-client-bundle.js` | Client bundle 求值级验证 |

已退役：`sync-modules.js`（两步链）、`build-preset.js`（更早生成器，运行即 exit 1）、`sync-persona.js`（3g 文件化）、`*.ps1`（Windows 时代）——均在 `code/legacy/`。

## 4. 部署语义（生效方式）

| 改动 | 生效方式 | 原因 |
|---|---|---|
| Host 源模块 / 路由 / 探针 | 重启 `dsh.service` | CJS 交付物在进程启动时加载 |
| 面板 UI（`src/client.js`） | 刷新浏览器页面 | bundle 按页面加载读取 |
| persona 提示词（`system-prompt.md`） | 重部署 preset（`install.js`）→ 新建/重载 preset 会话 | 运行时由 `persona-file.mjs` 读取 |
| profile 插件增删 | 重启 `dsh.service` | composition 树重启时重建 |

## 5. 常见坑（历史事故索引）

| 坑 | 规则 | 事故记录 |
|---|---|---|
| 双份代码（源 + 内联副本）漂移 | 阶段 3 起单一生成器从源直出，**禁止**手编任何生成物 | Iter-8/24 漏同步翻车；`build-preset.js` 覆盖事件 |
| Client bundle 注册 id 必须等于包名 | `__ModuleLoader__` 按 bundles 列表包名核对注册 | 阶段 3 单包化后 `…/monitor` 子路径 id 启动报错（已修） |
| 安装器 preset 清单必须随功能演进 | 阶段 3g 漏 `persona-file.mjs` → preset 断链 | 单包化验收发现（已修） |
| 停止类操作不依赖注入通道 | 0.1.5 注入不保证即时性 | 阶段 3 缺陷 #7（面板 Stop v4） |
| CJS 产物必须剥离条件导出块 | 否则 `apply()` 后 `module.exports` 被覆盖 | 阶段 2 验证报告（生成器已内建剥离） |
