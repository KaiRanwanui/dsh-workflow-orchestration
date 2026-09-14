# Iter-27a 报告 — 预定义目录结构与实例化（语义校验前置）

- **状态**：✅ 完成关闭（2026-09-03，用户 GUI 验收通过后收尾；含后补丁且复验通过）
- **版本**：host v0.17.1（主体 v0.17.0 + 后补丁）/ client 不动（v0.6.1）
- **提交**：`300923d`（主体）+ `dd48ff0`（后补丁+收尾），已推 origin/main
- **配套**：`iter27-design.md`（拆分版 27a/27b，四轮拍板落档）
- **背景**：自 Iter-27 拆分（拍板 S1=B）——预定义目录结构调整是 27b 校验双语境锚点的前提

## 设计决议（用户拍板，详见设计稿 §3）

- ① create 关口语义 = **B 硬拦截**（27b 实施本迭代只铺数据通道）
- ② items-from 存在性 = **双语境**：定义语境查模板子目录；实例语境查实例目录及子目录
- Q1 = create 物化静态文件进实例（Q3 绝对豁免后被四点调整收窄至实例层）
- Q2 = templates 每工作流一子目录自包含，samples/ 转纯参考
- 四点静态文件模型：预置定义禁绝对路径（27b 强制）/ create 1:1 复制 / 子目录=实例级同构（相对引用零调整）/ 绝对路径仅 create params 与人工调整两个入口

## 交付

- `code/shared/workflow-paths.js`（新增）：`isAbsoluteishPath` 前移（tools-preset 改调共享）、`isVariablePath`、`resolveStaticPath`（优先目录→两级链，全 miss 回退第一优先）、`presetTemplateDirOf`
- `builtin-skills.js`：物化改子目录布局；items-demo 静态文件迁 `templates/items-demo/inputs/items/`（与 BUILTIN_SAMPLES 参考件并存）；samples/README 重写为纯参考声明；新增 templates/README.md（布局+平铺迁移说明，fs 无删除 API 不自动清理）
- `tools-preset.js`：expandDefinition items 分支改 resolveStaticPath（dirCtx 增 defDir；predefinedRoot 兜底 detectPredefinedRoot）；expandInstanceDefinition 从 meta.sourcePath 推导 defDir；新增 `copyTemplateStaticTree`（递归 1:1 文本复制，排除定义文件，失败收集不阻断）；workflow_create/begin 挂复制并回传 `presetCopy`
- mjs 直编区：`/wf/templates` 子目录下钻（`<子目录名>.yaml` 优先→子目录根第一个 *.yaml）+平铺 legacy+同名子目录赢；`/wf/create` 补复制与 presetCopy；BUILTIN_TEMPLATES items-demo refs 迁移（v1.2）
- persona（system-prompt.md + agent.cordis.yml）：预置模板自包含契约、解析顺序、绝对路径=用户指定直通不改写、presetCopy.failed 转告义务
- 基础设施：sync-modules 登记 workflow-paths（8→9 section）

## 验证结论

- **单测**：387 → 419 → 421 全绿（用例 23 新增 28 项：路径分类五态/presetTemplateDirOf 四情形/resolveStaticPath 优先级五情形/copyTemplateStaticTree 三情形/expandDefinition 实例副本与 defDir 锚点集成/workflow_create 1:1 复制与非 preset 零复制/扫描下钻四情形；用例 18/21 断言随模板迁移与后补丁互斥更新）
- **修复真 bug**：expandInstanceDefinition 的 src 不带 predefinedRoot，resolveStaticPath 初版无 detectPredefinedRoot 兜底 → start 路径预定义端探测丢失（c21 物化用例暴露；已修，与 resolveRefPath 同语义）
- **部署**：sync 9 section → package.json 0.17.0 → build.js（lib 求值级加载通过）→ persona/mjs 三份 cp 至 `~/.dsh/.agent-presets/workflow-orchestrator/`（diff 一致）→ 用户重启 dsh.service
- **GUI 验收（用户执行）**：✅ 四个内建模板（default-demo/serial-demo/items-demo/runtime-items-demo）开箱即用验证通过；后补丁复验通过（items-demo 派发带 item 值、inputs 为空仍跑通、default-demo 不受影响）

## 后补丁：items-from 与 inputs 互斥（2026-09-03，用户提出定义层问题，host v0.17.1）

- **问题**：loop/concurrent 任务把 items-from 文件再声明进 inputs（items-demo ×6、runtime-items-demo ×1）——根因是 integrator 技能（两输入汇总语义）被复用为逐 item 处理器、且派发契约未透出条目值
- **拍板**：互斥约定（items-from=专用条目获取输入，仅用于循环/并发控制，条目值经快照 `_loopItem` 随派发传入子会话；inputs=业务内容来源）；重复声明 27b 记 **W-ITEMS-INPUT-DUP 警告级**；新建专用技能、当轮作 27a 后补丁
- **落地**：模板 7 处重复 inputs 清零（items-demo v1.3）；新建 `item-processor` 技能（按派发 item 值处理+empty 空清单占位；integrator 保持两输入汇总）；persona 派发契约补「迭代任务 prompt 带 `item = <_loopItem>` 行」；c21 断言随新形态更新并加 default-demo 防误伤断言

## 边界与遗留（已定归属）

| 项 | 归属 | 说明 |
|---|---|---|
| 语义校验引擎+workflow_validate+create/start 关口 | **Iter-27b**（下一迭代，设计已确认） | E-ABS-IN-DEF（preset 禁绝对路径）、E-DEP-CYCLE、缺 processor/gate checker 升错误级、create 硬拦截（拍板①=B） |
| 手工预置子目录完整性校验 | Iter-27b | 27a 不拦（无校验引擎）；内建四模板迁移后自身自包含 |
| 旧平铺模板残留清理 | 用户手工 | templates/README.md 说明；下拉已同名去重子目录赢 |
| 绝对路径可填范围限制 | backlog | 四点④"未来可能限制" |
| 物化仅文本文件 | 局限声明 | fs 服务 readText/writeText 无 copy/delete（Iter-26 先例延续） |
