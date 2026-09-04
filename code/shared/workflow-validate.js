// ============================================================================
// workflow-agent — 语义校验引擎（Iter-27b，R8/R12）
// 文件：code/shared/workflow-validate.js
// 说明：
//   - 纯函数：输入 raw parsed（parseWorkflow 原始产物，*Raw 字段保留）+ 语境锚点 +
//     fs 探针，输出 { ok, errors, warnings } 结构化清单；纯异步零副作用，仅
//     stat/readText 探针。parse 结构错误不在本引擎复报（调用方关口先行拦截）。
//   - 语境（context，拍板②双语境）：
//       'definition-preset'  preset 定义语境（templates/<子目录>/）：静态文件必须在该
//                            子目录内存在（不走两级链，四点①）；raw 字面绝对路径 →
//                            E-ABS-IN-DEF（保证预置发布完整）。
//       'definition'         非 preset 定义语境（workspace YAML / inline text）：两级链
//                            （workspace→预定义，现状）；字面绝对允许（用户指定产物），
//                            仅查存在。
//       'instance'           实例语境（create 之后）：实例目录及子目录优先（1:1 副本）
//                            → defDir → 两级链兜底；绝对直通仅查存在。
//   - raw 与 expanded 双轨（四点①④同时成立的关键）：E-ABS-IN-DEF 查 raw 字面；
//     存在性查 ${} 注入后的展开值——「params 注入展开为绝对 = create 时用户指定
//     合法入口」（四点④）；preset 语境变量展开为绝对按直通查存在（§5.1 变量路径列，
//     create 时展开后按实例语境判）。
//   - ${item / ${item.*}（迭代期才定）与展开后仍含 ${ 的值（未知 param / 定义语境的
//     ${wf_dir}）一律跳过；点号键非迭代上下文不可解析，校验期一律占位 → 统一跳过。
//   - 延迟组（26R 不误报）：deferDisposition（workflow-paths 共享单一事实源）判定=
//     延迟 → 跳过 items 存在性；显式 deferred:false 不跳（同报 E-ITEMS-MISSING）。
//     items 文件命中时仍做格式探针（E-ITEMS-PARSE）。
//   - 空 items 提取不算错（26R Q1-b 占位迭代合法）；提取抛错（坏 JSON/顶层标量）
//     → E-ITEMS-PARSE。
//   - inputs 衔接（§5.1）：命中任一任务 outputs（展开值相对精确 + basename 兜底）→
//     成立不查文件；仅 basename 命中（完整路径不同）→ 追加 W-REF-MISMATCH（疑似
//     拼写不一致）。outputs 声明本身不校验（运行期产出）。
//   - 技能（processor）恒两级链（R4 不复制不物化）：E-SKILL-MISSING 用内置两级链
//     stat 探针（与 tools-preset.resolveRefPath 同语义；shared 不反向依赖 plugin，
//     一致性由单测对齐）。gate checker 文件缺失不在拍板错误码表（10 码）内，保持
//     现状启动期报错语义不入引擎（局限记录 iter27b-report）。
//   - fs 缺失时降级：仅做纯静态检查（环/缺 processor/缺 checker/字面绝对/互斥警告），
//     存在性探测全部跳过——引擎不因无探针而误报。
// ============================================================================

// 共享同目录模块：mjs 内联同作用域直呼（typeof 探测；workflow-validate section 排
// workflow-paths / items-extract / schema 之后），Node 独立加载走 require 兜底。
let wvE_isAbsoluteishPath = typeof isAbsoluteishPath !== 'undefined' ? isAbsoluteishPath
  : (typeof require !== 'undefined' ? require('./workflow-paths').isAbsoluteishPath : null)
let wvE_resolveStaticPath = typeof resolveStaticPath !== 'undefined' ? resolveStaticPath
  : (typeof require !== 'undefined' ? require('./workflow-paths').resolveStaticPath : null)
let wvE_deferDisposition = typeof deferDisposition !== 'undefined' ? deferDisposition
  : (typeof require !== 'undefined' ? require('./workflow-paths').deferDisposition : null)
let wvE_extractItems = typeof extractItems !== 'undefined' ? extractItems
  : (typeof require !== 'undefined' ? require('./items-extract').extractItems : null)
let wvE_PARAM_PATTERN = typeof PARAM_PATTERN !== 'undefined' ? PARAM_PATTERN
  : (typeof require !== 'undefined' && require('./workflow-schema').PARAM_PATTERN
    ? require('./workflow-schema').PARAM_PATTERN
    : /\$\{(\w+)\}/g)

