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
    const entry = { instanceId, dir, meta, engine, storage }
    engines.set(instanceId, entry)
    if (opts.sessionId) activeBySession.set(opts.sessionId, instanceId)
    return entry
  }

  // ── 会话当前活跃实例；未命中则按实例目录惰性恢复（DSH 重启后首次调用）────
  async function forSession(exec) {
    const sessionId = sessionIdOf(exec)
    const hit = sessionId ? activeBySession.get(sessionId) : undefined
    if (hit && engines.get(hit)) return engines.get(hit)
    const cwd = (function () {
      try {
        const c = exec && exec.agent && exec.agent.session && exec.agent.session.header && exec.agent.session.header.cwd
        return typeof c === 'string' && c ? c : undefined
      } catch (e) {
        return undefined
      }
    })()
    if (!cwd) return undefined
    const restored = await hydrateLatest(cwd, sessionId)
    if (!restored) return undefined
    if (sessionId) activeBySession.set(sessionId, restored.instanceId)
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
    const matched = sessionId ? candidates.find(c => c.meta.sessionId === sessionId) : null
    const best = matched || candidates.sort((a, b) => String(b.meta.createdAt || '').localeCompare(String(a.meta.createdAt || '')))[0]
    const dir = instanceDirPath(cwd, best.meta.instanceId)
    const engine = deps.createWorkflowEngine()
    const storage = deps.createWorkflowStorage(ctx, engine)
    storage.setInstanceDir(dir)
    engine.hydrate(best.state)
    const entry = { instanceId: best.meta.instanceId, dir, meta: best.meta, engine, storage }
    engines.set(entry.instanceId, entry)
    return entry
  }

  return {
    beginInstance,
    forSession,
    hydrateLatest,
    get,
    activeIdFor,
    sessionIdOf,
    engines,
    activeBySession,
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { slugifyName, makeUuid8, instancesRootPath, instanceDirPath, composeMetadata, createInstanceRegistry }
}
