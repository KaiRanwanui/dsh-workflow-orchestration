# Iter-8 报告：并发语义完善 + concurrent 节点 + DAG 增强

> 对应 `progress-record.md` §10（Iter-8 交付）
> 迭代计划：`plan/development/development-plan.md`（Iter-8）

---

## 1. 交付概要

| 项 | 值 |
|----|-----|
| 目标 | 并发语义完善（组级/工作流级 max 取最严格）+ concurrent 节点 + DAG start/end |
| 状态 | ✅ 核心功能完成并验证 |
| 提交 | `898ce53`（concurrent 节点）+ `8ca2ac0`（DAG 语义）+ `127ec86`/`af7ce10`/`916a2ea`/`d508a15`（视觉优化） |
| 单测 | 65 通过，0 失败（原 59 + 新增 6） |

---

## 2. 目标与范围

### 2.1 设计背景（用户澄清）

交付 Iter-7 后发现对"并发"的理解有偏差，修正如下：
- 依赖同一前驱的多个节点是**独立节点**（碰巧可并发），不是"一个组"，不应线框打包
- 新增 **concurrent 节点类型**：对 items 的每个 item **并发**执行相同操作（类似 loop，但 loop 串行、concurrent 并发）

### 2.2 实际交付

| 项 | 说明 |
|----|------|
| **并发语义** | `getRunnableTasks` 对 concurrent 迭代做**组级并发控制**（组内 RUNNING + 已列入 < 组级 max）与**工作流级 max** 取最严格者 |
| **concurrent 节点** | `type: concurrent`（同 loop 结构：items-from/item-var/processor/inputs/outputs/gate + 自身 `max-concurrency`）；`expandConcurrentTasks` 展开 N 个 item 迭代，迭代**无依赖**（可并发）；engine 存 `_concurrentGroup`/`_concurrentMax` 元数据 |
| **DAG 语义** | ① 依赖同一前驱节点：撤销线框，改垂直排列 ② 新增 start（绿实心圆点）/end（红空心圆圈）节点 ③ concurrent 节点复用 LoopGroupNode（实线 + 进度条 + 状态 + 可展开），标注"⚡ 并发" |

---

## 3. 修改清单

| 文件 | 改动 |
|------|------|
| `workflow-schema.js` | `TASK_TYPES.CONCURRENT` + `REQUIRED.concurrent` |
| `workflow-parser.js` | `normalizeTask` 支持 `type: concurrent`（items-from/item-var/max-concurrency） |
| `tools-preset.js` | `expandConcurrentTasks()`（迭代无依赖）+ workflow_begin 展开分支 |
| `engine.js` | `getRunnableTasks` 组级并发控制（组级与工作流级取最严格）；begin/taskSnapshot/hydrate 存并发组元数据 |
| `workflow-host.mjs` | 同步 schema/parser/tools/engine 内联副本 |
| `client.js` | DAG：撤销线框、start/end 圆形化、concurrent 实线节点（复用 LoopGroupNode）、箭头按动态 centerY 对齐 |
| `lib/index.js` / `lib/client.js` | 构建产物 |
| `test-host.js` | 用例 7（6 断言）：组级并发 + expand 展开 |
| `workflows/demo-concurrent.yaml` | 新增并发 demo 工作流 |

---

## 4. 验证结果

### 4.1 Node 单元测试

| 用例 | 断言数 | 结果 |
|------|--------|------|
| 用例 1~6（原有） | 59 | ✅ 全部通过 |
| 用例 7（新增） | 6 | ✅ 全部通过 |
| 用例 7 覆盖 | concurrent 初始组级 max 放行、RUNNING 后组级占满、DONE 释放槽位、expand 无依赖展开 | ✅ |

### 4.2 DSH 在线验证（demo-concurrent 工作流）

| 步骤 | runnable | 正确 |
|------|----------|------|
| 初始 | `[req-analysis]`（concurrent 迭代依赖 req-analysis） | ✅ |
| req-analysis DONE | `[login, order]`（组级 max=2 放 2，全局 max=4 被组级限制） | ✅ |
| login RUNNING | `[order]`（组级槽位 1） | ✅ |
| order RUNNING | `[]`（组级占满） | ✅ |
| login DONE | `[payment]`（释放槽位） | ✅ |

### 4.3 DAG 展示（用户确认）

| 检验项 | 结果 |
|--------|------|
| start 绿实心圆点 / end 红空心圆圈 | ✅ |
| 依赖同前驱节点垂直排列无框 | ✅ |
| concurrent 节点实线化（进度 + 状态 + 可展开），标注 ⚡ 并发 | ✅ |
| 箭头按动态 centerY 对齐节点中心 | ✅ |

---

## 5. 踩坑记录

| 坑 | 现象 | 解决方案 |
|----|------|---------|
| **改源模块漏同步内联副本** | `expandConcurrentTasks` 等改动需同步到 workflow-host.mjs | 与 Iter-7 相同，构建链陷阱，已多次踩坑（MEMORY 强化） |
| **组级并发分配错误** | 初始 runnable 返回超过组级 max 的迭代（filter + slice 未按组累计） | `getRunnableTasks` 改为按组累计 `gRun + gInResult >= gMax` |
| **节点高度不同导致箭头偏移** | 节点中心不同 → 箭头 y 杂乱 | 统一按最高节点高度动态 `centerY` 垂直居中，箭头 y=centerY |

---

## 6. 遗留（延后修，用户已确认）

| 项 | 说明 |
|----|------|
| 箭头 x 左右两端 | 未完全连接到图元边缘（y 已对齐 centerY，x 边缘连接不完美） |
| 图元内长文字 | 覆盖右上角 ▶/▼ 展开图标（并发实际可展开，图标仅被文字压住） |
| 图元宽度 | 偏窄，后续增加文字内容时需加宽 |

> 用户决定：以上 DAG 视觉细节延后到后续迭代（需增加较多文字内容时）再统一调整。

---

## 7. 当前部署状态

```yaml
profile: web (systemd dsh.service)
packages:
  - @workflow-agent/workflow-host (引擎 + 工具 + 路由 + 并发执行)
  - @workflow-agent/client-ui-monitor (DAG 面板 + 并发语义可视化)
状态: running
新增能力:
  - concurrent 节点（无依赖并发 + 组级 max 限制）
  - DAG start/end 节点 + 并发节点实线化
```

---

## 8. 参考文件

| 文件 | 说明 |
|------|------|
| `plan/development/development-plan.md` | Iter-8 迭代计划 |
| `plan/development/iter7-report.md` | Iter-7（并发引擎） |
| `workflows/demo-concurrent.yaml` | Iter-8 并发 demo |
