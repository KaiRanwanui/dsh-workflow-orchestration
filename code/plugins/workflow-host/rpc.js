// ============================================================================
// workflow-agent — Host RPC 处理器（供 Client 端轮询调用）
// 文件：code/plugins/workflow-host/rpc.js
// 说明：注册 Package-private RPC：
//       - wf:status   ：返回最新引擎快照（Client 监控面板轮询）
//       - wf:skill    ：按节点 id 读取处理器/门禁 skill 文本（点击节点查看）
// 依赖：harness、engine、ctx（fs）。
// ============================================================================

function registerWorkflowRpc(ctx, harness, engine) {
  const fs = ctx.get('fs')

  // wf:status — Client 轮询快照
  harness.handle('wf:status', async () => {
    return engine.snapshot()
  })

  // wf:skill — 读取指定节点的技能文件内容
  harness.handle('wf:skill', async (req) => {
    const id = req && req.id
    if (!fs) return { id, name: id, text: '（fs 不可用）' }
    const s = engine.snapshot()
    const t = (s.tasks || []).find((x) => x.id === id)
    if (!t) return { id, name: id, text: '（未找到节点 ' + id + '）' }
    const path = t.processor
    if (!path) return { id, name: t.name, text: '（该节点未配置处理器技能）' }
    try {
      const text = await fs.readText(await fs.resolve(path))
      return { id, name: t.name, text }
    } catch (e) {
      return { id, name: t.name, text: '（技能文件不可读: ' + path + '）' }
    }
  })

  // wf:param — 查看工作流参数（供编辑器回显用，后续迭代扩展）
  harness.handle('wf:logs', async () => {
    const s = engine.snapshot()
    return { logs: s.logs || [] }
  })
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { registerWorkflowRpc }
}