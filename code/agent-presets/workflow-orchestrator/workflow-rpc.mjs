// ============================================================================
// workflow-agent — Host RPC 处理器插件
// 文件：code/plugins/workflow-rpc/index.mjs
// 说明：注册 Client 监控面板需要的 RPC 接口（wf:status/wf:skill/wf:config），
//       通过读取 .workflow-agent/state.json 获取引擎的最新快照。
// 挂载方式：在 agent.cordis.yml 中添加一行 name: ./index.mjs
// 依赖：harness（内置）, fs（Cordis 服务）
// ============================================================================

export const name = 'workflow-rpc'
export const inject = ['fs']

export function apply(ctx) {
  const fs = ctx.get('fs')

  // ── 从指定工作区加载 state.json ──────────────────────────────────────────
  async function loadState(workspaceRoot) {
    if (!fs) return { state: null, error: 'fs service unavailable' }
    try {
      const root = (workspaceRoot || '').replace(/\\/g, '/').replace(/\/+$/, '')
      if (!root) return { state: null, error: 'workspaceRoot not specified' }
      const statePath = root + '/.workflow-agent/state.json'
      const resolved = await fs.resolve(statePath)
      const text = await fs.readText(resolved)
      const state = JSON.parse(text)
      return { state, error: null }
    } catch (e) {
      return { state: null, error: e && e.message ? e.message : String(e) }
    }
  }

  // ── wf:status — Client 轮询获取引擎快照 ──────────────────────────────────
  harness.handle('wf:status', async (args) => {
    const workspaceRoot = args && args.workspaceRoot ? String(args.workspaceRoot) : ''
    const result = await loadState(workspaceRoot)
    return result
  })

  // ── wf:skill — 读取指定文件的技能内容 ────────────────────────────────────
  harness.handle('wf:skill', async (args) => {
    if (!fs) return { error: 'fs service unavailable' }
    try {
      const path = args && args.path ? String(args.path) : ''
      if (!path) return { error: 'no file path provided', text: null }
      const resolved = await fs.resolve(path)
      const text = await fs.readText(resolved)
      return { text, error: null }
    } catch (e) {
      return { text: null, error: e && e.message ? e.message : String(e) }
    }
  })

  // ── wf:config — 验证工作区根目录 ──────────────────────────────────────────
  harness.handle('wf:config', async (args) => {
    const root = args && args.workspaceRoot ? String(args.workspaceRoot) : ''
    if (root && fs) {
      try {
        const p = root + '/.workflow-agent/state.json'
        await fs.resolve(p)
        return { valid: true, workspaceRoot: root }
      } catch (e) {
        return { valid: false, workspaceRoot: root, error: 'state.json not found at ' + root + '/.workflow-agent/state.json' }
      }
    }
    return { valid: false, workspaceRoot: root, error: 'workspaceRoot not provided' }
  })

  ctx.effect(() => () => {})
}