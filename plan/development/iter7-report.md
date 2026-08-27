# Iter-7 报告：并发执行引擎 + DAG 并发组可视化

> 对应 `progress-record.md` §9（Iter-7 交付）
> 迭代计划：`plan/development/development-plan.md`（Iter-7）

---

## 1. 交付概要

| 项 | 值 |
|----|-----|
| 目标 | 并发执行引擎（就绪计算 + max-concurrency）+ DAG 并发组可视化 |
| 状态 | ✅ 完成并验证 |
| 提交 | `c6b140f`（核心）+ `ff3a334`（system-prompt）+ `1b2ece0`（修复）+ `ec1f0f0`（DAG 可视化） |
| 单测 | 59 通过，0 失败（原 50 + 新增 9） |

---

## 2. 目标与范围

### 2.1 计划范围（development-plan.md Iter-7）

- engine 就绪队列 + 并发调度器（Task 完成 → 检查就绪 → 按 max-concurrency 启动新 Task）
- system-prompt 并发策略
- dag.js 并发状态显示（多个 Task 同时蓝色）
- workflow-schema 确认并发语义

### 2.2 实际交付

| 项 | 说明 |
|----|------|
| 核心 | `getRunnableTasks()`：就绪 = 前驱全 DONE/SKIPPED，槽位 = maxConcurrency - 当前 RUNNING；snapshot 输出 `runnable` 列表 |
| schema/parser | 工作流级 `max-concurrency` 字段（默认 1=串行，>1 并发） |
| engine | `begin` 存 `dependsOn` + `maxConcurrency`；`hydrate` 恢复这两者 |
| system-prompt | 执行模型 v1 串行 → v2 并发（以 `runnable` 为准，可并行启动多个 subagent） |
| DAG | **并发组可视化**：检测 dependsOn 相同的连续任务组，垂直并列 + 虚线线框 + 箭头指向后继 |

---

## 3. 修改清单

| 文件 | 改动 |
|------|------|
| `code/shared/workflow-schema.js` | `DEFAULTS` 加 `maxConcurrency: 1` |
| `code/shared/workflow-parser.js` | `parseWorkflow` 解析 `max-concurrency`（校验 >=1 整数）+ return 加 `maxConcurrency` |
| `code/plugins/workflow-host/engine.js` | ① `begin` 存 `dependsOn`+`maxConcurrency` ② `getNextRunnableTask` 升级为 `getRunnableTasks` ③ `hydrate` 恢复两者 ④ snapshot 输出 `runnable`+`maxConcurrency` ⑤ taskSnapshot 输出 `dependsOn` |
| `code/agent-presets/workflow-orchestrator/workflow-host.mjs` | 同步 engine + parser + schema 的内联副本 |
| `code/agent-presets/workflow-orchestrator/agent.cordis.yml` | persona 执行模型 v1 串行 → v2 并发 |
| `code/packages/client-ui-monitor/src/client.js` | DAG 并发组检测 + 垂直并列 + 虚线线框 + 箭头 |
| `code/packages/workflow-host/lib/index.js` | 构建产物（build.js） |
| `code/packages/client-ui-monitor/lib/client.js` | 构建产物（build.js） |
| `code/scripts/test-host.js` | 新增用例 6（9 断言）：并发/串行依赖/FAILED 前驱 |

---

## 4. 验证结果

### 4.1 Node 单元测试

| 用例 | 断言数 | 结果 |
|------|--------|------|
| 用例 1~5（原有） | 50 | ✅ 全部通过 |
| 用例 6（新增） | 9 | ✅ 全部通过 |
| 用例 6 覆盖 | 无依赖并发（max-concurrency=2 同时就绪 A/B）、槽位动态释放、串行依赖链、FAILED 前驱不放行 | ✅ |

### 4.2 DSH 在线验证（concurrent-demo 工作流）

| 步骤 | runnable 结果 | 正确 |
|------|--------------|------|
| 初始（max-concurrency=2） | `[task-a, task-b]` | ✅ 两个无依赖任务同时就绪 |
| task-a → RUNNING | `[task-b]`（槽位 2-1=1） | ✅ |
| task-b → RUNNING | `[]`（槽位占满） | ✅ |
| task-a → DONE | `[]`（task-c 依赖未全满足） | ✅ |
| task-b → DONE | `[task-c]`（依赖满足 + 槽位释放） | ✅ |

### 4.3 DAG 并发组可视化（用户确认）

| 检验项 | 结果 |
|--------|------|
| 并发任务（task-a/task-b）上下并列 | ✅ |
| 虚线线框包裹并发组 | ✅ |
| 线框箭头指向后继节点（task-c） | ✅ |
| 组内节点按状态着色 | ✅ |

---

## 5. 踩坑记录

| 坑 | 现象 | 解决方案 |
|----|------|---------|
| **改了 parser/schema 源模块漏同步内联副本** | `max-concurrency` 未生效（返回默认 1），`runnable` 只返回 1 个任务 | workflow-host.mjs 是 build-preset.js 拼接产物（内联 schema/parser/engine/storage/tools 五个源模块），改任何源模块都需手动同步对应内联副本，再 build.js。已更新 MEMORY 强化此构建链陷阱 |
| 并发组依赖判断需规范化 | `dependsOn` 数组顺序不同导致比较误判 | 用 `dependsOn.slice().sort()` 规范化后 JSON 比较 |

---

## 6. 当前部署状态

```yaml
profile: web (systemd dsh.service)
packages:
  - @workflow-agent/workflow-host (引擎 + 工具 + 路由 + 并发执行)
  - @workflow-agent/client-ui-monitor (DAG 面板 + 并发组可视化)
状态: running
新增能力:
  - max-concurrency 并发执行（getRunnableTasks 就绪计算）
  - DAG 并发组可视化（垂直并列 + 线框 + 箭头）
```

---

## 7. 参考文件

| 文件 | 说明 |
|------|------|
| `plan/development/development-plan.md` | Iter-7 迭代计划 |
| `plan/development/iter6-report.md` | Iter-6（循环错误处理） |
| `plan/architecture/architecture-decisions.md` | 架构决策 |
