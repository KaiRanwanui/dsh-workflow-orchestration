# Workflow Definition YAML Schema v1

> 本文定义 workflow-agent 的工作流文件格式。
> 对应 `code/shared/workflow-schema.js` 中的常量定义和校验规则。
>
> **v1.1（当前）**：`inputs` 改为命名式 map（`{key: 单路径 | 路径列表}`），
> 废弃列表形态；key 不校验复数。详见 §4.2。

---

## 1. 顶层结构

```yaml
name: string                     # 工作流名称（必填）
version: string                  # 版本号（必填）
description: string              # 可选描述

params:                          # 工作流参数（可选）
  param_name:                    # 参数名，在字段中用 ${param_name} 引用
    type: string                 # 参数类型
    description: string          # 参数说明
    default: any                 # 默认值（可选）

tasks:                           # Task 列表（必填，至少 1 个）
  - id: string                   # Task ID（必填，工作流内唯一）
    name: string                 # Task 名称（可选，默认同 id）
    type: string                 # Task 类型（可选，默认 "llm-task"）

    depends-on: [string]         # 前驱 Task ID 列表（可选，默认 []）
                                 # 列表中的所有 Task 完成后本 Task 才就绪
                                 # 空列表表示无前驱依赖，工作流启动后即可执行

    timeout: integer             # 超时秒数（可选，默认 600）

    # ── 类型专属字段 ──
    # 以下字段取决于 type 值，见各类型定义
```

---

## 2. Task 类型

### 2.1 `llm-task`（默认）

LLM 处理任务，由 subagent 加载 skill 执行。

```yaml
- id: req-analysis
  name: "需求分析"
  # type: llm-task （默认，可省略）

  processor: skills/analysis/SKILL.md    # 处理技能文件路径（必填）
  inputs:                                # 命名输入 map（可选，v1.1 起仅支持此形态）
    ir_doc: "${input_doc}"               # 单个输入文件（值=路径，可含 ${param}）
    refs:                                # 一组输入文件（值=路径列表，逐项可含 ${param}）
      - "context/ref1.md"
      - "context/ref2.md"
  outputs:                               # 输出文件列表（可选）
    - "output/analysis.md"

  depends-on: []                         # 无前驱，工作流启动后即执行
  timeout: 600

  precondition:                          # 前置条件（可选，后续迭代）
    condition: "${some_var} == true"
    on-skip: "skip"

  quality-gate:                          # 质量门禁（可选）
    checker: skills/req-review/SKILL.md  # 门禁技能文件（必填）
    on-failure: retry                    # retry | block | skip（必填）
    max-retries: 3                       # 最大重试次数（可选，默认 0）
```

### 2.2 `loop`

循环 Task，对 items 列表中的每个元素**顺序执行**一次。

```yaml
- id: batch-process
  name: "批量处理"
  type: loop

  items-from: "${item_list_file}"        # 循环数据来源（必填，文件路径）
                                         # 文件格式：每行一个 item 值
                                         # 空行和 # 注释行被忽略
  item-var: "item"                       # 循环变量名（必填）
                                         # 在 processor/inputs/outputs 中可用 ${item}

  processor: skills/batch/SKILL.md       # 处理技能（循环体，必填）
  inputs:                                # 命名输入，${item} 替换当前迭代值
    item_data: "output/${item}/data.md"
    refs: ["context/a.md", "spec/${item}/api.md"]
  outputs:                               # 输出，${item} 替换为当前迭代值
    - "output/${item}/result.md"

  depends-on: [req-analysis]
  timeout: 300

  quality-gate:                          # 可选，每个迭代独立执行门禁
    checker: skills/batch-review/SKILL.md
    on-failure: retry
    max-retries: 2
```

**执行顺序**（items = ["A", "B", "C"]）：

```
迭代1(subagent, processor) → Gate(A)
    ↓ PASS
迭代2(subagent, processor) → Gate(B)
    ↓ PASS
迭代3(subagent, processor) → Gate(C)
    ↓ PASS
结束（进入下一个 depends-on 指向本 Task 的后继 Task）
```

### 2.3 `human-decision`（后续迭代）

```yaml
- id: approval
  name: "人工确认"
  type: human-decision

  prompt: "请审核上述设计结果，批准请回复 APPROVED"
  inputs:
    - "output/design.md"
    - "output/analysis.md"

  depends-on: [design-complete]
```

### 2.4 `external-agent`（后续迭代）

```yaml
- id: code-gen
  name: "生成代码"
  type: external-agent

  agent: "opencode"
  command: "opencode --input ${in}"
  inputs:
    - "${design_doc}"
  outputs:
    - "output/src/"
```

---

## 3. 执行规则

### 3.1 Task 执行顺序

```
工作流启动
  │
  ↓ 检查所有 Task 的 depends-on
  │
  ├── depends-on=[] 的 Task → 就绪队列（按 tasks 列表顺序）
  │
  ↓
从就绪队列中取出第一个 Task 执行
  │
  ├── llm-task: subagent(processor) → 产出文件 → (quality-gate?) → 完成
  ├── loop: 迭代1 → 迭代2 → ... → 所有迭代完成后 → 完成
  │
  ↓ 标记为 COMPLETED
  │
  ↓ 重新检查所有未执行 Task 的 depends-on
  │
  │  ┌── 有 Task 的所有前驱都完成了？
  │  ├── 是 → 加入就绪队列
  │  └── 否 → 继续等待
  │
  ↓
从就绪队列取下一个 Task → 执行
```

### 3.2 Quality Gate 执行

