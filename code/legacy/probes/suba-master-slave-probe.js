#!/usr/bin/env node
/**
 * Iter-SUBA 主从关系探针（suba-3/pkg-3）—— 动态 Cordis 插件 Host 代码存档
 *
 * 用途：技术验证 DSH 主 Session 与 subagent 子会话的关系与控制接口。
 * 部署方式：cordis_define({ idPrefix:'suba', kind:'new', code.host = 本文件除本头注释外的完整内容 })
 *          → cordis_run → 本会话即获得 suba_* 工具 → 配合 subagent 工具派发实验对象。
 * 用后约定：cordis_stop + cordis_undefine（动态插件不残留；本文件为唯一存档）。
 *
 * 工具清单：
 *   suba_whoami   当前会话 id + agents registry 自我快照（status/hasPending/parentSession/origin）
 *   suba_list     apiProxy.subagents.list 枚举子会话（id/mode/label/activity/hasChildren + parentAvailable）
 *   suba_interrupt apiProxy.subagents.interrupt（authority {kind:'user', parentSessionId}；one-shot/absent=no-op）
 *   suba_prompt   apiProxy.subagents.prompt（followup 注入，仅 continuable）
 *   suba_agent    读任意 sessionId 的 agents registry 快照（null=不在注册表）
 *   suba_events   插件内存事件流：subagent/start|end（含 stopReason）+ agent/status（cap 400）
 *
 * 已实证结论（2026-09-01，DSH 0.1.1-rc.2，详细报告见 plan/development/iter-suba-report.md）：
 *   1. subagent/start|end 事件在 Host 插件 ctx.on 全局可达（start: runId/id/provider/local；end: + stopReason
 *      completed/aborted/error/max-tokens）；同一 childId 每个"回合"一对新 runId 的 start/end
 *   2. subagents.list 返回该父会话全部历史子会话（continuable+one-shot），activity 由 apiProxy 用
 *      ctx.agents.get(id)?.status==='running' 重算——hasRunningChildren 的现成官方实现
 *   3. interrupt 实测毫秒级生效：accept → ~23ms agent/status idle → ~21ms 后 subagent/end(stopReason='aborted')
 *   4. interrupt 后子 agent 从 agents registry 移除（get→null）；父会话收到"was stopped before it finished"
 *      结算通知（closing message 为空）；正常完成则"finished and will do no further work..."+closing message
 *      有内容——编排 agent 可从通知文案区分级联停止与正常完成
 *   5. apiProxy 调用形状：{ rpcId, payload }，返回 { rpcId, result:{ ok, value } }（需解包 result.value）
 *   6. 【关键坑】subagents.prompt/history 直调必须显式传第二参 AbortSignal（内部读 signal.aborted）；
 *      工具 execute 的 exec.signal 可用（execKeys 含 signal/agent/concludeTurn 等）。sessions.prompt 不需要
 *   7. followup 可唤醒 interrupt 后的冷子会话（冷恢复→新 runId start→completed）；continuable 子会话
 *      回合结束即从 agents registry 移除（settled→dispose），两回合之间 get→null
 *
 * 已知边界（源码结论，plan/development/iter-suba-report.md 有出处）：
 *   - interrupt 是取消信号（fire-and-return），目标观察到信号才停；one-shot 不可 interrupt（本 preset 已配 continuable）
 *   - subagents.prompt 要求父会话 live（ctx.agents.get(parent)）；mode:'continuable'
 */

