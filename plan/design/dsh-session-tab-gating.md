# 技术总结 — DSH 会话感知页签门控（Workflow 页签按 preset 动态显隐）

- **项目**：workflow-agent（DSH 0.1.5-rc.2，@workflow-agent/workflow-host 单包插件）
- **日期**：2026-09-17 ~ 09-19（Iter-39，host v0.26.21 ~ v0.26.26）
- **效果**：仅 `workflow-orchestrator` preset 的主会话显示 Workflow 页签；非编排会话与 subagent 子会话完全不出现；会话切换实时跟随
- **关联**：`plan/phases/phase-4-ui-enhance/iter-39-design.md`（方案）、`iterations/iter-39-report.md`（验收）

---

## 1. DSH 会话页签机制（逆向确认的契约）

DSH web 前端的会话页签区由 `conversation.view` 这个 **session 作用域 list slot** 驱动，插件通过 `ctx.get('slots')` 门面接入。关键契约（均经源码/运行时实证）：

| # | 契约 | 出处 |
|---|---|---|
| 1 | 页签列表 = `viewTabs()` 遍历 `slots.entries('conversation.view')`——**entry 存在即有页签**，label 只是文字，无法借 label 隐藏 | dsh-client-ui-conversation lib/client.js |
| 2 | `register()` 返回 **disposer**；调用即从 entries 移除并 `markDirty` → 页签即时刷新 | dsh-client-ui-slots lib/index.js |
| 3 | list slot **同 id 重复注册抛错**（"already has an entry"）→ 重注册前必须先 disposer | register 同 id 守卫 |
| 4 | `slots.inject(name, factory)` = **cordis 子插件注册**（`plugin({inject: name, apply: factory})`）——**factory 每次页面加载只运行一次**（按插件身份去重），与会话切换无关 | dsh-web-frontend bundle 逆向 |
| 5 | `renderSlot(..., { only: active.id })` 只渲染当前激活页签的组件；唯一 entry 自动成为 active | 同 1 |
| 6 | 会话数据经 `ctx.get('sessions')` 服务：`sessions.list.getSnapshot()`（`current` + `byId`）、`sessions.list.subscribe(cb)`——**会话切换/投影更新必触发** | conversation 包同款用法 |
| 7 | 会话 preset 官方读取路径：`byId[id].projectionValues.agentPreset`（兜底 `byId[id].agentPreset`）；子会话标记 `byId[id].origin === 'subagent'` | 同 6 + dsh-client-ui-agent-preset 先例 |

**推论**：页签显隐的唯一正确杠杆是「entry 的注册/注销」；而注册决策必须由一个**不随组件生死而失效的持久感知源**驱动。

## 2. 最终方案（三层结构）

```
sessionsSvc.list.subscribe ──► applyGate（顶层驱动器，每次会话变化重判）
                                   │  读快照 current/byId → preset/origin
                                   │  isWf=true  → registerEntry()（幂等）
                                   │  isWf=false → disposeEntry()
                                   ▼
              slots.inject factory ──► 条件注册（sessionGateMap 缓存判定，
                                   已判定非编排的 scope 直接不注册）
                                   ▼
              WorkflowGate 哨兵组件 ──► 渲染层兜底判定（useSessions selector）：
                                   编排 → WfComponent 面板；明确非编排 → disposeEntry()
                                   （preset 加载中 → 保持注册等待，不自注销）
```

**判定规则**：`preset === 'workflow-orchestrator' && origin !== 'subagent'`；preset 未加载（undefined）视为「未知」而非「非编排」——保持注册等待投影就绪，避免误杀。

**服务获取**：`ctx.get('sessions')` 在插件 apply 时可能尚未注册（启动时序竞态）→ 惰性获取 + 重试订阅（500ms × 40 次），拿到即补一次判定。

## 3. 踩坑记录（现象 → 根因 → 教训）

