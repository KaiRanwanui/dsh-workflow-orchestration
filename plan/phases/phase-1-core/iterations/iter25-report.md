# Iter-25 报告 — 数据流显性化（参数传递地基）

- **状态**：✅ 完成关闭（2026-09-02，用户 GUI 验证通过后收尾）
- **版本**：host v0.14.0 / client v0.6.1（本迭代不动）
- **提交**：53f022d（已推 origin/main）
- **配套**：`iter25-design.md`（设计定稿，D1-D4 用户拍板）

## 背景与目标

修复 definition-pipeline-discussion 缺口 #1/#2/#4：工具返回从未携带 inputs/outputs（契约漂移）、引擎零数据流感知、inputs.analysis 无传递通道。交付=工具返回展开后 inputs/outputs+目录变量注入+门禁拿 inputs+processor 可选（校验挂创建关口）。

## 设计决议（用户拍板）

- **D1** inputs/outputs 相对路径以实例目录为基准绝对化；workspace 引用用 `${workspace}` 显式
- **D2** 目录变量为保留字，优先于同名 params
- **D3** 无 processor 任务的 `${skill_dir}` 占位保留
- **D4** 校验挂创建/编辑关口，与执行事件解耦——create 返回结构化 warnings 不拦截；begin/start 不拦截；persona 运行时护栏（processor null 不派发、报告用户）

## 交付

- `engine.js`：begin 存 inputs/skillDir；taskSnapshot 补 inputs/outputs/skillDir（返回+state.json 同源）；hydrate 旧格式兼容（缺省 {}/null）
- `tools-preset.js`：注入函数加 vars 形参（D2）；`finalizeDataflow`/`absolutizeDataflowPath` 纯函数（两阶段注入）；begin 路径实例目录就绪后阶段2接线；`expandInstanceDefinition` 阶段2（start/reset 共用）；workflow_create 返回 warnings；begin/create 工具描述更新
- `workflow-parser.js`：processor 缺失 error→warning（llm-task/loop/concurrent）；gate 无 checker warning；warnings 通道启用
- `workflow-schema.js`：REQUIRED 移出 processor
- mjs `/wf/create` 路由：200 响应补 warnings
- persona（`system-prompt.md`+`agent.cordis.yml`）：数据流契约（绝对路径直接用）、派发首行技能来源行（R21a）、门禁拿 inputs+outputs（R16）、processor null 护栏、create warnings 转告
- 基础设施：sync-modules 登记补全至 7 section（schema/parser/engine/storage 纳入全量同步，消除手工盲区）；顺带修复 begin 路径 `entry.hasState` 未置位潜伏 bug（begin→stop→reset 误拒）

## 验证结论

- **单测**：250 → 286 全绿（用例 20 新增 34 项：两阶段注入/绝对化四情形/D2 优先级/D3 占位/begin 端到端 integrate.analysis 绝对路径/state.json 落盘/重启 hydrate/stop-reset 后 inputs 保持/create warnings/D4 不拦/loop 迭代；用例 10 补路由 warnings 2 项）
- **部署**：全量 sync → build.js v0.14.0（lib 求值级加载通过）→ persona/mjs 三份副本 cp 至 `~/.dsh/.agent-presets/workflow-orchestrator/`（diff 一致）→ 用户重启 dsh.service
- **GUI 验证（用户执行）**：✅ 每个任务的 inputs/outputs 在 subagent 间传递，绝对路径、数值正确；✅ 下游任务能读取上游输出（缺口 #4"无传递通道"修复达成）；✅ 运行时护栏生效——Agent 识别无 processor 任务并向用户询问处理方式（不瞎派发）

## 遗留项（已定归属）

| 项 | 归属 | 说明 |
|---|---|---|
| create warnings 的面板展示 | Iter-28 编辑前台 | 数据通道已通（单测+部署副本验证）；client 本迭代不动，`submitCreate` 无 warnings 渲染逻辑，用户创建时不可见 |
| 缺 processor 升级为错误级校验 | Iter-27 语义校验 | 用户表态（2026-09-02）：缺 processor 是需要修改的问题，不能告警放过；Iter-27 须升级为错误级+实例"需修改"标示，创建拦截 vs 派生状态+启动闸门开工前拍板（已注入 replan draft Iter-27 节） |
