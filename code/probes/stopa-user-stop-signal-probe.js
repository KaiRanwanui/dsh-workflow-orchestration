#!/usr/bin/env node
/**
 * Iter-23 方向 A 前置探针（stopa/…）—— "手工停 DSH 会话"在 Host 侧的可读停止信号
 *
 * 问题（iter-suba-verification-report.md §现象）：用户手工停掉编排会话（UI Stop → sessions.cancel →
 * agent.cancel({kind:'user'},{keepInbox:true})）后，子会话跑完的结算通知会唤醒已 cancel 的 agent 继续编排。
 * 方向 A 需要 syncInstanceState 读 sessions 层"已停"状态判 user-stop。本探针回答：
 *   Q1 停在"回合进行中"（Case R）：session log 是否留下可读的持久痕迹？
 *   Q2 停在"agent 空闲"（Case I，即"复活"现象的实际命中场景）：是否留任何痕迹？
 *   Q3 cancel 后 prompt 是否被拒绝/接受？（Iter-21 线索"已停 session 拒绝 prompt 注入"真伪）
 *   Q4 workflow-host 插件能否读另一会话的 log（live session.log 与持久 sessionPersistence.readFrom 双路）？
 *
 * 源码预判（deepseek-harness-master，待本探针在部署版实证）：
 *   - AgentStatus = 'idle' | 'running'（core/agent/src/runtime-types.ts:50），无第三态；dispose=移出注册表
 *   - cancel 对 idle agent 是 no-op（"does not arm later work"）→ Case I 预计零痕迹
 *   - cancel 对 running agent：turn/end 持久事件 reason={kind:'aborted', reason:{kind:'user'|'parent'|'hook'|'disposed'|'legacy'}}
 *     （core/session/src/types.ts:142-158）；keepInbox=true 保留 inbox 待 FIFO 续跑
 *   - prompt 在 cancel 后应被接受（唤醒输入在取消收敛后排队/立即开新回合）
 *
 * 已实证结论（2026-09-02，部署版运行时探针 stopa-6/pkg-6；详细报告 plan/development/iter23-probe-report.md）：
 *   Q1（Case R 停在活动回合）✅ 有持久可读信号：turn/end data={turn,reason:{kind:'aborted',reason:{kind:'user'}}}
 *      + assistant/message interrupted:true；agent running→idle 且留在注册表；live 与持久层双路可读
 *   Q2（Case I 停在空闲）❌ 零痕迹：cancel 为纯 no-op，RPC 仍返回 accepted:true（假性成功），无任何事件/状态/持久变化
 *      ——即"手工停会话复活"现象的机制；Host 侧原理性不可检测（除非 DSH 改动）
 *   Q3（停后 prompt）接受且立即唤醒新回合——Iter-21"已停 session 拒绝 prompt"线索证伪
 *   Q4（读路径）✅ live agents.get(sid).session.log + 冷 sessionPersistence.readFrom(sid,0,signal) 双路可用；
 *      部署版事件形态为 {type,seq,time,data:{...}}（payload 在 data 包装下，与 master 源码顶层签名不同，源码侦察必须对照实测）；
 *      user/message 的 data.source.kind ∈ user(带rpcId)/plugin/skill-catalog/agent-instructions…可区分真实输入与合成注入；
 *      session/event 全局实时事件（含他回合 turn/end）可作事件驱动 sync 挂点
 *   判定窗口注意：aborted(user) 之后若有新回合（如结算通知唤醒），"最后一条 turn/end"不再指向 abort
 *      → 方向 A 应以 ctx.on('session/event') 事件驱动即时捕获为主、轮询读尾部为兜底
 *
 * 部署方式：cordis_define({ idPrefix:'stopa', kind:'new', code.host = 本文件除本头注释外的完整内容 })
 *          → cordis_run → 本会话获得 stopa_* 工具 → 按 Q1-Q4 流程驱动。
 * 用后约定：cordis_stop + cordis_undefine；测试会话经 AgentHandle.dispose 清理（裸会话回退路径残留时在报告中注明）。
 * 实验残留：bare 回退路径产生的空壳会话 stopa-t-hymmr1（仅 3 条 epoch 事件，无对话内容）留在持久层。
 *
 * 工具清单：
 *   stopa_scan    读任意会话 log 聚合（live 优先 / cold=sessionPersistence.readFrom 交叉验证）
 *   stopa_create  造测试会话（prepare+enter+announce，持 detach；回退 create）
 *   stopa_prompt  apiProxy.sessions.prompt（queue）+ 等待 + 采样
 *   stopa_cancel  apiProxy.sessions.cancel（=UI Stop 同路径）+ 等待 + 采样
 *   stopa_events  插件捕获的实时事件流（agent/status、inbox/*、session/event、agent/created|disposed）
 *   stopa_cleanup 清理测试会话（触发 detach）
 */