### 坑 1：inject factory 每页只运行一次（致命误解）
- **现象**：非编排会话 dispose 后页签消失 ✓，但切回编排会话页签永不出现。
- **根因**：`slots.inject` 是 cordis 子插件注册（契约 #4），按插件身份去重——factory 的条件注册决策**只在页面加载时做一次**，会话切换不会重入。
- **教训**：**插件级注册动作的决策不能依赖「每会话重入」假设**；需要 per-session 行为时，感知源必须放在组件生命周期之外（顶层服务订阅）。

### 坑 2：哨兵自注销 = 自毁感知源
- **现象**：v0.26.21 哨兵组件在非编排会话 dispose 自身后，随组件卸载失去全部感知能力，复活无从谈起。
- **根因**：注销 entry → renderSlot 不再渲染 → 哨兵卸载 → 监听/判定逻辑随组件消亡。
- **教训**：**注册/注销的驱动器必须外置于被驱动对象**；「组件自管生命周期」在自注销场景是自指死锁。

### 坑 3：ctx.get('sessions') 启动时序竞态
- **现象**：同一份代码，有时顶层订阅工作正常，有时 `ctx.get('sessions')` 返回 undefined（插件 apply 早于服务注册）。
- **根因**：插件加载顺序不保证服务先行；apply 时点一次性获取不可靠。
- **修复**：惰性获取（每次用时取）+ 重试订阅（500ms × 40 次）+ 判定器对「服务未就绪」幂等跳过。
- **教训**：**客户端插件 apply 阶段获取协作服务一律视为可能未就绪**；一次性快照式获取要配重试或订阅通知后的补算。

### 坑 4：explore 阶段的三个连锁小坑（方法论层面）
- **替换式批量编辑静默 no-op**：python str.replace 目标与实际不符时不报错——doAction「统一保存」曾整轮未落地。**对策：关键替换后 grep 断言新标记存在**。
- **区域重建多一层闭合**：整段重写后 `})` 多一层、变量名撞车——**对策：node --check + 通读重建区域 + 单测全量回归**。
- **部分命中比全未命中更危险**：半新半旧状态（如 params 通道一半切换）比整体未切换更难排查——**对策：一次逻辑变更涉及的所有调用点列入同一检查清单**。

### 坑 5：诊断闭环——console 探针够不着
- **现象**：client 侧 console.log 进浏览器控制台，开发者在服务端无法自读；靠用户复制控制台存在遗漏（早期行滚出缓冲）。
- **修复**：临时 `/wf/debug-probe` POST 路由——客户端探针双写（console + 回传 Host）→ Host console → **journalctl 自读**，一个复现动作拿全量时序。
- **教训**：**给非自持环境的诊断要设计「可自读的回传通道」**；诊断结束后路由与探针成对移除（v0.26.26 已清零，部署产物 grep 核验）。

### 坑 6：同版本 file: tgz 不被 pnpm 刷新
- **现象**：pnpm install 显示 Done 但 node_modules 内容陈旧。
- **对策**：发版固定流程 = 改版本号 → build → **强删包目录** → `pnpm install --force` → **grep 部署产物核验关键标记**。

## 4. 验证要点（复用指引）

1. **真值链路**：会话切换 → sessions.list.subscribe 触发 → applyGate 判定（sid/preset/origin/isWf/registered 全量日志）→ register/dispose 动作。每环有探针即可远程定位断点。
2. **回归四条**：编排会话页签在且面板不回归 / 非编排会话无页签 / 子会话无页签 / 来回切换无残留无重注册报错。
3. **边界行为**：preset 投影未就绪时保持现状等下一次通知（不误杀）；页面冷启动在非编排会话时页签不出现（factory 条件注册）。

## 5. 复用指引

任何 DSH 插件若需「按当前会话特征显隐自己的页签」，直接套用本方案三层结构，替换判定函数（读 `sessions.list.getSnapshot()` 的任意字段）即可。核心不变量：

> **entry 存在 = 页签存在**；驱动器常驻顶层订阅；哨兵组件只做兜底判定，不做生命周期自管理。
