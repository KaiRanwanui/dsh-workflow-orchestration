// ============================================================================
// workflow-agent — 轻量 YAML 解析器 + 工作流文档结构化
// 文件：code/shared/workflow-parser.js
// 说明：无依赖纯逻辑片段（不包含 module.exports，供 Node 测试与宿主内联）。
//       实现的 YAML 子集：顶层 map、嵌套 map、block 列表（- item）、
//       内联列表（[a, b]）、标量（字符串/数字/布尔/null），引号剥离。
// ============================================================================

// ── 词法：行扫描 ────────────────────────────────────────────────────────────
function countIndent(line) {
  let n = 0
  while (n < line.length && (line[n] === ' ' || line[n] === '\t')) n++
  return n
}

function stripComment(line) {
  // 去除行尾注释（# 前有空白才视为注释，避免 url/说明内 #）
  const m = /(\s)#/.exec(line)
  return m ? line.slice(0, m.index) : line
}

function parseScalar(raw) {
  const s = String(raw).trim()
  if (s === '') return null
  if (s === 'null' || s === '~') return null
  if (s === 'true') return true
  if (s === 'false') return false
  // 数字
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s)
  // 引号剥离
  if ((s[0] === '"' && s[s.length - 1] === '"') || (s[0] === "'" && s[s.length - 1] === "'")) {
    return s.slice(1, -1)
  }
  return s
}

// 内联列表 [a, b, c]
function parseInlineList(s) {
  const m = /\s*\[(.*)\]\s*$/.exec(s)
  if (!m) return null
  const inner = m[1]
  if (inner.trim() === '') return []
  return inner.split(',').map((part) => parseScalar(part))
}

// ── 语法：块解析 ────────────────────────────────────────────────────────────
// 解析从 start 开始、缩进 >= baseIndent 的行序列，返回 { value, next }
// value 可为普通对象（map）、数组（list）、或标量。
function parseBlock(lines, start, baseIndent) {
  const total = lines.length
  if (start >= total || countIndent(lines[start]) < baseIndent) {
    return { value: null, next: start }
  }
  const indent = countIndent(lines[start])

  // 列表块：- item （支持 - key: value 多行对象元素）
  if (/^\s*-\s+/.test(lines[start]) || /^\s*-$/.test(lines[start])) {
    const arr = []
    let i = start
    while (i < total) {
      const ln = lines[i]
      const ind = countIndent(ln)
      if (ind < indent || !/^\s*-/.test(ln)) break
      const rest = stripComment(ln.slice(ln.indexOf('-') + 1).trim())
      if (rest === '') {
        // 空 item：后续缩进行是嵌套块（map 或 list）
        const sub = parseBlock(lines, i + 1, indent + 1)
        arr.push(sub.value)
        i = sub.next
      } else if (rest.indexOf(':') !== -1) {
        // "- key: value"：多行对象元素的起始行
        const obj = {}
        const colon = rest.indexOf(':')
        const key = rest.slice(0, colon).trim()
        const val = stripComment(rest.slice(colon + 1).trim()).trim()
        if (val === '') {
          const sub = parseBlock(lines, i + 1, indent + 1)
          obj[key] = sub.value
          i = sub.next
        } else {
          const inline = parseInlineList(val)
          obj[key] = inline ? inline : parseScalar(val)
          i++
        }
        // 续行：缩进 > 列表缩进 的 map 键归属于当前元素
        const cont = parseBlock(lines, i, indent + 1)
        if (cont.value && typeof cont.value === 'object' && !Array.isArray(cont.value)) {
          Object.assign(obj, cont.value)
          i = cont.next
        }
        arr.push(obj)
      } else if (rest.indexOf('[') !== -1 && rest.indexOf(']') !== -1) {
        arr.push(parseInlineList(rest))
        i++
      } else {
        arr.push(parseScalar(rest))
        i++
      }
    }
    return { value: arr, next: i }
  }

  // map 块：key: value
  const obj = {}
  let i = start
  while (i < total) {
    const ln = lines[i]
    const ind = countIndent(ln)
    if (ind < indent || !/^\S/.test(ln.trim())) break
    const colon = ln.indexOf(':')
    if (colon === -1) {
      i++
      continue
    }
    const key = ln.slice(0, colon).trim()
    const rest = ln.slice(colon + 1).trim()
    const restClean = stripComment(rest).trim()
    if (restClean === '') {
      // value 在后续缩进行中
      const sub = parseBlock(lines, i + 1, indent + 1)
      obj[key] = sub.value
      i = sub.next
    } else {
      const inline = parseInlineList(restClean)
      if (inline) {
        obj[key] = inline
      } else {
        obj[key] = parseScalar(restClean)
      }
      i++
    }
  }
  return { value: obj, next: i }
}