return {
  apply(ctx) {
    const events = []
    const cap = (arr, item) => { arr.push(item); if (arr.length > 400) arr.splice(0, arr.length - 400) }
    const off1 = ctx.on('subagent/start', (info) => cap(events, { t: Date.now(), ev: 'subagent/start', runId: info && info.runId, id: info && info.id, provider: info && info.provider, local: info && info.local }))
    const off2 = ctx.on('subagent/end', (info) => cap(events, { t: Date.now(), ev: 'subagent/end', runId: info && info.runId, id: info && info.id, provider: info && info.provider, stopReason: info && info.stopReason }))
    const off3 = ctx.on('agent/status', (payload) => { try { cap(events, { t: Date.now(), ev: 'agent/status', id: payload.agent.session.header.id, status: payload.status }) } catch (e) { /* 畸形载荷忽略 */ } })
    ctx.effect(() => () => { off1(); off2(); off3() }, 'suba-event-taps')

    const j = (v) => (v === undefined ? null : v)
    const selfId = (exec) => {
      try { return exec.agent.session.header.id } catch (e) { return null }
    }
    const agentBrief = (agents, sid) => {
      const a = agents.get(sid)
      if (a === undefined) return null
      const out = { status: j(a.status) }
      try { out.hasPending = a.inbox.hasPending === true } catch (e) { out.hasPending = 'unreadable' }
      try {
        const h = a.session.header
        out.parentSession = j(h.parentSession)
        out.origin = j(h.origin)
      } catch (e) { /* header 不可读则略 */ }
      return out
    }
    const def = (name, description, parameters, execute) => Object.assign(
      { name, description, parameters },
      { output: { schema: { type: 'object', additionalProperties: true }, render: (args, v) => [{ type: 'text', text: JSON.stringify(v).slice(0, 3000) }] }, execute },
    )

    harness.registerTool(ctx, harness.defineTool(def('suba_whoami',
      'SUBA 探针：当前会话 id + agents registry 自我快照（status/hasPending/parentSession/origin）',
      { type: 'object', properties: {} },
      async (args, exec) => {
        const sid = selfId(exec)
        const agents = ctx.get('agents')
        return { sessionId: j(sid), self: agents ? agentBrief(agents, sid) : 'agents service unavailable' }
      })))

    harness.registerTool(ctx, harness.defineTool(def('suba_list',
      'SUBA 探针：apiProxy.subagents.list 枚举某父会话的 subagent 子会话（缺省=当前会话）。返回 entries（id/mode/label/activity/hasChildren）+ parentAvailable',
      { type: 'object', properties: { parentSessionId: { type: 'string', description: '缺省=当前会话' } } },
      async (args, exec) => {
        const apiProxy = ctx.get('apiProxy')
        if (apiProxy === undefined) return { error: 'apiProxy unavailable' }
        const parentSessionId = (args && args.parentSessionId) || selfId(exec)
        try {
          const r = await apiProxy.subagents.list({ rpcId: 'suba-list-' + Date.now(), payload: { parentSessionId } })
          const body = r && r.payload !== undefined ? r.payload : r
          return { parentSessionId: j(parentSessionId), raw: body }
        } catch (e) { return { parentSessionId: j(parentSessionId), error: e && e.message ? e.message : String(e) } }
      })))

    harness.registerTool(ctx, harness.defineTool(def('suba_interrupt',
      'SUBA 探针：apiProxy.subagents.interrupt 打断某子会话当前回合（fire-and-return；one-shot/不存在=no-op）',
      { type: 'object', properties: { childSessionId: { type: 'string' }, parentSessionId: { type: 'string', description: '缺省=当前会话' } }, required: ['childSessionId'] },
      async (args, exec) => {
        const apiProxy = ctx.get('apiProxy')
        if (apiProxy === undefined) return { error: 'apiProxy unavailable' }
        const parentSessionId = (args && args.parentSessionId) || selfId(exec)
        try {
          const r = await apiProxy.subagents.interrupt({ rpcId: 'suba-int-' + Date.now(), payload: { parentSessionId, childSessionId: args.childSessionId } })
          return { accepted: true, echoed: r && r.payload !== undefined ? r.payload : r }
        } catch (e) { return { error: e && e.message ? e.message : String(e) } }
      })))

    harness.registerTool(ctx, harness.defineTool(def('suba_prompt',
      'SUBA 探针：apiProxy.subagents.prompt 向 continuable 子会话注入 followup 消息',
      { type: 'object', properties: { childSessionId: { type: 'string' }, text: { type: 'string' }, parentSessionId: { type: 'string', description: '缺省=当前会话' } }, required: ['childSessionId', 'text'] },
      async (args, exec) => {
        const apiProxy = ctx.get('apiProxy')
        if (apiProxy === undefined) return { error: 'apiProxy unavailable' }
        const parentSessionId = (args && args.parentSessionId) || selfId(exec)
        try {
          const r = await apiProxy.subagents.prompt({ rpcId: 'suba-prm-' + Date.now(), payload: { parentSessionId, childSessionId: args.childSessionId, mode: 'continuable', content: [{ type: 'text', text: args.text }] } })
          return { ok: true, echoed: r && r.payload !== undefined ? r.payload : r }
        } catch (e) { return { error: e && e.message ? e.message : String(e) } }
      })))

    harness.registerTool(ctx, harness.defineTool(def('suba_agent',
      'SUBA 探针：读任意 sessionId 的 agents registry 快照（status/hasPending/parentSession/origin；null=不在注册表）',
      { type: 'object', properties: { sessionId: { type: 'string' } }, required: ['sessionId'] },
      async (args) => {
        const agents = ctx.get('agents')
        if (agents === undefined) return { error: 'agents service unavailable' }
        return { sessionId: j(args.sessionId), agent: agentBrief(agents, args.sessionId) }
      })))

    harness.registerTool(ctx, harness.defineTool(def('suba_events',
      'SUBA 探针：读取本插件 run 起记录的 subagent/start|end 与 agent/status 事件流（cap 400；clear=true 读取后清空）',
      { type: 'object', properties: { clear: { type: 'boolean' }, filterId: { type: 'string', description: '只保留 id 匹配的事件（可缺省）' } } },
      async (args) => {
        const fid = args && args.filterId
        const list = fid ? events.filter((e) => e.id === fid) : events.slice()
        if (args && args.clear) events.length = 0
        return { count: list.length, events: list }
      })))
  },
}
