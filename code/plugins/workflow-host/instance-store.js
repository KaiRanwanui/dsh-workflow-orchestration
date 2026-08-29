// ============================================================================
// workflow-agent — 实例注册表与目录布局（Iter-10 多实例存储）
// 文件：code/plugins/workflow-host/instance-store.js
// 说明：多实例的核心数据结构与目录约定。
//       目录布局（锚点 = session cwd；DSH 沙箱按 session 解析，"A session cwd
//       is its workspace-write boundary"，实例目录建在会话工作区内即拥有完全
//       本地读写权限；Iter-9 探针证实 fs 嵌套写/读回可用）：
//         <cwd>/.workflow-agent/instances/<instanceId>/
//           ├── instance.yaml   # 实例定义快照（源 YAML + 参数注释头，源定义只读）
//           ├── state.json      # engine snapshot（storage.setInstanceDir 落点）
//           ├── metadata.json   # { instanceId, workflowName, sessionId, ... }
//           ├── output/         # 每实例产物
//           └── logs/           # 每实例日志
//       实例 id = slug(workflowName) + '-' + uuid8（设计文档定稿；
//       Iter-9 证实 session id 唯一 guard，uuid8 天然防撞）。
//       metadata.json 是 instanceId↔sessionId 的主映射（重启后惰性 hydrate 依据：
//       session id 跨重启稳定，按 sessionId 精确匹配优先、createdAt 最新兜底）。
// 依赖：ctx（fs）；engine/storage 工厂由 deps 注入（便于 Node 单测）。
// ============================================================================

// ── 工作流名 → 实例 id 前缀（安全文件名片段）────────────────────────────────
function slugifyName(name) {
  const s = String(name || '').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return s || 'wf'
}

// ── 8 位十六进制唯一后缀（时间尾 + 随机，实例级足够；目录重名由唯一性兜底）──
function makeUuid8() {
  return (Date.now().toString(16).slice(-4) + Math.random().toString(16).slice(2, 6)).slice(0, 8)
}

// ── 路径计算 ────────────────────────────────────────────────────────────────
function normalizeDir(p) {
  return String(p || '').replace(/\\/g, '/').replace(/\/+$/, '')
}

function instancesRootPath(cwd) {
  return (normalizeDir(cwd) + '/.workflow-agent/instances').replace(/\/+/g, '/')
}

function instanceDirPath(cwd, instanceId) {
  return instancesRootPath(cwd) + '/' + instanceId
}

// Iter-17：归档库路径（<cwd>/.workflow-agent/archive；移出池只读，Iter-19 起使用）
function archiveRootPath(cwd) {
  return (normalizeDir(cwd) + '/.workflow-agent/archive').replace(/\/+/g, '/')
}

// Iter-18：归档目录时间戳（YYYYMMDDTHHMMSSZ，与 lifecycle-design §7 一致）
function archiveTimestamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')
}

// ── metadata.json 组装（lossless JSON；sessionId 缺省 null 而非 undefined）──
function composeMetadata(m) {
  return {
    instanceId: m.instanceId,
    workflowName: m.workflowName,
    sessionId: m.sessionId === undefined ? null : m.sessionId,
    sessionCwd: m.sessionCwd || null,
    sourcePath: m.sourcePath || null,
    params: m.params && typeof m.params === 'object' ? m.params : {},
    createdAt: m.createdAt || new Date().toISOString(),
  }
}