function parseYaml(text) {
  const lines = String(text).split(/\r?\n/)
  const content = lines.filter((l) => l.trim() !== '' && !/^\s*#/.test(l))
  if (content.length === 0) return {}
  const r = parseBlock(content, 0, 0)
  return r.value || {}
}

// ── 工作流结构化与校验 ──────────────────────────────────────────────────────
// 输入：YAML 文本字符串；输出：结构化工作流对象（合法时）
// 结构：{ name, version, description, params, tasks:[...], errors:[...] }
function parseWorkflow(text) {
  const raw = parseYaml(text)
  const errors = []
  const warnings = []

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { name: null, version: null, description: null, params: {}, tasks: [], errors: ['工作流文件必须是一个 YAML 对象'], maxConcurrency: 1 }
  }

  const name = raw.name != null ? String(raw.name) : null
  if (!name) errors.push('缺少必填字段: name')

  const version = raw.version != null ? String(raw.version) : null

  // Iter-7：工作流级最大并发数（默认 1 = 串行）
  const maxConcurrency = raw['max-concurrency'] != null ? Number(raw['max-concurrency']) : 1
  if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1) {
    errors.push('max-concurrency 必须是 >= 1 的整数，实际: ' + raw['max-concurrency'])
  }

  const params = {}
  if (raw.params && typeof raw.params === 'object' && !Array.isArray(raw.params)) {
    for (const k of Object.keys(raw.params)) {
      const p = raw.params[k]
      params[k] = {
        type: (p && p.type) || 'string',
        description: (p && p.description) || '',
        default: p && p.default !== undefined ? p.default : undefined,
      }
    }
  }

  const tasks = []
  if (!Array.isArray(raw.tasks) || raw.tasks.length === 0) {
    errors.push('缺少必填字段: tasks（至少 1 个 Task）')
  } else {
    const seenIds = new Set()
    raw.tasks.forEach((t, idx) => {
      if (!t || typeof t !== 'object') {
        errors.push('tasks[' + idx + '] 不是有效对象')
        return
      }
      const task = normalizeTask(t, idx, errors, warnings)
      if (task) {
        if (seenIds.has(task.id)) {
          errors.push('Task id 重复: ' + task.id)
        }
        seenIds.add(task.id)
        tasks.push(task)
      }
    })
    // depends-on 引用校验
    for (const t of tasks) {
      for (const dep of t.dependsOn) {
        if (!seenIds.has(dep)) {
          errors.push('Task "' + t.id + '" 的 depends-on 引用了不存在的 Task: ' + dep)
        }
      }
    }
  }

  return { name, version, description: raw.description || null, params, tasks, errors, warnings, maxConcurrency }
}

function normalizeTask(t, idx, errors) {
  const id = t.id != null ? String(t.id).trim() : ''
  if (!id) {
    errors.push('tasks[' + idx + '] 缺少必填字段: id')
    return null
  }
  const type = t.type || 'llm-task'

  // v1.1：inputs 为命名 map {key: 单路径 | 路径列表}，值保留原始形态传给宿主
  const inputsRaw = normalizeInputs(t.inputs)
  if (inputsRaw === null) {
    errors.push('Task "' + id + '" 的 inputs 必须是命名 map {key: 路径 | 路径列表}（v1.1 起不再支持列表形态）')
  }

  const base = {
    id,
    name: t.name != null ? String(t.name) : id,
    type,
    dependsOn: toArray(t['depends-on']),
    timeout: t.timeout != null ? Number(t.timeout) : 600,
    // 原始相对路径（保留给宿主解析绝对路径）
    processorRaw: t.processor != null ? String(t.processor) : null,
    inputsRaw: inputsRaw || {},
    outputsRaw: toArray(t.outputs),
  }

  // 质量门禁
  if (t['quality-gate'] != null) {
    const g = t['quality-gate']
    if (typeof g !== 'object' || Array.isArray(g)) {
      errors.push('Task "' + id + '" 的 quality-gate 必须是对象')
    } else {
      const onFailure = g['on-failure'] || 'block'
      if (['retry', 'block', 'skip'].indexOf(onFailure) === -1) {
        errors.push('Task "' + id + '" 的 quality-gate.on-failure 必须是 retry|block|skip，实际: ' + onFailure)
      }
      base.gateRaw = g.checker != null ? String(g.checker) : null
      base.gateOnFailure = onFailure
      base.gateMaxRetries = g['max-retries'] != null ? Number(g['max-retries']) : 0
    }
  }

  // 类型专属校验
  if (type === 'llm-task' || !type) {
    if (!base.processorRaw) errors.push('Task "' + id + '" 缺少必填字段: processor')
  } else if (type === 'loop') {
    if (!base.processorRaw) errors.push('Task "' + id + '" 缺少必填字段: processor')
    if (t['items-from'] == null) errors.push('Task "' + id + '" 缺少必填字段: items-from')
    if (t['item-var'] == null) errors.push('Task "' + id + '" 缺少必填字段: item-var')
    base.itemsFromRaw = t['items-from'] != null ? String(t['items-from']) : null
    base.itemVar = t['item-var'] != null ? String(t['item-var']) : 'item'
    // 循环错误处理策略
    const onError = t['on-error'] || 'break'
    if (['break', 'continue'].indexOf(onError) === -1) {
      errors.push('Task "' + id + '" 的 on-error 必须是 break|continue，实际: ' + onError)
    }
    base.onError = onError
  } else if (type === 'human-decision') {
    base.prompt = t.prompt != null ? String(t.prompt) : null
    if (!base.prompt) errors.push('Task "' + id + '" 缺少必填字段: prompt')
  } else if (type === 'external-agent') {
    base.agent = t.agent != null ? String(t.agent) : null
    if (!base.agent) errors.push('Task "' + id + '" 缺少必填字段: agent')
  } else {
    errors.push('Task "' + id + '" 的 type 不支持: ' + type)
  }

  return base
}

function toArray(v) {
  if (v == null) return []
  if (Array.isArray(v)) return v.map((x) => String(x))
  return [String(v)]
}

// v1.1：命名式 inputs。YAML 解出后为 {key: string | string[]}；
// 保留 map 形态与值的原生类型，仅确保 string[] 元素为字符串。
// 若输入是数组/标量（旧列表形态），视为无效并返回 null（字段用默认 {}）。
function normalizeInputs(v) {
  if (v == null) return {}
  if (typeof v !== 'object' || Array.isArray(v)) return null
  const out = {}
  for (const k of Object.keys(v)) {
    const val = v[k]
    if (Array.isArray(val)) {
      out[k] = val.map((x) => String(x))
    } else if (val != null) {
      out[k] = String(val)
    }
  }
  return out
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseWorkflow, parseYaml }
}