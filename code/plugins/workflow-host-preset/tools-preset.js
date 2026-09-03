// ============================================================================
// workflow-agent — Host 模型工具（preset 本地插件版）
// 文件：code/plugins/workflow-host-preset/tools-preset.js
// 说明：与 plugins/workflow-host/tools.js 相同的两个工具定义，但注册方式改为
//       ctx.tools.register（preset 本地 .mjs 插件形态，custom-bash.mjs /
//       dsh-tool-workflow 先例），而非动态插件的 harness.defineTool。
//       另外从 exec.agent.session.header.cwd 取会话工作区作为默认落盘根，
//       解决宿主插件无会话上下文时写错目录的问题。
// 依赖：ctx（fs/exec）、engine、storage、schema/parser 常量（同作用域内联）。
// ============================================================================

// ── 相对路径解析（复用 PoC 逐级上探逻辑）───────────────────────────────────
function parentDir(p) {
  const norm = p.replace(/\\/g, '/')
  const idx = norm.lastIndexOf('/')
  if (idx <= 0) return null
  return norm.slice(0, idx)
}

// Iter-24：两级解析链——workspace 根优先 → 预定义根兜底；绝对路径直通；
// 双 miss 回退 workspace 相对路径（保持既有报错语义：下游 readText 按完整路径报缺失）。
// 替换旧"定义文件目录逐级上探"（resolveRel）。predefinedRoot 参数供测试注入。
// Iter-27a：isAbsoluteishPath 前移至 shared/workflow-paths.js（单一事实源；
// mjs 内联同作用域直呼，此处经 E_ 别名引用；Node 独立测试 require 兜底）。
// 同批前移：isVariablePath / resolveStaticPath / presetTemplateDirOf。
let E_isAbsoluteishPath = typeof isAbsoluteishPath !== 'undefined' ? isAbsoluteishPath
  : (typeof require !== 'undefined' ? require('../../shared/workflow-paths').isAbsoluteishPath : null)
let E_resolveStaticPath = typeof resolveStaticPath !== 'undefined' ? resolveStaticPath
  : (typeof require !== 'undefined' ? require('../../shared/workflow-paths').resolveStaticPath : null)
let E_presetTemplateDirOf = typeof presetTemplateDirOf !== 'undefined' ? presetTemplateDirOf
  : (typeof require !== 'undefined' ? require('../../shared/workflow-paths').presetTemplateDirOf : null)
// Node 直测（require 本源文件）时 builtin-skills 不在同作用域——require 兜底；
// mjs 内联作用域有 detectPredefinedRoot（builtin-skills section 在前），走 typeof 分支。
function fallbackPredefinedRoot() {
  try { return require('../workflow-host/builtin-skills').detectPredefinedRoot() } catch (e) { return null }
}
// Iter-27a：预定义根定位统一入口（mjs 内联走同作用域 detectPredefinedRoot，Node 直测走 require 兜底）
function detectPredefinedRootSafe() {
  return (typeof detectPredefinedRoot === 'function' ? detectPredefinedRoot() : null) || fallbackPredefinedRoot()
}

async function resolveRefPath(fs, workspaceRoot, rel, predefinedRoot) {
  const p = String(rel || '').replace(/\\/g, '/')
  if (E_isAbsoluteishPath(p)) return p
  const roots = []
  const ws = workspaceRoot ? String(workspaceRoot).replace(/\/+$/, '') : ''
  if (ws) roots.push(ws)
  const pre = predefinedRoot || (typeof detectPredefinedRoot === 'function' ? detectPredefinedRoot() : fallbackPredefinedRoot())
  if (pre && String(pre).replace(/\/+$/, '') !== ws) roots.push(String(pre).replace(/\/+$/, ''))
  for (const r of roots) {
    const cand = r + '/' + p
    try {
      const st = await fs.stat(await fs.resolve(cand))
      if (st) return cand
    } catch (e) { /* 尝试下一级 */ }
  }
  return (ws ? ws + '/' : '') + p
}

// Iter-24：模板清单合并——预定义目录扫描优先，内嵌常量兜底补缺（按 name 去重，磁盘版赢）。
// 预定义项形态 {name, path, yaml}；兜底项补 fallback:true（path=null，仅供展示提交 workflowText）。
function mergeTemplateLists(predefined, builtinTemplates) {
  const merged = (predefined || []).slice()
  for (const b of (builtinTemplates || [])) {
    if (!b || !b.name) continue
    if (!merged.some((x) => x && x.name === b.name)) {
      merged.push({ name: b.name, path: null, yaml: b.yaml, fallback: true })
    }
  }
  return merged
}

// ── ${param} / 目录变量注入（同一 PARAM_PATTERN 正则，R20）─────────────────
// PARAM_PATTERN 默认由同作用域 schema 模块提供；独立加载（Node 直测）时从 shared
// schema 加载（Iter-26 扩展含可选 .字段），再兜底旧单层正则
let E_PARAM_PATTERN = typeof PARAM_PATTERN !== 'undefined' ? PARAM_PATTERN
  : (typeof require !== 'undefined' && require('../../shared/workflow-schema').PARAM_PATTERN
    ? require('../../shared/workflow-schema').PARAM_PATTERN
    : /\$\{(\w+)\}/g)
// parseWorkflow 兜底：mjs 内联作用域有同名函数；Node 单独 require 时从 shared 加载
let E_parseWorkflow = typeof parseWorkflow !== 'undefined'
  ? parseWorkflow
  : (typeof require !== 'undefined' ? require('../../shared/workflow-parser').parseWorkflow : null)
// Iter-26：items 提取与 item 默认链（items-extract 模块）。宿主内联时同作用域已由
// 前置 items-extract section 提供；Node 独立测试时从 shared 显式加载（与 E_parseWorkflow 同模式）。
let E_extractItems = typeof extractItems !== 'undefined' ? extractItems
  : (typeof require !== 'undefined' ? require('../../shared/items-extract').extractItems : null)
let E_itemDisplayValue = typeof itemDisplayValue !== 'undefined' ? itemDisplayValue
  : (typeof require !== 'undefined' ? require('../../shared/items-extract').itemDisplayValue : null)
let E_isScalarValue = typeof isScalarValue !== 'undefined' ? isScalarValue
  : (typeof require !== 'undefined' ? require('../../shared/items-extract').isScalarValue : null)
// Iter-25：vars = 目录变量保留字（${workspace}/${wf_dir}/${skills}/${skill_dir}）。
// D2 决议：保留字优先于同名 params——${workspace} 永远是工作区路径，语义稳定。
// vars 形参可选，缺省时行为与 Iter-24 完全一致（向后兼容）。
// Iter-26：itemCtx = { varName, data, empty } 迭代上下文（可选）——
//   ${<varName>}        对象 item 走默认链（ID→名称→1-based 序号），标量原样；
//                       empty=true（占位迭代）注入空串；
//   ${<varName>.字段}   单层标量字段直取；缺失/非标量占位保留；empty 注入空串；
//   点号键在非迭代上下文（或 base≠itemVar）时占位保留，params 查找不受影响。
// 替换优先级：目录变量保留字（D2）→ item → params → 占位保留。
function injectParams(value, params, vars, itemCtx) {
  if (typeof value !== 'string') return value
  return value.replace(E_PARAM_PATTERN, (whole, key) => {
    const dot = key.indexOf('.')
    if (dot !== -1) {
      if (itemCtx) {
        const base = key.slice(0, dot)
        if (base === itemCtx.varName) {
          if (itemCtx.empty) return 'empty' // 占位迭代：字段注入 'empty'（路径可用，skill 自识别空 items）
          if (itemCtx.data && typeof itemCtx.data === 'object') {
            const v = itemCtx.data[key.slice(dot + 1)]
            if (E_isScalarValue(v)) return String(v)
          }
        }
      }
      return whole // 点号形式仅迭代上下文可解析，其余占位保留
    }
    if (vars && vars[key] !== undefined) return String(vars[key])
    if (itemCtx && key === itemCtx.varName) {
      if (itemCtx.empty) return 'empty' // 占位迭代：${itemVar} 注入 'empty'（output/empty/empty.md 可用路径）
      return E_itemDisplayValue(itemCtx.data, itemCtx.index || 0)
    }
    if (params && params[key] !== undefined) return String(params[key])
    return whole // 未提供则保留原样，由调用方提示
  })
}

function injectArray(list, params, vars, itemCtx) {
  return (list || []).map((x) => injectParams(x, params, vars, itemCtx))
}

// v1.1：命名式 inputs 注入。值为 string → 注入后返回 string；
// 值为 string[] → 逐项注入后返回 string[]。
function injectInputsMap(map, params, vars, itemCtx) {
  const out = {}
  for (const k of Object.keys(map || {})) {
    const v = map[k]
    out[k] = Array.isArray(v) ? v.map((x) => injectParams(x, params, vars, itemCtx)) : injectParams(v, params, vars, itemCtx)
  }
  return out
}

