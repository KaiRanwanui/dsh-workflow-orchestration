# 试验作业流定义设计稿

> ⚠️ **WF-1 已由用户定稿并实现**（2026-09-20）：最终为 **12 任务串行链**、输入 `input/PRD.md`（不用 params）、无门禁（Iter-45 引入，锚点 req-review/design-review）。**权威定义见 `workflow_samples/sys-design/sys-design.yaml` + `iterations/iter-44-report.md`**；下方 WF-1 早期 7 任务草稿仅作沿革留档，不再作为依据。
> WF-2（llm-wiki）留待后续阶段，仍为待决稿。

## WF-1 系统分析和设计作业（sys-design）——早期草稿（已被 12 任务定稿取代）

**形态**：7 任务纯串行链，阶段间设门禁（人工确认后放行）——这是典型「阶段门」工程流。

```
[初始需求] → [场景/用例分析] → [功能影响分析] → [系统需求]
           → [功能设计] → [架构元素影响分析] → [分配需求]
```

| id | name | 输入 | 输出 | 门禁 |
|---|---|---|---|---|
| initial-req | 初始需求 | params: 需求素材路径/描述 | output/01-initial-req.md | — |
| use-case | 场景/用例分析 | initial-req 产物 | output/02-use-cases.md | use-case 后 |
| func-impact | 功能影响分析 | use-case 产物 | output/03-func-impact.md | func-impact 后 |
| sys-req | 系统需求 | func-impact 产物 | output/04-sys-req.md | sys-req 后 |
| func-design | 功能设计 | sys-req 产物 | output/05-func-design.md | — |
| arch-impact | 架构元素影响分析 | func-design 产物 | output/06-arch-impact.md | arch-impact 后 |
| req-alloc | 分配需求 | arch-impact 产物 | output/07-req-alloc.md | 收尾 |

**待决点**：
1. **门禁落点**：是否每个分析阶段后都设 gate（串行人工审），还是只在关键三处（用例/系统需求/分配需求）？——影响实战能验证多少门禁体验。
2. **processor**：需要配套技能（分析/设计类 SKILL.md）。是先由助手起草通用版技能（放模板目录随实例物化），还是您已有现成技能/提示词？
3. **initial-req 的输入形态**：走 params（创建时填素材路径），还是第一个任务直接读固定路径？

## WF-2 llm-wiki 知识提取作业（llm-wiki-extract）

**形态**：前置计划 → 并发提取（items 驱动）→ 串行刷新链 → 回写计划（尾任务，可再跑）。

```
[raw 盘点] → [制定提取计划 items] → [提取摘要页面 loop/concurrent] 
                                → [提取对象页面 concurrent]
           → [刷新 index] → [刷新 log] → [刷新 overview] → [刷新提取计划]
```

| id | name | 类型 | items-from | 输出 |
|---|---|---|---|---|
| raw-scan | raw 文件盘点 | 普通任务 | — | output/raw-inventory.md |
| extract-plan | 制定知识提取计划 | 普通任务 | — | output/extract-plan.md（结构化清单，供 items-from 引用） |
| extract-summary | 提取摘要页面 | concurrent | extract-plan 产出的摘要清单 | output/summary/<item>.md |
| extract-object | 提取对象页面 | concurrent | extract-plan 产出的对象清单 | output/object/<item>.md |
| refresh-index | 刷新知识库 index | 普通任务 | — | wiki index 更新 |
| refresh-log | 刷新知识库 log | 普通任务 | — | log 更新 |
| refresh-overview | 刷新知识库 overview | 普通任务 | — | overview 更新 |
| plan-refresh | 刷新知识提取计划 | 普通任务 | — | extract-plan.md 更新 |

**待决点**：
1. **items 链路**：extract-plan 产出结构化清单后，extract-summary/object 用 items-from 指向它——但 items-from 目前读实例目录静态文件（Iter-27a 语义），**执行期任务产物能否直接作 items-from 源**需实测（这本身就是实战要验证的点，失败即入 findings）。备选：先跑一次只到 extract-plan，确认清单文件后人工把它登记为实例 inputs 再继续。
2. **对象提取的输入**：对象页面提取是逐 raw 文件一个对象，还是逐知识对象（跨文件聚合）？决定 items 粒度。
3. **wiki 库位置**：知识库（index/log/overview）的实际路径在哪个工作空间？刷新任务读写它需要对应技能。
4. **processor**：同 WF-1——提取/刷新技能由助手起草还是您已有？

## 共同待决点

- **技能来源**：两条流都依赖配套 SKILL.md。建议助手按「processor = SKILL.md 全文提示词」方式起草通用版（分析类 1 份、提取类 1 份、刷新类 1 份），实战中您再改内容——改技能本身也是实战场景。
- **定义落点**：作为新模板入 `code/packages/workflow-host/builtin-assets/templates/`（随包物化），还是直接放工作空间 `.dsh` 定义目录（不动插件包）？后者更贴近实战（不用重新发行）。
