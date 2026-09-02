# Iter-26 关闭报告：items 结构化提取

**状态**：✅ 已关闭（2026-09-02 GUI 三组验收通过）
**版本**：host v0.15.0（client 未动 v0.6.1）；单测 286 → **349**（+63，零回归）
**设计**：`iter26-design.md`（Q1-Q6+拆分/reset 全拍板）

## 交付明细（设计拍板 7 项）

1. **items-format**：显式声明 `lines|markdown|json|yaml`（非法值 error）+ 扩展名推断（`.md→markdown / .json/.jsonl→json / .yaml/.yml→yaml / 其余→lines`）；`lines` 行文本为兼容逃生门；
2. **提取器**（新共享模块 `shared/items-extract.js`，sync section 位于 workflow-parser 后）：markdown 表格（列名=字段名）> 列表（围栏跳过状态机）；JSON 数组/并列对象/JSON Lines；YAML 数组/并列 map（键恒为 `id`，标量值→`{id:键, name:值}`）；
3. **注入语义**：`${item}` 默认链 ID/编号字段 → 名称字段 → 1-based 序号（英文不区分大小写）；`${item.字段}` 单层标量；`PARAM_PATTERN` 扩展 `/\$\{(\w+(?:\.\w+)?)\}/g` 单遍扫描 + `injectParams` 第 4 形参 `itemCtx`（缺省行为不变）；
4. **空提取→占位迭代**：0 items → 1 个 `<组id>/empty` 占位迭代正常派发，任务名含"items 为空"，`${itemVar}`/`${itemVar.字段}` 注入 `'empty'`（GUI 二轮反馈修正：空串导致 `output/empty/.md` 不可用路径），skill 自行识别空 items；文件不存在/坏 JSON/顶层标量仍报错；
5. **items=启动时刻已存在文件**：start/reset 路径 `expandDefinition` 增 dirCtx 传 `entry.dir`（`${wf_dir}` items-from 可用）；begin 不重排；同运行上游 output 作 items → **Iter-26R 延迟展开**（排 27 前）；
6. **reset 语义修正**：归档备份后清空 output/logs——fs 服务无删除 API（实证 dsh-fs-local 方法面，详见 development-plan Iter-29 平台边界注记）→ 工具/面板返回 `pendingCleanup.cmd`，编排会话按 persona 契约（`[清理契约]`）用 bash 执行；面板 reset 注入通知同样携带命令；
7. **samples/items 四样例 + items-demo 内建模板**（v1.1：六任务=三格式×loop/concurrent，含 inputs，items 经两级链引用预定义 samples，开箱即跑）。

## GUI 验收修复（两轮用户反馈落地）

| 反馈 | 根因 | 修复 |
|------|------|------|
| 一轮：任务"找不到输入" | 模板六任务无 inputs；任务名含字面 `${mod.slug}` 造成"未填充"误判 | 模板补 inputs；name 去字面 |
| 一轮：reset 未清 output | 面板 reset 注入文案固定、不含清理命令 | 注入通知携带 `[清理契约]`+完整命令；system-prompt 契约覆盖工具/通知两路径 |
| 一轮：B 组无法建实例 | 会话↔实例 1:1 绑定（Iter-17/19 设计行为） | 验收指引改为新会话（非缺陷） |
| 二轮：input 路径不存在 | 静态 input 仅绝对化，文件留在 workspace/预定义目录 | **materializeInputsIntoInstance**：begin/start/reset 时静态 input 复制进实例 `inputs/<相对结构>/` 并改写为实例内绝对路径（实例自包含）；上游 output 引用不复制；连带修 resolveRefPath 的 detectPredefinedRoot require 兜底（Node 直测作用域不可见） |
| 二轮：reset 时无 bash 工具 | 编排 preset 未挂 bash | agent.cordis.yml 挂 `@deepseek-ai/dsh-tool-bash` |
| 二轮：归档只有目录无内容 | writeArchiveBackup 只复制顶层文件 | **递归复制**（含 output/logs/inputs）；排障教训：加 fs 形参漏改递归调用行→形参错位→TypeError 被 catch 静默吞掉，须插桩调用行实参才能定位 |
| 二轮：占位输出 `.md` | `${itemVar}` 注入空串 | 改注入 `'empty'` |

## 验证

- **单测**：349 通过 0 失败（用例 21 新增：提取器矩阵/推断矩阵/parser 校验/对象 item 注入/占位迭代/`${wf_dir}` 端到端/inputs 物化/备份递归/reset pendingCleanup）；
- **GUI A 组**（items-demo 新实例）：14 个输出文件逐 item 正确展开——`md-loop/login.md`（标量）、`md-conc/login.md`（`${mod.slug}` 对象字段路径）、`json-conc/api-gateway.md`、`yaml-loop/search.md`（默认链）等；subagent 从实例 `inputs/` 副本正常读取；
- **GUI B 组**（空 items 新会话）：`batch/empty` 占位迭代、任务名"items 为空"、输出 `output/empty/empty.md`、skill 如实写占位产物不虚构输入、COMPLETED；
- **GUI C 组**（reset）：归档备份含子目录文件，编排 agent 以 bash 执行 pendingCleanup 清空 output。

## 设计适配与已知局限

- fs 无删除 API → 清空由编排会话 bash 执行（pendingCleanup 模式，Iter-29 删除/下载同受此约束）；
- items-demo 原"prepare 写 items→output/ → loop 引用"在"items 启动时刻已存在"拍板下必然 start 失败，改为两级链引用预定义 samples；
- 并发语义：组间无 depends-on 即全并行（受 max-concurrency 约束）、loop 组内串行、concurrent 组内并行——用户确认符合预期；
- 表格 item 无 id 字段且 name 中文 sanitize 为空时迭代 id 兜底 `iter-N`（设计行为）；
- 备份递归按文本 readText 复制，二进制文件跳过（既有假设，Iter-29 打包下载一并评估）。

## 后续

**Iter-26R 运行时 items 展开**（组占位节点/组完成语义/下游 `depends-on:[组id]` 修正/DAG 晚现节点）排 Iter-27 之前，动工前先确认设计。