// 工作流文件加载：优先 workflowPath（读文件），兜底 workflowText（直接用）。
// Iter-24：相对引用不再以定义文件目录为基准，统一两级链（workspace 根优先）。
async function loadWorkflowSource(fs, args, wsRoot) {
  if (args.workflowPath) {
    const p = String(args.workflowPath)
    const text = await fs.readText(await fs.resolve(p))
    return { text, workspaceRoot: wsRoot }
  }
  if (args.workflowText) {
    return { text: String(args.workflowText), workspaceRoot: wsRoot }
  }
  return null
}

// ── 实例快照 instance.yaml 的注释头剥离（Iter-11：start/reset 读取实例定义）──
// 头部由 beginInstance 生成：连续 '#' 注释行 + 一个空行。剥离后即纯 YAML 定义。
function stripInstanceHeader(text) {
  const lines = String(text || '').split(/\r?\n/)
  let i = 0
  while (i < lines.length && lines[i].startsWith('#')) i++
  if (i > 0 && i < lines.length && lines[i].trim() === '') i++ // 头部结束空行
  return lines.slice(i).join('\n')
}

// 定义不合法错误（携带 workflowBeginErrors 数组，begin 路径保持既有契约）
function definitionError(errors) {
  const e = new Error('workflow 定义不合法: ' + errors.join('; '))
  e.workflowBeginErrors = errors
  return e
}

// ── 定义展开（Iter-11：begin/start/reset 共用）────────────────────────────
// src: { text, base }；params: 工作流级参数。返回 parsed（tasks 已注入参数、
// 解析相对路径、展开 loop/concurrent）。定义不合法或 items-from 为空时 throw。
// Iter-25 阶段1：目录变量 ${workspace}/${skills} 就此注入（展开期已知）；
// ${wf_dir}/${skill_dir} 实例目录就绪后由 finalizeDataflow（阶段2）注入。
// Iter-26：dirCtx = { wfDir } 可选——实例目录已知时（start/reset 路径传 entry.dir）
// 将 ${wf_dir} 并入阶段1保留字（D2 优先），使 items-from: ${wf_dir}/... 可解析；
// begin 一步式路径不传（实例目录尚不存在，展开后 createBind）。items 读取改经
// extractItems（items-format 声明/扩展名推断/四格式/空提取→[]，空提取由
// expandLoop/ConcurrentTasks 产出占位迭代）。
// Iter-27a：dirCtx 增 defDir（预置模板子目录锚点）——begin 传 workflowPath 所在
// 子目录；start/reset 传 meta.sourcePath 推导值。静态 items 解析优先序=
// 实例目录（1:1 副本）→ defDir → 两级链。
async function expandDefinition(fs, src, params, dirCtx) {
  const parsed = E_parseWorkflow(src.text)
  if (parsed.errors && parsed.errors.length > 0) throw definitionError(parsed.errors)
  const p = params || {}
  // Iter-25：阶段1目录变量——skills=预定义技能根目录（R20）；无预定义根（单测隔离环境）
  // 时值为 undefined，占位符保留原样。
  const preRoot = src.predefinedRoot || (typeof detectPredefinedRoot === 'function' ? detectPredefinedRoot() : null)
  const dirVars = {
    workspace: src.workspaceRoot || undefined,
    skills: preRoot ? String(preRoot).replace(/\/+$/, '') + '/skills' : undefined,
  }
  if (dirCtx && dirCtx.wfDir) dirVars['wf_dir'] = String(dirCtx.wfDir).replace(/\/+$/, '')
  const tasks = await Promise.all(parsed.tasks.map(async (t) => {
    const out = { ...t }
    out.inputs = injectInputsMap(t.inputsRaw, p, dirVars)
    out.outputs = injectArray(t.outputsRaw, p, dirVars)
    if (t.processorRaw) {
      const procRel = injectParams(t.processorRaw, p, dirVars)
      out.processor = await resolveRefPath(fs, src.workspaceRoot, procRel, src.predefinedRoot)
    }
    if (t.gateRaw) {
      const gateRel = injectParams(t.gateRaw, p, dirVars)
      out.gate = {
        checker: await resolveRefPath(fs, src.workspaceRoot, gateRel, src.predefinedRoot),
        onFailure: t.gateOnFailure,
        maxRetries: t.gateMaxRetries,
      }
    }
    if (t.itemsFromRaw) {
      const itemsRel = injectParams(t.itemsFromRaw, p, dirVars)
      // Iter-27a（四点②③）：静态 items 解析链——优先目录（实例目录 → defDir 模板
      // 子目录）→ 两级链兜底；技能不动（processor/gate 恒两级链，R4 不物化）。
      // predefinedRoot 兜底 detectPredefinedRoot（与 resolveRefPath 同语义：start 路径
      // 的 src 不带 predefinedRoot，不能因此丢掉预定义端探测）。
      out.itemsFrom = await E_resolveStaticPath(fs, itemsRel, {
        priorityDirs: [dirCtx && dirCtx.wfDir, dirCtx && dirCtx.defDir],
        workspaceRoot: src.workspaceRoot,
        predefinedRoot: src.predefinedRoot || detectPredefinedRootSafe(),
      })
      out.itemsRel = itemsRel // Iter-26R：解析前注入值（延迟组保留相对形态，finalizeDataflow 以实例目录绝对化）
      out.itemsFromRaw = t.itemsFromRaw // 保留原始值供循环展开二次注入
      out.itemVar = t.itemVar
    }
    return out
  }))
  parsed.tasks = tasks
  const finalTasks = []
  for (const t of tasks) {
    if (t.type === 'loop' && t.itemsFrom && t.itemVar) {
      // Iter-26R：延迟展开判定——items 文件不存在时检查是否应延迟
      const itemsExist = await fileExists(fs, t.itemsFrom)
      const shouldDefer = !itemsExist && shouldDeferExpansion(t, tasks)
      if (shouldDefer) {
        // 产出占位任务（id=组id，_pendingItems 携带展开元数据）
        finalTasks.push(buildPlaceholderTask(t, p, dirVars))
      } else {
        const text = await fs.readText(await fs.resolve(t.itemsFrom))
        // Iter-26：结构化提取（items-format 声明 > 扩展名推断 > lines）；空提取 → [] 占位迭代
        const items = E_extractItems(text, { format: t.itemsFormat || null, path: t.itemsFrom, taskId: t.id })
        const iterations = await expandLoopTasks(fs, t, items, t.itemVar, p, dirVars)
        finalTasks.push(...iterations)
      }
    } else if (t.type === 'concurrent' && t.itemsFrom && t.itemVar) {
      // Iter-26R：延迟展开判定（同 loop）
      const itemsExist = await fileExists(fs, t.itemsFrom)
      const shouldDefer = !itemsExist && shouldDeferExpansion(t, tasks)
      if (shouldDefer) {
        finalTasks.push(buildPlaceholderTask(t, p, dirVars))
      } else {
        const text = await fs.readText(await fs.resolve(t.itemsFrom))
        const items = E_extractItems(text, { format: t.itemsFormat || null, path: t.itemsFrom, taskId: t.id })
        const iterations = await expandConcurrentTasks(fs, t, items, t.itemVar, p, dirVars)
        finalTasks.push(...iterations)
      }
    } else {
      finalTasks.push(t)
    }
  }
  parsed.tasks = finalTasks
  return parsed
}

// Iter-26R：文件存在性检查（纯函数，fs 可选）
async function fileExists(fs, path) {
  if (!fs || !path) return false
  try {
    const st = await fs.stat(await fs.resolve(path))
    return !!st
  } catch (e) { return false }
}

// Iter-26R：延迟展开判定（D1 混合方案）
// 1. deferred=true 显式声明 → 延迟；deferred=false → 不延迟（报错）
// 2. deferred=null（未声明）→ 自动检测：是否有上游任务 outputs 包含该路径
// 匹配精度：itemsRel（解析前注入值，与 outputs 同为相对形态）精确匹配优先；
// basename 兜底（一侧经 resolveRefPath 加了 workspaceRoot 前缀 / 用户混写绝对相对的场景）。
function shouldDeferExpansion(task, allTasks) {
  if (task.deferred === true) return true
  if (task.deferred === false) return false
  const rel = task.itemsRel || task.itemsFrom
  if (!rel) return false
  const base = rel.split('/').pop()
  for (const t of allTasks) {
    const outputs = t.outputs || []
    for (const o of outputs) {
      if (o === rel || o.split('/').pop() === base) return true
    }
  }
  return false
}

