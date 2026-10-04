// ============================================================================
// workflow-agent — Host 侧 fs 适配层（阶段 6 / B5，2026-10-03）
// 文件：code/shared/fs-host.js
//
// 背景（真机实证）：DSH 0.2.0 fs 服务引入 workspace-write 文件沙箱（fs-sandbox，
// 可写根 = policy.workspaceRoot + /tmp），插件在 Host 进程作用域的写入（实例目录、
// 状态、gitkeep；目标在用户会话工作区内也会被拒——Host fs 的 workspaceRoot ≠ 会话
// 工作区）。实例/状态数据属插件私有装配（同 B4 物化的信任层级），改 node:fs 直写。
//
// 形状契约：与 DSH fs 服务及 test-host makeMockFs 逐字段对齐——
//   resolve(p) -> {path}          writeText(target, content)（自动建父目录）
//   readText(target) -> string    （缺失抛错，与 mock/服务一致）
//   stat(target) -> undefined | {path,size}（不存在返回 undefined，不抛）
//   listDir(target) -> [{name,type:'file'|'directory',target:{path},size?}]
//
// 开关：WF_HOST_FS=0 时置 null（test-host 对产物直测时走 mock 注入的 fs 服务形状）。
// 消费点统一形态：const fs = (typeof hostFs !== 'undefined' && hostFs) || ctx.get('fs')
// ============================================================================

function createHostFs() {
  const nodeFs = require('fs')
  const nodePath = require('path')
  const asPath = (t) => (typeof t === 'string' ? t : t.path)
  return {
    async resolve(p) { return { path: nodePath.resolve(String(p)) } },
    async writeText(t, content) {
      const p = asPath(t)
      nodeFs.mkdirSync(nodePath.dirname(p), { recursive: true })
      nodeFs.writeFileSync(p, String(content))
      return { operation: 'create' }
    },
    async readText(t) {
      return nodeFs.readFileSync(asPath(t), 'utf8')
    },
    async stat(t) {
      const p = asPath(t)
      try {
        const st = nodeFs.statSync(p)
        return { path: p, size: st.size }
      } catch (e) { return undefined }
    },
    async listDir(t) {
      let ents
      try { ents = nodeFs.readdirSync(asPath(t), { withFileTypes: true }) } catch (e) { return [] }
      return ents.map((e) => {
        const full = nodePath.join(asPath(t), e.name)
        const isFile = e.isFile()
        let size
        if (isFile) { try { size = nodeFs.statSync(full).size } catch (e2) { /* 竞态忽略 */ } }
        return Object.assign(
          { name: e.name, type: isFile ? 'file' : 'directory', target: { path: full } },
          isFile ? { size } : {}
        )
      })
    },
  }
}

// 产物内恒可用（WF_HOST_FS=0 关闭，供测试走注入 mock）；单模块 require 时同样成立
const hostFs = process.env && process.env.WF_HOST_FS === '0' ? null : createHostFs()

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createHostFs, hostFs }
}
