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
//   - deferDisposition（Iter-27b 自 tools-preset.shouldDeferExpansion 前移）：延迟展开
//     判定单一事实源——expandDefinition 与语义校验共用。true=延迟（items 运行期由
//     上游产出，校验跳过 items 存在性）；显式 deferred:false → false（校验同报）。
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

// Iter-27b 前移（原 tools-preset.shouldDeferExpansion，D1 混合方案）：
// 1. deferred=true 显式声明 → 延迟；deferred=false → 不延迟（校验同报 E-ITEMS-MISSING）
// 2. deferred=null（未声明）→ 自动检测：是否有上游任务 outputs 包含该路径
// 匹配精度：itemsRel（解析前注入值，与 outputs 同为相对形态）精确匹配优先；
// basename 兜底（一侧经 resolveRefPath 加了 workspaceRoot 前缀 / 用户混写绝对相对的场景）。
// Iter-27b 双形态：expandDefinition 传展开后任务（itemsRel/outputs 优先，行为不变）；
// 校验传 raw parsed 任务（回退 itemsFromRaw/outputsRaw，同为相对形态对称比较）。
function deferDisposition(task, allTasks) {
  if (task.deferred === true) return true
  if (task.deferred === false) return false
  const rel = task.itemsRel || task.itemsFrom || task.itemsFromRaw
  if (!rel) return false
  const base = String(rel).split('/').pop()
  for (const t of (allTasks || [])) {
    const outputs = t.outputs || t.outputsRaw || []
    for (const o of outputs) {
      if (o === rel || o.split('/').pop() === base) return true
    }
  }
  return false
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { isAbsoluteishPath, isVariablePath, resolveStaticPath, presetTemplateDirOf, deferDisposition }
}