// Iter-26R：构建占位任务（D2 占位=组完成哨兵）
// id=组id，_pendingItems 携带展开元数据，_expanded=false。
// 路径语义（GUI 验收修正）：items 文件由上游运行期产出、落在实例目录——
//   相对 items-from → 保留相对形态 + itemsDeferred=true（finalizeDataflow 以实例目录绝对化，
//   与上游 output 同基准）；绝对/~/items-from（含 ${wf_dir} 展开后）→ 直通保留，不标 deferred。
// processor/gate 存第一遍已解析的绝对路径（占位不派发，字段本身置 null；展开时从 _pendingItems 取）。
function buildPlaceholderTask(t, params, vars) {
  const relDeferred = t.itemsRel && !E_isAbsoluteishPath(t.itemsRel)
  const placeholder = {
    id: t.id, // 占位 id=组 id（下游 depends-on:[组id] 天然工作）
    name: (t.name || t.id) + '（等待 items）',
    type: 'llm-task', // 占位不派发 subagent
    dependsOn: t.dependsOn || [],
    timeout: t.timeout || 600,
    processor: null, // 占位不派发
    inputs: injectInputsMap(t.inputsRaw || {}, params, vars),
    outputs: injectArray(t.outputsRaw || [], params, vars),
    gate: null,
    // Iter-26R 运行时标记
    _pendingItems: {
      itemsFrom: relDeferred ? t.itemsRel : t.itemsFrom,
      itemsDeferred: !!relDeferred, // true=相对形态待实例目录绝对化（finalizeDataflow 处理）
      itemsFormat: t.itemsFormat || null,
      itemVar: t.itemVar,
      processor: t.processor || null, // 第一遍已解析的绝对路径（含 ${item} 时展开期按迭代二次注入）
      processorRaw: t.processorRaw,
      inputsRaw: t.inputsRaw || {},
      outputsRaw: t.outputsRaw || [],
      gate: t.gate || null,
      onError: t.onError || 'break',
      maxConcurrency: t.maxConcurrency || null,
      taskType: t.type, // 'loop' | 'concurrent'
    },
    _expanded: false,
    // 组元数据（DAG 组框渲染）
    _loopGroup: t.type === 'loop' ? t.id : null,
    _loopGroupName: t.type === 'loop' ? (t.name || t.id) : null,
    _loopItem: null,
    _loopIndex: 0,
    _onError: t.type === 'loop' ? (t.onError || 'break') : null,
    _concurrentGroup: t.type === 'concurrent' ? t.id : null,
    _concurrentGroupName: t.type === 'concurrent' ? (t.name || t.id) : null,
    _concurrentItem: null,
    _concurrentIndex: 0,
    _concurrentMax: t.type === 'concurrent' ? t.maxConcurrency : null,
  }
  return placeholder
}

// ── Iter-25 阶段2：数据流终态（R20 目录变量补全 + R15 显性化 + R21a skillDir）──
// 输入 tasks：阶段1展开后的最终任务数组（含 loop/concurrent 迭代）。
// dirCtx：{ wfDir } 实例目录绝对路径；legacy 单实例布局传 statePath 目录 / workspaceRoot。
// 语义（决策 D1/D2/D3）：
//   1) 注入 ${wf_dir} 与 ${skill_dir}（=dirname(processor)；无 processor 保留占位）；
//   2) inputs/outputs 绝对化：先注入再判相对——仍相对的值以实例目录为基准拼接；
//      仍含未解析 `${` 占位符的值跳过（防 `${skills}` 缺根等场景被错误拼接）；
//   3) 产 skillDir 字段。
// 纯函数：返回新数组，不修改入参。
function absolutizeDataflowPath(p, base) {
  const s = String(p || '')
  if (!s || E_isAbsoluteishPath(s) || s.indexOf('${') !== -1) return s
  return base ? String(base).replace(/\/+$/, '') + '/' + s : s
}

function absolutizeInputsMap(map, base) {
  const out = {}
  for (const k of Object.keys(map || {})) {
    const v = map[k]
    out[k] = Array.isArray(v) ? v.map((x) => absolutizeDataflowPath(x, base)) : absolutizeDataflowPath(v, base)
  }
  return out
}

function finalizeDataflow(tasks, dirCtx) {
  const wfDir = dirCtx && dirCtx.wfDir ? String(dirCtx.wfDir).replace(/\/+$/, '') : ''
  const baseVars = wfDir ? { wf_dir: wfDir } : {}
  return (tasks || []).map((t) => {
    const out = { ...t }
    const tvars = { ...baseVars }
    if (out.processor) tvars['skill_dir'] = parentDir(out.processor) || undefined
    out.inputs = injectInputsMap(out.inputs, {}, tvars)   // 先注入 ${wf_dir}/${skill_dir}
    out.outputs = injectArray(out.outputs || [], {}, tvars)
    if (wfDir) {                                          // 再对仍相对的值以实例目录为基准绝对化
      out.inputs = absolutizeInputsMap(out.inputs, wfDir)
      out.outputs = (out.outputs || []).map((x) => absolutizeDataflowPath(x, wfDir))
    }
    // Iter-26R：延迟组 items-from 同基准绝对化——itemsDeferred 标记的相对值以实例目录为基准，
    // 与上游 output 落点一致（expandDefinition 时文件尚不存在，两级链解析落到 workspaceRoot 是错的）。
    // 绝对路径（用户显式指定/解析已得）不标 deferred，直通保留。
    if (out._pendingItems && out._pendingItems.itemsDeferred) {
      if (wfDir) out._pendingItems.itemsFrom = absolutizeDataflowPath(out._pendingItems.itemsFrom, wfDir)
      out._pendingItems.itemsDeferred = false
    }
    out.skillDir = tvars['skill_dir'] || null
    return out
  })
}

// ── Iter-26(GUI 二轮反馈)：静态 input 文件物化进实例目录（inputs/<相对结构>）────
// finalizeDataflow 把相对 inputs 拼为 <实例目录>/... 伪绝对路径，但两级链命中的文件
// （workspace/预定义目录）并不在实例内——运行期 subagent 拿到不存在路径需自行猜测。
// 此处识别"实例目录前缀但文件不存在"的值，剥前缀走两级链找真实文件，复制到
// <dir>/inputs/<rel> 并改写 inputs 值（实例自包含）。实例内已存在的（上游 output）
// 与复制失败的保留原值。items-from 是一次性读取，不物化。
async function materializeInputsIntoInstance(fs, tasks, dir, wsRoot) {
  if (!fs || !dir) return tasks
  const d = String(dir).replace(/\/+$/, '')
  const exists = async (p) => {
    try { return !!(await fs.stat(await fs.resolve(p))) } catch (e) { return false }
  }
  const rewrite = async (v) => {
    const s = String(v || '')
    if (!s || s.indexOf('${') !== -1) return s
    if (!s.startsWith(d + '/')) return s // 实例目录外（外部绝对路径）不动
    if (await exists(s)) return s        // 实例内已存在：上游 output / 已物化，不动
    const rel = s.slice(d.length + 1)
    const real = await resolveRefPath(fs, wsRoot, rel) // 两级链：workspace → 预定义
    if (!(await exists(real))) return s  // 两级链未命中：保留（上游 output 运行期生成）
    const dest = d + '/inputs/' + rel
    try {
      const text = await fs.readText(await fs.resolve(real))
      await fs.writeText(await fs.resolve(dest), text)
      return dest
    } catch (e) { return s }
  }
  for (const t of (tasks || [])) {
    const map = t && t.inputs
    if (!map) continue
    for (const k of Object.keys(map)) {
      map[k] = Array.isArray(map[k]) ? await Promise.all(map[k].map(rewrite)) : await rewrite(map[k])
    }
  }
  return tasks
}

// ── Iter-27a（四点②③）：预置模板子目录静态树 1:1 复制 ─────────────────────
// 模板子目录=实例级同构镜像：create/begin 实例化时把子目录内全部文件原样复制进
// 实例目录（相对结构保留 → 相对引用路径零调整，实例自包含）。
// fs 服务只有 readText/writeText/listDir/stat（无 copy/delete）→ 递归文本复制，
// **仅文本文件**（二进制不支持，沿 Iter-26 物化先例声明局限）。
// excludePath：定义文件本身（已写为实例 instance.yaml），跳过。
// listDir 条目 type==='file' 视为文件，其余（'directory'/'dir'）下钻。
// 返回 { copied: number, failed: string[] }；单文件失败不阻断其余。
async function copyTemplateStaticTree(fs, srcDir, destDir, excludePath) {
  const copied = []
  const failed = []
  if (!fs || !srcDir || !destDir) return { copied: 0, failed: ['fs/srcDir/destDir 缺失'] }
  const src = String(srcDir).replace(/\/+$/, '')
  const dest = String(destDir).replace(/\/+$/, '')
  const excl = excludePath ? String(excludePath).replace(/\\/g, '/') : null
  async function walk(dir) {
    let entries = []
    try {
      entries = await fs.listDir(await fs.resolve(dir))
    } catch (e) {
      failed.push(dir + ': ' + (e && e.message ? e.message : String(e)))
      return
    }
    for (const en of (entries || [])) {
      if (!en || !en.name) continue
      const child = dir + '/' + en.name
      if (excl && child.replace(/\\/g, '/') === excl) continue
      if (en.type === 'file') {
        try {
          const text = await fs.readText(await fs.resolve(child))
          await fs.writeText(await fs.resolve(dest + child.slice(src.length)), text)
          copied.push(child.slice(src.length + 1))
        } catch (e) {
          failed.push(child + ': ' + (e && e.message ? e.message : String(e)))
        }
      } else {
        await walk(child)
      }
    }
  }
  await walk(src)
  return { copied: copied.length, failed }
}

