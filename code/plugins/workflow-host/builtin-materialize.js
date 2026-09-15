// ============================================================================
// workflow-agent — 内建资产物化（阶段 3f：资产文件化）
// 文件：code/plugins/workflow-host/builtin-materialize.js
// 说明：
//   - 内建资产（4 工作流模板 / 7 技能 / samples / docs）为**真实文件**，位于本包
//     builtin-assets/（随 npm 包分发；唯一源，勿在本文件内嵌资产内容）。
//   - materializeBuiltinAssets(fs, options)：启动时把包内 builtin-assets/ 递归复制到
//     ${DSH_HOME:-$HOME/.dsh}/workflow-agent/（**幂等覆盖**——用户拍板 2026-09-15；
//     任一文件失败不阻断其余）。读取走 node:fs（CJS 形态可用）；写入走 DSH fs
//     服务（目标作用域，Iter-24 探针实证）。兼任探针：journalctl 搜
//     '[workflow-agent] materialize' 即见物化结果。
//   - detectPredefinedRoot：预定义目录根解析（${DSH_HOME:-$HOME/.dsh}/workflow-agent）。
// 历史：本文件原名 builtin-skills.js，曾以 JS 字符串内嵌全部资产（Iter-24~29）；
//       阶段 3f 改为独立文件 + 复制语义。ESM 生成物形态不支持物化（无 __dirname），
//       返回 { ok:false, reason }（该形态仅本地测试用，见 resolveBuiltinAssetsDir）。
// ============================================================================

// ── 预定义目录根：${DSH_HOME:-$HOME/.dsh}/workflow-agent ───────────────────
function detectPredefinedRoot() {
  let home = null
  try {
    if (typeof process !== 'undefined' && process.env && process.env.HOME) home = process.env.HOME
  } catch (e) { /* 非 Node 上下文忽略 */ }
  if (!home) {
    try {
      if (typeof require !== 'undefined') home = require('os').homedir()
    } catch (e) { /* require 不可用忽略 */ }
  }
  if (!home) return null
  let dshHome = null
  try {
    if (typeof process !== 'undefined' && process.env && process.env.DSH_HOME) dshHome = process.env.DSH_HOME
  } catch (e) { /* 忽略 */ }
  const base = (dshHome || (home.replace(/\/+$/, '') + '/.dsh')).replace(/\/+$/, '')
  return base + '/workflow-agent'
}

// ── 包内资产目录解析 ────────────────────────────────────────────────────────
// CJS 产物：__dirname = <pkg>/lib → 资产在 ../builtin-assets。
// ESM 生成物（dist/workflow-host.mjs）无 __dirname → 返回 null
// （该形态仅本地测试用；生产部署一律为 CJS npm 包）。
function resolveBuiltinAssetsDir() {
  try {
    if (typeof __dirname !== 'undefined' && typeof require !== 'undefined') {
      return require('path').join(__dirname, '..', 'builtin-assets')
    }
  } catch (e) { /* 忽略 */ }
  return null
}

// ── 物化：递归复制包内 builtin-assets/ → 预定义目录（幂等覆盖）─────────────
// fs：DSH fs 服务（writeText 自动创建父目录——与实例目录创建同语义）。
// options.assetsDir：覆盖默认资产目录（单测注入虚拟目录用）。
// 返回：{ ok, root, written[], failed[] } 或 { ok:false, reason }
async function materializeBuiltinAssets(fs, options) {
  if (!fs) return { ok: false, reason: 'fs service unavailable' }
  const root = detectPredefinedRoot()
  if (!root) return { ok: false, reason: 'cannot locate home directory' }
  const opts = options || {}
  const assetsDir = opts.assetsDir || resolveBuiltinAssetsDir()
  if (!assetsDir) return { ok: false, reason: 'builtin-assets dir unavailable (esm form)' }
  const nodePath = typeof require !== 'undefined' ? require('path') : null
  const nodeFs = typeof require !== 'undefined' ? require('node:fs') : null
  if (!nodePath || !nodeFs) return { ok: false, reason: 'node fs unavailable (esm form)' }

  let files = []
  try {
    const walk = (dir, rel) => {
      for (const ent of nodeFs.readdirSync(dir, { withFileTypes: true })) {
        const r = rel ? rel + '/' + ent.name : ent.name
        if (ent.isDirectory()) walk(nodePath.join(dir, ent.name), r)
        else files.push(r)
      }
    }
    walk(assetsDir, '')
  } catch (e) {
    return { ok: false, reason: 'cannot list builtin-assets: ' + (e && e.message ? e.message : String(e)) }
  }

  const written = []
  const failed = []
  for (const rel of files) {
    const target = root + '/' + rel
    try {
      const content = nodeFs.readFileSync(nodePath.join(assetsDir, rel), 'utf8')
      await fs.writeText(await fs.resolve(target), content)
      written.push(rel)
    } catch (e) {
      failed.push(rel + ': ' + (e && e.message ? e.message : String(e)))
    }
  }
  return { ok: failed.length === 0, root, written, failed }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { detectPredefinedRoot, materializeBuiltinAssets, resolveBuiltinAssetsDir }
}
