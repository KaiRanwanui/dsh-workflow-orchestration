# Iter-25 设计定稿 — 数据流显性化（参数传递地基）

- **时间**：2026-09-02
- **状态**：设计定稿（四项决策点用户已拍板），据此实施
- **输入**：`../requirements/工作流数据管理需求.md`（R15/R16/R20/R21a/R11/R14）+ `../design/definition-pipeline-discussion.md`（缺口 #1/#2/#4）+ `iteration-replan-draft.md` Iter-25 节
- **上游迭代**：Iter-24（两级解析链 resolveRefPath / 预定义目录 / detectPredefinedRoot）

## 1. 目标与范围

修复缺口 #1（工具返回从未携带 inputs/outputs）、#2（引擎零数据流感知）、#4（inputs.analysis 无传递通道）：

| # | 交付 | 落点 |
|---|------|------|
| 1 | begin/start/status 返回任务带 `inputs`（命名字典→绝对路径）、`outputs`（绝对路径数组）、`skillDir`；同步落盘 state.json | engine.js |
| 2 | 目录变量 `${workspace}/${wf_dir}/${skills}/${skill_dir}` 展开期注入（与 `${param}`/`${item}` 同一 `PARAM_PATTERN`） | tools-preset.js |
| 3 | 门禁拿 inputs+outputs（R16）+ 派发附技能来源行（R21a） | persona 协议文档 |
| 4 | processor 可选（创建态可缺省）；**校验挂创建/编辑关口，与执行事件解耦**（D4 修正） | parser/schema/tools-preset 路由 |
| 5 | persona 协议文档同步 + 运行时护栏（processor null 不派发） | system-prompt.md + agent.cordis.yml |

Client（v0.6.1）不动：taskSnapshot 新字段对 DAG 渲染无害；节点详情属 Iter-30。

## 2. 决策记录（用户拍板）

| # | 决策 | 结论 |
|---|------|------|
| D1 | inputs/outputs 相对路径绝对化基准 | **A：实例目录为基准**（现协议约定升格为引擎解析）；workspace 引用用 `${workspace}` 显式表达。现有定义零回归 |
| D2 | 目录变量与 params 同名冲突 | **A：目录变量=保留字，优先于 params** |
| D3 | 无 processor 任务的 `${skill_dir}` | **A：保留占位原样**（用户注：无 processor 属错误定义，理论上不应存在；占位可见便于发现） |
| D4 | processor 缺失拦截范围 | **原则修正：校验挂创建实例、编辑实例关口，与执行事件无关**。begin/start **不拦截**；`workflow_create` 与 `POST /wf/create` 返回结构化 `warnings`（缺 processor / gate 无 checker），实例照常创建；运行时由 persona 护栏（processor null 不派发、报告用户）兜底。原 replan 草案"启动被拦截"验收作废 |
| 默认① | inputs/outputs 进 taskSnapshot | 同时进工具返回与 state.json 落盘（/wf/status 自动带出，Iter-30 节点详情与跨重启可读地基） |
| 默认② | 新字段命名 | `skillDir`（camelCase，与 `gateChecker` 一致） |
| 默认③ | loop/concurrent 与 llm-task 统一 | 同样允许缺 processor（创建警告） |
| 默认④ | legacy 单实例布局（显式 statePath/workspaceRoot） | `${wf_dir}` = statePath 所在目录，无 statePath 回退 workspaceRoot |

## 3. 技术方案：两阶段注入流水线

约束：`workflow_begin` 先 `expandDefinition` 后 `createBind` 建实例目录——`${wf_dir}`/`${skill_dir}` 解析时不存在。

