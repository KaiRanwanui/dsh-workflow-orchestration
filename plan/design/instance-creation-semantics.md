# 实例创建语义与生命周期决策

**日期**：2026-08-28（v2：并入产品流程映射与用户拍板决策）
**状态**：v2 已定稿（用户审查通过）
**关联**：`multi-instance-session-design.md`、`architecture-decisions.md` §6、Iter-11/12 报告

---

## 1. 核心语义：实例目录 = 一次编排运行的完整种子

```
instances/<workflowName>-<uuid8>/
├── instance.yaml   ← 当次运行的定义快照（源 + params 注释头）
├── metadata.json   ← 溯源：sourcePath / params / sessionId / sessionCwd / createdAt
├── state.json      ← 运行状态
└── output/ logs/   ← 产物与日志
```

实例目录不是"会话的工作区"，而是**一次编排运行的完整种子**。关键性质是**可复现性**：

- 源 YAML 后来被修改甚至删除，实例快照不变；`workflow_start` / `workflow_reset` 重跑的是"当时固化的定义+参数"；
- `workflow_reset` 能"清状态重跑"正因快照独立于源存在。

**推论（惰性创建）**：创建目录 = 固化一次运行的定义。session 刚创建时没有定义与参数，无东西可固化——因此实例目录跟随显式创建动作出现，而非 session 创建时出现。

## 2. 模板与实例严格区分（v2 定稿）

**实例 = 模板 + 配置**。两者是不同的东西，全程不混用：

| | 模板（template） | 实例（instance） |
|--|--|--|
| 本质 | 只读的流程定义源头 | 模板的一次固化运行种子 |
| 载体 | YAML 文件（位置不强制约定） | 实例目录（`instance.yaml` 快照 + 状态 + 产物） |
| 可变性 | 可被编辑器编辑，但**已建实例不受影响** | CREATED 状态可编辑写回快照；RUNNING 禁编辑 |
| 关系 | 编辑器读模板 → 创建实例 | metadata.sourcePath 反向溯源到模板 |

编辑器双模式（Iter-13 范围修订）：
1. **模板模式**：打开模板 YAML 编辑 → 保存后用"创建实例"实例化；
2. **实例模式**：打开实例的 `instance.yaml` 编辑 → CREATED 状态写回快照（metadata 记 `updatedAt`）；RUNNING 状态禁止保存（提示先 stop/reset）。

## 3. 实例生命周期状态机

```
（不存在）
   │ 创建动作（workflow_create / workflow_begin / 面板按钮）
   ▼
CREATED        有快照，未启动（无 state.json）；可编辑快照
   │ start / begin
   ▼
PENDING ──→ RUNNING ──→ COMPLETED / FAILED
               │ stop
               ▼
            STOPPED ── 用户说"继续"→ 编排 Agent hydrate 续跑（不清进度）
                     ── 用户说"重跑"→ workflow_reset（全新 PENDING）
```

- 状态判定以**磁盘**为准（`entryStateOnDisk`）。
- **"继续"语义**：无需新工具——引擎 hydrate 已支持从磁盘状态恢复（DSH 重启后的惰性恢复即同机制），编排 Agent 读 `workflow_status` 快照按 runnable 继续推进。缺的只是 persona 教学（v0.5.0 persona 第 7 步已含 STOPPED 约束，续跑教学在 Iter-16 面板控制时一并补）。

## 4. 为什么不在 session 创建时自动建实例目录

（v1 结论维持）双重否决：**信息不完备**（无定义可固化）+ **preset 判断耦合链**（依赖方向反转 / 静默失效面 / 职责越界）。**显式调用是唯一不需要耦合的身份信号。**

## 5. 产品流程映射（v2 新增，用户 7 步愿景）

| # | 流程 | 底座 | 缺口/迭代 |
|--|------|------|----------|
| 1 | 创建编排 Session | preset（session 创建零磁盘副作用） | 无 |
| 2 | 面板创建 workflow，可选模板 | Iter-14 create 按钮 | 模板库 v1（§6.1） |
| 3 | 编辑节点/关系/参数/技能/门控/输入输出 | Iter-13 编辑器 | 双模式 + 严格区分（§2，Iter-13 范围修订） |
| 4 | 面板启动执行 | — | **Iter-15 技术穿刺** → Iter-16 面板控制（§6.2） |
| 5 | DAG 展示 + 停止/继续/重跑 | Iter-12 展示；stop/reset 工具有 | 面板控制走 §6.2 通道；"继续"见 §3 |
| 6 | 获取输出/过程文件 | 文件已在实例目录落盘 | 面板产物列表（小，随 Iter-16 或独立小迭代） |
| 7 | 归档/删 session 不删文件 | 天然自洽（文件在用户工作区） | 孤儿实例语义（§7） |

## 6. 面板控制与模板库（v2 定稿）

### 6.1 模板库：v1 从简，演进留路

**v1 实现（并入 Iter-14）**：
- 内置少量基础流程模板（随插件分发，用户编辑创建）；
- 约定可选扫描目录 `<cwd>/templates/*.yaml`——用户自行放入，或从指定 git 仓下载（下载能力后置）；
- 面板表单提供"从模板新建"入口：选模板 → 参数替换 → 走 POST /wf/create。

**演进路径（不设时限）**：UI 指定本地目录 / git 仓拉取 / 服务端模板管理。涉及本地文件读取、上传服务端等问题，均后置。

### 6.2 面板控制通道：Client → Host → session 指令注入

**决策（用户拍板）**：做**技术穿刺**，稳妥优先。面板 start/stop/继续在原理上同构：Client 发消息 → Host → 向指定 session 注入指令。

- **Iter-15（技术穿刺，动态插件形态，先例 Iter-9）**：验证 DSH 是否支持插件向指定 session 注入用户消息/指令。产出 go/no-go 结论 + 可用 API 形态。
- **Iter-16（面板控制，依赖 Iter-15 = go）**：面板 start/stop/继续按钮，走注入通道驱动编排 session；"继续"按 §3 语义。no-go → 维持"面板只 create，控制走 session"。
- **架构预留（后话，已立项注记）**：任务失败后对**局部任务**启动 subAgent 重新执行、执行状态局部刷新总状态——要求注入通道是**通用指令消息**（如 `{type: "rerun-task", taskId}`）而非硬编码 start/stop。Iter-15 穿刺时按通用消息形态验证。

### 6.3 创建动作定稿

**边界：面板按钮只 create，不 start**（start 的驱动者是 session 内编排 Agent；面板 start 待 Iter-15/16 通道打通后再议）。

| 动作 | 载体 | 语义 |
|------|------|------|
| 预建（不启动） | `workflow_create` 工具 / 面板 POST /wf/create | 校验定义 → 建快照目录 → CREATED |
| 新建并启动 | `workflow_begin` | create + start 一步到位（编排主路径） |
| 启动已有 | `workflow_start` | 读实例快照 → PENDING + runnable；RUNNING 拒绝 |
| 从模板新建 | 面板"模板→实例"（v1 §6.1） | 模板内容经 params 替换后走 create；模板不受影响 |

## 7. 孤儿实例语义（v2 新增）

**实例所有权 = cwd，session 只是"当前驱动者"**。归档/删除 session 后：文件不动（工作区文件，DSH 删 session 不触文件系统）；实例仍在 `/wf/list` 中列出；同 cwd 新 session 可接管（forSession 惰性恢复按 createdAt 最新兜底）。metadata.sessionId 记录的是"创建/最后绑定它的 session"，仅供溯源，不构成所有权。
