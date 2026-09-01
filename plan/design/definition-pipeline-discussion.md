# 流程定义文件技术讨论纪要 — 定义读取/传递全过程与内核缺口

- **讨论时间**：2026-09-01
- **前置状态**：Iter-23（手工停 DSH 会话=权威停止）已关闭并推送（git 39ee656→15108af 到 origin/main，host v0.12.0 / client v0.6.0）；原「六迭代映射」重排提案（归档→定义技能→数据流→编辑器→美化→清理）被用户判定不准确，约定先逐点讨论技术事实、再定迭代计划。
- **后续去向**：本文档是**迭代计划刷新的有效输入**——讨论核实的事实与缺口将映射进四大未收尾块（①定义与执行 ②定义前台 UI ③DAG 美化交互 ④输出归档清理）的迭代拆分。
- **实证方式**：全部结论以当前仓库代码为准（读点清单见附录），关键历史用 git 考古交叉验证；无推测性结论。

---

## 1. 讨论的问题与解答

### 问 1：`.workflow-agent` 目录是创建 Session 时建的吗？谁驱动、文件从哪来？

**结论：不是。** 该目录由 workflow-host 插件（Host 端）在**首个工作流实例创建时**通过 DSH 的 `fs` 服务创建，DSH 本体不知道它的存在。入口有三个：编排 agent 调 `workflow_begin` / `workflow_create` 工具，或面板 `POST /wf/create`。首次创建先物化骨架 `<会话工作区>/.workflow-agent/{instances/, archive/}`。

- 每实例结构：`instances/<实例id>/` 下 `instance.yaml`（定义快照+注释头）、`metadata.json`（绑定映射）、`state.json`（引擎状态）、`output/`、`logs/`。
- **没有 copy 安装动作**：所有文件由插件当场生成。模板来源=插件代码内建 2 个 + `<工作区>/templates/*.yaml` 扫描。
- **`skills/` 不是插件装的**：它就是工作区里的普通目录（谁建谁维护），定义只引用 `skills/xxx/SKILL.md` 相对路径，插件解析期逐级上探解析为绝对路径。
- 插件本体安装：npm 包经 web profile 的 `dependencies link:` + `dsh.profile.bundles` 挂载；编排会话另有 `~/.dsh/.agent-presets/workflow-orchestrator/` 预设（内联同源 mjs）。

### 问 2：编排会话有没有类似 CLAUDE.md / AGENTS.md 的指令文档？如何安装、是否每会话一份？

**结论：有，就是 agent preset。** 位置 `~/.dsh/.agent-presets/workflow-orchestrator/`，三个关键文件：

| 文件 | 作用 |
|---|---|
| `agent.cordis.yml` | **真正生效**的 DSH 组合；persona 行内联了完整指令文本 |
| `system-prompt.md` | 同一文本的可读源文档（人评审/维护用），本身不直接生效 |
| `preset.yml` | 预设元信息（名称/描述） |

- 安装=目录放进 `.agent-presets/` 即被 DSH 识别；创建会话时选用该预设，persona 文本作为 system prompt 注入。
- **磁盘只有一份，不是每会话一份实例**：所有用该预设建的会话注入同一份文本；改文档只对**新会话**生效，已有会话不回填。

### 问 3：指令文档里是否硬编码了工作流定义、技能？

**结论：只有协议，没有业务内容。** 不硬编码任何具体定义、模板、技能清单。硬编码的是**执行协议**：

- 工具调用规程（workflow_begin/status/start/stop/resume/reset…）；
- 派发 prompt 构造规则（技能全文 + inputs 字典 + outputs 路径）;
- 控制指令短语表（"请启动/停止/继续/重置实例…"→立即调对应工具，只回一行确认）;
- Stop/Resume 语义（含"resume 时先检查输出文件是否已存在，存在直接标 DONE 不再派发"的约定）。

跑什么工作流、用哪些技能，全部来自运行时工具返回的任务数据。