```
阶段1 expandDefinition（现状扩展）          阶段2 finalizeDataflow（新增纯函数）
├─ ${param} + ${workspace}/${skills}        ├─ 注入 ${wf_dir}、${skill_dir}(=dirname(processor)；
│   同一 PARAM_PATTERN 一遍扫描（D2 保留字优先）  D3：无 processor 占位保留）
├─ processor/gate/items-from 两级链解析      ├─ inputs/outputs 绝对化：先注入再判相对，
├─ loop/concurrent 展开（${item} 注入，      │   仍相对的值以 实例目录 为基准拼接（D1）；
│   目录变量占位符原样幸存）                  │   含未解析 `${` 的值跳过（防二次拼接）
└─ parsed 返回                              └─ 产 skillDir 字段（R21a 来源行数据源）
```

- **begin 路径**：阶段1 → createBind/beginInstance（entry.dir 就绪）→ `finalizeDataflow(tasks, {wfDir: entry.dir})` → engine.begin → start。解析失败仍不建实例目录（现状语义保留）。
- **start/reset 路径**：`expandInstanceDefinition` 内 entry.dir 已知，阶段1+2 一次完成。
- **engine**：begin 存 `inputs/skillDir`（outputs 原已存）；taskSnapshot 补 `inputs/outputs/skillDir`（返回+落盘同源）；hydrate 旧格式缺省 `{}/null` 兼容。
- **校验（D4）**：parser 中 processor 缺失 error→**warning**（llm-task/loop/concurrent；gate 无 checker 同 warning）；`workflow_create`/`POST /wf/create` 返回 `warnings` 数组；无任何 begin/start 拦截。Iter-27 语义校验应沿用"创建/编辑关口"原则。
- ** Iter-25 基础设施**：sync-modules 登记补全（workflow-schema/workflow-parser/engine/storage 四个 section 纳入全量 sync），消除"源改了 mjs 没同步"的结构性盲区（webserver-routes 无外部源，本就在 mjs 编辑）。

## 4. 改动面

| 文件 | 改动 |
|------|------|
| `code/shared/workflow-schema.js` | REQUIRED：processor 移出必填 |
| `code/shared/workflow-parser.js` | processor 缺失 error→warning；gate 无 checker warning；normalizeTask 加 warnings 通道 |
| `code/plugins/workflow-host/engine.js` | begin 存 inputs/skillDir；taskSnapshot/hydrate 补 3 字段 |
| `code/plugins/workflow-host-preset/tools-preset.js` | injectParams/injectArray/injectInputsMap 加 vars 形参；finalizeDataflow/absolutizeDataflowPath；begin 阶段2接线；expandInstanceDefinition 阶段2；workflow_create 返回 warnings；工具描述更新 |
| `code/agent-presets/workflow-orchestrator/workflow-host.mjs` | /wf/create 200 响应补 warnings（webserver-routes section） |
| `code/scripts/sync-modules.js` | SOURCES 补 4 个 section |
| `code/agent-presets/workflow-orchestrator/system-prompt.md` + `agent.cordis.yml` | 契约对齐 + 来源行 + 门禁 inputs+outputs + 运行时护栏 + 目录变量说明 |
| `code/scripts/test-host.js` | 用例 20 |
| `code/packages/workflow-host/package.json` | 0.13.0 → 0.14.0 |

## 5. 验证标准（D4 修正版）

**单测**（250 项全绿 + 用例 20）：parser 警告矩阵；阶段1 `${workspace}/${skills}` 注入与占位幸存；阶段2 注入+绝对化四情形（相对/绝对/显式 `${wf_dir}`/`${skill_dir}`）+ D3 占位；begin 端到端 integrate.inputs.analysis 绝对路径、skillDir、state.json 落盘含 inputs/outputs；重启 hydrate 恢复 + 旧格式兼容；stop→reset→start 全链 inputs 保持；loop 迭代 `${item}`+绝对化；workflow_create 返回 warnings 且缺 processor 实例可 start（D4 不拦）。

**端到端（部署后 GUI 验证）**：①default-demo begin 返回可见 inputs/outputs 绝对路径；②integrate 子会话 prompt 真实出现 `output/analysis.md` 绝对路径、门禁 prompt 同时含 inputs+outputs；③派发 prompt 含"本技能全文来自 `<skillDir>`"来源行；④缺 processor 定义经 /wf/create 创建成功且响应含 warnings；⑤既有工作区 workspace 优先解析不回归。

**部署纪律**：全量 `sync-modules.js` → `packages/workflow-host/build.js`（v0.14.0）→ persona 2 份 + mjs cp 到 `~/.dsh/.agent-presets/workflow-orchestrator/` → 提醒用户重启 dsh.service（不自行 systemctl）。