// ── 轻量 ${} 注入（与 tools-preset.injectParams 非迭代分支同语义；一致性单测对齐）──
// 优先级：目录变量保留字（D2）→ params → 占位保留。点号键（${x.y}）仅迭代上下文可
// 解析，校验期一律占位保留 → 由「仍含 ${ 即跳过」统一兜住。
function expandRef(value, params, dirVars) {
  if (typeof value !== 'string') return value
  return value.replace(wvE_PARAM_PATTERN, (whole, key) => {
    if (key.indexOf('.') !== -1) return whole
    if (dirVars && dirVars[key] !== undefined) return String(dirVars[key])
    if (params && params[key] !== undefined) return String(params[key])
    return whole
  })
}

// 注：内部助手带 wv 前缀——mjs 内联为模块级作用域，避免与 workflow-paths 的
// 同义函数（normalizeSlashes 等）重声明冲突（ESM 严格模式）。
function wvNormalize(p) { return String(p || '').replace(/\\/g, '/') }

function basenameOf(p) {
  const n = wvNormalize(p)
  const i = n.lastIndexOf('/')
  return i >= 0 ? n.slice(i + 1) : n
}

async function pathExists(fs, p) {
  if (!fs || !p) return false
  try {
    const st = await fs.stat(await fs.resolve(p))
    return !!st
  } catch (e) { return false }
}

// 技能两级链探针（与 tools-preset.resolveRefPath 同语义：workspace → 预定义；
// 绝对直通；双 miss=false）
async function skillRefExists(fs, ref, workspaceRoot, predefinedRoot) {
  const p = wvNormalize(ref)
  if (wvE_isAbsoluteishPath(p)) return pathExists(fs, p)
  const roots = []
  const ws = workspaceRoot ? String(workspaceRoot).replace(/\/+$/, '') : ''
  if (ws) roots.push(ws)
  const pre = predefinedRoot ? String(predefinedRoot).replace(/\/+$/, '') : ''
  if (pre && pre !== ws) roots.push(pre)
  for (const r of roots) {
    if (await pathExists(fs, r + '/' + p)) return true
  }
  return false
}

// 静态文件语境探测（拍板②双语境表）。返回 { status: 'ok'|'miss'|'skip', path }；
// 'skip' = 变量未知（迭代期/未知 param/定义语境 ${wf_dir}）或 preset raw 字面绝对
// （E-ABS-IN-DEF 已单报，调用方传 literalAbs）；'ok'/'miss' 附命中/回退路径。
async function probeStaticPath(fs, rawVal, opts) {
  const o = opts || {}
  if (!fs) return { status: 'skip', path: null }
  if (o.literalAbs) return { status: 'skip', path: null }
  const expanded = wvNormalize(expandRef(wvNormalize(rawVal), o.params, o.dirVars))
  if (expanded.indexOf('${') !== -1) return { status: 'skip', path: null }
  if (o.context === 'definition-preset') {
    // preset 定义语境：相对 = 仅模板子目录锚点（不走两级链，四点①）；
    // params 注入展开为绝对 = 用户指定合法入口 → 直通查存在（§5.1 变量路径列）。
    if (wvE_isAbsoluteishPath(expanded)) {
      return (await pathExists(fs, expanded)) ? { status: 'ok', path: expanded } : { status: 'miss', path: expanded }
    }
    if (!o.defDir) return { status: 'skip', path: null } // 防御：无锚点不误报
    const cand = String(o.defDir).replace(/\/+$/, '') + '/' + expanded
    return (await pathExists(fs, cand)) ? { status: 'ok', path: cand } : { status: 'miss', path: cand }
  }
  if (o.context === 'instance') {
    // 实例语境：绝对直通；相对 = 实例目录（1:1 副本）→ defDir → 两级链兜底
    if (wvE_isAbsoluteishPath(expanded)) {
      return (await pathExists(fs, expanded)) ? { status: 'ok', path: expanded } : { status: 'miss', path: expanded }
    }
    const resolved = await wvE_resolveStaticPath(fs, expanded, {
      priorityDirs: [o.wfDir, o.defDir],
      workspaceRoot: o.workspaceRoot,
      predefinedRoot: o.predefinedRoot,
    })
    return (await pathExists(fs, resolved)) ? { status: 'ok', path: resolved } : { status: 'miss', path: resolved }
  }
  // 非 preset 定义语境：两级链（workspace→预定义，现状）；绝对（字面或展开）直通
  if (wvE_isAbsoluteishPath(expanded)) {
    return (await pathExists(fs, expanded)) ? { status: 'ok', path: expanded } : { status: 'miss', path: expanded }
  }
  const resolved = await wvE_resolveStaticPath(fs, expanded, {
    priorityDirs: [],
    workspaceRoot: o.workspaceRoot,
    predefinedRoot: o.predefinedRoot,
  })
  return (await pathExists(fs, resolved)) ? { status: 'ok', path: resolved } : { status: 'miss', path: resolved }
}

