# 阶段 5 问题台账（findings）

> 运行中发现的每个问题/不顺手点记一条。格式：现象 → 现场信息（实例/日志/state）→ 初步分诊 → 处置（迭代池 / 现场解释 / 不处理）。

## 台账

| # | 日期 | 现象 | 现场信息 | 初步分诊 | 处置 |
|---|---|---|---|---|---|
| F-1 | 2026-09-23 | **面板 Reset 后主 Session 未收到重置指令**（实例 sys-design-b68e1d10，09:58:33Z）。引擎侧 reset 已执行（state 重置为全新 PENDING、metadata.lastResetAt 更新、archive 备份生成），但「已重置+清理契约」注入未达主会话——output/logs/inputs 残留未清。**17 秒后**对 34a8cdf1 的同操作完全正常（09:58:50Z reset，09:59:07 主会话执行清理子进程） | `metadata.json` lastResetAt；`state.json` 仅 BEGIN 日志；journalctl 17:59:07 清理子进程仅 34a8cdf1；b68e1d10 output 残留 6 文件（已人工补清理，备份 20260923T095833Z_reset_STOPPED） | 注入链路（Iter-22/31 语义）静默失败：`injectSessionCmd` 的 prompt 结果（accepted/error）只写进 200 响应体，**面板不消费 `messageInjected`/`messageInjectionError`**，失败无任何用户可见反馈；失败后清理契约无兜底执行者。失败诱因待复现（怀疑与会话当时 busy/stop-steer 状态相关，queue 模式投递被吞） | 已人工补清理恢复 PENDING；**开单**：①面板 4 键响应消费注入结果（失败醒目提示，reset 时展示 pendingCleanup.cmd 供手动执行兜底）；②引擎侧评估清理失败兜底。归迭代池（阻塞级别：中——可手动恢复，但静默失败违反复核原则） |

## 迭代池联动

- /wf/skill 围栏收口（阶段 4 遗留，待实战验证优先级）
- 权限矩阵对齐（阶段 4 遗留 D3/D4 依赖，需用户场景矩阵拍板）