```
Task 执行完成
  │
  ├── 有 quality-gate 配置？
  │   ├── 是 → 调独立 subagent（加载 checker skill）→ 产出 gate-result.md
  │   │        ↓
  │   │     读取 gate-result.md → PASS 或 FAIL
  │   │        ├── PASS → Task 标记完成
  │   │        └── FAIL
  │   │             ├── on-failure: retry → 重执行 Task（未超 max-retries）
  │   │             ├── on-failure: block → 工作流阻断，通知用户
  │   │             └── on-failure: skip → Task 标记为 SKIPPED，继续
  │   │
  │   └── 否 → Task 直接标记完成
```

---

## 4. 参数注入规则

### 4.1 参数来源

| 来源 | 语法 | 说明 |
|------|------|------|
| 工作流参数 | `${param_name}` | 定义在 `params` 中，启动时赋值 |
| 循环变量 | `${item}` | 循环 Task 中当前迭代的值 |
| 组合 | `output/${project}/${item}.md` | 路径拼接 |

### 4.2 inputs 命名式（v1.1）

`inputs` 是 **map**：`{key: 单路径 | 路径列表}`，**key 不校验复数**，只是给 skill 的引用名。

```yaml
inputs:
  main: "output/${project}/analysis.md"     # 值=字符串 → 单个文件
  refs: ["context/a.md", "context/b.md"]   # 值=数组 → 一组文件
  specs:                                   # 值=多行列表 → 一组文件
    - "spec/${module}/req.md"
    - "spec/${module}/api.md"
```

解析后子 Agent 收到命名字典（值均经 `${param}` 注入 + 相对路径解析）：

```json
{
  "main": "C:/abs/output/projectA/analysis.md",
  "refs": ["C:/abs/context/a.md", "C:/abs/context/b.md"],
  "specs": ["C:/abs/spec/m1/req.md", "C:/abs/spec/m1/api.md"]
}
```

> ⚠️ v1.1 起废弃列表形态（`inputs: ["a.md"]`），parser 将报错。
> 旧列表本身支持 `${param}` 注入，但注入后无名字、skill 无法按名引用，故统一为命名式。

### 4.3 解析时机

```
params 注入  → 工作流启动时，由 workflow_begin Tool 完成
${item} 注入 → 循环 Task 展开时，展开完成即替换，不延迟到运行时
路径解析     → workflow_begin 时，相对路径转为绝对路径（PoC 的 resolveRel 机制）
```

---

## 5. 完整示例

```yaml
name: ir-to-ar-workflow
version: "1.0"
description: "从初始需求到分配需求的标准工作流"

params:
  ir_doc:
    type: string
    description: "初始需求文档路径"
  project:
    type: string
    description: "项目名称"
    default: "default-project"

tasks:
  - id: req-analysis
    name: "需求分析"
    processor: skills/req-analysis/SKILL.md
    inputs:
      ir_doc: "${ir_doc}"
    outputs: ["output/${project}/analysis.md"]
    timeout: 600
    quality-gate:
      checker: skills/req-review/SKILL.md
      on-failure: retry
      max-retries: 3

  - id: func-design
    name: "功能设计"
    processor: skills/func-design/SKILL.md
    inputs:
      analysis: "output/${project}/analysis.md"
      tech: "context/tech-stack.yaml"
    outputs: ["output/${project}/func-design.md"]
    depends-on: [req-analysis]

  - id: module-review
    name: "逐模块评审"
    type: loop
    items-from: "config/modules.txt"
    item-var: "module"
    processor: skills/module-review/SKILL.md
    inputs:
      design: "output/${project}/func-design.md"
      req: ["spec/${module}/req.md"]
    outputs: ["output/${project}/review-${module}.md"]
    depends-on: [func-design]
    quality-gate:
      checker: skills/review-check/SKILL.md
      on-failure: block

  - id: export-docs
    name: "导出文档"
    processor: skills/export/SKILL.md
    inputs:
      design: "output/${project}/func-design.md"
    outputs: ["output/${project}/SRS.md"]
    depends-on: [req-analysis, func-design]
```

执行序列：

```
req-analysis ──→ func-design ──→ module-review(迭代1 → 迭代2 → ...) ──→ export-docs
                                              ↓
                                        每个迭代独立 Gate
```

---

## 6. Schema 常量定义（`code/shared/workflow-schema.js`）

```javascript
// Task 类型枚举
const TASK_TYPES = {
  LLM_TASK: 'llm-task',
  LOOP: 'loop',
  HUMAN_DECISION: 'human-decision',   // 预留
  EXTERNAL_AGENT: 'external-agent',   // 预留
}

// 字段默认值
const DEFAULTS = {
  timeout: 600,
  dependsOn: [],
  taskType: TASK_TYPES.LLM_TASK,
  retries: 0,
  onFailure: 'block',
}

// 必填字段校验规则
const REQUIRED = {
  llmTask: ['id', 'processor'],
  loop: ['id', 'processor', 'items-from', 'item-var'],
}

// 模式字符串（用于 ${param} 和 ${item} 的正则）
const PARAM_PATTERN = /\$\{(\w+)\}/g
```

---

## 7. 开放问题

| # | 问题 | 建议 |
|---|------|------|
| Q1 | loop 的 `items-from` 文件格式 | 每行一个 item（trim 空白，忽略空行和 # 注释行） |
| Q2 | params 在启动时如何传入 | `workflow_begin` 的第二个参数 `{params: {ir_doc: "...", project: "..."}}` |
| Q3 | 相对路径的基目录 | YAML 文件所在目录（PoC 已实现的 resolveRel 逻辑） |
| Q4 | loop 嵌套 | 暂不支持，后续迭代评估 |