// E-DEP-CYCLE：dependsOn 图 DFS 三色（白=未访问 灰=在栈 黑=完成）；自环=环；
// 未知引用跳过（归 parser 现状）。同环多入口按成员集合去重，报一条完整环路径。
function detectDepCycles(tasks) {
  const byId = new Map()
  for (const t of tasks) byId.set(t.id, t)
  const color = new Map()
  const cycles = []
  const seen = new Set()
  function visit(id, stack) {
    color.set(id, 1)
    stack.push(id)
    const t = byId.get(id)
    for (const dep of ((t && t.dependsOn) || [])) {
      if (!byId.has(dep)) continue
      const c = color.get(dep) || 0
      if (c === 1) {
        const i = stack.indexOf(dep)
        const cyc = stack.slice(i).concat([dep])
        const key = cyc.slice(0, -1).slice().sort().join('|')
        if (!seen.has(key)) { seen.add(key); cycles.push(cyc) }
      } else if (c === 0) {
        visit(dep, stack)
      }
    }
    stack.pop()
    color.set(id, 2)
  }
  for (const t of tasks) {
    if (!(color.get(t.id) || 0)) visit(t.id, [])
  }
  return cycles
}

// ── 主入口 ─────────────────────────────────────────────────────────────────
// opts = { parsed, params?, workspaceRoot?, predefinedRoot?, defDir?, wfDir?, context?, fs? }
// 返回 { ok, errors: [{code,task,field,message}], warnings: [同构] }
async function validateWorkflow(opts) {
  const o = opts || {}
  const parsed = o.parsed
  const out = { ok: true, errors: [], warnings: [] }
  if (!parsed || !Array.isArray(parsed.tasks)) {
    out.ok = false
    out.errors.push({ code: 'E-ITEMS-PARSE', task: null, field: 'workflow', message: 'parsed 缺失或无 tasks（应先过 parseWorkflow）' })
    return out
  }
  const pushE = (code, task, field, message) => out.errors.push({ code, task, field, message })
  const pushW = (code, task, field, message) => out.warnings.push({ code, task, field, message })
  const context = o.context || 'definition'
  const params = o.params || {}
  const fs = o.fs || null
  const dirVars = {
    workspace: o.workspaceRoot || undefined,
    skills: o.predefinedRoot ? String(o.predefinedRoot).replace(/\/+$/, '') + '/skills' : undefined,
  }
  if (o.wfDir) dirVars['wf_dir'] = String(o.wfDir).replace(/\/+$/, '')
  const tasks = parsed.tasks
  const probeOpts = {
    context, params, dirVars, fs,
    workspaceRoot: o.workspaceRoot, predefinedRoot: o.predefinedRoot, defDir: o.defDir, wfDir: o.wfDir,
  }

  // 1) E-DEP-CYCLE（dependsOn 环/自依赖）
  for (const cyc of detectDepCycles(tasks)) {
    pushE('E-DEP-CYCLE', cyc[0], 'depends-on', '任务依赖成环: ' + cyc.join(' → '))
  }

  // 2) 上游 outputs 集合（展开值比较，与 input 展开同基准对称；26R 精确+basename 同款）
  const allOutputs = []
  for (const t of tasks) {
    for (const ov of (t.outputsRaw || [])) allOutputs.push(wvNormalize(expandRef(String(ov), params, dirVars)))
  }

  // 3) 逐任务静态检查
  for (const t of tasks) {
    // E-PROCESSOR-MISSING（自 parser warning 升级；llm-task/loop/concurrent 均派发 subagent 必须指定）
    if (!t.processorRaw) {
      pushE('E-PROCESSOR-MISSING', t.id, 'processor', '未指定 processor（技能）——必须补全后才能创建/启动')
    } else if (fs) {
      // E-SKILL-MISSING（processor 两级链探针；展开后仍含 ${ 跳过）
      const ref = wvNormalize(expandRef(t.processorRaw, params, dirVars))
      if (ref.indexOf('${') === -1 && !(await skillRefExists(fs, ref, o.workspaceRoot, o.predefinedRoot))) {
        pushE('E-SKILL-MISSING', t.id, 'processor', '技能不存在（两级链 miss）: ' + ref)
      }
    }
    // E-GATE-CHECKER-MISSING（自 parser warning 升级；gateRaw 属性仅在 quality-gate 对象存在时由 parser 设置）
    if ('gateRaw' in t && t.gateRaw == null) {
      pushE('E-GATE-CHECKER-MISSING', t.id, 'quality-gate', 'quality-gate 未指定 checker——该门禁必须补全')
    }

    // inputs 逐值：字面绝对（preset）→ 上游衔接（精确/basename）→ 语境探测
    const rawInputs = t.inputsRaw || {}
    let dupWarned = false
    for (const key of Object.keys(rawInputs)) {
      const v = rawInputs[key]
      for (const raw0 of (Array.isArray(v) ? v : [v])) {
        const raw = wvNormalize(String(raw0))
        const expanded = wvNormalize(expandRef(raw, params, dirVars))
        const literalAbs = context === 'definition-preset' && wvE_isAbsoluteishPath(raw)
        if (literalAbs) {
          pushE('E-ABS-IN-DEF', t.id, 'inputs.' + key, 'preset 定义禁用字面绝对路径静态文件（须置于模板子目录内）: ' + raw)
        }
        // W-ITEMS-INPUT-DUP（拍板 2026-09-03：items-from 与 inputs 互斥；每任务至多一条）
        if (t.itemsFromRaw && !dupWarned) {
          const ir = wvNormalize(t.itemsFromRaw)
          if (raw === ir || (basenameOf(raw) !== '' && basenameOf(raw) === basenameOf(ir))) {
            pushW('W-ITEMS-INPUT-DUP', t.id, 'items-from', 'items-from 与 inputs 声明同一文件（互斥约定：条目经 _loopItem 随派发传入，inputs 勿再声明该文件）: ' + ir)
            dupWarned = true
          }
        }
        if (literalAbs) continue // 已单报，不重复探测
        if (expanded.indexOf('${') !== -1) continue // 迭代期/未知变量
        // 上游衔接：精确 → basename 兜底（W-REF-MISMATCH）
        if (allOutputs.indexOf(expanded) !== -1) continue
        const base = basenameOf(expanded)
        if (base && allOutputs.some((x) => basenameOf(x) === base)) {
          pushW('W-REF-MISMATCH', t.id, 'inputs.' + key, 'input 与上游 output 仅 basename 相同而完整路径不同（疑似拼写不一致）: ' + expanded)
          continue
        }
        const found = await probeStaticPath(fs, raw, probeOpts)
        if (found.status === 'miss') {
          pushE('E-INPUT-MISSING', t.id, 'inputs.' + key, '输入文件不存在且非上游产出: ' + expanded)
        }
      }
    }

    // items（loop/concurrent）：延迟组跳过存在性；命中则做格式探针
    if (t.itemsFromRaw) {
      const raw = wvNormalize(t.itemsFromRaw)
      const literalAbs = context === 'definition-preset' && wvE_isAbsoluteishPath(raw)
      if (literalAbs) {
        pushE('E-ABS-IN-DEF', t.id, 'items-from', 'preset 定义禁用字面绝对路径静态文件（须置于模板子目录内）: ' + raw)
      } else {
        const found = await probeStaticPath(fs, raw, probeOpts)
        if (found.status === 'miss') {
          // 延迟组跳过（deferDisposition 单一事实源）；显式 deferred:false 不跳（拍板同报）
          const deferred = wvE_deferDisposition ? wvE_deferDisposition(t, tasks) : false
          if (!deferred) {
            pushE('E-ITEMS-MISSING', t.id, 'items-from', 'items 文件不存在且非上游产出（无延迟豁免）: ' + wvNormalize(expandRef(raw, params, dirVars)))
          }
        } else if (found.status === 'ok') {
          // E-ITEMS-PARSE：文件存在但提取失败；空提取不报（26R Q1-b 占位迭代合法）
          try {
            const text = await fs.readText(await fs.resolve(found.path))
            try {
              wvE_extractItems(text, { format: t.itemsFormat || null, path: found.path, taskId: t.id })
            } catch (e2) {
              pushE('E-ITEMS-PARSE', t.id, 'items-from', 'items 文件存在但提取失败: ' + (e2 && e2.message ? e2.message : String(e2)))
            }
          } catch (e1) {
            // 探测/读取竞态：按 miss 走延迟组判定，不误报 E-ITEMS-PARSE
            const deferred = wvE_deferDisposition ? wvE_deferDisposition(t, tasks) : false
            if (!deferred) {
              pushE('E-ITEMS-MISSING', t.id, 'items-from', 'items 文件读取失败: ' + (e1 && e1.message ? e1.message : String(e1)))
            }
          }
        }
      }
    }
  }

  out.ok = out.errors.length === 0
  return out
}

// 校验结果 → 单行可读串（关口拒绝 message / persona 转告用）
function formatValidationItem(it) {
  return '[' + it.code + '] 任务 "' + (it.task || '-') + '" ' + it.field + ': ' + it.message
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { validateWorkflow, expandRef, detectDepCycles, skillRefExists, probeStaticPath, formatValidationItem }
}
