// ============================================================================
// workflow-agent — items 结构化提取器（Iter-26，R17/R18）
// 文件：code/shared/items-extract.js
// 说明：纯逻辑模块（无 DSH/Cordis 依赖），可被 Node 直接 require 测试，
//       宿主内联打包时按模块源码拼接（sync section: items-extract）。
// 职责：
//   1) 扩展名推断 inferItemsFormat（声明缺省时；.md→markdown / .json/.jsonl→json
//      / .yaml/.yml→yaml / 其余→lines）；
//   2) 四格式提取：lines（行文本，向后兼容）/ markdown（表格>列表）/
//      json（数组·并列对象·JSON Lines）/ yaml（数组·并列 map，复用 parseYaml 子集）；
//   3) ${item} 默认链（Q2 拍板）：ID/编号字段 → 名称字段 → 1-based 顺序编号；
//   4) item 规范化与标量判定。
// 约定（拍板 Q1/Q1-b/Q3）：
//   - markdown 表格 > 列表；代码围栏（```）内内容跳过；单元格保持字符串；
//     列数不齐宽容补齐（缺列补空串、多列忽略）；
//   - 顶层并列对象：键恒为 id 字段（值内同名 id 以键覆盖）；值为标量 →
//     {id: 键, name: String(值)}；值为数组 → 报错；
//   - 空提取返回 []（调用方产出占位迭代）；文件不存在/坏 JSON/顶层标量由
//     调用方抛错（错误信息携带 taskId）。
// 已知局限（文档声明）：YAML 走 parseYaml 子集（不支持内联 flow 嵌套对象、
//     多文档、锚点）；markdown 不解析嵌套结构；JSON 单 item 请用数组包裹。
// ============================================================================

// parseYaml 由同作用域 workflow-parser section 提供；Node 独立测试时兜底 require
let E_parseYaml = typeof parseYaml !== 'undefined'
  ? parseYaml
  : (typeof require !== 'undefined' ? require('./workflow-parser').parseYaml : null)

// ── ${item} 默认链字段名单（Q2 拍板：英文不区分大小写，中文精确）──────────
const ITEM_ID_FIELDS = ['id', 'no', 'num', 'number', '编号', '序号']
const ITEM_NAME_FIELDS = ['name', 'title', '名称', '标题']

// ── 扩展名推断（显式 items-format 恒优先，本函数仅在声明缺省时调用）────────
function inferItemsFormat(p) {
  const m = /\.([a-zA-Z0-9]+)$/.exec(String(p || '').replace(/\\/g, '/'))
  if (!m) return 'lines'
  const ext = m[1].toLowerCase()
  if (ext === 'md' || ext === 'markdown') return 'markdown'
  if (ext === 'json' || ext === 'jsonl') return 'json'
  if (ext === 'yaml' || ext === 'yml') return 'yaml'
  return 'lines'
}

// ── 标量判定：注入与默认链只消费标量（对象/数组/null 视为未提供）────────────
function isScalarValue(v) {
  return v !== null && v !== undefined && typeof v !== 'object'
}

// ── items 规范化：标量元素统一转字符串；对象/数组原样（字段消费在注入层）──
function normalizeItems(items) {
  return (items || []).map((it) => {
    if (it === null || it === undefined) return ''
    if (typeof it === 'object') return it
    return String(it)
  })
}

// ── ${item} 默认链（Q2）：对象 item 按 ID → 名称 → 顺序编号；标量原样 ──────
function lookupItemField(item, fields) {
  const keys = Object.keys(item)
  for (const f of fields) {
    const fl = f.toLowerCase()
    for (const k of keys) {
      if (k.toLowerCase() === fl && isScalarValue(item[k])) return item[k]
    }
  }
  return undefined
}

function itemDisplayValue(item, index) {
  if (item !== null && typeof item === 'object') {
    const id = lookupItemField(item, ITEM_ID_FIELDS)
    if (id !== undefined) return String(id)
    const name = lookupItemField(item, ITEM_NAME_FIELDS)
    if (name !== undefined) return String(name)
    return String((index || 0) + 1) // 1-based 顺序编号
  }
  return String(item)
}

// ── lines：行文本提取（Iter-25 前规则原样，向后兼容）────────────────────────
function extractLinesItems(text) {
  return String(text).split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
}

// ── markdown：表格（对象 item，列名=字段名）> 列表（标量 item）；围栏跳过 ──
function splitMarkdownRow(line) {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|')) s = s.slice(0, -1)
  return s.split('|').map((c) => c.trim())
}

function isMarkdownSeparatorRow(cells) {
  return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c))
}

