# 实例创建语义与生命周期决策

**日期**：2026-08-28
**状态**：已定稿（Iter-11/12 部署验证通过后与用户讨论形成）
**关联**：`multi-instance-session-design.md`（实例=session 总方案）、`architecture-decisions.md` §6、Iter-11/12 报告

---

## 1. 核心语义：实例目录 = 一次编排运行的完整种子

```
instances/<workflowName>-<uuid8>/
├── instance.yaml   ← 当次运行的定义快照（源 YAML + params 注释头）
├── metadata.json   ← 溯源：sourcePath / params / sessionId / sessionCwd / createdAt
├── state.json      ← 运行状态
└── output/ logs/   ← 产物与日志
```

实例目录不是"会话的工作区"，而是**一次编排运行的完整种子**。关键性质是**可复现性**：

- 源 YAML 后来被修改甚至删除，实例目录里的 `instance.yaml` 快照不变；
- `workflow_start` / `workflow_reset` 重跑的是"当时固化的定义+参数"，而非磁盘上可能已变的源文件；
- `workflow_reset` 能"清状态重跑"正因快照独立于源存在（Iter-11：重读 instance.yaml → 全新 PENDING）。

**推论（惰性创建的依据）**：创建目录这个动作 = 固化一次运行的定义。session 刚创建时只有 cwd——没有定义、没有参数，`instance.yaml` 无内容可写、`workflowName` 未知、连 `slug(workflowName)-uuid8` 的实例 id 都无法生成。因此**实例目录跟随首次创建动作出现，而非 session 创建时出现**。

## 2. 实例生命周期状态机

```
（不存在）
   │ workflow_create / workflow_begin   ← 创建动作（唯一入口）
   ▼
CREATED        有定义快照，未启动过（无 state.json）
   │ workflow_start / workflow_begin
   ▼
PENDING ──→ RUNNING ──→ COMPLETED / FAILED
               │
               ▼ workflow_stop
            STOPPED（编排 Agent 不得继续执行；reset 重跑或重新 start）
```

- 状态判定以**磁盘**为准：`CREATED` = 目录有 metadata 无 state.json；其余读 state.json（`entryStateOnDisk`，内存标记会过期）。
- 同一 cwd 多实例并存（uuid8 防撞）；同一 session 重复 begin 产生新实例（begin 是"新建并启动"的快捷方式，create+start 是显式生命周期）。

## 3. 为什么不在 session 创建时自动建实例目录

两个独立理由，任一都足以否决：

### 3.1 信息不完备（语义层）

session 创建时刻没有定义和参数——只能建违背快照语义的空壳目录，且引入复杂状态机（"CREATED 无定义" vs "CREATED 有定义"），弱化可复现性。当前状态机里 CREATED 的含义是干净的："**有快照、未启动**"。

### 3.2 preset 判断耦合（架构层）

自动建目录必须回答"这个新建 session 是编排会话吗"。workflow-host 能接触的身份线索只有 preset id / persona / 工具集，于是必须内置"名为 workflow-orchestrator 的 preset 才建目录"的规则。耦合链：

1. **依赖方向反转**：现在是 preset → 引擎（preset 消费引擎工具），干净；加监听后引擎 → preset（引擎知道具体 preset 存在），通用插件被具体业务身份污染。
2. **静默失效面**：复制 preset 变体、改名 → 判断悄悄失效（不建目录，无报错）；轻量编排变体 → 漏判/误判，往普通会话 cwd 撒目录。
3. **职责越界**：preset 是用户的会话配置选择（会话身份层）；引擎解读它 = 把编排业务管理策略塞进存储层。

**正面原则**：`workflow_create` 是会话内**显式动作**——会话通过调用行为自证"我是编排会话，要这个定义的实例"。零猜测、零配置、任何 preset 可用。**显式调用是唯一不需要耦合的身份信号。**

## 4. 创建工作流的动作定义（定稿）

### 4.1 会话内（已实现，v0.5.0）

| 动作 | 工具 | 语义 |
|------|------|------|
| 预建（不启动） | `workflow_create {workflowPath\|workflowText, params}` | 校验定义 → 建快照目录 → `phase: CREATED` |
| 新建并启动 | `workflow_begin {workflowPath\|workflowText, params}` | create + start 一步到位（兼容既有编排主路径） |
| 启动已有 | `workflow_start {instanceId?}` | 读实例快照 → 解析展开 → PENDING，返回 runnable（编排循环起点） |

### 4.2 面板按钮（Iter-14 规划）

**动作边界：按钮只 create，不 start。** 理由：启动编排必须有驱动者（编排 Agent loop 在 session 内）；面板 start 会制造"有 RUNNING 状态却没有驱动者"的僵尸实例。启动永远由用户在 session 里发起（或未来明确引入"面板 start → 通知 session 驱动"的通道后再议）。

| 项 | 定义 |
|------|------|
| HTTP | `POST /wf/create`（写操作用 POST；现有 /wf/* prefix handler 增加 method 判断 + POST body chunk 收集） |
| Body | `{ workspaceRoot, workflowPath \| workflowText, params }` |
| 行为 | 校验 loopback → 校验定义（parseWorkflow）→ `registry.beginInstance`（复用 workflow_create 工具语义，sessionId 记 null）→ 返回 `{ instanceId, dir, workflowName, phase: "CREATED" }` |
| 失败 | 400（参数缺失/定义不合法，附 workflowBeginErrors） |
| UI | 实例切换条旁"+"按钮 → 弹出表单（工作流路径 + params JSON）→ 创建后切换条即时可见（现有 /wf/list 轮询自动带出） |
| 不做 | 面板 start/stop/reset 按钮（同样受"驱动者"约束；STOPPED 语义不变） |

### 4.3 决策记录

| 决策 | 结论 |
|------|------|
| session 创建自动建目录 | ❌ 否决（信息不完备 + preset 耦合，见 §3） |
| 编排 Agent 开场 create | ✅ persona 约定即可（v0.5.0 已支持） |
| 面板创建按钮 | ✅ 采纳为 Iter-14（只 create 不 start） |
| 面板启动按钮 | ❌ 暂缓（驱动者问题未解，见 §4.2） |
