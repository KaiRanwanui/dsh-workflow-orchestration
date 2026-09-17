// ============================================================================
// workflow-agent — Host 插件 apply 前言（源模块）
// 文件：code/plugins/workflow-host/apply-prologue.js
// 说明：applyInternal(ctx) 函数体——服务探针（sessions/agents/subagents/sessionController）、
//       实例注册表装配、A1 session/event tap（用户停止→权威停止）、webServer 路由与工具注册入口。
// 构建：由 packages/workflow-host/build.js 按 code/scripts/module-manifest.js 顺序拼入产物
//       （本文件是源，直接编辑此处；不要编辑生成的 lib/index.js 或 dist/*.mjs）。
// 作用域：拼入产物后位于模块作用域；引用的 engine/storage/instance-store/tools-preset/
//       webserver-routes 符号由同一拼接作用域提供（函数声明提升）。
// ============================================================================

function applyInternal(ctx) {
  // Iter-10：多实例注册表（instanceId → engine/storage，sessionId → 活跃实例）
  // Iter-18：注入会话存活判定（孤儿识别用；sessions.get(id) 为 undefined 即会话离开 live store）
  //          若 sessions 服务不可用，保守返回 live（不误判孤儿）。
  const sessions = ctx.get('sessions')
  const isSessionLive = (sid) => {
    if (!sessions || typeof sessions.get !== 'function') return true
    return !!(sid && sessions.get(sid))
  }
  // Iter-33（缺陷 #9）：会话「存在性」判定——与驻留语义分离。
  // 探针结论（iter-33-probe）：sessions.get/list 均为 live（驻留）语义，无法回答
  // 「会话存在但未打开」；持久化会话索引用 sessionQuery 服务（web profile 经
  // session-query-sqlite 挂载，官方 api-session-controller 以 ctx.sessionQuery 消费）：
  // listSessions(): Promise<SessionRecord[]> 覆盖含未驻留在内的全部持久化会话。
  // 孤儿判定改用 sessionExists：listSessions 成员资格（驻留命中走快路径）；
  // 服务不可用/查询异常 → 保守返回 true（宁可漏回收，不可误回收——#9 实证误回收代价大）。
  const sessionQuery = ctx.get('sessionQuery')
  const sessionExists = async (sid) => {
    if (!sid) return false
    if (sessions && typeof sessions.get === 'function' && sessions.get(sid)) return true
    if (!sessionQuery || typeof sessionQuery.listSessions !== 'function') return true
    try {
      const records = await sessionQuery.listSessions()
      return (records || []).some((r) => r && (r.id === sid || r.sessionId === sid))
    } catch (e) {
      return true
    }
  }
  // Iter-19：注入会话 agent 运行判定（Session 启停同步用；agents.get(sid).status === 'running'）
  const agents = ctx.get('agents')
  const isAgentRunning = (sid) => {
    if (!agents || typeof agents.get !== 'function') return undefined
    const a = agents.get(sid)
    if (!a) return undefined
    return a.status === 'running'
  }
  // Iter-22(S1)：排队用户输入判定（idle→stop 守卫用；agents.get(sid).inbox.hasPending）。
  // 探针结论（Iter-22 S1 探针）：提问等待（ask_user_question 阻塞）期间 status 仍为 running，
  // 不产生 idle；hasPending=true 仅出现在用户消息已排队、driver 尚未认领的间隙——该间隙不得误停。
  const isAgentPending = (sid) => {
    if (!agents || typeof agents.get !== 'function') return false
    const a = agents.get(sid)
    if (!a) return false
    try { return a.inbox ? a.inbox.hasPending === true : false } catch (e) { return false }
  }
  // Iter-SUBA(P1/P3)：子会话聚合探针——subagents Host 服务生产实现（0.1.5 迁移：apiProxy.subagents.list
  // 已移除，改 subagents.listChildren(parentSessionId) → SubagentListEntry[]（durable，按 createdAt/id 排序）；
  // 旧响应双层包裹解包废弃，activity 由本插件用 agents.get(id)?.status==='running' 重算（官方判活，与
  // 迁移前等价）。探针故障降级为空（不守卫，保持可停）。
  const listRunningChildren = async (parentSessionId) => {
    try {
      const subagents = ctx.get('subagents')
      if (!subagents || typeof subagents.listChildren !== 'function') return []
      const entries = await subagents.listChildren(parentSessionId)
      const list = Array.isArray(entries) ? entries : []
      // 0.1.5 实证（Phase 3）：agents store 不含子会话（agents.get(childId) 恒 undefined）；
      // activity 字段亦不可靠（子会话在跑仍报 inactive）。判活主源改为 sessions.get(child)
      // （resident = live activation，0.1.1 同源语义）；activity/agents 仅作兜底。
      const liveChild = (id) => {
        try { return !!(sessions && typeof sessions.get === 'function' && sessions.get(id)) } catch (e0) { return false }
      }
      const running = list
        .filter((e) => {
          if (!e || e.kind !== 'child' || !e.id) return false
          return liveChild(e.id) || e.activity === 'running' || isAgentRunning(e.id) === true
        })
        .map((e) => e.id)
      return running
    } catch (e) { return [] }
  }
  const interruptChild = async (parentSessionId, childSessionId) => {
    try {
      const subagents = ctx.get('subagents')
      if (!subagents || typeof subagents.interruptByParent !== 'function') return
      // 0.1.5 迁移：参数顺序变为 (child, parent, mode)；absent/idle/completed 目标是 accepted no-op
      await subagents.interruptByParent(childSessionId, parentSessionId, 'continuable')
    } catch (e) { /* fire-and-return：单子失败不阻断 */ }
  }
  // Iter-23(A2)：会话日志末条回合终局"用户中止"探针（live agents.get(sid).session.log 尾扫，
  // 判定复用 detectUserAbortFromLog 纯函数）。探针实证（iter23-probe-report.md）：事件 payload
  // 在 data 包装下。agent 未挂载/日志不可读返回 undefined（降级为 session-idle 既有语义，不卡停）。
  const detectUserAbort = async (sid) => {
    try {
      if (!agents || typeof agents.get !== 'function') return undefined
      const a = agents.get(sid)
      if (!a || !a.session) return undefined
      const log = a.session.log
      if (!log || typeof log.length !== 'number' || log.length === 0) return undefined
      return detectUserAbortFromLog(log)
    } catch (e) { return undefined }
  }
  const registry = createInstanceRegistry(ctx, { createWorkflowEngine, createWorkflowStorage, isSessionLive, sessionExists, isAgentRunning, isAgentPending, listRunningChildren, interruptChild, detectUserAbort })
  // 单实例兼容绑定（显式 statePath/workspaceRoot 参数或无会话上下文时回退）
  const engine = createWorkflowEngine()
  const storage = createWorkflowStorage(ctx, engine)
  if (storage) {
    storage.load().catch(() => {})
  }
  if (ctx.get('tools')) {
    registerWorkflowToolsPreset(ctx, engine, storage, registry)
  }
  // Iter-5：webServer HTTP 路由（替代 harness RPC，供 Client 面板轮询状态）
  // Iter-12：传入 registry（/wf/list 实例列表）
  registerWebRoutes(ctx, registry)
  // Iter-23(A1)：session/event 全局事件 tap——绑定会话回合被"用户中止"（UI 停止按钮 →
  // sessions.cancel → 回合 aborted(user)，探针实证唯一可读的权威停止信号）→ 即时权威停止：
  // wf STOPPED(user-stop) + 级联 interrupt 子会话。fire-and-return；幂等（非 RUNNING/未绑定跳过）。
  // Case I（agent 空闲时停）零痕迹不触发本 tap——原由 A3 面板提示条覆盖；Iter-31（D3）该提示
  // 已随 stopHint 一并移除（Stop v4 后两通道等效，用户真机验证通过），Case I 无提示为预期行为。
  const offUserAbortTap = (() => {
    try {
      if (typeof ctx.on !== 'function') return null
      return ctx.on('session/event', (session, event) => {
        try {
          if (!isUserAbortTurnEnd(event)) return
          const sid = session && session.header && session.header.id
          if (!sid) return
          registry.handleSessionUserStop(sid)
            .catch(() => {})
        } catch (e) { /* 畸形事件忽略 */ }
      })
    } catch (e) { return null }
  })()
  if (offUserAbortTap) ctx.effect(() => offUserAbortTap, 'wf-user-abort-tap')
  ctx.effect(() => () => {})
}
