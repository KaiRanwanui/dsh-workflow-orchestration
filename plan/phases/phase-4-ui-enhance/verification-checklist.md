# 阶段 4 前置 — 全功能人工验证清单

> **用途**：阶段 4 范围定稿前，由用户对当前全部已交付功能做一轮系统人工验证；发现的问题按文末格式开单，开单清单 + `plan.md` 草案候选项合并排序后定稿阶段 4 迭代划分。
> **基线**：DSH 0.1.5-rc.2 · host v0.23.0 单包（2026-09-15 实物验收后形态）。
> **覆盖来源**：根 README 能力表 + 阶段 1/2/3 迭代报告已验收项。可按需裁剪，不必逐项全跑。

## 环境准备

- [x] `systemctl --user status dsh` 正常（Web 3080）
- [x] GUI 打开 workflow-orchestrator 会话，Workflow 页签可见（预设门控生效）

## A. 定义与创建

- [x] 模板创建：弹窗选模板 → 实例创建成功，模板子目录静态文件 1:1 复制到实例目录
- [ ] 【无法验证】文本创建：粘贴 YAML / 指定 workflowPath 创建
- [ ] 【无法验证】校验硬拦：构造缺 processor/缺 items/环依赖等定义 → create/start 被拦，错误清单结构化展示（`[code] 任务 "id" 字段: 原因`）
- [ ] 【无法验证】警告类（W-REF-MISMATCH / W-ITEMS-INPUT-DUP）正常提示不硬拦

## B. 实例编辑器

- [x] 双栏编辑打开、改动后「仅校验」与「保存」行为正确
- [x] 权限矩阵：运行中实例 / 定义只读场景的禁用态正确（readonlyAll / editable.definition）

## C. 执行与编排形态

- [x] 串行链按依赖顺序执行
- [x] 并发组：max-concurrency 生效、组盒展开/收起
- [x] 循环节点：items 四格式（lines/markdown/json/yaml）至少各跑一种；`_loopItem` 注入、迭代命名无「（等待 items）」残留
- [ ] 【无法验证】items 空提取：占位框渲染正确（(0) 形态）
- [ ] 【无法验证】分支条件：条件不满足走 SKIPPED
- [ ] 【未通过】门禁任务：独立会话执行、PASS→COMPLETED 链路真实跑通（0.1.5 环境下尚未复跑过的分支）；FAIL 按 gateOnFailure 处置
- [x] 每个 Task 独立 subagent 会话派发（隔离上下文）

## D. 执行控制四键

- [X] Start：PENDING → RUNNING
- [x] Stop（面板）：主会话**活跃**时 → 主/子会话立即停止，STOPPED 落盘留痕（logs/stop-trace.log）
- [x] Stop（面板）：主会话**空闲**（后台子会话在跑）→ 同样全停（缺陷 #7 修复后的 v4 三通道）
- [x] 会话 UI 停止按钮：与面板 Stop 同效（两时序各验一次）
- [x] Resume：STOPPED → 续跑保进度（已完成任务不重跑）
- [x] Reset：确认框 → 归档备份 `reset_<state>` → 回 PENDING 全新 begin

## E. DAG 面板

- [x] 分层布局：无交叉/无穿盒（收起与展开两态）
- [x] 状态着色与图例条一致；RUNNING/完成/失败/跳过可辨
- [x] 节点点击选中高亮、再点取消；组盒右上角点击展开/收起
- [x] 状态条（S/进度/G/R/error）信息正确
- [x] 合并点正交总线、分支贝塞尔、开始/结束圆帽样式正常
- [x] 轮询刷新无闪烁；实例切换条跟随会话 cwd

## F. 实例管理

- [x] 实例列表 / 会话绑定状态派生（BOUND/DONE/UNBOUND/BROKEN）正确
- [x] 采用（adopt）：池内实例绑定到当前会话；STOPPED 含进度提示语正确
- [x] 孤儿回收：重启 dsh 后死会话实例解绑回池（/wf/list 触发）
- [x] 归档：仅 STOPPED/COMPLETED/FAILED 可归档；归档后会话 DONE
- [x] 归档管理视图：列表 / 打包 zip 下载 / 删除
- [ ] 【无法验证】RUNNING 残留自愈（异常残留标注）

## G. 数据流

- [x] inputs/outputs 绝对路径显性化（任务上报后在状态/定义中可读）
- [x] 【未完整测试】目录变量（${workspace}/${wf_dir}/${skills}/${skill_dir}）两阶段注入正确
- [x] outputs 文件实际产出在实例目录 output/ 下

## H. 预定义资产

- [x] 模板下拉（predefined 链）4 模板可选
- [x] 【部分验证：工作区覆盖未验证】技能下拉：预定义 7 技能；工作区 skills/ 同名覆盖生效
- [x] 物化目录 `~/.dsh/workflow-agent/`（4 模板 + 7 技能 + samples/docs）完整

## I. 边界与恢复

- [x] 重启 dsh.service 后：实例状态恢复、面板正常重连
- [ ] 【无法验证】删除绑定会话（如支持）：实例解绑/先停后解绑行为符合设计
- [ ] 【未通过】非 orchestrator preset 会话不显示 Workflow 页签（门控）

---

## 开单格式建议（缺陷 / 改进点）

| # | 分类 | 位置（页面/操作） | 现象 / 期望 | 严重级（阻塞/一般/打磨） | 备注（复现步骤/截图） |
|---|---|---|---|---|---|
| 1 | 缺陷或改进 | | | | |

> 开单后：与 `plan.md` 草案候选（详情面板/交互增强/主题适配）合并排序 → 定稿阶段 4 迭代划分、目录名与版本号。
## **问题清单**
- reset之后自动执行
- “编排会话空闲等待中：会话内的停止按钮此刻无效。后台任务执行中——要停止工作流请点面板 Stop” 这个提示是否还有必要？现在会话停止按钮、面板Stop点击后的行为是一致的，subagent的停止是立即触发的，不会再出现subagent继续执行到完成并触发主Session继续执行的问题
- 绑定后，再执行出现错误，DAG面板始终未加载出工作流图，一直是"Waiting for workflow..."字样；点击启动/resume，提示“恢复失败: instance not started (CREATED) ”。 实例ID：44d0d90b。【可能是残留数据的问题，其他Session绑定执行没有问题】
- 非 orchestrator preset 会话也会示 Workflow 页签
- 编辑页面processor、gateChecker下拉列表的配色问题：未选中的列表字体颜色跟背景一样，导致未选中就看不到文字。
- 循环/foreach任务的items-from属性未开放配置
- 创建工作流实例后，全局params属性无法修改
- gateChecker未执行

## 后续迭代需规划的内容
- 工作流实例定义全文编辑
- 完整的可执行期编辑属性的编辑、全部属性的呈现
- gatechecker独立subagent执行，发现的错误反馈到下一轮执行，影响output的输出
- 真实技能的使用，output->input/item-form的串联
- 技能中使用目录变量、输入输出变量、item变量
- workflow页签只针对workflow-orchestration会话展示