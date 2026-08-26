# workflow-agent

基于 [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) 的通用工作流编排框架。

> **🚀 从 PoC 到正式开发**：本工程前身为 `software-design-agent`，经 PoC 验证后，
> 项目目标从"软件设计工作流"升级为"**通用工作流框架**"。详见
> [`plan/requirements/需求-从PoC到正式开发.md`](plan/requirements/需求-从PoC到正式开发.md)。

## 定位

workflow-agent 是一个 **DSH 插件工程**，在 DSH 上实现通用工作流的定义、编排、执行、
监控和人工干预能力。它不是 DSH 的修改版，而是通过 Cordis 插件系统扩展 DSH 的能力边界。

## 核心功能

| 功能 | 说明 |
|------|------|
| **工作流定义** | YAML 格式，支持串行/并行/循环/分支条件 |
| **Task 编排** | IPO 模型（输入文件 → LLM 处理 → 输出文件），可指定 Skill |
| **质量门禁** | 每个 Task 可配置独立 LLM 会话的质量检查 |
| **前置条件** | 决定 Task 执行或跳过的条件判断 |
| **执行控制** | 启动、暂停、继续、重试、停止 |
| **实时监控** | DAG 状态可视化、执行日志、Token 消耗统计 |
| **人工干预** | LLM 会话交互界面，用户可随时介入流程 |
| **外部 Agent** | 可集成 opencode、claude code 等第三方 Agent 工具 |

## 工程结构

```
workflow-agent/
├── plan/                          # 项目文档
│   ├── requirements/              # 需求分析文档
│   ├── design/                    # 架构设计文档
│   └── development/               # 开发计划
├── code/                          # DSH 插件开发交付件
│   ├── plugins/
│   │   ├── workflow-host/         # Host 端插件（引擎 + 工具 + RPC）
│   │   └── workflow-client/       # Client 端插件（UI 面板）
│   ├── ui/                        # UI 组件
│   ├── scripts/                   # 工具脚本
│   └── shared/                    # 跨模块共享代码
├── skills/                        # DSH Skill 定义
├── templates/                     # 文档模板
├── bin/                           # 启动脚本
├── PoC/                           # PoC 验证产物（参考）
├── RR/                            # 原始需求（参考）
├── package.json                   # DSH Profile 清单
├── cordis.yml                     # 空根配置（自动管理）
├── cordis.patch.yml               # Profile 定制层
└── README.md                      # 本文
```

## 开发流程

```bash
# 1. 在 DSH 会话中使用 Cordis Plugin API 增量开发验证
cordis_define    # 定义新 Package
cordis_run       # 激活验证
cordis_inspect_self  # 检查诊断

# 2. 验证通过后，固化代码到 code/ 目录
# 3. 迭代下一功能
```

## PoC 验证结论

详见 [`PoC/REPORT.md`](PoC/REPORT.md) 和 [`plan/design/architecture-proposal.md`](plan/design/architecture-proposal.md)。

| 结论 | 结果 |
|------|------|
| Task → 文件 → Gate 数据管道 | ✅ 可行 |
| subagent 隔离 LLM 会话 | ✅ 已验证 |
| 插件 Tool 内编程编排（`subagents.start()`） | ❌ 不可行 |
| **Agent 驱动编排**（模型调 `subagent` 工具） | **✅ 推荐方案** |
| Cordis Client Slot UI + RPC | ✅ 可用 |
| **两层协作**: Agent 编排 + 插件 UI 呈现 | ✅ 通过 |

## 许可证

MIT