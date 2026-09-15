// ============================================================================
// workflow-agent — Client 监控面板（动态 Cordis 插件）
// 文件：code/plugins/workflow-client/index.js
// 用法：通过 cordis_define 提交 code.host + code.client 为函数体
//       实际运行的版本是 wfd-2/pkg-3（紧凑版，全 ASCII）
//       本文件为可读参考源码，臣大结构紧凑。
//
// Host 半边：harness.handle RPC（wf:status, wf:skill, wf:config）
// Client 半边：conversation.view slot → DAG 监控面板
//
// 架构：
//   - 独立动态插件（非 preset 本地），依赖 harness.handle / host.call
//   - 状态来源：preset 插件 workflow-host.mjs 持久化 .workflow-agent/state.json
//   - 模块级数据层根治 remount 闪烁
// ============================================================================

// ── 模块导出（cordis_define 引用或 Node 检查） ──────────────────────────────
// 实际运行使用 cordis_define 直接提交函数体字符串，
// 本文件仅保留参考作用。详见 code/plugins/workflow-client/
// host-body.txt / client-ascii.txt / client-body.txt
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { note: 'See host-body.txt and client-ascii.txt for cordis_define bodies' }
}