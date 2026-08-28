// ============================================================================
// workflow-agent — 状态持久化
// 文件：code/plugins/workflow-host/storage.js
// 说明：工作流状态落盘/恢复。
//       修正记录（Iter-1 验收发现）：宿主插件没有 session 上下文，
//       sandboxPolicy.workspaceRoot 在宿主侧解析为「部署根」（DSH 安装目录），
//       直接使用会把状态写入安装目录。因此落盘位置不再依赖该 fallback，
//       改由 workflow_begin 调用方显式指定：
//         - setWorkspaceRoot(root)：状态默认写到 <root>/.workflow-agent/state.json
//         - setStatePath(path)    ：完全自定义状态文件路径
//       两者都未设置时 save() 返回错误、load() 返回 false（不抛异常、不写盘）。
// 依赖：ctx（fs）、engine（snapshot/setPersist/hydrate）。
// Iter-10：新增实例目录模式 setInstanceDir(dir)——落点 <dir>/state.json，
//          优先级高于 workspaceRoot 旧布局（<root>/.workflow-agent/state.json）。
// ============================================================================

function createWorkflowStorage(ctx, engine) {
  const sandboxPolicy = ctx.get('sandboxPolicy')

  let workspaceRoot = sandboxPolicy ? (sandboxPolicy.workspaceRoot || '') : ''
  let explicitStatePath = null
  let statePath = null
  let instanceDir = null // Iter-10：实例目录（优先级最高，落点 <instanceDir>/state.json）

  // 由调用方（workflow_begin）在运行时设置，替代宿主 fallback root
  function setWorkspaceRoot(root) {
    workspaceRoot = (root || '').replace(/\\/g, '/').replace(/\/+$/, '')
    statePath = null // 下次访问时重算
  }

  function setStatePath(p) {
    explicitStatePath = p ? String(p).replace(/\\/g, '/') : null
    statePath = null // 下次访问时重算
  }

  // Iter-10：实例目录模式（由 instance-store 的 beginInstance/hydrateLatest 设置）
  function setInstanceDir(dir) {
    instanceDir = dir ? String(dir).replace(/\\/g, '/').replace(/\/+$/, '') : null
    statePath = null
  }

  // 延迟计算状态文件绝对路径（首次读写时解析）
  async function ensurePath() {
    if (statePath) return statePath
    const fs = ctx.get('fs')
    if (!fs) return null
    if (explicitStatePath) {
      statePath = await fs.resolve(explicitStatePath)
      return statePath
    }
    if (instanceDir) {
      statePath = await fs.resolve(instanceDir + '/state.json')
      return statePath
    }
    if (!workspaceRoot) return null
    const dir = (workspaceRoot + '/.workflow-agent').replace(/\/+/g, '/')
    statePath = await fs.resolve(dir + '/state.json')
    return statePath
  }

  // 显式沙箱写策略：写策略根来自实例目录 > workspaceRoot > 状态文件父目录
  function writePolicy() {
    let root = instanceDir || workspaceRoot
    if (!root && explicitStatePath) {
      const idx = explicitStatePath.lastIndexOf('/')
      root = idx > 0 ? explicitStatePath.slice(0, idx) : explicitStatePath
    }
    return {
      mode: 'workspace-write',
      workspaceRoot: root || '',
    }
  }

  async function save() {
    const fs = ctx.get('fs')
    if (!fs) return 'err: no fs'
    try {
      const p = await ensurePath()
      if (!p) return 'err: no workspaceRoot/statePath（请由 workflow_begin 指定）'
      const snap = engine.snapshot()
      const payload = {
        workflow: snap.workflow,
        version: snap.version,
        description: snap.description,
        params: snap.params,
        active: snap.active,
        stage: snap.stage,
        tasks: snap.tasks,
        gateResult: snap.gateResult,
        retries: snap.retries,
        error: snap.error,
        updatedAt: snap.updatedAt,
        logs: snap.logs,
      }
      await fs.writeText(p, JSON.stringify(payload, null, 2), undefined, undefined, writePolicy())
      const r = 'ok'
      engine.setPersist(r)
      return r
    } catch (e) {
      const r = 'err: ' + ((e && e.message) || String(e))
      engine.setPersist(r)
      return r
    }
  }

  // 恢复：仅当存在有效状态文件时执行
  async function load() {
    const fs = ctx.get('fs')
    if (!fs) return false
    try {
      const p = await ensurePath()
      if (!p) return false
      const text = await fs.readText(p)
      const j = JSON.parse(text)
      if (!j || !j.workflow) return false
      engine.hydrate(j)
      return true
    } catch (e) {
      return false // 无之前状态
    }
  }

  return { save, load, setWorkspaceRoot, setStatePath, setInstanceDir }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createWorkflowStorage }
}