### 问 4：任务之间 output→input 如何传递？

**结论：文件即接口、LLM 搬运、引擎只管顺序。**

- **引擎不传参数**：`depends-on` 全部 DONE/SKIPPED 才放行下游（`getRunnableTasks`），仅此而已。
- **对齐靠定义作者**：下游 `inputs.spec: output/spec.md` 必须手写成上游 `outputs` 里声明过的路径——引擎**不校验**该 input 是否真有上游产出。
- **路径基准是约定**：解析期只有 processor / gate.checker / items-from 三类被解析成绝对路径；**inputs/outputs 保持 YAML 原文**（如 `output/spec.md`），其基准=实例目录是 prompt 协议约定。
- **实际搬运**（每个任务四步）：agent 标 RUNNING → read 技能全文 → 构造 subagent prompt（粘贴技能 + inputs 绝对路径字典 + outputs 绝对路径）→ 子会话自己 read 输入、write 输出；agent 最后 read 确认输出文件已生成才标 DONE（约定动作，非引擎强制）。

### 问 5：loop / concurrent 的 item 如何获取？

**结论：来自一个纯文本文件，在定义展开期读掉。**

- `items-from` = 纯文本文件路径（解析期从定义文件目录逐级上探）；展开时机在 `workflow_begin`/`workflow_start` 的定义展开阶段——**还没进引擎就先展开了**。
- 读取规则：按行拆分、trim、跳过空行与 `#` 注释行；空文件直接报"定义不合法"。
- 每行=一个 item 字符串；`item-var` 定变量名；展开时 `${item-var}` 注入每个子任务的 processor/inputs/outputs；子任务 id=`原任务id/item文本`。
- loop=子任务串行成链（每个迭代 depends 前一个）；concurrent=并发组（组内独立 max-concurrency）；两者都带 DAG 分组元数据。
- "上游产出当清单"的唯一通道=上游任务写一个行文本文件、下游 `items-from` 指向它。**不支持** YAML/JSON 结构化清单、键值对象 item。

### 问 6：state.json 是否记录 processor 指令原文？

**结论：不记录。** `storage.save()` 落盘的就是 `engine.snapshot()`，任务字段被 taskSnapshot 裁剪：

- **任务级**：id、name、type、dependsOn、status、retries、gateResult + **processor 绝对路径**（代码注释原话："处理器技能绝对路径（Client 读取 skill 文本用）"）+ gate checker 绝对路径。
- **全局**：工作流名、stage、params、maxConcurrency、logs（≤200 条）、error、updatedAt。
- **三个"不存"**：指令原文（技能文本永远只在技能文件里）；**inputs（begin 时即丢弃）**；**outputs（内存 state.tasks 有，落盘时被剥掉）**。
- 完整解析定义（含 inputs/outputs）= `state.def`，**纯内存**，重启即失（hydrate 不恢复）；reset 时从 instance.yaml 重新解析，不依赖它。

### 问 7：技能文本是否只在派发时由主会话读取后发给子会话？

**结论：是，值传递。** 链条：processor 路径随工具 JSON 返回到编排 agent → **派发时刻**主会话用 read 读出技能**全文** → 粘贴进 subagent prompt（一次性文本快照）→ 子会话不再回读技能文件。三个性质：

- 每次（重）派发都重新读 → **技能文件内容改动对后续派发即时生效**（对比：定义按 instance.yaml 快照，改动须 reset——**技能按引用、定义按快照**）。
- gate checker 同理：门禁时刻 agent 读 checker 全文粘给门禁子会话。
- 面板另有独立预览通道 `GET /wf/skill?path=`（Host 读文件文本返回），与派发无关，读同一份文件。

---

## 2. 流程定义的详细处理过程（全旅程）

### 2.1 定义的三种存在形态

