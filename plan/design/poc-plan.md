# 概念验证计划（POC）— 已执行，含结论

## 目标

在正式编码前，通过手工验证确认核心假设成立。**已执行，详见 `PoC/REPORT.md`。**

---

## 核心假设验证结果

| 假设 | 验证方式 | 结果 |
|------|---------|------|
| DSH subagent 能作为 Task 的隔离执行单元 | subagent 工具调 Task/Gate | ✅ 通过 |
| 文件传递模型可行 | Task 写 analysis.md → Gate 读 | ✅ 通过 |
| 质量门禁模型合理 | Gate 基于文件评审，产出 PASS/FAIL | ✅ 通过 |
| Cordis 插件可编程式调用 subagent | `subagents.start()` in Tool execute | ❌ 不可行 |

---

## 架构方向修正

原计划假设在 Cordis 插件中通过 `subagents.start()` Service API 实现自动化编排。PoC 证明此路径不可行（子 Agent 无 LLM 产出），但模型层的 `subagent` 工具完美工作。

**修正后的方向**：编排逻辑放在 Agent Loop 层（模型调 `subagent` 工具），实现为一个 DSH Agent Preset。

详见：
- `solutions/architecture-proposal.md` — 更新后的架构方案
- `solutions/architecture-comparison.md` — 方案对比
- `PoC/REPORT.md` — 验证报告
- `PoC/design.md` — 设计文档（含实际验证结论）

---

## 验证步骤（已执行）

### Step 1：准备测试物料 ✅

```
PoC/
├── test-data/ir-sample.md          # 示例 IR 文档
├── skills/poc-analyzer/SKILL.md    # Task 1 处理指令
├── skills/poc-reviewer/SKILL.md    # Task 2 质量门禁指令
├── workflows/poc-with-gate.yaml    # 工作流定义
└── output/
    ├── analysis.md                 # Task 产出物
    └── gate-result.md             # Gate 门禁报告
```

### Step 2：执行 Task ✅

调 `subagent` 工具，加载 `poc-analyzer` skill，读取 `ir-sample.md`，产出 `analysis.md`。

### Step 3：执行 Gate ✅

调 `subagent` 工具（独立会话），加载 `poc-reviewer` skill，读取 `analysis.md`，产出 `gate-result.md`。

### Step 4：判定结果 ✅

Gate 产出 PASS（5/5 检查通过），无需重试。

---

## 成功标准达成

| 假设 | 通过标准 | 结果 |
|------|---------|------|
| subagent 隔离 | Gate 无法回忆 Task 对话内容 | ✅ |
| 文件传递 | Gate 输出引用了 Task 结果 | ✅ |
| 质量门禁 | 门禁能正确判定 PASS/FAIL | ✅ |
| skill.md 指令 | Task 和 Gate 按 skill 格式产出 | ✅ |

---

## 后续计划

1. **短期**：设计工作流 Agent Preset（system prompt + 工具配置），实现首个端到端工作流
2. **中期**：完整 YAML schema + 并行调度 + 人工决策节点
3. **长期**：多工作流实例管理 + 持久化