// ── 循环展开：将 loop Task 展开为 N 个串行迭代实例 ────────────────────────
// items 参数：extractItems 产物（元素 string|object；空数组=空提取）。
// itemVar：迭代变量名（如 "module"），在 inputs/outputs 中解决 ${itemVar} / ${itemVar.字段}
// params：已注入的工作流级参数
// loopTask：原始 loop Task 对象（含 inputsRaw/outputsRaw/processor/gate/dependsOn）
// prevDeps：【内部使用】前一个迭代的 id，用于构建串行依赖链
// Iter-26：对象 item 经 itemCtx 注入（${itemVar}=默认链 ID→名称→序号，${itemVar.字段}=
// 标量直取）；空提取 → 1 个占位迭代（id=<组id>/empty，${itemVar} 注入空串，行为由
// skill 处理——Q1-b 拍板：引擎不做特殊处理、不改依赖图、不写文件）。
function normalizeItemEntries(items) {
  return (items || []).map((it) => {
    if (it === null || it === undefined) return ''
    if (typeof it === 'object') return it
    return String(it)
  })
}

function buildItemContext(itemVar, item, index) {
  return { varName: itemVar, data: item, empty: false, index }
}

async function expandLoopTasks(fs, loopTask, items, itemVar, params, vars) {
  const expanded = []
  const loopDeps = loopTask.dependsOn || []
  let prevId = null
  const list = normalizeItemEntries(items)

  // 空提取 → 占位迭代（Q1-b）：组节点存在、依赖链完整、正常派发，skill 识别空 items
  if (list.length === 0) {
    const emptyCtx = { varName: itemVar, data: null, empty: true }
    expanded.push({
      id: loopTask.id + '/empty',
      name: (loopTask.name || loopTask.id) + '（items 为空）',
      type: 'llm-task',
      dependsOn: loopDeps,
      timeout: loopTask.timeout || 600,
      processor: injectParams(loopTask.processor || '', params, null, emptyCtx),
      inputs: injectInputsMap(loopTask.inputsRaw || {}, params, vars, emptyCtx),
      outputs: injectArray(loopTask.outputsRaw || [], params, vars, emptyCtx),
      gate: loopTask.gate ? {
        checker: loopTask.gate.checker,
        onFailure: loopTask.gate.onFailure,
        maxRetries: loopTask.gate.maxRetries,
      } : null,
      _onError: loopTask.onError || 'break',
      _loopGroup: loopTask.id,
      _loopGroupName: loopTask.name || loopTask.id,
      _loopItem: '（items 为空）',
      _loopIndex: 0,
    })
    return expanded
  }

  for (let i = 0; i < list.length; i++) {
    const item = list[i]
    const itemStr = E_itemDisplayValue(item, i) // 对象：默认链；标量：原样
    const itemCtx = buildItemContext(itemVar, item, i)

    // 安全 ID：loopTaskId/sanitized-item（取默认链解析串，与旧行为同构）
    const sanitized = itemStr.replace(/[^a-zA-Z0-9_\-]/g, '-').replace(/^-+|-+$/g, '') || ('iter-' + i)
    const iterId = loopTask.id + '/' + sanitized

    // inputs/outputs 注入（含 item 变量/字段；Iter-25：vars=阶段1目录变量同批注入）
    const iterInputs = injectInputsMap(loopTask.inputsRaw || {}, params, vars, itemCtx)
    const iterOutputs = injectArray(loopTask.outputsRaw || [], params, vars, itemCtx)

    // processor 路径重新注入（已是阶段1解析后的路径；含 item 变量时按迭代替换）
    const iterProcessor = injectParams(loopTask.processor || '', params, null, itemCtx)

    // gate 复制（同一 checker，独立执行）
    const iterGate = loopTask.gate ? {
      checker: loopTask.gate.checker,
      onFailure: loopTask.gate.onFailure,
      maxRetries: loopTask.gate.maxRetries,
    } : null

    expanded.push({
      id: iterId,
      name: (loopTask.name || loopTask.id) + ' - ' + itemStr,
      type: 'llm-task',
      dependsOn: prevId ? [prevId] : loopDeps,
      timeout: loopTask.timeout || 600,
      processor: iterProcessor,
      inputs: iterInputs,
      outputs: iterOutputs,
      gate: iterGate,
      // 循环错误处理策略
      _onError: loopTask.onError || 'break',
      // 循环组元数据（供 Client DAG 分组渲染）
      _loopGroup: loopTask.id,
      _loopGroupName: loopTask.name || loopTask.id,
      _loopItem: itemStr,
      _loopIndex: i,
    })
    prevId = iterId
  }

  return expanded
}

// Iter-8：并发展开——对 items 的每个 item 生成一个独立迭代，迭代之间无依赖（可并发，受组级 max 约束）
// Iter-26：对象 item/空提取占位迭代语义同 expandLoopTasks（无串行依赖链）。
async function expandConcurrentTasks(fs, task, items, itemVar, params, vars) {
  const expanded = []
  const loopDeps = task.dependsOn || []
  const list = normalizeItemEntries(items)
  const gMax = task.maxConcurrency || Math.max(list.length, 1) // 组级并发（默认 items 数量，全部并发）

  // 空提取 → 占位迭代（Q1-b）
  if (list.length === 0) {
    const emptyCtx = { varName: itemVar, data: null, empty: true }
    expanded.push({
      id: task.id + '/empty',
      name: (task.name || task.id) + '（items 为空）',
      type: 'llm-task',
      dependsOn: loopDeps,
      timeout: task.timeout || 600,
      processor: injectParams(task.processor || '', params, null, emptyCtx),
      inputs: injectInputsMap(task.inputsRaw || {}, params, vars, emptyCtx),
      outputs: injectArray(task.outputsRaw || [], params, vars, emptyCtx),
      gate: task.gate ? {
        checker: task.gate.checker,
        onFailure: task.gate.onFailure,
        maxRetries: task.gate.maxRetries,
      } : null,
      _concurrentGroup: task.id,
      _concurrentGroupName: task.name || task.id,
      _concurrentItem: '（items 为空）',
      _concurrentIndex: 0,
      _concurrentMax: gMax,
    })
    return expanded
  }

  for (let i = 0; i < list.length; i++) {
    const item = list[i]
    const itemStr = E_itemDisplayValue(item, i)
    const itemCtx = buildItemContext(itemVar, item, i)

    const sanitized = itemStr.replace(/[^a-zA-Z0-9_\-]/g, '-').replace(/^-+|-+$/g, '') || ('iter-' + i)
    const iterId = task.id + '/' + sanitized

    const iterInputs = injectInputsMap(task.inputsRaw || {}, params, vars, itemCtx)
    const iterOutputs = injectArray(task.outputsRaw || [], params, vars, itemCtx)
    const iterProcessor = injectParams(task.processor || '', params, null, itemCtx)

    const iterGate = task.gate ? {
      checker: task.gate.checker,
      onFailure: task.gate.onFailure,
      maxRetries: task.gate.maxRetries,
    } : null

    expanded.push({
      id: iterId,
      name: (task.name || task.id) + ' - ' + itemStr,
      type: 'llm-task',
      dependsOn: loopDeps, // ← 关键：无串行依赖链，都依赖原始前驱 → 可并发
      timeout: task.timeout || 600,
      processor: iterProcessor,
      inputs: iterInputs,
      outputs: iterOutputs,
      gate: iterGate,
      // 并发组元数据（Client DAG 分组渲染 + engine 组级并发控制）
      _concurrentGroup: task.id,
      _concurrentGroupName: task.name || task.id,
      _concurrentItem: itemStr,
      _concurrentIndex: i,
      _concurrentMax: gMax,
    })
  }

  return expanded
}

// 从工具执行上下文取会话工作区（preset 挂载后 exec.agent 可用）
function sessionCwd(exec) {
  try {
    const cwd = exec && exec.agent && exec.agent.session && exec.agent.session.header && exec.agent.session.header.cwd
    return typeof cwd === 'string' && cwd.length > 0 ? cwd : undefined
  } catch (e) {
    return undefined
  }
}

