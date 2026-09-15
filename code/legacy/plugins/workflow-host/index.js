// ============================================================================
// workflow-agent — Host 插件入口（apply 组装）
// 文件：code/plugins/workflow-host/index.js
// 说明：构建脚本将本文件与 workflow-schema.js / workflow-parser.js /
//       engine.js / storage.js / tools.js / rpc.js 拼接为自包含的 host
//       函数体（hostApply）供 cordis_define 使用；同时生成 CommonJS
//       可加载版本（host + hostApply）供 Node 验证。
// ============================================================================

function hostApply(ctx) {
  const engine = createWorkflowEngine()
  const storage = createWorkflowStorage(ctx, engine)

  // 插件启动时尝试恢复上次状态（幂等；无状态文件则忽略）
  if (storage) {
    storage.load().catch(() => {})
  }

  if (ctx.get('fs')) {
    registerWorkflowTools(ctx, harness, engine, storage)
    registerWorkflowRpc(ctx, harness, engine)
  }

  console.log('[workflow-agent] host loaded, workflow=' + (engine.snapshot().workflow || '(none)'))

  // 生命周期：无额外副作用订阅，disposer 空实现
  ctx.effect(() => () => {})
}

function host() {
  return {
    inject: ['fs', 'timer'],
    apply: hostApply,
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { host, hostApply }
}