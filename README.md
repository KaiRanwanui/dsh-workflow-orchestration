# workflow-agent

基于 [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) 的**通用工作流编排框架** —— 用 YAML 定义工作流，由 DSH Agent 驱动执行、由插件提供引擎与可视化面板。

> **项目状态**：阶段 1~4 已归档；阶段 5（设计作业流）因设备迁移暂停中；**阶段 6 · DSH 0.2.0-rc.2 迁移（Mac 环境重建）已完成**——恢复阶段 5。
> **当前状态权威 → [`plan/status.md`](plan/status.md)**（阶段表 / 版本基线 / 已知限制 / 下一步）。

---

## 3 分钟了解

| 问题 | 答案 |
|---|---|
| 它是什么 | 一个 **DSH 插件工程**（不是 DSH 修改版）：通过 Cordis 插件扩展 DSH，实现工作流的定义、编排、执行、监控与人工干预 |
| 怎么工作 | **Agent 驱动编排**：编排 Agent 读工作流定义 → 按引擎返回的就绪顺序用 `subagent` 派发每个 Task（独立 LLM 会话）→ 用 `workflow_*` 工具上报进度；Host 插件持引擎/持久化/HTTP 路由；Client 插件渲染 DAG 面板 |
| 当前版本 | host `v0.28.7`（DSH `0.2.0-rc.2`，macOS，603 单测全绿） |
| 现在能做什么 | 定义（YAML + 语义校验）· 编排（并发/循环/门禁）· 执行（状态机 + 停止/恢复）· 呈现（DAG 面板四键 + 实例管理）· 资产（预定义模板与技能开箱即用） |
| 从哪看起 | 本文 → [`plan/status.md`](plan/status.md) → [`plan/README.md`](plan/README.md)（文档地图）→ [`GUIDE.md`](GUIDE.md)（代码结构与机制速查） |

## 核心能力

| 能力 | 说明 |
|---|---|
| 工作流定义 | YAML schema v1：串行 / 并发组（`max-concurrency`）/ 循环与并发节点（items 四格式）/ 分支条件 / 质量门禁 |
| Task 编排 | IPO 模型（inputs → LLM 处理 → outputs）；每个 Task 一个隔离的 subagent 会话；门禁任务独立会话检查 |
| 执行控制 | 引擎状态机（CREATED/PENDING/RUNNING/STOPPED/COMPLETED/FAILED）；Start/Stop/Resume/Reset 四键；权威停止（面板与 UI 停止同级） |
| 实时监控 | `conversation.view` DAG 面板：分层布局、状态着色、执行日志、实例管理（归档/下载/删除） |
| 数据流 | inputs/outputs 绝对路径显性化；目录变量两阶段注入；运行时 items 展开（`_loopItem`） |
| 预定义资产 | 启动时物化到 `${DSH_HOME:-~/.dsh}/workflow-agent/`（0.2.0 起 node:fs 直写，Mac 实证 `~/.dsh-dev/workflow-agent/`）：4+ 工作流模板 + 7+ 技能；模板子目录 1:1 复制到实例目录 |
| 语义校验 | 8 类错误码硬拦（create/start 关口）+ 2 类警告；实例编辑器（双栏 + 权限矩阵） |

## 仓库结构

```
workflow-agent/
├── code/                     # 全部交付代码（见 code/README.md）
│   ├── packages/             #   npm 包：workflow-host（Host 插件）/ client-ui-monitor（Client 面板）
│   ├── plugins/              #   源模块：engine / storage / instance-store / tools-preset / builtin-skills / webserver-routes
│   ├── shared/               #   跨模块共享：schema / parser / validate / edit / paths / items-extract / zip-writer
│   ├── agent-presets/        #   Agent Preset：workflow-orchestrator（persona + composition）
│   └── scripts/              #   构建 / 测试 / 同步脚本
├── plan/                     # 项目管理文档（见 plan/README.md）
│   ├── status.md             #   ★ 当前状态唯一权威
│   ├── phases/               #   阶段归档（phase-0 PoC / phase-1 核心 / phase-2 迁移 + iterations/）
│   ├── design/ architecture/ requirements/   # 现行设计 / 架构决策 / 需求
│   ├── development/          #   团队约定 + 迭代计划与报告模板
│   └── build/                #   构建部署与环境文档
├── PoC/                      # PoC 阶段资产（docs/ 文档 · solutions/ 方案 · legacy-root/ 早期根目录遗留）
└── GUIDE.md                  # 工程导览：代码结构、关键机制、开发流程
```

## 快速开始（开发环境，macOS + DSH 0.2.0）

前置：DSH `0.2.0-rc.2`，开发 home 为 `~/.dsh-dev`（`DSH_HOME` 已导出；`~/.dsh` 属 dsh-desktop 勿混用），Node ≥ 22。

```bash
# 1) 构建三件套（Host CJS + persona 资产 + 面板 bundle）
node code/packages/workflow-host/build.js
node code/packages/workflow-host/build-client.mjs
node code/scripts/verify-client-bundle.js

# 2) 单测（603 用例）
node code/scripts/test-host.js

# 3) 发行打包 → 从打包产物安装（拍板：不直接挂源码目录）
node code/scripts/build-release.js
node code/scripts/install.js --tgz release       # dsh plugin add 自动注册 bundles；preset 随包生效

# 4) 生效：Host 改动重启 dsh web；Client 改动刷新页面
```

> preset（workflow-orchestrator）随包声明（`presets/workflow-orchestrator.patch.yml` 进 bundle patch 链），安装即生效，**无独立部署步骤**。
> 构建链细节与「改哪里 → 跑什么」对照表见 [`GUIDE.md`](GUIDE.md) 与 `plan/build/`。
> 注意：`code/scripts/build-preset.js` 已**废弃**（运行即退出并提示现役构建链）。

## 文档地图

```
README.md（本文） ── 3 分钟了解项目
   ├─ plan/status.md              当前状态（阶段/基线/下一步/已知限制）
   ├─ plan/README.md              文档地图与三种阅读路径
   ├─ GUIDE.md                    工程导览（代码结构、机制速查、开发流程）
   ├─ plan/phases/                阶段归档与迭代索引（30 迭代 + 迁移 5 任务）
   ├─ plan/design/                现行设计（生命周期、schema、通信、状态管理）
   ├─ plan/architecture/         架构决策记录（ADR）
   ├─ plan/requirements/         需求基线
   ├─ plan/development/          团队约定 + 迭代模板
   └─ plan/build/                构建/部署/环境
```

## PoC 验证结论（项目起点）

| 结论 | 结果 |
|---|---|
| Task → 文件 → Gate 数据管道 | ✅ 可行 |
| subagent 隔离 LLM 会话 | ✅ 已验证 |
| 插件 Tool 内编程编排（`subagents.start()`） | ❌ 不可行 |
| **Agent 驱动编排**（模型调 `subagent` 工具） | **✅ 采用方案** |
| Cordis Client Slot UI | ✅ 可用 |
| 两层协作：Agent 编排 + 插件 UI 呈现 | ✅ 通过 |

详见 [`PoC/docs/REPORT.md`](PoC/docs/REPORT.md) 与 [`PoC/solutions/architecture-proposal.md`](PoC/solutions/architecture-proposal.md)。

## 许可证

MIT
