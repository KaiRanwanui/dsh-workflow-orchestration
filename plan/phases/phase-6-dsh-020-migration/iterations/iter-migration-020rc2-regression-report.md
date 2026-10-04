# Iter-MIG3 · 行为回归与缺陷修复报告（阶段 6 · DSH 0.2.0-rc.2 迁移）

> **状态**：✅ 完成（回归矩阵全过 + B6 页签死锁修复；v0.28.7 收口）
> **环境**：macOS / `~/.dsh-dev` / DSH 0.2.0-rc.2 / host v0.28.7

---

## 1. 回归矩阵（真机 3080 实例全过）

| # | 回归项 | 结果 | 证据 |
|---|---|---|---|
| 1 | 实例创建全链路（校验→fs→落盘） | ✓ | E-SKILL-MISSING 精确拦截 → 补技能后 `mig-probe` / `default-demo-16659c4c` 创建成功（B5 修复后） |
| 2 | **B1 停止链路级联（主场景）** | ✓ | `panel-stop sid=session-d317… cancelled=true drained=true children=3`；面板按钮复验 `children=6`——0.2.0 `SubagentCatalogEntry`（无 kind）下子会话枚举/级联打断全链生效 |
| 3 | Stop 语义 | ✓ | stage STOPPED + `stopReason=user-stop`；无 sid 时降级引擎直停（trace 有痕，合理降级） |
| 4 | Resume 语义 | ✓ | PENDING 重派发、DONE 保留、推进至门禁任务 |
| 5 | Reset 语义（**Iter-46-2 复验，阶段 5 欠账关闭**） | ✓ | `lastResetAt` 落档；停 PENDING 等手动 Start；logs/ 清理（pendingCleanup 契约）；重跑并发 2 正常 |
| 6 | **门禁分支 PASS→COMPLETED**（阶段 2 遗留） | ✓ | integrate → integrator-checker 独立评审子会话 → `gateResult=PASS` → COMPLETED（后台轮询 40s 内闭环） |
| 7 | 并发组 max-concurrency:2 | ✓ | deep-analysis + write-spec 并行 RUNNING |
| 8 | 物化→引擎技能引用 | ✓ | 门禁处理器引用 `~/.dsh-dev/workflow-agent/skills/integrator-checker/SKILL.md` |
| 9 | 孤儿回收 | ✓ | `recoveredOrphans:[]`（多次重启后无孤儿） |
| 10 | serial-demo 端到端 | ✓ | `serial-demo-dd362c06` **COMPLETED**（0.2.0 下首个完整闭环实例） |
| 11 | default-demo 端到端 + 门禁 | ✓ | COMPLETED / PASS（含两轮 Stop/Resume/Reset 干扰后恢复） |

## 2. B6 🔴 页签门控死锁（本轮发现并修复，v0.28.4→v0.28.6 三轮收敛）

- **现象**：编排主会话切到非编排子会话（页签正确隐藏）后**切回主会话页签不回显**，面板不可操作。
- **定位**（探针三轮：`[wf-gate]` 日志挂在 subscribe/applyGate/inject/register/dispose 五点）：
  1. Iter-39 补偿订阅挂上了但 **applyGate 零触发**——0.2.0 sessions store 不再向 subscribe 回调推送切换通知；
  2. 加哨兵轮询后暴露根因：**0.2.0 快照形状 `{ids,byId,phase,projectionsBySession}`——`current` 字段已删除**（"当前会话"改由宿主 UI 持有，插件不可见）→「按当前会话判定注册/注销」的旧架构必然死锁：组件注销后无任何信号能驱动复活。
- **修复（终版语义）**：
  - 哨兵复活判定改为「`snap.ids` 中**存在编排主会话**（agentPreset=workflow-orchestrator 且 origin≠subagent）→ registerEntry；否则 disposeEntry」；
  - **组件内不再自注销**（0.2.0 下注销=自杀）：非编排会话由组件 `return null` 门控内容；
  - 哨兵/重试定时器 `unref()`（纯 Node 门禁环境不吊事件循环——顺带修复 build-release 卡死）。
- **已知代价**：非编排会话下可能出现空 Workflow 页签（label 静态）——记 `optimization-backlog`（O-2），待考究 0.2.0 slot label 动态化。
- **教训留档**：0.2.0 客户端 store 契约变化（current 删除、通知机制变化）不在类型层面暴露——客户端兼容层的破坏只能靠运行时探针取证。

## 3. 配套修复

- **B5**（见 MIG2 报告 §3.4）：实例写入 fs 沙箱拒 → `shared/fs-host.js` 适配层（22 处消费点）。
- install 流程双缺陷（⓪ 悬空 file: 依赖前置修正 / ⓪.5 装后实体版本校验+强制同步）。

## 4. 版本轮次

| 版本 | 内容 |
|---|---|
| v0.28.4 | B6 哨兵 + unref |
| v0.28.5 | applyGate 早退深探针（定位 `current` 删除） |
| v0.28.6 | **B6 终版语义**（存在编排会话→注册；组件不自注销） |
| v0.28.7 | MIG4 降噪（移除高频探针，保留异常路径日志） |