// ── 实例注册表：instanceId → {engine, storage, meta}；sessionId → 活跃实例 ──
function createInstanceRegistry(ctx, deps) {
  const engines = new Map()        // instanceId -> entry
  const activeBySession = new Map() // sessionId -> instanceId
  // Iter-18：会话存活判定（孤儿识别依赖）。生产由 apply 注入 sessions 服务包装，
  // 测试注入可控 stub；缺省恒 true（不误判孤儿，保持既有行为）。
  const isSessionLive = typeof deps.isSessionLive === 'function' ? deps.isSessionLive : (() => true)
  // Iter-19：会话 agent 是否运行中（Session 启停同步依赖）。生产由 apply 注入 agents 服务包装；
  // 缺省返回 undefined（无法判定 → 不触发同步，保持既有行为）。
  const isAgentRunning = typeof deps.isAgentRunning === 'function' ? deps.isAgentRunning : (() => undefined)

  function get(instanceId) {
    return engines.get(instanceId)
  }

  function activeIdFor(sessionId) {
    return activeBySession.get(sessionId)
  }

  // 工具执行上下文 → sessionId（与 tools-preset 的 sessionCwd 同构）
  function sessionIdOf(exec) {
    try {
      const id = exec && exec.agent && exec.agent.session && exec.agent.session.header && exec.agent.session.header.id
      return typeof id === 'string' && id.length > 0 ? id : undefined
    } catch (e) {
      return undefined
    }
  }

  // ── 创建实例目录 + 引擎条目（workflow_begin 成功路径调用）────────────────
  async function beginInstance(opts) {
    const fs = ctx.get('fs')
    if (!fs) throw new Error('fs service unavailable')
    const cwd = normalizeDir(opts.cwd)
    if (!cwd) throw new Error('session cwd 未提供，无法创建实例目录')
    await ensureWorkspaceSkeleton(cwd) // Iter-17：首次挂接物化骨架（instances/ + archive/）
    const workflowName = opts.workflowName || 'wf'
    const instanceId = slugifyName(workflowName) + '-' + makeUuid8()
    const dir = instanceDirPath(cwd, instanceId)
    const meta = composeMetadata({
      instanceId,
      workflowName,
      sessionId: opts.sessionId,
      sessionCwd: cwd,
      sourcePath: opts.sourcePath,
      params: opts.params,
    })
    // 目录 + 固定文件（fs.writeText 自动建父目录；Iter-9 探针 P7 已验证嵌套写）
    await fs.writeText(await fs.resolve(dir + '/metadata.json'), JSON.stringify(meta, null, 2))
    const header = [
      '# workflow 实例定义快照（参数化副本；源定义文件保持只读）',
      '# source: ' + (opts.sourcePath || '(inline workflowText)'),
      '# instanceId: ' + instanceId,
      '# createdAt: ' + meta.createdAt,
      '# params: ' + JSON.stringify(opts.params || {}),
      '',
    ].join('\n')
    await fs.writeText(await fs.resolve(dir + '/instance.yaml'), header + String(opts.sourceText || ''))
    await fs.writeText(await fs.resolve(dir + '/output/.gitkeep'), '')
    await fs.writeText(await fs.resolve(dir + '/logs/.gitkeep'), '')
    // 引擎 + 存储（engine 零改造；存储落点 = 实例目录 state.json）
    const engine = deps.createWorkflowEngine()
    const storage = deps.createWorkflowStorage(ctx, engine)
    storage.setInstanceDir(dir)
    const entry = { instanceId, dir, meta, engine, storage, hasState: false }
    engines.set(instanceId, entry)
    if (opts.sessionId) activeBySession.set(opts.sessionId, instanceId)
    return entry
  }

  // 工具执行上下文 → 会话 cwd（Iter-11：操控工具的实例定位锚点）
  function sessionCwdOf(exec) {
    try {
      const c = exec && exec.agent && exec.agent.session && exec.agent.session.header && exec.agent.session.header.cwd
      return typeof c === 'string' && c ? c : undefined
    } catch (e) {
      return undefined
    }
  }

  // ── 会话当前活跃实例；未命中则按实例目录惰性恢复（DSH 重启后首次调用）────
  async function forSession(exec) {
    const sessionId = sessionIdOf(exec)
    const hit = sessionId ? activeBySession.get(sessionId) : undefined
    if (hit && engines.get(hit)) {
      await syncInstanceState(sessionCwdOf(exec), hit) // Iter-19：Session 启停同步
      return engines.get(hit)
    }
    const cwd = sessionCwdOf(exec)
    if (!cwd) return undefined
    const restored = await hydrateLatest(cwd, sessionId)
    if (!restored) return undefined
    if (sessionId) activeBySession.set(sessionId, restored.instanceId)
    await syncInstanceState(cwd, restored.instanceId) // Iter-19：Session 启停同步
    return restored
  }

  // ── 扫描实例目录恢复最新实例（metadata.sessionId 精确匹配优先）────────────
  async function hydrateLatest(cwd, sessionId) {
    const fs = ctx.get('fs')
    if (!fs) return undefined
    let dirs = []
    try {
      const entries = await fs.listDir(await fs.resolve(instancesRootPath(cwd)))
      dirs = entries.filter(en => en.type === 'directory').map(en => en.name)
    } catch (e) {
      return undefined // 无 instances 目录（该 cwd 从未运行过实例）
    }
    const candidates = []
    for (const id of dirs) {
      try {
        const meta = JSON.parse(await fs.readText(await fs.resolve(instanceDirPath(cwd, id) + '/metadata.json')))
        if (!meta || meta.instanceId !== id) continue
        const state = JSON.parse(await fs.readText(await fs.resolve(instanceDirPath(cwd, id) + '/state.json')))
        if (!state || !state.workflow) continue
        candidates.push({ meta, state })
      } catch (e) { /* 残缺实例目录跳过 */ }
    }
    if (candidates.length === 0) return undefined
    // Iter-20：只返回声明了该 sessionId 的实例；会话未绑定（UNBOUND）→ undefined。
    // 绝不回退取"工作区最新实例"（那可能是别的会话的，导致归属污染/空态误显示 DAG/Start 注入错实例）。
    const matched = sessionId ? candidates.find(c => c.meta.sessionId === sessionId) : null
    if (!matched) return undefined
    const best = matched
    const dir = instanceDirPath(cwd, best.meta.instanceId)
    const engine = deps.createWorkflowEngine()
    const storage = deps.createWorkflowStorage(ctx, engine)
    storage.setInstanceDir(dir)
    engine.hydrate(best.state)
    const entry = { instanceId: best.meta.instanceId, dir, meta: best.meta, engine, storage }
    engines.set(entry.instanceId, entry)
    return entry
  }

  // ── Iter-11：精确加载实例为条目（有 state.json 则 hydrate；无则为空白引擎）──
  // 返回 entry 或 undefined（目录/metadata 不存在）。opts.active=true 时标记为
  // 当前会话活跃实例。
  async function loadEntry(cwd, instanceId, opts) {
    const fs = ctx.get('fs')
    if (!fs || !instanceId) return undefined
    const dir = instanceDirPath(cwd, instanceId)
    let meta
    try {
      meta = JSON.parse(await fs.readText(await fs.resolve(dir + '/metadata.json')))
    } catch (e) {
      return undefined // 目录或 metadata 不存在
    }
    if (!meta || meta.instanceId !== instanceId) return undefined
    const existing = engines.get(instanceId)
    if (existing) {
      if (opts && opts.active) {
        const sid = opts.sessionId || meta.sessionId
        if (sid) activeBySession.set(sid, instanceId)
      }
      return existing
    }
    const engine = deps.createWorkflowEngine()
    const storage = deps.createWorkflowStorage(ctx, engine)
    storage.setInstanceDir(dir)
    let hasState = false
    try {
      const state = JSON.parse(await fs.readText(await fs.resolve(dir + '/state.json')))
      if (state && state.workflow) {
        engine.hydrate(state)
        hasState = true
      }
    } catch (e) { /* 无 state.json → CREATED 阶段的空白条目 */ }
    const entry = { instanceId, dir, meta, engine, storage, hasState }
    engines.set(instanceId, entry)
    if (opts && opts.active) {
      const sid = opts.sessionId || meta.sessionId
      if (sid) activeBySession.set(sid, instanceId)
    }
    return entry
  }

  // ── Iter-11：操控工具的实例解析（显式 instanceId 优先，缺省走会话活跃）────
  async function resolveEntry(exec, instanceId, opts) {
    const cwd = sessionCwdOf(exec)
    if (instanceId) {
      if (!cwd) return undefined
      return loadEntry(cwd, instanceId, opts)
    }
    return forSession(exec)
  }

  // ── Iter-11：列出当前 cwd 下全部实例（metadata + state 摘要，createdAt 倒序）──
  // phase: 'CREATED'（仅目录，未启动过）| 'READY'（有 state.json）
  // ── Iter-20：轻量会话绑定态（BOUND/UNBOUND/BROKEN）──────────────
  // 供 /wf/list 等轮询路径 gating 用：只扫描 metadata.sessionId，不物化骨架、不整树扫描。
  // （session 状态按设计是派生的，无存储字段；这里给一个轻量判定。）
  async function sessionBindState(cwd, sessionId) {
    if (!sessionId) return { state: 'UNBOUND' }
    const fs = ctx.get('fs')
    if (!fs) return { state: 'UNBOUND' }
    let dirs = []
    try {
      const ins = await fs.listDir(await fs.resolve(instancesRootPath(cwd)))
      dirs = ins.filter(en => en.type === 'directory').map(en => en.name)
    } catch (e) { return { state: 'UNBOUND' } }
    let bound = null
    for (const id of dirs) {
      const meta = await tryReadMeta(cwd, id)
      if (meta && meta.sessionId === sessionId) {
        if (bound) return { state: 'BROKEN', reason: 'CONFLICT: 会话被多实例占用/' + sessionId }
        bound = { id, meta }
      }
    }
    if (bound) return { state: 'BOUND', instanceId: bound.id }
    return { state: 'UNBOUND' }
  }

  async function listInstances(cwd) {
    const fs = ctx.get('fs')
    if (!fs) return []
    let dirs = []
    try {
      const entries = await fs.listDir(await fs.resolve(instancesRootPath(cwd)))
      dirs = entries.filter(en => en.type === 'directory').map(en => en.name)
    } catch (e) {
      return [] // 无 instances 目录
    }
    const out = []
    for (const id of dirs) {
      try {
        const meta = JSON.parse(await fs.readText(await fs.resolve(instanceDirPath(cwd, id) + '/metadata.json')))
        if (!meta || meta.instanceId !== id) continue
        const item = {
          instanceId: id,
          workflowName: meta.workflowName,
          sessionId: meta.sessionId || null,
          createdAt: meta.createdAt || null,
          lastResetAt: meta.lastResetAt || null,
          phase: 'CREATED',
          stage: null,
          active: !!meta.sessionId && activeBySession.get(meta.sessionId) === id,
          taskTotal: 0,
          taskDone: 0,
          taskFailed: 0,
        }
        // Iter-20(R4)：绑定实例先做 Session 启停同步（idle→stop / running→resume），列表不再见过期 RUNNING
        const entry = meta.sessionId ? await syncInstanceState(cwd, id) : undefined
        if (entry && entry.hasState) {
          const snap = entry.engine.snapshot()
          item.phase = 'READY'
          item.stage = snap.stage
          item.taskTotal = snap.tasks.length
          item.taskDone = snap.tasks.filter(t => t.status === 'DONE').length
          item.taskFailed = snap.tasks.filter(t => t.status === 'FAILED').length
        } else {
          try {
            const state = JSON.parse(await fs.readText(await fs.resolve(instanceDirPath(cwd, id) + '/state.json')))
            if (state && state.workflow) {
              item.phase = 'READY'
              item.stage = state.stage || null
              const tasks = Array.isArray(state.tasks) ? state.tasks : []
              item.taskTotal = tasks.length
              item.taskDone = tasks.filter(t => t.status === 'DONE').length
              item.taskFailed = tasks.filter(t => t.status === 'FAILED').length
            }
          } catch (e) { /* 无 state.json → CREATED */ }
        }
        out.push(item)
      } catch (e) { /* 残缺实例目录跳过 */ }
    }
    out.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    return out
  }

  // ── Iter-11：更新实例 metadata 的辅助字段（如 reset 的 lastResetAt）────────
  async function patchMeta(cwd, instanceId, patch) {
    const fs = ctx.get('fs')
    if (!fs) return undefined
    const p = instanceDirPath(cwd, instanceId) + '/metadata.json'
    try {
      const meta = JSON.parse(await fs.readText(await fs.resolve(p)))
      if (!meta || meta.instanceId !== instanceId) return undefined
      const next = Object.assign({}, meta, patch || {})
      await fs.writeText(await fs.resolve(p), JSON.stringify(next, null, 2))
      const entry = engines.get(instanceId)
      if (entry) entry.meta = next
      return next
    } catch (e) {
      return undefined
    }
  }

  // ── Iter-17：工作区骨架物化（instances/ + archive/）────────────────────────
  // 首次挂接 workflow 会话时调用；幂等。落 .gitkeep 标记，mock/真实 fs 均物化目录
  // （fs.writeText 自动建父目录）。骨架在场是完整性判定（checkWorkspaceTreeIntegrity）
  // 的前置，但物化本身不判定缺场（缺场=删除后异常，由完整性检查单独识别根异常）。
  async function ensureWorkspaceSkeleton(cwd) {
    const fs = ctx.get('fs')
    if (!fs) throw new Error('fs service unavailable')
    const root = (normalizeDir(cwd) + '/.workflow-agent').replace(/\/+/g, '/')
    await fs.writeText(await fs.resolve(root + '/instances/.gitkeep'), '')
    await fs.writeText(await fs.resolve(root + '/archive/.gitkeep'), '')
    return root
  }

  // 读取某实例的有效 metadata（能解析且 instanceId 匹配目录名；否则视为损坏）
  async function tryReadMeta(cwd, instanceId) {
    const fs = ctx.get('fs')
    const p = instanceDirPath(cwd, instanceId) + '/metadata.json'
    try {
      const meta = JSON.parse(await fs.readText(await fs.resolve(p)))
      if (!meta || meta.instanceId !== instanceId) return null
      return meta
    } catch (e) {
      return null
    }
  }

  // 扫描 archive/<instanceId>/<ts>_<kind>_<state>/metadata.json 是否含绑定 sessionId
  // （Iter-19 起产生归档；DONE 派生依赖。当前无归档时恒 false）。
  async function archiveDeclaresSession(cwd, sessionId) {
    const fs = ctx.get('fs')
    let instanceDirs = []
    try {
      const ar = await fs.listDir(await fs.resolve(archiveRootPath(cwd)))
      instanceDirs = ar.filter(en => en.type === 'directory').map(en => en.name)
    } catch (e) {
      return false // 无 archive
    }
    for (const iid of instanceDirs) {
      let subDirs = []
      try {
        const subs = await fs.listDir(await fs.resolve(archiveRootPath(cwd) + '/' + iid))
        subDirs = subs.filter(en => en.type === 'directory').map(en => en.name)
      } catch (e) { continue }
      for (const sub of subDirs) {
        try {
          const m = JSON.parse(await fs.readText(await fs.resolve(archiveRootPath(cwd) + '/' + iid + '/' + sub + '/metadata.json')))
          if (m && m.sessionId === sessionId) return true
        } catch (e) { /* skip */ }
      }
    }
    return false
  }

  // ── Iter-17：整树完整性判定（纯完整性，不设独立绑定指针）────────────────
  // 判定标准 = .workflow-agent 整树：在场且自洽 → ok；骨架缺场 / 退化（实例目录
  // 损坏）/ 冲突（1:1 违反）→ not ok。返回 {ok, reason?, instances, archives}。
  async function checkWorkspaceTreeIntegrity(cwd) {
    const fs = ctx.get('fs')
    if (!fs) return { ok: false, reason: 'fs-unavailable' }
    const agentRoot = (normalizeDir(cwd) + '/.workflow-agent').replace(/\/+/g, '/')
    let children = []
    try {
      children = await fs.listDir(await fs.resolve(agentRoot))
    } catch (e) {
      // 未物化（更从未运行过）→ 空，非 BROKEN（首挂接由 ensureWorkspaceSkeleton 物化）
      return { ok: true, instances: [], archives: [] }
    }
    const dirs = children.filter(c => c.type === 'directory').map(c => c.name)
    // 骨架在场校验：agentRoot 有内容时必须含 instances/（archive/ 由物化补齐）
    if (children.length > 0 && !dirs.includes('instances')) {
      return { ok: false, reason: 'SKELETON_MISSING: 骨架缺场（缺 instances/）' }
    }
    let instanceDirs = []
    try {
      const ins = await fs.listDir(await fs.resolve(instancesRootPath(cwd)))
      instanceDirs = ins.filter(en => en.type === 'directory').map(en => en.name)
    } catch (e) {
      instanceDirs = []
    }
    const seenSession = new Map() // sessionId -> instanceId
    const instances = []
    for (const id of instanceDirs) {
      const meta = await tryReadMeta(cwd, id)
      if (!meta) return { ok: false, reason: 'CORRUPT: 实例目录损坏/' + id }
      instances.push({ id, meta })
      if (meta.sessionId) {
        if (seenSession.has(meta.sessionId)) {
          return { ok: false, reason: 'CONFLICT: 会话被多实例占用/' + meta.sessionId }
        }
        seenSession.set(meta.sessionId, id)
      }
    }
    let archives = []
    try {
      const ar = await fs.listDir(await fs.resolve(archiveRootPath(cwd)))
      archives = ar.filter(en => en.type === 'directory').map(en => en.name)
    } catch (e) { archives = [] }
    return { ok: true, instances, archives }
  }

  // ── Iter-17：派生会话状态（UNBOUND/BOUND/DONE/BROKEN）─────────────────────
  // 权威在实例侧；会话状态不定存，实时从实例+整树派生，不侵入 DSH Session。
  // BOUND=恰好一个结构完好实例声明 S；DONE=archive 声明 S；UNBOUND=无声明；
  // BROKEN=整树损坏/冲突。
  async function deriveSessionState(cwd, sessionId) {
    await ensureWorkspaceSkeleton(cwd)
    const integ = await checkWorkspaceTreeIntegrity(cwd)
    if (!integ.ok) return { state: 'BROKEN', reason: integ.reason }
    const bound = integ.instances.filter(x => x.meta.sessionId === sessionId)
    if (bound.length === 1) return { state: 'BOUND', instanceId: bound[0].id }
    if (bound.length > 1) return { state: 'BROKEN', reason: 'CONFLICT: 会话被多实例占用/' + sessionId }
    if (await archiveDeclaresSession(cwd, sessionId)) return { state: 'DONE' }
    return { state: 'UNBOUND' }
  }

  // ── Iter-19：解绑冲突实例（数据自愈，明确告知用户）────────────────────────
  // CONFLICT（同 sessionId 被多实例声明）不该让整工作区永久 BROKEN。
  // 策略：不自动"保留最新"（可能非当前会话实例），而是在用户新建实例时，把
  // 所有涉及冲突绑定的实例解绑（sessionId→null 回 UNBOUND 池），新建实例绑定
  // 当前会话；调用方须把 unbound 列表明确告知用户。
  async function recoverBindingConflicts(cwd) {
    const fs = ctx.get('fs')
    if (!fs) return { unbound: [], conflicts: [] }
    let dirs = []
    try {
      const ins = await fs.listDir(await fs.resolve(instancesRootPath(cwd)))
      dirs = ins.filter(en => en.type === 'directory').map(en => en.name)
    } catch (e) { return { unbound: [], conflicts: [] } }
    const metas = []
    for (const id of dirs) {
      const meta = await tryReadMeta(cwd, id)
      if (meta && meta.sessionId) metas.push({ id, meta })
    }
    const cnt = new Map()
    for (const { meta } of metas) cnt.set(meta.sessionId, (cnt.get(meta.sessionId) || 0) + 1)
    const conflicted = new Set([...cnt].filter(([s, c]) => c > 1).map(([s]) => s))
    const unbound = []
    for (const { id, meta } of metas) {
      if (conflicted.has(meta.sessionId)) {
        await patchMeta(cwd, id, { sessionId: null })
        activeBySession.delete(meta.sessionId)
        unbound.push(id)
      }
    }
    return { unbound, conflicts: [...conflicted] }
  }

  // ── Iter-17：create-bind（UNBOUND→BOUND，新建实例并写 metadata.sessionId=S）──
  async function createBind(cwd, sessionId, opts) {
    if (!sessionId) throw new Error('createBind 需要 sessionId')
    await ensureWorkspaceSkeleton(cwd)
    let integ = await checkWorkspaceTreeIntegrity(cwd)
    let recovered = []
    // Iter-19：CONFLICT 自愈——不解绑"最新"，而是把冲突的旧实例解绑回池，再新建当前绑定
    if (!integ.ok && /^CONFLICT/.test(integ.reason || '')) {
      const rec = await recoverBindingConflicts(cwd)
      recovered = rec.unbound
      integ = await checkWorkspaceTreeIntegrity(cwd)
    }
    if (!integ.ok) throw new Error('工作区完整性异常，无法绑定: ' + integ.reason)
    if (integ.instances.some(x => x.meta.sessionId === sessionId)) {
      throw new Error('会话 ' + sessionId + ' 已绑定实例（1:1 守卫，禁再绑）')
    }
    const entry = await beginInstance(Object.assign({}, opts, { cwd, sessionId }))
    entry._recoveredConflict = recovered // 供 route/tool 明确告知用户
    return entry
  }

  // ── Iter-17：adopt（UNBOUND→BOUND，采用池中 sessionId==null 实例并写 S）──
  async function adoptInstance(cwd, sessionId, instanceId) {
    const fs = ctx.get('fs')
    if (!fs) throw new Error('fs service unavailable')
    if (!sessionId) throw new Error('adopt 需要 sessionId')
    await ensureWorkspaceSkeleton(cwd)
    const integ = await checkWorkspaceTreeIntegrity(cwd)
    if (!integ.ok) throw new Error('工作区完整性异常，无法采用: ' + integ.reason)
    if (integ.instances.some(x => x.meta.sessionId === sessionId)) {
      throw new Error('会话 ' + sessionId + ' 已绑定实例（1:1 守卫，禁再绑）')
    }
    const target = integ.instances.find(x => x.id === instanceId)
    if (!target) throw new Error('实例不存在: ' + instanceId)
    if (target.meta.sessionId) {
      throw new Error('实例 ' + instanceId + ' 已被会话占用（sessionId=' + target.meta.sessionId + '），不可采用')
    }
    // 运行态守卫：RUNNING 实例须先 stop 再采用（避免两会话驱动同一 RUNNING 实例）
    let stage = null
    try {
      const st = JSON.parse(await fs.readText(await fs.resolve(instanceDirPath(cwd, instanceId) + '/state.json')))
      if (st && st.workflow) stage = st.stage || null
    } catch (e) { /* 无 state */ }
    if (stage === 'RUNNING') throw new Error('实例 ' + instanceId + ' 运行中，先 stop 再采用')
    await patchMeta(cwd, instanceId, { sessionId })
    activeBySession.set(sessionId, instanceId)
    return loadEntry(cwd, instanceId, { active: true })
  }

  // ── Iter-18：孤儿识别（绑定会话离开 live store 的实例）────────────────────
  // 判定 = !isSessionLive(boundSessionId)；归档≠死亡（归档仅改 UI，会话仍 live）。
  async function scanOrphans(cwd) {
    const integ = await checkWorkspaceTreeIntegrity(cwd)
    if (!integ.ok) return []
    const orphans = []
    for (const inst of integ.instances) {
      const sid = inst.meta.sessionId
      if (sid && !isSessionLive(sid)) orphans.push({ id: inst.id, sessionId: sid })
    }
    return orphans
  }

  // ── Iter-18：孤儿回收（RUNNING 先 stop → 解绑→保留 state.json 回 UNBOUND 池）──
  async function recoverOrphan(cwd, instanceId) {
    const entry = await loadEntry(cwd, instanceId)
    if (!entry) throw new Error('实例不存在: ' + instanceId)
    const sid = entry.meta.sessionId
    if (!sid) throw new Error('实例 ' + instanceId + ' 无绑定，非孤儿')
    if (isSessionLive(sid)) throw new Error('实例 ' + instanceId + ' 绑定会话仍存活，非孤儿')
    // RUNNING 先 stop（保留 DONE 进度）
    if (entry.hasState) {
      const st = entry.engine.snapshot()
      if (st.stage === 'RUNNING') entry.engine.stop()
    }
    await patchMeta(cwd, instanceId, { sessionId: null })
    activeBySession.delete(sid)
    return loadEntry(cwd, instanceId)
  }

  // ── Iter-18：写归档备份（reset 用 kind=reset；显式归档用 kind=archive，Iter-19）──
  // 复制实例内容到 archive/<instanceId>/<ts>_<kind>_<state>/ + manifest.json。
  async function writeArchiveBackup(cwd, instanceId, kind, state) {
    const fs = ctx.get('fs')
    if (!fs) throw new Error('fs service unavailable')
    const ts = archiveTimestamp()
    const dest = archiveRootPath(cwd) + '/' + instanceId + '/' + ts + '_' + kind + '_' + state
    const src = instanceDirPath(cwd, instanceId)
    for (const f of ['metadata.json', 'instance.yaml', 'state.json']) {
      try {
        const text = await fs.readText(await fs.resolve(src + '/' + f))
        await fs.writeText(await fs.resolve(dest + '/' + f), text)
      } catch (e) { /* 实例可能无该文件（如 CREATED 无 state.json） */ }
    }
    for (const sub of ['output', 'logs']) {
      try {
        const entries = await fs.listDir(await fs.resolve(src + '/' + sub))
        for (const en of entries) {
          if (en.type !== 'file') continue
          try {
            const text = await fs.readText(await fs.resolve(src + '/' + sub + '/' + en.name))
            await fs.writeText(await fs.resolve(dest + '/' + sub + '/' + en.name), text)
          } catch (e) { /* skip */ }
        }
      } catch (e) { /* skip */ }
    }
    const meta = await tryReadMeta(cwd, instanceId)
    const manifest = {
      kind,
      state,
      reason: kind === 'reset' ? 'reset_backup' : 'archive',
      archivedAt: new Date().toISOString(),
      workflowName: meta ? meta.workflowName : null,
    }
    await fs.writeText(await fs.resolve(dest + '/manifest.json'), JSON.stringify(manifest, null, 2))
    return dest
  }

  // ── Iter-19：Session 启停同步（前后台状态配合）────────────────────────────
  // 用户起停 DSH Session（agent idle⇄running）时，绑定实例状态需对齐：
  //   agent idle（用户停了 session）  → 实例 RUNNING 则 engine.stop() → STOPPED（保进度）
  //   agent running（用户重启 session）→ 实例 STOPPED 则 engine.resume() → RUNNING（续跑）
  // 仅在能判定 agent 状态时触发；CREATED/PENDING/COMPLETED/FAILED 不误改。
  async function syncInstanceState(cwd, instanceId) {
    const entry = await loadEntry(cwd, instanceId)
    if (!entry) return entry
    const sid = entry.meta.sessionId
    if (!sid || !isSessionLive(sid)) return entry // UNBOUND 或孤儿（孤儿由 Iter-18 回收）
    const running = isAgentRunning(sid)
    if (running === undefined || running === null) return entry // 无法判定，不触发
    const stage = entry.engine.snapshot().stage // 以引擎实际状态为准（hasState 仅缓存标记）
    if (running === false) {
      if (stage === 'RUNNING') {
        entry.engine.stop() // RUNNING→STOPPED，保 DONE 进度
        await entry.storage.save()
        entry.engine.setPersist('ok (session-idle sync)')
      }
    } else {
      if (stage === 'STOPPED') {
        entry.engine.resume() // STOPPED→RUNNING，续跑
        await entry.storage.save()
        entry.engine.setPersist('ok (session-running sync)')
      }
    }
    return entry
  }

  return {
    beginInstance,
    forSession,
    hydrateLatest,
    loadEntry,
    resolveEntry,
    listInstances,
    patchMeta,
    ensureWorkspaceSkeleton,
    checkWorkspaceTreeIntegrity,
    deriveSessionState,
    createBind,
    adoptInstance,
    recoverBindingConflicts,
    sessionBindState,
    scanOrphans,
    recoverOrphan,
    writeArchiveBackup,
    syncInstanceState,
    get,
    activeIdFor,
    sessionIdOf,
    sessionCwdOf,
    engines,
    activeBySession,
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { slugifyName, makeUuid8, instancesRootPath, instanceDirPath, archiveRootPath, archiveTimestamp, composeMetadata, createInstanceRegistry }
}