// 找第一个 GFM 管道表格 → 对象 item 数组；无表格返回 null
function findMarkdownTable(lines) {
  for (let i = 0; i < lines.length - 1; i++) {
    const a = lines[i].trim()
    const b = lines[i + 1].trim()
    if (a.indexOf('|') === -1 || b.indexOf('|') === -1) continue
    if (a.startsWith('#')) continue
    const header = splitMarkdownRow(a)
    if (!isMarkdownSeparatorRow(splitMarkdownRow(b))) continue
    const rows = []
    for (let j = i + 2; j < lines.length; j++) {
      const line = lines[j].trim()
      if (line === '' || line.indexOf('|') === -1) break
      const cells = splitMarkdownRow(line)
      const row = {}
      // 宽容：以表头列数为准，缺列补空串、多列忽略；空表头列名 → colN
      header.forEach((h, k) => { row[h || ('col' + (k + 1))] = cells[k] !== undefined ? cells[k] : '' })
      rows.push(row)
    }
    return rows
  }
  return null
}

function extractMarkdownItems(text) {
  // 先剔除代码围栏（```/~~~）内内容，防误提取
  const kept = []
  let fence = false
  for (const raw of String(text).split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(raw)) { fence = !fence; continue }
    if (!fence) kept.push(raw)
  }
  const table = findMarkdownTable(kept)
  if (table) return table // Q1：表格 > 列表
  const list = []
  for (const raw of kept) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue // 空行/标题行跳过
    let m = /^[-*+]\s+(.*)$/.exec(line)
    if (!m) m = /^\d+[.)]\s+(.*)$/.exec(line)
    if (m) list.push(m[1].trim())
  }
  return list
}

// ── 顶层并列对象（Q3）：键恒为 id；对象值 → {id:键, ...值}；标量值 → {id, name} ──
function parallelMapToItems(obj) {
  const out = []
  for (const k of Object.keys(obj)) {
    const v = obj[k]
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      const item = Object.assign({}, v)
      item.id = k // 键覆盖值内同名 id（顶层键是天然唯一标识）
      out.push(item)
    } else if (Array.isArray(v)) {
      throw new Error('并列对象键 "' + k + '" 的值必须是对象或标量，实际为数组')
    } else {
      out.push({ id: k, name: v === null || v === undefined ? '' : String(v) })
    }
  }
  return out
}

// ── json：整体 JSON.parse（数组/并列对象）→ 失败回退 JSON Lines（逐行对象）──
function extractJsonItems(text) {
  const s = String(text).trim()
  if (s === '') return []
  let v
  try { v = JSON.parse(s) } catch (e) { v = undefined }
  if (v !== undefined) {
    if (Array.isArray(v)) return v
    if (v !== null && typeof v === 'object') return parallelMapToItems(v)
    throw new Error('JSON 顶层必须是数组或对象，实际为 ' + typeof v)
  }
  const out = []
  const lines = s.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim()
    if (t === '' || t.startsWith('#')) continue
    let lv
    try { lv = JSON.parse(t) } catch (e) { throw new Error('JSON Lines 第 ' + (i + 1) + ' 行解析失败: ' + e.message) }
    if (lv === null || typeof lv !== 'object' || Array.isArray(lv)) {
      throw new Error('JSON Lines 第 ' + (i + 1) + ' 行必须是对象')
    }
    out.push(lv)
  }
  return out
}

// ── yaml：parseYaml 子集；顶层数组 / 并列 map；解析不出结构时报错 ───────────
function extractYamlItems(text) {
  const s = String(text)
  if (s.trim() === '') return []
  if (!E_parseYaml) throw new Error('parseYaml 不可用（items-extract 独立加载且无 workflow-parser）')
  const v = E_parseYaml(s)
  if (Array.isArray(v)) return v
  if (v !== null && typeof v === 'object') {
    const hasContent = s.split(/\r?\n/).some((l) => { const t = l.trim(); return t !== '' && !t.startsWith('#') })
    if (Object.keys(v).length === 0 && hasContent) {
      // parseYaml 子集把无结构文本（顶层标量等）吃成 {} —— 显式报错而非空提取
      throw new Error('YAML 顶层必须是数组或并列对象（parseYaml 子集不支持标量/嵌套 flow 结构）')
    }
    return parallelMapToItems(v)
  }
  throw new Error('YAML 顶层必须是数组或并列对象')
}

// ── 主入口：格式分派 + 错误包装（携带 taskId 与格式）────────────────────────
// opts: { format?: 'lines'|'markdown'|'json'|'yaml', path?: string（推断用）, taskId?: string }
// 返回 items 数组（元素 string|object）；空数组=空提取（调用方产占位迭代）。
function extractItems(text, opts) {
  const o = opts || {}
  const format = o.format || inferItemsFormat(o.path)
  const taskId = o.taskId || '?'
  let items
  try {
    if (format === 'lines') items = extractLinesItems(text)
    else if (format === 'markdown') items = extractMarkdownItems(text)
    else if (format === 'json') items = extractJsonItems(text)
    else if (format === 'yaml') items = extractYamlItems(text)
    else throw new Error('不支持的 items-format: ' + format)
  } catch (e) {
    throw new Error('Task "' + taskId + '" 的 items 文件解析失败（' + format + '）: ' + e.message)
  }
  return items
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    extractItems,
    inferItemsFormat,
    parallelMapToItems,
    normalizeItems,
    itemDisplayValue,
    isScalarValue,
    ITEM_ID_FIELDS,
    ITEM_NAME_FIELDS,
  }
}
