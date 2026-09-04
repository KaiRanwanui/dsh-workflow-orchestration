// ============================================================================
// workflow-agent — 实例编辑前台共享逻辑（Iter-28）
// 文件：code/shared/workflow-edit.js
// 说明：无依赖纯逻辑片段（不含 module.exports 供宿主内联；Node 测试走 require）。
//       组成：YAML 序列化器（parseYaml raw → 文本往返）、实例编辑权限矩阵、
//       patch 白名单合并（applyInstancePatch）、模板 params 简化、技能 frontmatter 解析。
//       安全边界：name/params 永不可经 patch 修改；字段级白名单由 stage 权限位强制。
// ============================================================================

// ── 标量 → YAML 文本 ───────────────────────────────────────────────────────
// 引号规则：空串/含 : 或 #/首尾空白/特殊起头字符/疑似数字·布尔·null 形态的字符串
// 一律加双引号（防 parseScalar 二次解析变型）；其余原样输出。
function weScalarToYaml(v) {
  if (v === null || v === undefined) return ''
  if (typeof v === 'boolean' || typeof v === 'number') return String(v)
  const s = String(v)
  const needsQuote = s === ''
    || /[:#]/.test(s)
    || /^\s|\s$/.test(s)
    || /^(-|\?|&|\*|!|\||>|%|@|`|"|'|[\[{])/.test(s)
    || /^-?\d+(\.\d+)?$/.test(s)
    || s === 'true' || s === 'false' || s === 'null' || s === '~'
  if (needsQuote) return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'
  return s
}

// 内联列表（解析器两形态皆支持；短列表统一内联，风格与内建模板一致）
function weInlineList(arr) {
  return '[' + arr.map(weScalarToYaml).join(', ') + ']'
}

// ── raw（parseYaml 产物）→ YAML 文本 ───────────────────────────────────────
// 已知顶层键按稳定顺序先出（name/version/description/params/max-concurrency/tasks），
// 其余未知键透传（编辑往返不丢字段）。值形态：标量/map/列表（标量或对象元素）。
function weSerializeMap(obj, indent) {
  const pad = ' '.repeat(indent)
  const lines = []
  for (const k of Object.keys(obj)) {
    const v = obj[k]
    if (v === null || v === undefined) {
      lines.push(pad + k + ': ')
    } else if (Array.isArray(v)) {
      if (v.length === 0) { lines.push(pad + k + ': []'); continue }
      if (v.every((x) => x === null || typeof x !== 'object')) {
        lines.push(pad + k + ': ' + weInlineList(v))
      } else {
        lines.push(pad + k + ':')
        lines.push.apply(lines, weSerializeList(v, indent + 2))
      }
    } else if (typeof v === 'object') {
      const keys = Object.keys(v)
      if (keys.length === 0) { lines.push(pad + k + ': {}'); continue }
      lines.push(pad + k + ':')
      lines.push.apply(lines, weSerializeMap(v, indent + 2))
    } else {
      lines.push(pad + k + ': ' + weScalarToYaml(v))
    }
  }
  return lines
}

function weSerializeList(arr, indent) {
  const pad = ' '.repeat(indent)
  const lines = []
  for (const item of arr) {
    if (item === null || typeof item !== 'object') {
      lines.push(pad + '- ' + weScalarToYaml(item))
    } else if (Array.isArray(item)) {
      lines.push(pad + '- ' + weInlineList(item))
    } else {
      const keys = Object.keys(item)
      if (keys.length === 0) { lines.push(pad + '- {}'); continue }
      keys.forEach((k, i) => {
        const v = item[k]
        const prefix = (i === 0 ? pad + '- ' : pad + '  ')
        if (v === null || v === undefined) {
          lines.push(prefix + k + ': ')
        } else if (Array.isArray(v)) {
          if (v.length === 0) { lines.push(prefix + k + ': []') }
          else if (v.every((x) => x === null || typeof x !== 'object')) { lines.push(prefix + k + ': ' + weInlineList(v)) }
          else {
            lines.push(prefix + k + ':')
            lines.push.apply(lines, weSerializeList(v, indent + 4))
          }
        } else if (typeof v === 'object') {
          const vkeys = Object.keys(v)
          if (vkeys.length === 0) { lines.push(prefix + k + ': {}') }
          else {
            lines.push(prefix + k + ':')
            lines.push.apply(lines, weSerializeMap(v, indent + 4))
          }
        } else {
          lines.push(prefix + k + ': ' + weScalarToYaml(v))
        }
      })
    }
  }
  return lines
}

function serializeWorkflowYaml(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ''
  const KNOWN = ['name', 'version', 'description', 'params', 'max-concurrency', 'tasks']
  const ordered = {}
  for (const k of KNOWN) { if (raw[k] !== undefined) ordered[k] = raw[k] }
  for (const k of Object.keys(raw)) { if (KNOWN.indexOf(k) === -1) ordered[k] = raw[k] }
  return weSerializeMap(ordered, 0).join('\n') + '\n'
}

// ── 实例编辑权限矩阵（用户拍板 2026-09-05）────────────────────────────────
// definition = processor/gateChecker/inputs/outputs（仅 CREATED 可改——"一旦运行即不可改"）
// runtime    = retries（gate.max-retries）/任务级 concurrency/实例级 max-concurrency
//              （RUNNING 全禁；PENDING 已 start 视同已运行，仅 runtime 可调）
function instanceEditPermissions(stage) {
  const s = String(stage || 'CREATED')
  return {
    stage: s,
    definition: s === 'CREATED',
    runtime: s !== 'RUNNING',
    readonlyAll: s === 'RUNNING',
  }
}

// ── patch 白名单合并 ───────────────────────────────────────────────────────
// patch = { maxConcurrency?, tasks: { [taskId]: { processor?, gateChecker?, inputs?,
//          outputs?, retries?, concurrency? } } }
// 返回 { ok, errors:[{code, task, field, message}] }；禁改/非法值整字段拒绝并记错误。
// gateChecker='' → 删除 gate.checker（保留 gate 壳）；concurrency=null → 删任务级 max-concurrency。
// 任务本无 quality-gate 而设置 checker/retries → 创建 { checker, on-failure: 'block' } 壳。
function weEnsureGate(t) {
  if (!t['quality-gate'] || typeof t['quality-gate'] !== 'object' || Array.isArray(t['quality-gate'])) {
    t['quality-gate'] = { 'on-failure': 'block' }
  }
  return t['quality-gate']
}

function applyInstancePatch(raw, patch, perms) {
  const errors = []
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: [{ code: 'E-EDIT-RAW', task: null, field: 'definition', message: '实例定义不是有效 YAML 对象' }] }
  }
  const deny = (task, field, why) => errors.push({ code: 'E-EDIT-DENIED', task, field, message: why })

  if (patch && patch.maxConcurrency !== undefined) {
    if (!perms.runtime) deny(null, 'max-concurrency', '当前状态（' + perms.stage + '）不可修改 max-concurrency')
    else {
      const n = Number(patch.maxConcurrency)
      if (!Number.isInteger(n) || n < 1) errors.push({ code: 'E-EDIT-VALUE', task: null, field: 'max-concurrency', message: 'max-concurrency 须为 >=1 整数，实际: ' + JSON.stringify(patch.maxConcurrency) })
      else raw['max-concurrency'] = n
    }
  }

  const tasks = Array.isArray(raw.tasks) ? raw.tasks : []
  const byId = new Map()
  tasks.forEach((t) => { if (t && t.id != null && !byId.has(String(t.id))) byId.set(String(t.id), t) })

  const tp = (patch && patch.tasks && typeof patch.tasks === 'object') ? patch.tasks : {}
  for (const tid of Object.keys(tp)) {
    const t = byId.get(tid)
    if (!t || typeof t !== 'object') {
      errors.push({ code: 'E-EDIT-NOTASK', task: tid, field: null, message: '实例定义中不存在任务: ' + tid })
      continue
    }
    const ch = tp[tid] || {}
    if (ch.processor !== undefined) {
      if (!perms.definition) deny(tid, 'processor', '仅 CREATED 状态可修改 processor（当前 ' + perms.stage + '）')
      else {
        const v = String(ch.processor).trim()
        if (!v) errors.push({ code: 'E-EDIT-VALUE', task: tid, field: 'processor', message: 'processor 不能为空（如需清空请走重新 create）' })
        else t.processor = v
      }
    }
    if (ch.gateChecker !== undefined) {
      if (!perms.definition) deny(tid, 'quality-gate.checker', '仅 CREATED 状态可修改 gateChecker（当前 ' + perms.stage + '）')
      else {
        const v = String(ch.gateChecker == null ? '' : ch.gateChecker).trim()
        if (v === '') {
          // 清空 → 删 checker 行；gate 壳连同 on-failure 保留
          const g = t['quality-gate']
          if (g && typeof g === 'object' && !Array.isArray(g)) delete g.checker
        } else {
          weEnsureGate(t).checker = v
        }
      }
    }
    if (ch.inputs !== undefined) {
      if (!perms.definition) deny(tid, 'inputs', '仅 CREATED 状态可修改 inputs（当前 ' + perms.stage + '）')
      else {
        const inv = ch.inputs
        if (inv === null || typeof inv !== 'object' || Array.isArray(inv)) {
          errors.push({ code: 'E-EDIT-VALUE', task: tid, field: 'inputs', message: 'inputs 须为命名 map {key: 路径|路径列表}' })
        } else {
          const clean = {}
          let bad = false
          for (const k of Object.keys(inv)) {
            const val = inv[k]
            if (Array.isArray(val)) { clean[k] = val.map((x) => String(x)) }
            else if (val !== null && val !== undefined && val !== '') { clean[k] = String(val) }
            else if (val === '') { bad = true; errors.push({ code: 'E-EDIT-VALUE', task: tid, field: 'inputs.' + k, message: 'inputs 值不能为空字符串' }) }
          }
          if (!bad) {
            if (Object.keys(clean).length === 0) delete t.inputs
            else t.inputs = clean
          }
        }
      }
    }
    if (ch.outputs !== undefined) {
      if (!perms.definition) deny(tid, 'outputs', '仅 CREATED 状态可修改 outputs（当前 ' + perms.stage + '）')
      else {
        const ov = ch.outputs
        if (!Array.isArray(ov) || ov.some((x) => x === null || x === undefined || String(x).trim() === '')) {
          errors.push({ code: 'E-EDIT-VALUE', task: tid, field: 'outputs', message: 'outputs 须为非空路径字符串数组' })
        } else {
          const clean = ov.map((x) => String(x).trim())
          if (clean.length === 0) delete t.outputs
          else t.outputs = clean
        }
      }
    }
    if (ch.retries !== undefined) {
      if (!perms.runtime) deny(tid, 'quality-gate.max-retries', '当前状态（' + perms.stage + '）不可修改 retries')
      else {
        const n = Number(ch.retries)
        if (!Number.isInteger(n) || n < 0) errors.push({ code: 'E-EDIT-VALUE', task: tid, field: 'quality-gate.max-retries', message: 'retries 须为 >=0 整数，实际: ' + JSON.stringify(ch.retries) })
        else {
          if (n === 0 && !t['quality-gate']) { /* 无 gate 壳且 0 → 不创建壳 */ }
          else weEnsureGate(t)['max-retries'] = n
        }
      }
    }
    if (ch.concurrency !== undefined) {
      if (!perms.runtime) deny(tid, 'max-concurrency', '当前状态（' + perms.stage + '）不可修改任务并发')
      else if (ch.concurrency === null || ch.concurrency === '') {
        delete t['max-concurrency']
      } else {
        const n = Number(ch.concurrency)
        if (!Number.isInteger(n) || n < 1) errors.push({ code: 'E-EDIT-VALUE', task: tid, field: 'max-concurrency', message: '任务并发须为 >=1 整数或留空，实际: ' + JSON.stringify(ch.concurrency) })
        else t['max-concurrency'] = n
      }
    }
  }
  return { ok: errors.length === 0, errors }
}

// ── 模板 params 简化（创建弹窗 key-value 预填）────────────────────────────
// parsed.params = { key: { type, description, default } } → { key: default 原值 }（无 default → ''）
function simplifyParams(parsedParams) {
  const out = {}
  if (!parsedParams || typeof parsedParams !== 'object') return out
  for (const k of Object.keys(parsedParams)) {
    const p = parsedParams[k]
    out[k] = (p && typeof p === 'object' && p.default !== undefined) ? p.default : ''
  }
  return out
}

// ── 技能 frontmatter 解析（技能下拉 名称+版本）────────────────────────────
// 取文件头首个 --- ... --- 块的 name/version 字段；缺省 name=目录名、version=null。
function parseSkillFrontmatter(text, dirName) {
  const out = { name: dirName || null, version: null }
  const s = String(text || '')
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(s)
  if (!m) return out
  for (const line of m[1].split(/\r?\n/)) {
    const mm = /^(name|version)\s*:\s*(.*)$/.exec(line)
    if (mm) {
      const val = mm[2].trim().replace(/^["']|["']$/g, '')
      if (mm[1] === 'name') { if (val) out.name = val }
      else { if (val) out.version = val }
    }
  }
  return out
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { serializeWorkflowYaml, instanceEditPermissions, applyInstancePatch, simplifyParams, parseSkillFrontmatter }
}
