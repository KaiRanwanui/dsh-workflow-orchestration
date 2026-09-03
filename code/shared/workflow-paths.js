// ============================================================================
// workflow-agent — 路径分类与解析锚点（Iter-27a）
// 文件：code/shared/workflow-paths.js
// 说明：
//   - isAbsoluteishPath 自 tools-preset.js 前移（单一事实源；tools-preset 改调
//     本模块，mjs 内联同作用域直呼）。字符串即可区分（Linux/POSIX）：
//       '/' 开头 = 绝对路径；'~' 开头 = 伪绝对（shell 展开记号，展开后才绝对）；
//       'C:\' 盘符 = Windows 形态（WSL 下 /mnt/c/... 以 / 开头自然命中）；
//       其余 = 相对路径。
//   - isVariablePath：含 ${...} 占位（${param}/${workspace}/${wf_dir}/${item...}）
//     —— 注入/展开前无法静态定位，解析与校验须跳过或展开后重判。
//   - resolveStaticPath：静态文件（inputs/items）解析链（Iter-27a 四点②③）——
//     优先目录（实例目录 → defDir 模板子目录）→ workspace → 预定义根；
//     绝对/伪绝对直通；全 miss 回退第一优先目录相对拼接（保持下游 readText 报错语义）。
//     技能（processor/gateChecker）不走本函数——恒两级链（R4 技能不复制不物化）。
//   - presetTemplateDirOf：sourcePath 位于 <predefinedRoot>/templates/<子目录>/<file>
//     时返回子目录绝对路径（预置工作流判定；create 1:1 复制与 defDir 锚点共用）。
//     平铺 legacy（templates/<file>.yaml）与外部路径返回 null。
// ============================================================================

function isAbsoluteishPath(p) {
  return /^([a-zA-Z]:[\\/]|\/|~\/|~$)/.test(p)
}

// Iter-27a：含 ${...} 占位（展开前静态不可定位）
function isVariablePath(p) {
  return String(p || '').indexOf('${') !== -1
}

function normalizeSlashes(p) {
  return String(p || '').replace(/\\/g, '/')
}

function stripTrailingSlashes(p) {
  return String(p || '').replace(/\/+$/, '')
}

// Iter-27a：静态文件解析链。opts = { priorityDirs: [实例目录, defDir...], workspaceRoot, predefinedRoot }
// 契约与 tools-preset.resolveRefPath 同构：命中返回拼根绝对路径；全 miss 回退
// priorityDirs[0]（次选 workspaceRoot；皆无则原文）+'/' + rel。
async function resolveStaticPath(fs, rel, opts) {
  const p = normalizeSlashes(rel)
  if (isAbsoluteishPath(p)) return p
  const o = opts || {}
  const roots = []
  const seen = new Set()
  const push = (r) => {
    const v = r ? stripTrailingSlashes(normalizeSlashes(r)) : ''
    if (v && !seen.has(v)) { seen.add(v); roots.push(v) }
  }
  for (const d of (o.priorityDirs || [])) push(d)
  push(o.workspaceRoot)
  push(o.predefinedRoot)
  for (const r of roots) {
    const cand = r + '/' + p
    try {
      const st = await fs.stat(await fs.resolve(cand))
      if (st) return cand
    } catch (e) { /* 尝试下一级 */ }
  }
  const fb = roots.length > 0 ? roots[0] : ''
  return (fb ? fb + '/' : '') + p
}

// Iter-27a：预置工作流判定——workflowPath 在 <predefinedRoot>/templates/<子目录>/<file>
// 内（子目录形态）→ 返回模板子目录绝对路径；平铺/外部/空 → null。
function presetTemplateDirOf(sourcePath, predefinedRoot) {
  const p = normalizeSlashes(sourcePath)
  const pre = predefinedRoot ? stripTrailingSlashes(normalizeSlashes(predefinedRoot)) : ''
  if (!p || !pre) return null
  const prefix = pre + '/templates/'
  if (p.indexOf(prefix) !== 0) return null
  const rest = p.slice(prefix.length)
  const idx = rest.indexOf('/')
  if (idx <= 0) return null // 平铺 legacy（templates/<file>.yaml）非子目录形态
  return prefix + rest.slice(0, idx)
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { isAbsoluteishPath, isVariablePath, resolveStaticPath, presetTemplateDirOf }
}
