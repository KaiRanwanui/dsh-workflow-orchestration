// ============================================================================
// workflow-agent — Host 插件模块清单（构建单一源）
// 文件：code/scripts/module-manifest.js
// 说明：声明 workflow-host 插件的元数据（name/inject）与有序模块表；
//       packages/workflow-host/build.js 按此清单拼接产出：
//         ① packages/workflow-host/lib/index.js        （CJS 交付物，运行时加载）
//         ② packages/workflow-host/dist/workflow-host.mjs（ESM 生成物，入库）
//       顺序 = 拼接作用域顺序（后置 section 可直呼前置符号；函数声明提升）。
// 纪律：改任何清单内源模块后，直接跑 `node code/packages/workflow-host/build.js`
//       （无需同步脚本——本清单替代旧 sync-modules 流程）。
// ============================================================================

module.exports = {
  name: 'workflow-host',
  // 服务注入：fs（文件）/ tools（工具注册）/ subagents、agents、sessions（探针与判活）/
  // sessionController（0.1.5：prompt 注入与 cancel 权威停止）
  inject: ['fs', 'tools', 'subagents', 'agents', 'sessionController', 'sessions'],
  modules: [
    // apply 前言（applyInternal 定义：探针 + 注册表装配 + A1 tap）——必须在最前
    { id: 'apply-prologue', path: 'plugins/workflow-host/apply-prologue.js' },
    // 共享模块
    { id: 'workflow-schema', path: 'shared/workflow-schema.js' },
    { id: 'workflow-parser', path: 'shared/workflow-parser.js' },
    { id: 'workflow-paths', path: 'shared/workflow-paths.js' },
    { id: 'workflow-validate', path: 'shared/workflow-validate.js' },
    { id: 'workflow-edit', path: 'shared/workflow-edit.js' },
    { id: 'zip-writer', path: 'shared/zip-writer.js' },
    { id: 'items-extract', path: 'shared/items-extract.js' },
    // 插件源模块
    { id: 'engine', path: 'plugins/workflow-host/engine.js' },
    { id: 'storage', path: 'plugins/workflow-host/storage.js' },
    { id: 'instance-store', path: 'plugins/workflow-host/instance-store.js' },
    { id: 'builtin-materialize', path: 'plugins/workflow-host/builtin-materialize.js' },
    { id: 'tools-preset', path: 'plugins/workflow-host-preset/tools-preset.js' },
    // webServer 路由（/wf/*）——必须最后（引用前置 section 的 parser/validate/模板表等）
    { id: 'webserver-routes', path: 'plugins/workflow-host/webserver-routes.js' },
  ],
}