| 形态 | 在哪 | 谁写的 |
|---|---|---|
| ① 模板源 | 插件代码内嵌（内建 2 个）/ `<工作区>/templates/*.yaml` | 开发者/用户 |
| ② 实例定义快照 | `<实例目录>/instance.yaml` | Host 插件（创建时原文落盘） |
| ③ 展开后的任务结构 | 内存 → `state.json`（仅状态+路径） | Host 插件（启动时解析展开） |

### 2.2 传递主图（四跳）

```
插件内嵌模板 / templates/*.yaml
   │ ① 浏览器经 GET /wf/templates 获取（内建=拿 YAML 全文可改；工作区=只拿路径）
   ▼
创建表单 ── POST /wf/create（workflowText 或 workflowPath + params + sessionId）
   │ ② Host parseWorkflow 校验 → 原文落盘 instance.yaml + metadata.json（绑定当前会话）
   ▼    （不解析展开、不建 state.json，phase=CREATED；此后模板改动与本实例无关）
instance.yaml ── ③ workflow_start（编排 agent 驱动）：Host 读盘 → 剥注释头 → 解析展开
   │    （再校验 / ${param} 注入 / processor·gate·items-from 绝对路径 / loop·concurrent 展开）
   ▼
内存 tasks → 引擎 begin+start → RUNNING → state.json
   │ ④ workflow_begin/start/status 以 JSON 返回 agent（LLM 从不见 YAML 原文）
   ▼
编排 agent 构造子会话 prompt（技能全文 + 输入输出路径）→ 子会话执行 → 校验输出 → DONE
   → 面板 2s 轮询 GET /wf/status（读 state.json）刷新 DAG
```

### 2.3 关键推论

1. **定义修改的唯一生效途径**：手改 `instance.yaml` + Reset（reset 从它重新解析展开）。启动后改模板不影响已建实例。
2. **技能内容改动即时生效**（派发时现读），定义改动不生效（按快照）——两者生命周期不同。
3. **定义被消费的关口只有两个**：create 时的 schema 校验、start 时的解析展开。两个关口都**不做语义预检**（技能存在性/依赖闭环/items 文件存在/上下游对齐）。
4. **LLM 全程不见 YAML 原文**，拿到的只是展开后的 JSON 任务结构。

---

## 3. 发现的问题（讨论中的关键产出）

按严重度排序，全部已用代码/考古实证：

| # | 问题 | 实证 |
|---|---|---|
| 1 | **工具返回从未携带 inputs/outputs**：workflow_begin/start/status 三个工具返回的都是 `engine.snapshot()`，任务经 taskSnapshot 剥离后无 inputs/outputs 字段；**自首个提交（6b51352）起如此**。而 persona 协议文档写"begin 返回 inputs 命名字典/outputs"——**文档与代码长期不符（契约漂移）** | git 考古 + tools-preset.js workflow_begin/start/status 返回构造 + engine.js taskSnapshot |
| 2 | **引擎对数据流零感知**：inputs 在 `engine.begin()` 即丢弃（不进 state.tasks）；outputs 仅内存不落盘；完整定义 state.def 重启即失 → 引擎层面**做不了**产出校验、上下游对齐检查 | engine.js begin()/taskSnapshot/storage.save() |
| 3 | **传递完全依赖 LLM 补位**：面板创建→启动流程中 agent 没有 YAML 上下文，工具又不返回 inputs/outputs，只能即兴（自己读 instance.yaml / 从技能文本约定推断路径）；直跑流程靠"YAML 恰好还在自己上下文里" | 问 4/问 7 推论 + 问题 1 |
| 4 | **修复无通道**：7fd8648 给 default-demo 模板加的 `inputs.analysis: "output/analysis.md"` 实际没有传递通道，真正起效的是同提交的 depends-on（顺序修复） | 问题 1 的直接推论 |
| 5 | **无产出校验**：输出文件没写出/为空，任务照样可被标 DONE（agent read 确认是协议约定，非引擎强制） | 问 4 |
| 6 | **无语义预检**：create/start 两关口均不检查技能存在性、依赖闭环、items 文件存在、上下游文件名对齐——错只会在运行中爆 | 2.3 推论 3 |
| 7 | **item 能力弱**：仅支持换行分隔纯文本；无 YAML/JSON 结构化清单、无键值对象 item | 问 5 |
| 8 | **路径基准靠约定**：inputs/outputs 相对实例目录是 prompt 层约定，引擎不解析 | 问 4 |

