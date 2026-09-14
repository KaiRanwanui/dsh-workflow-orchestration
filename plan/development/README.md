# plan/development/ —— 协作纪律与迭代模板

> 本目录存放**跨阶段通用**的开发协作文档（纪律、模板）。
> 迭代产物（报告 / 设计定稿 / 验证报告）不在本目录，已按阶段归档到 [`../phases/`](../phases/)。
> 新阶段（阶段 3）启动时，用本目录模板撰写迭代方案与报告。

## 内容

| 文件 | 用途 | 刷新频率 |
|---|---|---|
| `team-conventions.md` | **协作与工程纪律单一源**：上下文压力处理、差分验证、工作代码保护、环境边界探针、**先设计后开发**、Client UI 附加约定 | 约定变更时 |
| `iteration-plan-template.md` | 迭代方案模板（交付件 / 技术选型 / 执行顺序 / 验证标准 / 回退点） | 模板演进时 |
| `iteration-report-template.md` | 迭代报告模板（状态 / 版本 / 测试 / 设计决议 / 改动面 / 遗留） | 同上 |

## 迭代生命周期（本项目既定流程）

```
① 读 plan/status.md 明确阶段与基线
② 用 iteration-plan-template.md 写迭代方案  →  提请用户确认（team-conventions §A6）
③ 确认后开发：一次只改一个维度（§A2）、探针先行（§A5）
④ 构建 + 单测 + 产物级验证（Host：test-host；Client：verify-client-bundle）
⑤ GUI / 行为验收 → 用 iteration-report-template.md 写报告 → 归档到 plan/phases/<阶段>/iterations/
⑥ 阶段收尾时才更新 plan/status.md（不逐迭代回改状态文档）
```

## 相关

- 阶段归档与迭代索引：[`../phases/README.md`](../phases/README.md)
- 当前状态与下一阶段：[`../status.md`](../status.md)
- 历史迭代报告（Iter-1~30 与迁移 5 任务）：`../phases/phase-1-core/iterations/`、`../phases/phase-2-dsh-migration/iterations/`
