# 阶段 5 待优化问题列表（非阻塞）

> 记录本阶段使用工作流过程中发现的**非阻塞性**问题（不影响流程跑通与正确性，但影响体验/质量）。
> 每条：现象 → 初步分诊 → 去向。阻塞性问题走 findings.md 即时分诊；本列表条目由用户在规划迭代时择机开单。
> 规约：追加式记录，条目编号 O-N 不复用；修复后标状态，不删除条目。

| # | 发现日期 | 场景/工作流 | 现象 | 初步分诊 | 去向/优先级 | 状态 |
|---|---|---|---|---|---|---|
| O-1 | 2026-09-22 | sys-design 实例 DAG（Iter-44 验收时） | 节点间连线存在交叉、且被任务节点遮盖。典型：func-impact、dfx-analy、sr-def 图元之间——sr-def 有双上游（func-impact + dfx-analy），两条入边交叉；边绘制层级低于节点，穿越/被压在图元下 | client 渲染问题：①布局未对分叉点做防交叉处理（sr-def 双依赖是最小复现）；②边与节点的 z-order/绕行策略缺失。纯前端 DAG 布局与绘制顺序调整，不涉及 host | 与其他 DAG 视觉优化合并开迭代（可与待定迭代 52~55 的能力项分开单排一个小迭代） | 待开单 |
| O-2 | 2026-10-03 | 全局页签门控（阶段 6 MIG3 / B6） | 非编排会话下可能出现空的 Workflow 页签（label 静态，内容已正确门控为 null）。根因：0.2.0 sessions 快照删除 `current` 字段且订阅不推送切换通知，插件不可见"当前会话"，旧「按当前会话注销」架构死锁（详见 `../phase-6-dsh-020-migration/iterations/iter-migration-020rc2-regression-report.md` §2） | client 侧：考究 0.2.0 slot label 动态化（`label: () => wfSessionActive ? 'Workflow' : ''` 的宿主重求值时机）或宿主新的页签隐藏 API；哨兵复活语义保留 | 与其他 client UI 优化合并开迭代 | **已解决**（阶段 6 Iter-MIG5：事件驱动门控，见 phase-6 iterations/iter-migration-020rc2-mig5-report.md） |
| O-3 | 2026-10-04 | 阶段 6 终验 #2 | workflowPath 相对路径支持已由 MIG7 修复（两级链），但**默认搜索优先级**需用户确认现实现符合预期（当前工作空间 > 插件预置目录） | host 已修（v0.29.2）；验收确认后关闭 | 验收复验 | 待复验 |
| O-4 | 2026-10-04 | 阶段 6 终验 #3 | Workflow-Orchestration 会话切换后 DAG 面板有 1~2s 时延，短暂显示上一会话 DAG | client 实例状态切换的过渡态（拉取/指纹比对窗口）；可加 loading 遮罩或 keyed 重置 | client UI 优化迭代 | 待开单 |
| O-5 | 2026-10-04 | 阶段 6 终验 #4 | 源码模式校验/保存按钮深色主题下文字不可见（填充与文字均灰白） | client 按钮配色硬编码未随主题 token；与表单模式按钮配色对齐 | client UI 优化迭代（可与 O-4 合并） | 待开单 |
| O-6 | 2026-10-04 | 阶段 6 终验 #5 | 表单模式：gateChecker 选技能保存后改「（无门禁）」，无效的 on-failure/max-retries 不隐藏；未保存切换时 max-retries 不隐藏 | client 表单联动状态机缺陷（gate 字段组显隐逻辑） | client 缺陷迭代 | 待开单 |
| O-7 | 2026-10-04 | 阶段 6 终验 #6 | design-init 门禁重入不严格：①读已存在 output 而非重查工作目录（改 PRD 名后未重检）；②结论写 logs/gate-xxx-0.md 加 -0 后缀而非覆盖任务定义的 output；根因是门禁评审 prompt 指示（「读取上述输出文件」「写入以下路径」）引导 LLM 走捷径 | host 门禁评审 prompt 构造（webserver-routes/tools-preset 的 gate 派发文案）：检查对象应指向原始输入/工作目录产物，结论路径应为任务定义 output；prompt 需显式「不得引用上轮门禁结论」 | host 功能迭代（与阶段 5 门禁磨炼合并） | 待开单 |
| O-8 | 2026-10-04 | 阶段 6 终验 #7 | inputs 为 KV 风格而 outputs 为纯 V 列表，风格不统一；inputs KV 的优势需评估 | schema v1 设计取舍（inputs KV 支持同名多输入映射到技能参数名）；改 outputs 为 KV 属破坏性 schema 变更，需专项讨论 | schema 演进讨论项 | 待讨论 |
| O-9 | 2026-10-04 | 阶段 6 终验 #8 | 编辑校验未核对并发组/循环组任务 outputs 文件名中 `${var}` 占位符的变量名与 items-var 是否一致 | validate 增强（E 级或 W 级待定）：outputs 展开值含 `${未声明var}` 时提示 | host 校验增强迭代 | 待开单 |
| O-10 | 2026-10-04 | 阶段 6 终验 #9 | `${wf_dir}`/`${skill_dir}` 等变量仅在实例文件填充，未传入技能（skill 运行时 prompt 中不可用） | tools-preset 派发 prompt 构造：将实例级目录变量注入技能会话上下文（需考虑技能兼容性——变量缺失时的降级文案） | host 功能迭代 | 待开单 |
| O-11 | 2026-10-04 | 阶段 6 终验 #10 | 创建 verify-empty-items 后提示「⚠ 有 1 个任务的执行状态属上一轮定义 · Reset 后对齐」的必要性与文案可读性（用户难理解所指） | client 提示文案与触发条件复核（首次创建不应出现？或改写文案说明「同名模板实例残留状态」） | client UI 优化迭代 | 待开单 |
| O-12 | 2026-10-04 | 阶段 6 终验收尾 | 采纳未绑定会话的实例（如 default-demo），其相对 outputs（output/analysis.md）无 absolutize 基准 → 节点详情文件预览打不开；/wf/skill fallback 已修为明确报错（不再误导指向 normal_ws） | absolutize 需会话 cwd/工作区基准；未绑定实例的基准策略待定（工作区根 or 拒绝 absolutize） | host 功能迭代 | 待开单 |