// 注册工具：preset 本地插件形态（ctx.tools.register），不依赖 harness
// Iter-10：新增 registry 参数（instance-store 的 createInstanceRegistry 产物）。
//   - 会话上下文 + 无显式 statePath/workspaceRoot 参数 → 实例布局：
//     begin 时创建实例目录并绑定新 engine/storage；status 时按会话取活跃实例
//     （重启后惰性 hydrate）。快照附 instanceId 供调用方/前端识别。
//   - 显式 statePath/workspaceRoot 参数或无会话上下文 → 回退单实例绑定
//     （engine/storage 形参，保持既有行为与旧布局兼容）。
function registerWorkflowToolsPreset(ctx, engine, storage, registry) {
  const fs = ctx.get('fs')

  // ── Iter-24：预定义目录物化（模板+技能+骨架；幂等覆盖；失败不阻断工具注册）──
  // 兼任探针：journalctl 搜 "[workflow-agent] materialize" 即见 Host fs 对
  // ~/.dsh/ 的写能力与物化结果。fire-and-forget，不等待。
  if (fs) {
    try {
      const tpl = (typeof BUILTIN_TEMPLATES !== 'undefined') ? BUILTIN_TEMPLATES : []
      materializeBuiltinAssets(fs, tpl)
        .then((r) => {
          if (r && r.ok) console.log('[workflow-agent] materialize ok root=' + r.root + ' written=' + r.written.length + (r.failed.length ? ' FAILED=' + r.failed.join('; ') : ''))
          else console.log('[workflow-agent] materialize skip: ' + ((r && r.reason) || 'unknown') + (r && r.failed && r.failed.length ? ' failed=' + r.failed.join('; ') : ''))
        })
        .catch((e) => console.log('[workflow-agent] materialize ERROR: ' + (e && e.message ? e.message : String(e))))
    } catch (e) {
      console.log('[workflow-agent] materialize ERROR-sync: ' + (e && e.message ? e.message : String(e)))
    }
  }

  // ── 每次工具调用解析绑定的引擎/存储（避免跨会话闭包串扰，多会话并行安全）──
  // Iter-26R：返回值补 entry（实例条目，含 dir/meta）——workflow_status 的延迟展开
  // 前置检查（expandDeferredGroups）需要 entry.dir 构造 expandFn；此前 b.entry 恒
  // undefined 导致展开从未触发（GUI 验收实证）。
  async function bind(exec, args) {
    if (args && (args.statePath || args.workspaceRoot)) {
      return { engine, storage, instanceId: null, entry: null }
    }
    if (registry) {
      const entry = await registry.forSession(exec)
      if (entry) return { engine: entry.engine, storage: entry.storage, instanceId: entry.instanceId, entry }
    }
    return { engine, storage, instanceId: null, entry: null }
  }

  function withInstanceId(snapshot, b) {
    if (b && b.instanceId) snapshot.instanceId = b.instanceId
    return snapshot
  }

  // ── workflow_begin ────────────────────────────────────────────────────────
  const beginTool = {
    name: 'workflow_begin',
    description: '解析并启动一个工作流定义（YAML）。参数 workflowPath 为本机绝对路径；或传 workflowText 直接给 YAML 文本。可选 params 对象注入工作流级 ${param} 模板变量；定义中可用目录变量 ${workspace}/${wf_dir}/${skills}/${skill_dir}（展开期注入为绝对路径）。loop/concurrent 支持 items-format（lines|markdown|json|yaml，缺省按扩展名推断）与对象 item 注入（${item} 默认链 id→名称→序号、${item.字段} 标量；空 items 展开为 <组id>/empty 占位迭代，items 文件须启动时刻已存在）。可选 workspaceRoot / statePath 指定状态落盘位置（兼容旧单实例布局）；默认在当前会话工作区创建实例目录 <cwd>/.workflow-agent/instances/<workflowName-uuid8>/（instance.yaml/state.json/metadata.json/output/logs），状态写入实例目录。成功返回解析出的任务列表（processor 技能绝对路径、inputs 命名字典与 outputs 列表均为绝对路径——inputs/outputs 相对路径以实例目录为基准解析、skillDir 技能目录、门禁配置、instanceId）与初始 PENDING 状态；定义不合法时返回 errors 列表。processor 未指定的任务照常返回（processor=null，由编排侧向用户报告，Iter-25 起 parser 降为创建警告）。',
    parameters: {
      type: 'object',
      additionalProperties: true,
      properties: {
        workflowPath: { type: 'string', description: '工作流 YAML 的绝对路径' },
        workflowText: { type: 'string', description: '工作流 YAML 文本（与 workflowPath 二选一）' },
        workspaceRoot: { type: 'string', description: '（兼容旧布局）状态落盘根目录；默认走实例目录布局' },
        statePath: { type: 'string', description: '（兼容旧布局）完全自定义的状态文件绝对路径' },
        params: {
          type: 'object',
          additionalProperties: true,
          description: '工作流参数，替换字段中的 ${param_name}',
        },
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render(_a, v) {
        return [{ type: 'text', text: JSON.stringify(v, null, 2) }]
      },
    },
    async execute(args, exec) {
      // 初始绑定（错误路径也要能落盘）
      let b = await bind(exec, args)
      try {
        if (!fs) throw new Error('fs service unavailable')
        if (args && args.workspaceRoot && b.storage) b.storage.setWorkspaceRoot(String(args.workspaceRoot))
        if (args && args.statePath && b.storage) b.storage.setStatePath(String(args.statePath))
        // 未显式指定 workspaceRoot 时，从会话上下文取工作区（legacy 单实例布局落点）
        if ((!args || !args.workspaceRoot) && b.storage) {
          const cwd = sessionCwd(exec)
          if (cwd) b.storage.setWorkspaceRoot(cwd)
        }
        const src = await loadWorkflowSource(fs, args, (args && args.workspaceRoot) || sessionCwd(exec) || undefined)
        if (!src) throw new Error('需要 workflowPath 或 workflowText 参数')
        const params = (args && args.params) || {}
        // Iter-27a：预置工作流（templates/<子目录>/）defDir 锚点——begin 展开期
        // 实例目录尚不存在，静态 items 相对引用优先 defDir（模板子目录）解析。
        //（声明在外层：创建实例后的 1:1 复制同用此值）
        let beginDefDir = args.workflowPath
          ? (E_presetTemplateDirOf(args.workflowPath, detectPredefinedRootSafe()) || undefined)
          : undefined
        let parsed
        try {
          parsed = await expandDefinition(fs, src, params, beginDefDir ? { defDir: beginDefDir } : undefined)
        } catch (e) {
          if (e && e.workflowBeginErrors) {
            // 保持既有契约：解析错误经快照 workflowBeginErrors 字段返回
            b.engine.setError(e.message)
            await b.storage.save()
            const s = b.engine.snapshot()
            s.workflowBeginErrors = e.workflowBeginErrors
            return withInstanceId(s, b)
          }
          throw e
        }

        // ── Iter-10：多实例布局——成功路径创建实例目录并切换绑定 ──
        // （解析/展开失败不建实例目录；显式 statePath/workspaceRoot 参数走旧布局）
        let wfDir = null // Iter-25：阶段2基准目录（实例目录；legacy 回退见下）
        if (registry && !args.statePath && !args.workspaceRoot) {
          const cwd = sessionCwd(exec)
          if (cwd) {
            const entry = await (registry.sessionIdOf(exec)
              ? registry.createBind(cwd, registry.sessionIdOf(exec), { // Iter-19：1:1 + CONFLICT 自愈
                workflowName: parsed.name,
                sourceText: src.text,
                sourcePath: args.workflowPath || null,
                params,
              })
              : registry.beginInstance({ cwd, sessionId: null, workflowName: parsed.name, sourceText: src.text, sourcePath: args.workflowPath || null, params }))
            b = { engine: entry.engine, storage: entry.storage, instanceId: entry.instanceId, recoveredConflict: entry._recoveredConflict || [] }
            wfDir = entry.dir
            // Iter-25 修复（潜伏 bug）：begin 路径此前从未置 hasState，begin→stop→reset
            // 会被 reset 工具按 stage=CREATED 误拒（workflow_start 路径一直有置）。
            entry.hasState = true
            // Iter-27a（四点②③）：预置工作流子目录 1:1 复制（定义已写 instance.yaml；
            // 静态文件原样复制，相对引用零调整；文本 only；失败不阻断 begin 主流程）
            if (beginDefDir) b.presetCopy = await copyTemplateStaticTree(fs, beginDefDir, entry.dir, args.workflowPath)
          }
        }
        if (!wfDir) wfDir = args.statePath ? parentDir(String(args.statePath)) : (src.workspaceRoot || null) // legacy 单实例布局（默认④）

        // Iter-25 阶段2：实例目录就绪后注入 ${wf_dir}/${skill_dir} 并绝对化 inputs/outputs
        parsed.tasks = finalizeDataflow(parsed.tasks, { wfDir })
        parsed.tasks = await materializeInputsIntoInstance(fs, parsed.tasks, wfDir, src.workspaceRoot)
        b.engine.begin(parsed)
        b.engine.start() // Iter-19：begin 后即视为执行中 → RUNNING（与状态机一致）
        b.engine.setError(null)
        const r = await b.storage.save()
        b.engine.setPersist(r)
        const beginSnap = withInstanceId(b.engine.snapshot(), b)
        if (b.recoveredConflict && b.recoveredConflict.length > 0) beginSnap.recoveredConflict = b.recoveredConflict
        return beginSnap
      } catch (error) {
        b.engine.setError(error.message)
        await b.storage.save()
        return withInstanceId(b.engine.snapshot(), b)
      }
    },
  }
  ctx.tools.register(beginTool)

  // ── workflow_status ───────────────────────────────────────────────────────
  const statusTool = {
    name: 'workflow_status',
    description: '按编排进展更新工作流状态并同步持久化与 UI：stage（PENDING|RUNNING|COMPLETED|FAILED）、gateResult（PASS|FAIL）、task/tasktatus 更新单个任务（PENDING|RUNNING|DONE|FAILED|SKIPPED）、retries 重试计数、error 错误信息。状态写入当前会话活跃实例目录的 state.json（重启后自动从实例目录恢复）。每次调用返回最新快照（含 instanceId）。',
    parameters: {
      type: 'object',
      additionalProperties: true,
      properties: {
        stage: { type: 'string', description: '全局阶段' },
        gateResult: { type: 'string', description: '门禁结果 PASS 或 FAIL' },
        task: { type: 'string', description: '要更新的任务 id' },
        taskStatus: { type: 'string', description: '该任务状态' },
        retries: { type: 'number', description: '失败重试计数' },
        error: { type: 'string', description: '错误信息' },
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render(_a, v) {
        return [{ type: 'text', text: JSON.stringify(v, null, 2) }]
      },
    },
    async execute(args, exec) {
      const b = await bind(exec, args)
      try {
        if (!args) args = {}
        if (args.stage) b.engine.setStage(String(args.stage))
        if (args.gateResult) b.engine.setGateResult(String(args.gateResult))
        if (typeof args.retries === 'number') b.engine.setRetries(args.retries)
        if (args.error !== undefined) b.engine.setError(args.error ? String(args.error) : null)
        if (args.task && args.taskStatus) {
          b.engine.updateTask(String(args.task), { status: String(args.taskStatus) })
        }
        // Iter-26R（D4）：延迟展开前置检查——占位节点前驱就绪时展开为迭代
        if (b.entry) {
          const expandFn = makeExpandFn(b.entry)
          await b.engine.expandDeferredGroups(expandFn)
        }
        const r = await b.storage.save()
        b.engine.setPersist(r)
        return withInstanceId(b.engine.snapshot(), b)
      } catch (error) {
        b.engine.setError(error.message)
        return withInstanceId(b.engine.snapshot(), b)
      }
    },
  }
  ctx.tools.register(statusTool)

  // ══ Iter-11：实例操控工具（操作当前会话工作区下的实例目录）══════════════
  // 定位语义：显式 instanceId → 本 cwd 实例目录精确解析；缺省 → 会话活跃实例。
  // 实例运行状态记实例目录 state.json；实例选择/切换由 DSH session 列表承担
  // （设计文档 §5.4）。

  // 实例定义的相对路径解析基目录（优先原始源定义所在目录）
  // 读取实例 instance.yaml 并展开为 parsed（start/reset 共用）
  // Iter-24：相对引用走两级解析链，基准=创建会话的工作区根（meta.sessionCwd）
  // Iter-25：阶段2数据流终态在展开内一次完成（entry.dir 实例目录已知）
  // Iter-26：entry.dir 同时作为阶段1 ${wf_dir} 保留字传入（items-from: ${wf_dir}/...
  // 在 start/reset 路径可解析；begin 一步式路径实例目录尚不存在，不传）
  async function expandInstanceDefinition(entry) {
    const raw = await fs.readText(await fs.resolve(entry.dir + '/instance.yaml'))
    const text = stripInstanceHeader(raw)
    const params = (entry.meta && entry.meta.params) || {}
    const wsRoot = (entry.meta && entry.meta.sessionCwd) || undefined
    // Iter-27a：预置工作流 defDir 锚点（meta.sourcePath → templates/<子目录>）。
    // 静态 items 解析优先序=实例目录（1:1 副本，自包含主路径）→ defDir（模板子目录，
    // 实例副本缺失时自愈）→ 两级链兜底（非预置来源/旧实例）。
    const defDir = E_presetTemplateDirOf(entry.meta && entry.meta.sourcePath, detectPredefinedRootSafe()) || undefined
    const parsed = await expandDefinition(fs, { text, workspaceRoot: wsRoot }, params, { wfDir: entry.dir, defDir })
    parsed.tasks = finalizeDataflow(parsed.tasks, { wfDir: entry.dir })
    parsed.tasks = await materializeInputsIntoInstance(fs, parsed.tasks, entry.dir, wsRoot)
    return parsed
  }

  // Iter-26R（D4）：延迟展开回调——占位节点前驱就绪时读 items 文件并展开为迭代数组
  // 由 engine.expandDeferredGroups 调用；返回的迭代已含 processor/inputs/outputs 绝对路径。
  // entry 参数：当前实例条目（提供 dir/wsRoot 上下文）。
  function makeExpandFn(entry) {
    const wsRoot = (entry.meta && entry.meta.sessionCwd) || undefined
    const instDir = entry.dir ? String(entry.dir).replace(/\/+$/, '') : ''
    const dirVars = { wf_dir: instDir || undefined }
    return async function expandDeferred(placeholder, pendingItems) {
      if (!pendingItems || !pendingItems.itemsFrom) return []
      // Iter-26R：itemsFrom 已由 finalizeDataflow 以实例目录绝对化（itemsDeferred 清标记）；
      // 兜底——hydrate 的旧占位若仍是相对形态，以实例目录拼接（与 D1 基准一致）。
      let itemsPath = String(pendingItems.itemsFrom)
      if (!E_isAbsoluteishPath(itemsPath) && instDir) itemsPath = instDir + '/' + itemsPath
      // 读 items 文件（可能仍不存在→readText 抛错→expandDeferredGroups catch 占位保持 PENDING）
      const text = await fs.readText(await fs.resolve(itemsPath))
      const items = E_extractItems(text, {
        format: pendingItems.itemsFormat || null,
        path: itemsPath,
        taskId: placeholder.id,
      })
      // 构造临时任务对象（复用 expandLoop/ConcurrentTasks）
      const tmpTask = {
        id: placeholder.id,
        name: placeholder.name,
        type: pendingItems.taskType,
        dependsOn: placeholder.dependsOn || [],
        processorRaw: pendingItems.processorRaw,
        inputsRaw: pendingItems.inputsRaw || {},
        outputsRaw: pendingItems.outputsRaw || [],
        gate: pendingItems.gate || null,
        onError: pendingItems.onError || 'break',
        maxConcurrency: pendingItems.maxConcurrency || null,
        itemsFrom: itemsPath,
        itemsFormat: pendingItems.itemsFormat || null,
        itemVar: pendingItems.itemVar,
      }
      // processor 用占位中已解析的绝对路径（expandDefinition 第一遍 resolveRefPath 产物）；
      // 含 ${item} 场景由 expandLoop/ConcurrentTasks 按迭代二次注入——与即时展开路径一致。
      tmpTask.processor = pendingItems.processor
        || (tmpTask.processorRaw ? await resolveRefPath(fs, wsRoot, tmpTask.processorRaw) : null)
      // 展开（空提取 → []，由 expandDeferredGroups 处理占位 DONE）
      let iterations = []
      if (pendingItems.taskType === 'loop') {
        iterations = await expandLoopTasks(fs, tmpTask, items, pendingItems.itemVar, {}, dirVars)
      } else if (pendingItems.taskType === 'concurrent') {
        iterations = await expandConcurrentTasks(fs, tmpTask, items, pendingItems.itemVar, {}, dirVars)
      }
      // Iter-26R：迭代 inputs/outputs 以实例目录为基准绝对化 + skillDir（与即时展开路径
      // 的 finalizeDataflow 阶段2 同款；outputsRaw 是相对形态，注入 ${item} 后需同基准绝对化）
      return finalizeDataflow(iterations, { wfDir: instDir })
    }
  }

  // 条目是否有已落盘运行状态（一律以磁盘 state.json 为准，避免内存标记过期）
  async function entryStateOnDisk(entry) {
    try {
      const st = JSON.parse(await fs.readText(await fs.resolve(entry.dir + '/state.json')))
      return !!(st && st.workflow)
    } catch (e) {
      return false
    }
  }

  function errPayload(e) {
    const out = { error: (e && e.message) || String(e) }
    if (e && e.workflowBeginErrors) out.workflowBeginErrors = e.workflowBeginErrors
    return out
  }

  // ── workflow_list ─────────────────────────────────────────────────────────
  ctx.tools.register({
    name: 'workflow_list',
    description: '列出当前会话工作区下的全部 workflow 实例（按创建时间倒序）。phase=CREATED 表示仅创建未启动；READY 表示已有运行状态（stage/task 计数）。返回 {cwd, instances[], activeInstanceId}。',
    parameters: { type: 'object', additionalProperties: true, properties: {} },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render(_a, v) { return [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
    },
    async execute(args, exec) {
      try {
        if (!registry) throw new Error('registry unavailable')
        const cwd = registry.sessionCwdOf(exec)
        if (!cwd) throw new Error('无会话工作区（实例按 session cwd 隔离）')
        const instances = await registry.listInstances(cwd)
        const sid = registry.sessionIdOf(exec)
        // Iter-18：派生当前会话状态 UNBOUND/BOUND/DONE/BROKEN + 孤儿扫描提示
        let sessionState = null
        if (sid) sessionState = await registry.deriveSessionState(cwd, sid)
        const orphans = await registry.scanOrphans(cwd)
        const out = { cwd, instances, activeInstanceId: (sid && registry.activeIdFor(sid)) || null }
        if (sid) out.sessionState = sessionState
        if (orphans.length > 0) out.orphans = orphans.map(o => o.id)
        return out
      } catch (e) {
        return errPayload(e)
      }
    },
  })

  // ── workflow_create ───────────────────────────────────────────────────────
  ctx.tools.register({
    name: 'workflow_create',
    description: '从工作流定义（workflowPath 或 workflowText）+ params 创建 workflow 实例目录（instance.yaml/metadata.json/output/logs），校验定义但不启动执行。返回 {instanceId, dir, workflowName, phase:"CREATED", warnings[], presetCopy}——warnings 为创建关口校验警告（任务缺 processor / quality-gate 缺 checker；Iter-25 起允许此类半成品实例存在，启动前应补全）。Iter-27a：workflowPath 为预置模板子目录（templates/<名>/<名>.yaml）时，子目录内全部文件 1:1 复制进实例目录（静态文件自包含，相对引用零调整；文本文件），返回 presetCopy={copied,failed}。启动用 workflow_start。',
    parameters: {
      type: 'object',
      additionalProperties: true,
      properties: {
        workflowPath: { type: 'string', description: '工作流 YAML 的绝对路径' },
        workflowText: { type: 'string', description: '工作流 YAML 文本（与 workflowPath 二选一）' },
        params: { type: 'object', additionalProperties: true, description: '工作流参数快照（启动时复用）' },
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render(_a, v) { return [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
    },
    async execute(args, exec) {
      try {
        if (!registry) throw new Error('registry unavailable')
        if (!fs) throw new Error('fs service unavailable')
        const cwd = registry.sessionCwdOf(exec)
        if (!cwd) throw new Error('无会话工作区（实例必须在会话工作区内创建）')
        const src = await loadWorkflowSource(fs, args)
        if (!src) throw new Error('需要 workflowPath 或 workflowText 参数')
        const parsed = E_parseWorkflow(src.text)
        if (parsed.errors && parsed.errors.length > 0) throw definitionError(parsed.errors)
        const entry = await (registry.sessionIdOf(exec)
          ? registry.createBind(cwd, registry.sessionIdOf(exec), { // Iter-19：1:1 + CONFLICT 自愈
            workflowName: parsed.name,
            sourceText: src.text,
            sourcePath: args.workflowPath || null,
            params: args.params || {},
          })
          : registry.beginInstance({ cwd, sessionId: null, workflowName: parsed.name, sourceText: src.text, sourcePath: args.workflowPath || null, params: args.params || {} }))
        // Iter-27a（四点②③）：预置工作流子目录 1:1 复制——模板子目录与实例目录
        // 同构，静态文件原样复制（相对引用零调整，实例自包含）；定义文件本身已写
        // 为 instance.yaml，跳过；文本 only；单文件失败不阻断（失败清单回传）。
        let presetCopy = null
        const tplDir = args.workflowPath
          ? (E_presetTemplateDirOf(args.workflowPath, detectPredefinedRootSafe()) || null)
          : null
        if (tplDir) presetCopy = await copyTemplateStaticTree(fs, tplDir, entry.dir, args.workflowPath)
        // Iter-25（D4）：创建关口校验警告（缺 processor / gate 无 checker）——实例照常创建，
        // 校验与执行事件解耦；补全后重创建或（Iter-28 起）编辑实例。
        // Iter-27a：presetCopy = { copied, failed }（仅预置工作流子目录来源时返回）。
        return { instanceId: entry.instanceId, dir: entry.dir, workflowName: parsed.name, phase: 'CREATED', cwd, recoveredConflict: entry._recoveredConflict || [], warnings: parsed.warnings || [], presetCopy }
      } catch (e) {
        return errPayload(e)
      }
    },
  })

  // ── workflow_start ────────────────────────────────────────────────────────
  ctx.tools.register({
    name: 'workflow_start',
    description: '启动一个已存在的 workflow 实例：读实例 instance.yaml → 解析展开 → 引擎置 PENDING → 写实例 state.json → 返回任务列表与 runnable（编排循环起点）。缺省 instanceId 时用当前会话活跃实例。RUNNING 中的实例会拒绝（先 stop 或 reset）。返回快照含 instanceId。',
    parameters: {
      type: 'object',
      additionalProperties: true,
      properties: {
        instanceId: { type: 'string', description: '实例 id（缺省=当前会话活跃实例）' },
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render(_a, v) { return [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
    },
    async execute(args, exec) {
      try {
        if (!registry) throw new Error('registry unavailable')
        if (!fs) throw new Error('fs service unavailable')
        const entry = await registry.resolveEntry(exec, args && args.instanceId, { active: true })
        if (!entry) throw new Error('实例不存在' + (args && args.instanceId ? ': ' + args.instanceId : '（且当前会话无活跃实例，可先 workflow_create 或传 instanceId）'))
        // Iter-18：start 须会话已认领实例（UNBOUND→先 adopt；异会话→1:1 拒）
        const sessId = registry.sessionIdOf(exec)
        if (sessId && entry.meta.sessionId !== sessId) {
          if (!entry.meta.sessionId) throw new Error('实例 ' + entry.instanceId + ' 未绑定本会话；先用 workflow_adopt 采用')
          throw new Error('实例 ' + entry.instanceId + ' 已被会话 ' + entry.meta.sessionId + ' 占用（1:1），本会话不可启动')
        }
        // 状态机守卫
        const stage = entry.hasState ? entry.engine.snapshot().stage : 'CREATED'
        if (stage === 'RUNNING') throw new Error('实例 ' + entry.instanceId + ' 正在运行中（stage=RUNNING）')
        if (stage === 'STOPPED') throw new Error('实例 ' + entry.instanceId + ' 已停止；用 workflow_resume 续跑')
        if (stage === 'COMPLETED' || stage === 'FAILED') throw new Error('实例 ' + entry.instanceId + ' 已完成/失败（stage=' + stage + '）；用 workflow_reset 重跑')
        if (!entry.hasState) {
          const parsed = await expandInstanceDefinition(entry)
          entry.engine.begin(parsed)
        }
        entry.engine.setError(null)
        entry.engine.start() // Iter-18：PENDING→RUNNING（引擎守卫仅 PENDING）
        const r = await entry.storage.save()
        entry.engine.setPersist(r)
        entry.hasState = true
        const snap = entry.engine.snapshot()
        snap.instanceId = entry.instanceId
        return snap
      } catch (e) {
        return errPayload(e)
      }
    },
  })

  // ── workflow_stop ─────────────────────────────────────────────────────────
  ctx.tools.register({
    name: 'workflow_stop',
    description: '停止一个 workflow 实例：stage 置 STOPPED 并落盘实例 state.json（编排 Agent 看到 STOPPED 后不再推进）。缺省 instanceId 时用当前会话活跃实例。CREATED 未启动的实例无需停止。返回快照含 instanceId。',
    parameters: {
      type: 'object',
      additionalProperties: true,
      properties: {
        instanceId: { type: 'string', description: '实例 id（缺省=当前会话活跃实例）' },
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render(_a, v) { return [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
    },
    async execute(args, exec) {
      try {
        if (!registry) throw new Error('registry unavailable')
        const entry = await registry.resolveEntry(exec, args && args.instanceId)
        if (!entry) throw new Error('实例不存在' + (args && args.instanceId ? ': ' + args.instanceId : '（且当前会话无活跃实例）'))
        if (!(await entryStateOnDisk(entry))) throw new Error('实例 ' + entry.instanceId + ' 尚未启动（CREATED），无需停止')
        entry.engine.stop() // Iter-18：仅 RUNNING→STOPPED（保进度，active=false）
        const r = await entry.storage.save()
        entry.engine.setPersist(r)
        // Iter-SUBA(P3)：权威急停——级联 interrupt 仍在跑的任务子会话（fire-and-return，one-shot/absent=no-op）；
        // apiProxy 不可用/单子失败均不阻断 stop 主流程。Iter-23(方向A)：手工停 DSH 会话路径（A1 事件
        // tap 即时处置 / A2 sync 轮询兜底）走 instance-store.applyUserStop，与本工具同一处置语义
        // （STOPPED(user-stop)+级联），面板 Stop 与 UI 停止按钮自此同级权威。
        let stoppedChildren = 0
        try {
          const sid = exec && exec.agent && exec.agent.session && exec.agent.session.header ? exec.agent.session.header.id : undefined
          const apiProxy = ctx && ctx.get ? ctx.get('apiProxy') : undefined
          if (apiProxy && apiProxy.subagents && sid) {
            const lst = await apiProxy.subagents.list({ rpcId: 'wf-stop-list-' + Date.now(), payload: { parentSessionId: sid } })
            const body = lst && lst.payload !== undefined ? lst.payload : lst
            const value = body && body.result && body.result.value ? body.result.value : body
            const entries = value && Array.isArray(value.entries) ? value.entries : []
            for (const ch of entries) {
              if (ch && ch.kind === 'child' && ch.activity === 'running') {
                try {
                  await apiProxy.subagents.interrupt({ rpcId: 'wf-stop-int-' + Date.now() + '-' + ch.id, payload: { parentSessionId: sid, childSessionId: ch.id } })
                  stoppedChildren += 1
                } catch (e2) { /* 单子失败不阻断 */ }
              }
            }
          }
        } catch (e2) { /* 级联失败不阻断 stop 主流程 */ }
        // Iter-SUBA(P2)：权威停止标记 user-stop——syncInstanceState 据此永不自动恢复（区别于自然空闲停）
        const cwd = sessionCwd(exec)
        if (cwd) await registry.patchMeta(cwd, entry.instanceId, { stopReason: 'user-stop' })
        const snap = entry.engine.snapshot()
        snap.instanceId = entry.instanceId
        snap.stopReason = 'user-stop'
        snap.stoppedChildren = stoppedChildren
        return snap
      } catch (e) {
        return errPayload(e)
      }
    },
  })

  // ── workflow_reset ────────────────────────────────────────────────────────
  ctx.tools.register({
    name: 'workflow_reset',
    description: '重置一个 workflow 实例并可直接重跑：先归档备份实例内容（<ts>_reset_<state>/）→ 从 instance.yaml 重新解析展开 → 引擎全新 PENDING → 覆盖 state.json → 返回快照含 pendingCleanup（rm 命令）——**编排 Agent 必须立即用 bash 执行 pendingCleanup.cmd 清空 output/logs**（fs 服务无删除 API，清空由会话执行；备份已在 archive/ 保留全部产物）。缺省 instanceId 时用当前会话活跃实例。',
    parameters: {
      type: 'object',
      additionalProperties: true,
      properties: {
        instanceId: { type: 'string', description: '实例 id（缺省=当前会话活跃实例）' },
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render(_a, v) { return [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
    },
    async execute(args, exec) {
      try {
        if (!registry) throw new Error('registry unavailable')
        if (!fs) throw new Error('fs service unavailable')
        const cwd = registry.sessionCwdOf(exec)
        if (!cwd) throw new Error('无会话工作区')
        const entry = await registry.resolveEntry(exec, args && args.instanceId, { active: true })
        if (!entry) throw new Error('实例不存在' + (args && args.instanceId ? ': ' + args.instanceId : '（且当前会话无活跃实例）'))
        // Iter-18：reset 仅 STOPPED/COMPLETED/FAILED（PENDING/CREATED/RUNNING 拒）
        const stage = entry.hasState ? entry.engine.snapshot().stage : 'CREATED'
        if (stage === 'RUNNING') throw new Error('reset 仅允许 STOPPED/COMPLETED/FAILED；RUNNING 先 workflow_stop')
        if (stage === 'CREATED' || stage === 'PENDING') throw new Error('reset 仅允许 STOPPED/COMPLETED/FAILED（当前 ' + stage + '）')
        // Iter-18：先写 reset 归档备份（<ts>_reset_<state>/），再 engine.reset()
        const backupDir = await registry.writeArchiveBackup(cwd, entry.instanceId, 'reset', (stage || 'UNKNOWN'))
        // Iter-22：reset 不依赖内存 state.def（hydrate 不恢复 def，历史/重启/hydrate-only 实例
        // 必无 def）——从 instance.yaml 重新解析展开定义再重置，任意可 reset 实例都能重跑。
        const parsed = await expandInstanceDefinition(entry)
        entry.engine.resetWithDefinition(parsed) // → 全新 PENDING
        entry.engine.setError(null)
        const r = await entry.storage.save()
        entry.engine.setPersist(r)
        await registry.patchMeta(cwd, entry.instanceId, { lastResetAt: new Date().toISOString(), stopReason: null }) // Iter-SUBA(P2)：重置即全新运行，清除停止标记
        const snap = entry.engine.snapshot()
        snap.instanceId = entry.instanceId
        snap.resetBackup = backupDir
        // Iter-26（用户拍板"重置重来应删 output"）：备份后清空 output/logs。fs 服务无删除/
        // 移动 API（dsh-fs-local 仅 read/write/list/stat）→ 返回 pendingCleanup 命令，
        // 由编排会话按 persona 契约立即用 bash 执行（rm -rf + mkdir -p 重建空目录）。
        const q = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'"
        snap.pendingCleanup = {
          outputDir: entry.dir + '/output',
          logsDir: entry.dir + '/logs',
          cmd: 'rm -rf ' + q(entry.dir + '/output') + ' ' + q(entry.dir + '/logs') + ' && mkdir -p ' + q(entry.dir + '/output') + ' ' + q(entry.dir + '/logs'),
        }
        snap.resetNote = '状态已重置；output/logs 已备份至 ' + backupDir + '，须立即执行 pendingCleanup.cmd 清空产物'
        return snap
      } catch (e) {
        return errPayload(e)
      }
    },
  })

  // ── workflow_resume（Iter-18 新增：仅 STOPPED 续跑）────────────────────────
  ctx.tools.register({
    name: 'workflow_resume',
    description: '续跑一个已停止（STOPPED）的 workflow 实例：engine.resume() 从已存 state.json hydrate 续跑保进度（保 DONE）→ RUNNING。缺省 instanceId 用当前会话活跃实例。仅 STOPPED 可 resume；PENDING/RUNNING/COMPLETED/FAILED 拒绝。返回快照含 instanceId。',
    parameters: {
      type: 'object',
      additionalProperties: true,
      properties: {
        instanceId: { type: 'string', description: '实例 id（缺省=当前会话活跃实例）' },
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render(_a, v) { return [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
    },
    async execute(args, exec) {
      try {
        if (!registry) throw new Error('registry unavailable')
        const entry = await registry.resolveEntry(exec, args && args.instanceId)
        if (!entry) throw new Error('实例不存在' + (args && args.instanceId ? ': ' + args.instanceId : '（且当前会话无活跃实例）'))
        if (!(await entryStateOnDisk(entry))) throw new Error('实例 ' + entry.instanceId + ' 尚未启动（CREATED），无进度可续跑')
        const stage = entry.engine.snapshot().stage
        if (stage !== 'STOPPED') throw new Error('resume 仅允许 STOPPED（当前 ' + stage + '）')
        entry.engine.resume() // STOPPED→RUNNING，保 DONE
        const r = await entry.storage.save()
        entry.engine.setPersist(r)
        // Iter-SUBA(P2)：显式 resume 清 stopReason（自动恢复语义只对 session-idle 生效，防残留误判）
        const cwdResume = sessionCwd(exec)
        if (cwdResume) await registry.patchMeta(cwdResume, entry.instanceId, { stopReason: null })
        const snap = entry.engine.snapshot()
        snap.instanceId = entry.instanceId
        return snap
      } catch (e) {
        return errPayload(e)
      }
    },
  })

  // ── workflow_adopt（Iter-18 新增：采用池中 UNBOUND 实例并绑定本会话）────────
  ctx.tools.register({
    name: 'workflow_adopt',
    description: '采用一个池中 UNBOUND（sessionId==null）的 workflow 实例并绑定到当前会话（1:1 守卫；RUNNING 实例先 stop 再采用）。须传 instanceId。返回实例快照含 instanceId 与 adopted=true。',
    parameters: {
      type: 'object',
      additionalProperties: true,
      properties: {
        instanceId: { type: 'string', description: '要采用的实例 id（必填）' },
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render(_a, v) { return [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
    },
    async execute(args, exec) {
      try {
        if (!registry) throw new Error('registry unavailable')
        if (!fs) throw new Error('fs service unavailable')
        const cwd = registry.sessionCwdOf(exec)
        if (!cwd) throw new Error('无会话工作区（实例必须在会话工作区内采用）')
        if (!(args && args.instanceId)) throw new Error('workflow_adopt 须传 instanceId')
        const sessId = registry.sessionIdOf(exec)
        if (!sessId) throw new Error('无会话 id，无法绑定实例')
        const entry = await registry.adoptInstance(cwd, sessId, args.instanceId)
        const snap = entry.engine.snapshot()
        snap.instanceId = entry.instanceId
        snap.adopted = true
        snap.meta = entry.meta
        return snap
      } catch (e) {
        return errPayload(e)
      }
    },
  })
}

// 供 Node 独立验证（与宿主体内同构）：{ registerWorkflowToolsPreset, resolveRefPath, injectParams, injectArray, injectInputsMap, sessionCwd }
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { registerWorkflowToolsPreset, resolveRefPath, isAbsoluteishPath: E_isAbsoluteishPath, resolveStaticPath: E_resolveStaticPath, presetTemplateDirOf: E_presetTemplateDirOf, copyTemplateStaticTree, mergeTemplateLists, injectParams, injectArray, injectInputsMap, sessionCwd, expandLoopTasks, expandConcurrentTasks, stripInstanceHeader, expandDefinition, definitionError, finalizeDataflow, absolutizeDataflowPath }
}