---

## 4. 对迭代计划刷新的输入映射

四大未收尾块与本轮发现的对应关系（供重定迭代拆分时直接引用）：

### 块 1（定义与执行/内核）——本轮发现的主战场

- **最小修复点 A（参数传递地基）**：把展开后的 inputs/outputs 带回 workflow_begin/start/status 的返回（数据在解析结果里现成，只是返回时被剥掉），并同步修正 persona 协议文档 → 问题 1/2/3/4 一次收敛。这是后续一切校验的前提。
- **最小修复点 B（语义预检）**：在 create/start 两关口加检查——技能文件存在性、depends-on 闭环、items 文件存在、上下游 outputs↔inputs 对齐 → 问题 6。
- **最小修复点 C（产出校验）**：基于 A 的 outputs 声明做引擎级存在性/非空校验，DONE 判定有据 → 问题 5。
- **最小修复点 D（item 增强）**：清单来源扩展（YAML/JSON/上游输出）、键值对象 item → 问题 7。
- **最小修复点 E（定义文件管理）**：模板库管理（CRUD+改名+校验）、instance.yaml 修改生效途径的规范化。
- 技能关联（技能清单/注册表）与本块 B 的存在性预检天然同点交付。

### 块 2（定义前台 UI）

- 编辑器写的就是 instance.yaml / 模板两层（2.1 形态①②）；修复点 A 是"编辑器内数据流可视化（把上游输出口连到下游输入口）"的前提。

### 块 3（DAG 美化与交互）

- 节点详情面板（输入/输出/技能/门禁）依赖修复点 A 的数据可见性；item 级展示依赖块 1 的 D。

### 块 4（输出归档清理）

- 与本轮发现基本正交；归档设计方案已有定稿（`workflow-lifecycle-design.md`），清理规则建议等块 1 产物形态稳定后再定。

---

## 附录：实证读点清单（便于复核）

| 事实 | 代码位置 |
|---|---|
| 任务落盘/返回字段裁剪 | `code/plugins/workflow-host/engine.js` taskSnapshot()/begin()（L18-42、L103-125） |
| state.json 序列化源 | `code/plugins/workflow-host/storage.js` save()（L74-92，落 snapshot） |
| 定义解析展开/绝对路径/items 展开 | `code/plugins/workflow-host-preset/tools-preset.js` expandDefinition（L97+）、expandLoopTasks |
| 三工具返回构造 | 同上 workflow_begin（L296+）/workflow_start（L537+）/workflow_status（L385-424），均 `engine.snapshot()` |
| /wf/create 校验+原文落盘 | `code/agent-presets/workflow-orchestrator/workflow-host.mjs` L2904-2958 |
| /wf/templates、/wf/skill | 同上 L2887+、L2959-2978 |
| 面板创建表单传参 | `code/packages/client-ui-monitor/src/client.js` submitCreate（L633-649） |
| 指令文档与协议 | `~/.dsh/.agent-presets/workflow-orchestrator/{agent.cordis.yml, system-prompt.md}` |
| 历史考古 | git show 6b51352（首提交即 snapshot 返回）、eb63bb5（Iter-19 createBind 改造前后） |

### 配套文档

- `workflow-session-state-summary.md` — 状态管理机制技术总结（状态机视角）
- `workflow-lifecycle-design.md` — 生命周期与归档设计
- `dsh-session-subagent-control-research.md` — 子会话控制能力探索