return {
  inject: ['timer'],
  apply(ctx) {
    const events = []
    const cap = (item) => { events.push(Object.assign({ t: Date.now() }, item)); if (events.length > 500) events.splice(0, events.length - 500) }
    const safe = (fn, tag) => { try { const v = fn(); return v === undefined ? null : v } catch (e) { return 'unreadable:' + tag } }
    const off = []
    off.push(ctx.on('agent/status', (p) => { try { cap({ ev: 'agent/status', id: p.agent.session.header.id, status: p.status }) } catch (e) { /* 畸形载荷忽略 */ } }))
    off.push(ctx.on('agent/created', (p) => { try { cap({ ev: 'agent/created', id: p.agent.session.header.id }) } catch (e) { /* 忽略 */ } }))
    off.push(ctx.on('agent/disposed', (p) => { try { cap({ ev: 'agent/disposed', id: p.agent.session.header.id }) } catch (e) { /* 忽略 */ } }))
    const inboxEv = (name) => (p) => { try { cap({ ev: name, id: p.agent.session.header.id, srcKind: p.message && p.message.source ? p.message.source.kind : undefined }) } catch (e) { /* 忽略 */ } }
    off.push(ctx.on('agent/inbox/inserted', inboxEv('agent/inbox/inserted')))
    off.push(ctx.on('agent/inbox/claimed', inboxEv('agent/inbox/claimed')))
    off.push(ctx.on('agent/inbox/discarded', inboxEv('agent/inbox/discarded')))
    off.push(ctx.on('session/event', (session, event) => {
      try {
        const d = event.data !== null && typeof event.data === 'object' ? event.data : {}
        const item = { ev: 'session/event', id: session.header.id, type: event.type }
        if (typeof d.turn === 'number') item.turn = d.turn
        if (event.type === 'turn/end' && d.reason && typeof d.reason === 'object') {
          item.reasonKind = d.reason.kind
          if (d.reason.kind === 'aborted' && d.reason.reason && typeof d.reason.reason === 'object') item.cancelKind = d.reason.reason.kind
        }
        if (event.type === 'user/message' && d.source && typeof d.source === 'object') item.srcKind = d.source.kind
        cap(item)
      } catch (e) { /* 忽略 */ }
    }))
    ctx.effect(() => () => { for (const d of off) { try { d() } catch (e) { /* 忽略 */ } } }, 'stopa-event-taps')

    const created = new Map()

    const extractEvent = (e) => {
      if (e === null || typeof e !== 'object') return { type: '?' }
      const out = { type: e.type === undefined ? '?' : e.type }
      if (typeof e.seq === 'number') out.seq = e.seq
      const d = e.data !== null && typeof e.data === 'object' ? e.data : {}
      if (typeof d.turn === 'number') out.turn = d.turn
      if (typeof d.step === 'number') out.step = d.step
      if (e.type === 'turn/end' && d.reason && typeof d.reason === 'object') {
        out.reasonKind = d.reason.kind
        if (d.reason.kind === 'aborted' && d.reason.reason && typeof d.reason.reason === 'object') out.cancelKind = d.reason.reason.kind
      }
      if (e.type === 'user/message' && d.source && typeof d.source === 'object') {
        out.srcKind = d.source.kind
        if (d.source.rpcId !== undefined) out.rpcId = String(d.source.rpcId).slice(0, 48)
      }
      if (e.type === 'assistant/message' && d.interrupted === true) out.interrupted = true
      return out
    }

    const liveLog = (sid) => {
      const agents = ctx.get('agents')
      if (agents === undefined) return null
      const agent = safe(() => agents.get(sid), 'agents.get')
      if (agent === undefined || agent === null) return null
      const session = safe(() => agent.session, 'agent.session')
      if (session === undefined || session === null) return null
      const log = safe(() => session.log, 'session.log')
      if (log === null || log === undefined || typeof log.length !== 'number') return null
      return { session, log }
    }

    const headerBrief = (session) => ({
      id: safe(() => session.header.id, 'h.id'),
      cwd: safe(() => session.header.cwd, 'h.cwd'),
      origin: safe(() => session.header.origin, 'h.origin'),
      agentPreset: safe(() => session.header.agentPreset, 'h.preset'),
      parentSession: safe(() => session.header.parentSession, 'h.parent'),
    })

    const agentBrief = (sid) => {
      const agents = ctx.get('agents')
      if (agents === undefined) return 'agents service unavailable'
      const a = safe(() => agents.get(sid), 'agents.get')
      if (a === undefined || a === null) return null
      return {
        status: safe(() => a.status, 'status'),
        hasPending: safe(() => a.inbox.hasPending === true, 'hasPending'),
      }
    }

    const aggregate = (log) => {
      const counts = {}
      const turnEnds = []
      const userMsgs = []
      const aborted = []
      let lastTurnEndRaw = null
      let lastUserMsgMeta = null
      for (let i = 0; i < log.length; i++) {
        const e = extractEvent(log[i])
        counts[e.type] = (counts[e.type] || 0) + 1
        if (e.type === 'turn/end') {
          turnEnds.push(e)
          if (e.reasonKind === 'aborted') aborted.push(e)
          try { lastTurnEndRaw = JSON.stringify(log[i]).slice(0, 400) } catch (err) { lastTurnEndRaw = 'stringify-failed:' + err.message }
        }
        if (e.type === 'user/message') {
          userMsgs.push(e)
          try {
            const ev = log[i]
            const dv = ev.data !== null && typeof ev.data === 'object' ? ev.data : {}
            lastUserMsgMeta = JSON.stringify({ turn: dv.turn === undefined ? null : dv.turn, source: dv.source === undefined ? null : dv.source, keys: Object.keys(ev) }).slice(0, 400)
          } catch (err) { lastUserMsgMeta = 'stringify-failed:' + err.message }
        }
      }
      return { logLength: log.length, counts, turnEnds: turnEnds.slice(-15), userMsgs: userMsgs.slice(-20), abortedAll: aborted, lastTurnEndRaw, lastUserMsgMeta }
    }

    const sampleSession = async (sid, cold) => {
      const out = { sessionId: sid, agent: agentBrief(sid) }
      const live = liveLog(sid)
      if (live !== null && !cold) {
        out.source = 'live session.log'
        out.header = headerBrief(live.session)
        Object.assign(out, aggregate(live.log))
        out.tail = []
        const start = Math.max(0, live.log.length - 8)
        for (let i = start; i < live.log.length; i++) out.tail.push(extractEvent(live.log[i]))
        return out
      }
      const pers = ctx.get('sessionPersistence')
      if (pers === undefined) { out.source = 'unavailable'; out.error = 'live log unreadable and sessionPersistence absent' ; return out }
      const r = await pers.readFrom(sid, 0, undefined)
      const evs = r && r.events
      if (!Array.isArray(evs)) { out.source = 'cold'; out.error = 'readFrom returned no events array'; return out }
      out.source = 'cold sessionPersistence.readFrom'
      if (r.meta) out.header = { id: r.meta.id === undefined ? null : r.meta.id, cwd: r.meta.cwd === undefined ? null : r.meta.cwd, origin: r.meta.origin === undefined ? null : r.meta.origin, agentPreset: r.meta.agentPreset === undefined ? null : r.meta.agentPreset }
      Object.assign(out, aggregate(evs))
      out.tail = []
      const start2 = Math.max(0, evs.length - 8)
      for (let i = start2; i < evs.length; i++) out.tail.push(extractEvent(evs[i]))
      return out
    }

    const unwrap = (r) => (r && r.payload !== undefined ? r.payload : r)
    const selfId = (exec) => { try { return exec.agent.session.header.id } catch (e) { return null } }
    const def = (name, description, parameters, execute) => Object.assign(
      { name, description, parameters },
      { output: { schema: { type: 'object', additionalProperties: true }, render: (args, v) => [{ type: 'text', text: JSON.stringify(v).slice(0, 6000) }] }, execute },
    )

    const reg = (name, desc, params, exec) => harness.registerTool(ctx, harness.defineTool(def(name, desc, params, exec)))

    reg('stopa_scan',
      'STOPA 探针：读任意会话 log 聚合（counts/turnEnds 最近15/userMsgs 最近20/全部 aborted 记录/尾部8条）。cold=true 走 sessionPersistence.readFrom 持久层交叉验证。缺省=当前会话 live',
      { type: 'object', properties: { sessionId: { type: 'string' }, cold: { type: 'boolean' } } },
      async (args, exec) => sampleSession((args && args.sessionId) || selfId(exec), args && args.cold === true))

    reg('stopa_create',
      'STOPA 探针：经 ctx.agents.create 造测试会话+agent（AgentHandle.dispose 可清理；回退裸会话 prepare+enter+announce）',
      { type: 'object', properties: { note: { type: 'string' } } },
      async (args, exec) => {
        const agents = ctx.get('agents')
        if (agents === undefined || typeof agents.create !== 'function') return { error: 'agents.create unavailable' }
        const cwd = safe(() => agents.get(selfId(exec)).session.header.cwd, 'cwd')
        const id = 'stopa-t-' + Date.now().toString(36).slice(-6)
        const meta = typeof cwd === 'string' && cwd.startsWith('/') ? { cwd } : {}
        try {
          const handle = await agents.create({ sessionId: id, meta })
          created.set(id, { dispose: () => handle.dispose() })
          return { sessionId: id, path: 'agents.create', cwd: meta.cwd || null }
        } catch (e) {
          const sessions = ctx.get('sessions')
          if (sessions === undefined) return { error: 'agents.create failed and sessions unavailable: ' + (e && e.message ? e.message : String(e)) }
          const sid = id + '-b'
          const session = sessions.prepare(sid, { meta })
          const detach = sessions.enter(session)
          try { sessions.announce(session) } catch (e2) { detach(); throw e2 }
          ctx.effect(() => detach, 'stopa-test-session-' + sid)
          created.set(sid, { detach })
          return { sessionId: sid, path: 'bare-fallback(' + (e && e.message ? e.message : String(e)) + ')', note: '裸会话无法被 prompt 接管，仅用于读路径验证' }
        }
      })

    reg('stopa_prompt',
      'STOPA 探针：apiProxy.sessions.prompt 向指定会话注入消息（mode=queue）+ 等待 waitMs 后采样',
      { type: 'object', properties: { sessionId: { type: 'string' }, text: { type: 'string' }, mode: { type: 'string' }, waitMs: { type: 'number' } }, required: ['sessionId', 'text'] },
      async (args) => {
        const apiProxy = ctx.get('apiProxy')
        if (apiProxy === undefined) return { error: 'apiProxy unavailable' }
        try {
          const r = await apiProxy.sessions.prompt({ rpcId: 'stopa-prm-' + Date.now(), payload: { sessionId: args.sessionId, mode: args.mode || 'queue', content: [{ type: 'text', text: args.text }] } })
          await ctx.timeout(args.waitMs === undefined ? 1500 : args.waitMs)
          const sample = await sampleSession(args.sessionId, false)
          return { rpc: unwrap(r), sample }
        } catch (e) {
          return { error: e && e.message ? e.message : String(e) }
        }
      })

    reg('stopa_cancel',
      'STOPA 探针：apiProxy.sessions.cancel（=UI Stop 同路径 agent.cancel({kind:user},{keepInbox:true})）+ 等待 waitMs 后采样',
      { type: 'object', properties: { sessionId: { type: 'string' }, waitMs: { type: 'number' } }, required: ['sessionId'] },
      async (args) => {
        const apiProxy = ctx.get('apiProxy')
        if (apiProxy === undefined) return { error: 'apiProxy unavailable' }
        try {
          const r = await apiProxy.sessions.cancel({ rpcId: 'stopa-cancel-' + Date.now(), payload: { sessionId: args.sessionId } })
          await ctx.timeout(args.waitMs === undefined ? 600 : args.waitMs)
          const sample = await sampleSession(args.sessionId, false)
          return { rpc: unwrap(r), sample }
        } catch (e) {
          return { error: e && e.message ? e.message : String(e) }
        }
      })

    reg('stopa_events',
      'STOPA 探针：读取捕获的实时事件流（agent/status|created|disposed、inbox/*、session/event；cap 500；clear=true 读后清空）',
      { type: 'object', properties: { clear: { type: 'boolean' }, filterId: { type: 'string' } } },
      async (args) => {
        const fid = args && args.filterId
        const list = fid ? events.filter((e) => e.id === fid) : events.slice()
        if (args && args.clear) events.length = 0
        return { count: list.length, events: list }
      })

    reg('stopa_cleanup',
      'STOPA 探针：清理本探针创建的测试会话（agents.dispose 或 enter detach）',
      { type: 'object', properties: {} },
      async () => {
        const result = []
        for (const [id, entry] of created) {
          if (entry.dispose) { try { await entry.dispose(); result.push({ id, cleaned: true, via: 'agents.dispose' }) } catch (e) { result.push({ id, cleaned: false, error: e.message }) } }
          else if (entry.detach) { try { entry.detach(); result.push({ id, cleaned: true, via: 'session-detach' }) } catch (e) { result.push({ id, cleaned: false, error: e.message }) } }
          else result.push({ id, cleaned: false, note: 'create-path 无 detach，残留（undefine 后仍在会话列表）' })
          created.delete(id)
        }
        return { cleaned: result }
      })
  },
}
