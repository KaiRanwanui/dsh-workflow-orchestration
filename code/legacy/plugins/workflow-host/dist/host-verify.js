const TASK_TYPES = {
LLM_TASK: 'llm-task',
LOOP: 'loop',
HUMAN_DECISION: 'human-decision', // 预留（后续迭代）
EXTERNAL_AGENT: 'external-agent', // 预留（后续迭代）
}
const DEFAULTS = {
timeout: 600, // 秒
dependsOn: [],
taskType: TASK_TYPES.LLM_TASK,
retries: 0, // quality-gate max-retries 默认
onFailure: 'block', // quality-gate on-failure 默认
}
const REQUIRED = {
llmTask: ['id', 'processor'],
loop: ['id', 'processor', 'items-from', 'item-var'],
humanDecision: ['id', 'prompt'],
externalAgent: ['id', 'agent'],
}
const ON_ERROR_VALUES = ['break', 'continue']
const ON_FAILURE_VALUES = ['retry', 'block', 'skip']
const PARAM_PATTERN = /\$\{(\w+)\}/g
const TASK_STATUS = {
PENDING: 'PENDING', // 未开始
RUNNING: 'RUNNING', // 执行中
DONE: 'DONE', // 完成（含 Gate PASS）
FAILED: 'FAILED', // 失败（Gate FAIL 且重试耗尽 / block）
SKIPPED: 'SKIPPED', // 跳过
}
const STAGE = {
PENDING: 'PENDING', // 待启动
RUNNING: 'RUNNING', // 运行中
COMPLETED: 'COMPLETED', // 全部完成
FAILED: 'FAILED', // 阻断失败
PAUSED: 'PAUSED', // 暂停（后续迭代）
}
function countIndent(line) {
let n = 0
while (n < line.length && (line[n] === ' ' || line[n] === '\t')) n++
return n
}
function stripComment(line) {
const m = /(\s)#/.exec(line)
return m ? line.slice(0, m.index) : line
}
function parseScalar(raw) {
const s = String(raw).trim()
if (s === '') return null
if (s === 'null' || s === '~') return null
if (s === 'true') return true
if (s === 'false') return false
if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s)
if ((s[0] === '"' && s[s.length - 1] === '"') || (s[0] === "'" && s[s.length - 1] === "'")) {
return s.slice(1, -1)
}
return s
}
function parseInlineList(s) {
const m = /\s*\[(.*)\]\s*$/.exec(s)
if (!m) return null
const inner = m[1]
if (inner.trim() === '') return []
return inner.split(',').map((part) => parseScalar(part))
}
function parseBlock(lines, start, baseIndent) {
const total = lines.length
if (start >= total || countIndent(lines[start]) < baseIndent) {
return { value: null, next: start }
}
const indent = countIndent(lines[start])
if (/^\s*-\s+/.test(lines[start]) || /^\s*-$/.test(lines[start])) {
const arr = []
let i = start
while (i < total) {
const ln = lines[i]
const ind = countIndent(ln)
if (ind < indent || !/^\s*-/.test(ln)) break
const rest = stripComment(ln.slice(ln.indexOf('-') + 1).trim())
if (rest === '') {
const sub = parseBlock(lines, i + 1, indent + 1)
arr.push(sub.value)
i = sub.next
} else if (rest.indexOf(':') !== -1) {
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
function parseWorkflow(text) {
const raw = parseYaml(text)
const errors = []
const warnings = []
if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
return { name: null, version: null, description: null, params: {}, tasks: [], errors: ['工作流文件必须是一个 YAML 对象'] }
}
const name = raw.name != null ? String(raw.name) : null
if (!name) errors.push('缺少必填字段: name')
const version = raw.version != null ? String(raw.version) : null
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
for (const t of tasks) {
for (const dep of t.dependsOn) {
if (!seenIds.has(dep)) {
errors.push('Task "' + t.id + '" 的 depends-on 引用了不存在的 Task: ' + dep)
}
}
}
}
return { name, version, description: raw.description || null, params, tasks, errors, warnings }
}
function normalizeTask(t, idx, errors) {
const id = t.id != null ? String(t.id).trim() : ''
if (!id) {
errors.push('tasks[' + idx + '] 缺少必填字段: id')
return null
}
const type = t.type || 'llm-task'
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
processorRaw: t.processor != null ? String(t.processor) : null,
inputsRaw: inputsRaw || {},
outputsRaw: toArray(t.outputs),
}
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
if (type === 'llm-task' || !type) {
if (!base.processorRaw) errors.push('Task "' + id + '" 缺少必填字段: processor')
} else if (type === 'loop') {
if (!base.processorRaw) errors.push('Task "' + id + '" 缺少必填字段: processor')
if (t['items-from'] == null) errors.push('Task "' + id + '" 缺少必填字段: items-from')
if (t['item-var'] == null) errors.push('Task "' + id + '" 缺少必填字段: item-var')
base.itemsFromRaw = t['items-from'] != null ? String(t['items-from']) : null
base.itemVar = t['item-var'] != null ? String(t['item-var']) : 'item'
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
let E_STAGE = typeof STAGE !== 'undefined' ? STAGE : {
PENDING: 'PENDING', RUNNING: 'RUNNING', COMPLETED: 'COMPLETED', FAILED: 'FAILED', PAUSED: 'PAUSED',
}
let E_TASK_STATUS = typeof TASK_STATUS !== 'undefined' ? TASK_STATUS : {
PENDING: 'PENDING', RUNNING: 'RUNNING', DONE: 'DONE', FAILED: 'FAILED', SKIPPED: 'SKIPPED',
}
function taskSnapshot(t) {
return {
id: t.id,
name: t.name,
type: t.type,
status: t.status,
processor: t.processor || null,       // 处理器技能绝对路径（Client 读取 skill 文本用）
gateChecker: (t.gate && t.gate.checker) || null, // 门禁技能绝对路径
gateResult: t.gateResult || null,
gateOnFailure: t.gateOnFailure || null,
retries: t.retries || 0,
_loopGroup: t._loopGroup || null,
_loopItem: t._loopItem || null,
_loopIndex: t._loopIndex,
_loopGroupName: t._loopGroupName || null,
_onError: t._onError || null,
}
}
function createWorkflowEngine() {
const state = {
workflow: null, // 工作流名称
version: null,
description: null,
params: {},
active: false, // 是否有进行中的实例
stage: E_STAGE.PENDING,
tasks: [], // Task 运行时状态数组
gateResult: null, // 最近 Gate 结果（PASS/FAIL）
retries: 0, // 最近任务的重试计数
error: null,
updatedAt: 0,
logs: [], // 结构化执行日志 [{ts, action, detail}]
persist: null, // 最近一次持久化结果
}
function fingerprint() {
const t = state.tasks.map((x) => x.id + ':' + x.status).join(',')
return [state.stage, state.gateResult || '', state.retries, state.error || '', t].join('|')
}
function snapshot() {
return {
workflow: state.workflow,
version: state.version,
description: state.description,
active: state.active,
stage: state.stage,
tasks: state.tasks.map(taskSnapshot),
gateResult: state.gateResult,
retries: state.retries,
error: state.error,
updatedAt: state.updatedAt,
logs: state.logs.slice(-200), // 最多保留最近 200 条
persist: state.persist,
fingerprint: fingerprint(),
}
}
function begin(parsed) {
state.workflow = parsed.name
state.version = parsed.version
state.description = parsed.description
state.params = parsed.params || {}
state.active = true
state.stage = E_STAGE.PENDING
state.gateResult = null
state.retries = 0
state.error = null
state.tasks = parsed.tasks.map((t) => ({
id: t.id,
name: t.name,
type: t.type,
status: E_TASK_STATUS.PENDING,
processor: t.processor || null, // 绝对路径（由 tools 层解析后写入）
outputs: t.outputs || [],
gate: t.gate || null, // {checker, onFailure, maxRetries}
gateResult: null,
retries: 0,
_loopGroup: t._loopGroup || null,
_loopItem: t._loopItem || null,
_loopIndex: t._loopIndex,
_loopGroupName: t._loopGroupName || null,
_onError: t._onError || null,
}))
state.updatedAt = Date.now()
log('BEGIN', '工作流 "' + state.workflow + '" 已初始化，tasks=' + state.tasks.length)
}
function updateTask(taskId, patch) {
const t = state.tasks.find((x) => x.id === taskId)
if (!t) return false
if (patch.status !== undefined) t.status = patch.status
if (patch.gateResult !== undefined) t.gateResult = patch.gateResult
if (patch.retries !== undefined) t.retries = patch.retries
if (patch.error !== undefined) t.error = patch.error
state.updatedAt = Date.now()
log('TASK', taskId + ' -> ' + t.status)
return true
}
function setStage(s) {
state.stage = s
state.updatedAt = Date.now()
if (s === E_STAGE.COMPLETED || s === E_STAGE.FAILED) state.active = false
log('STAGE', s)
}
function setGateResult(r) {
state.gateResult = r
state.updatedAt = Date.now()
log('GATE', 'result=' + r)
}
function setRetries(n) {
state.retries = n
state.updatedAt = Date.now()
}
function setError(msg) {
state.error = msg || null
state.updatedAt = Date.now()
if (msg) log('ERROR', msg)
}
function setPersist(r) {
state.persist = r
}
function processBreak(taskId) {
const failed = state.tasks.find((x) => x.id === taskId)
if (!failed || !failed._loopGroup || failed._onError !== 'break') return false
let skipped = 0
state.tasks.forEach((t) => {
if (t._loopGroup === failed._loopGroup && t.status === E_TASK_STATUS.PENDING && t.id !== taskId) {
t.status = E_TASK_STATUS.SKIPPED
t.error = '循环中断：前序迭代 "' + failed.id + '" 失败'
skipped++
}
})
if (skipped > 0) log('BREAK', '循环 "' + failed._loopGroup + '" 中断，跳过 ' + skipped + ' 个任务')
return skipped > 0
}
function log(action, detail) {
state.logs.push({ ts: Date.now(), action, detail })
if (state.logs.length > 500) state.logs.splice(0, state.logs.length - 500)
}
function clear() {
state.workflow = null
state.version = null
state.description = null
state.params = {}
state.active = false
state.stage = E_STAGE.PENDING
state.tasks = []
state.gateResult = null
state.retries = 0
state.error = null
state.logs = []
state.updatedAt = Date.now()
}
function hydrate(j) {
state.workflow = j.workflow
state.version = j.version
state.description = j.description
state.params = j.params || {}
state.active = !!j.active
state.stage = j.stage || E_STAGE.PENDING
state.gateResult = j.gateResult || null
state.retries = j.retries || 0
state.error = j.error || null
state.updatedAt = Date.now()
state.logs = Array.isArray(j.logs) ? j.logs.slice(-200) : []
state.tasks = Array.isArray(j.tasks) ? j.tasks.map((t, i) => ({
id: t.id,
name: t.name,
type: t.type,
status: t.status || E_TASK_STATUS.PENDING,
processor: t.processor || null,
outputs: Array.isArray(t.outputs) ? t.outputs : [],
gate: t.gate || null,
gateResult: t.gateResult || null,
retries: t.retries || 0,
})) : []
state.updatedAt = Date.now()
}
return {
begin,
clear,
hydrate,
updateTask,
processBreak,
setStage,
setGateResult,
setRetries,
setError,
setPersist,
snapshot,
}
}
function createWorkflowStorage(ctx, engine) {
const sandboxPolicy = ctx.get('sandboxPolicy')
let workspaceRoot = sandboxPolicy ? (sandboxPolicy.workspaceRoot || '') : ''
let explicitStatePath = null
let statePath = null
function setWorkspaceRoot(root) {
workspaceRoot = (root || '').replace(/\\/g, '/').replace(/\/+$/, '')
statePath = null // 下次访问时重算
}
function setStatePath(p) {
explicitStatePath = p ? String(p).replace(/\\/g, '/') : null
statePath = null // 下次访问时重算
}
async function ensurePath() {
if (statePath) return statePath
const fs = ctx.get('fs')
if (!fs) return null
if (explicitStatePath) {
statePath = await fs.resolve(explicitStatePath)
return statePath
}
if (!workspaceRoot) return null
const dir = (workspaceRoot + '/.workflow-agent').replace(/\/+/g, '/')
statePath = await fs.resolve(dir + '/state.json')
return statePath
}
function writePolicy() {
let root = workspaceRoot
if (!root && explicitStatePath) {
const idx = explicitStatePath.lastIndexOf('/')
root = idx > 0 ? explicitStatePath.slice(0, idx) : explicitStatePath
}
return {
mode: 'workspace-write',
workspaceRoot: root || '',
}
}
async function save() {
const fs = ctx.get('fs')
if (!fs) return 'err: no fs'
try {
const p = await ensurePath()
if (!p) return 'err: no workspaceRoot/statePath（请由 workflow_begin 指定）'
const snap = engine.snapshot()
const payload = {
workflow: snap.workflow,
version: snap.version,
description: snap.description,
params: snap.params,
active: snap.active,
stage: snap.stage,
tasks: snap.tasks,
gateResult: snap.gateResult,
retries: snap.retries,
error: snap.error,
updatedAt: snap.updatedAt,
logs: snap.logs,
}
await fs.writeText(p, JSON.stringify(payload, null, 2), undefined, undefined, writePolicy())
const r = 'ok'
engine.setPersist(r)
return r
} catch (e) {
const r = 'err: ' + ((e && e.message) || String(e))
engine.setPersist(r)
return r
}
}
async function load() {
const fs = ctx.get('fs')
if (!fs) return false
try {
const p = await ensurePath()
if (!p) return false
const text = await fs.readText(p)
const j = JSON.parse(text)
if (!j || !j.workflow) return false
engine.hydrate(j)
return true
} catch (e) {
return false // 无之前状态
}
}
return { save, load, setWorkspaceRoot, setStatePath }
}
function parentDir(p) {
const norm = p.replace(/\\/g, '/')
const idx = norm.lastIndexOf('/')
if (idx <= 0) return null
return norm.slice(0, idx)
}
async function resolveRel(fs, base, rel) {
let d = base
while (d) {
const cand = d + '/' + rel.replace(/\\/g, '/')
try {
const st = await fs.stat(await fs.resolve(cand))
if (st) return cand
} catch (e) { /* keep climbing */ }
d = parentDir(d)
}
return base + '/' + rel.replace(/\\/g, '/')
}
let E_PARAM_PATTERN = typeof PARAM_PATTERN !== 'undefined' ? PARAM_PATTERN : /\$\{(\w+)\}/g
function injectParams(value, params) {
if (typeof value !== 'string') return value
return value.replace(E_PARAM_PATTERN, (whole, key) => {
if (params && params[key] !== undefined) return String(params[key])
return whole // 未提供则保留原样，由调用方提示
})
}
function injectArray(list, params) {
return (list || []).map((x) => injectParams(x, params))
}
function injectInputsMap(map, params) {
const out = {}
for (const k of Object.keys(map || {})) {
const v = map[k]
out[k] = Array.isArray(v) ? v.map((x) => injectParams(x, params)) : injectParams(v, params)
}
return out
}
async function loadWorkflowSource(fs, args) {
if (args.workflowPath) {
const p = String(args.workflowPath)
const text = await fs.readText(await fs.resolve(p))
return { text, base: p.replace(/[\\/][^\\/]*$/, '') }
}
if (args.workflowText) {
return { text: String(args.workflowText), base: undefined }
}
return null
}
async function expandLoopTasks(fs, loopTask, items, itemVar, params) {
const expanded = []
const loopDeps = loopTask.dependsOn || []
let prevId = null
for (let i = 0; i < items.length; i++) {
const item = String(items[i]).trim()
if (!item) continue
const iterParams = { ...params }
iterParams[itemVar] = item
const sanitized = item.replace(/[^a-zA-Z0-9_\-]/g, '-').replace(/^-+|-+$/g, '') || ('iter-' + i)
const iterId = loopTask.id + '/' + sanitized
expanded.push({
id: iterId,
name: (loopTask.name || loopTask.id) + ' - ' + item,
type: 'llm-task',
dependsOn: prevId ? [prevId] : loopDeps,
timeout: loopTask.timeout || 600,
processor: injectParams(loopTask.processor || '', iterParams),
inputs: injectInputsMap(loopTask.inputsRaw || {}, iterParams),
outputs: injectArray(loopTask.outputsRaw || [], iterParams),
gate: loopTask.gate ? {
checker: loopTask.gate.checker,
onFailure: loopTask.gate.onFailure,
maxRetries: loopTask.gate.maxRetries,
} : null,
_loopGroup: loopTask.id,
_loopGroupName: loopTask.name || loopTask.id,
_loopItem: item,
_loopIndex: i,
_onError: loopTask.onError || 'break',
})
prevId = iterId
}
return expanded
}
function registerWorkflowTools(ctx, harness, engine, storage) {
const fs = ctx.get('fs')
const beginTool = harness.defineTool({
name: 'workflow_begin',
description: '解析并启动一个工作流定义（YAML）。参数 workflowPath 为本机绝对路径；或传 workflowText 直接给 YAML 文本。可选 params 对象注入工作流级 ${param} 模板变量。可选 workspaceRoot（推荐：传会话工作区根，如 C:/Users/<user>/dsh_workspace）决定状态文件默认落盘位置 <root>/.workflow-agent/state.json；或直接传 statePath 完全指定状态文件路径。成功返回解析出的任务列表（含处理技能绝对路径、门禁配置）与初始 PENDING 状态；定义不合法时返回 errors 列表。',
parameters: {
type: 'object',
additionalProperties: true,
properties: {
workflowPath: { type: 'string', description: '工作流 YAML 的绝对路径' },
workflowText: { type: 'string', description: '工作流 YAML 文本（与 workflowPath 二选一）' },
workspaceRoot: { type: 'string', description: '状态落盘根目录（推荐会话工作区）；默认无则状态不落盘' },
statePath: { type: 'string', description: '完全自定义的状态文件绝对路径（优先级高于 workspaceRoot）' },
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
async execute(args) {
try {
if (!fs) throw new Error('fs service unavailable')
if (args && args.workspaceRoot && storage) storage.setWorkspaceRoot(String(args.workspaceRoot))
if (args && args.statePath && storage) storage.setStatePath(String(args.statePath))
const src = await loadWorkflowSource(fs, args)
if (!src) throw new Error('需要 workflowPath 或 workflowText 参数')
const parsed = parseWorkflow(src.text)
const params = (args && args.params) || {}
if (parsed.errors && parsed.errors.length > 0) {
engine.setError('workflow 定义不合法: ' + parsed.errors.join('; '))
await storage.save()
const s = engine.snapshot()
s.workflowBeginErrors = parsed.errors
return s
}
const tasks = await Promise.all(parsed.tasks.map(async (t) => {
const out = { ...t }
out.inputs = injectInputsMap(t.inputsRaw, params)
out.outputs = injectArray(t.outputsRaw, params)
if (t.processorRaw) {
const procRel = injectParams(t.processorRaw, params)
out.processor = src.base ? await resolveRel(fs, src.base, procRel) : procRel
}
if (t.gateRaw) {
const gateRel = injectParams(t.gateRaw, params)
out.gate = {
checker: src.base ? await resolveRel(fs, src.base, gateRel) : gateRel,
onFailure: t.gateOnFailure,
maxRetries: t.gateMaxRetries,
}
}
if (t.itemsFromRaw) {
const itemsRel = injectParams(t.itemsFromRaw, params)
out.itemsFrom = src.base ? await resolveRel(fs, src.base, itemsRel) : itemsRel
out.itemsFromRaw = t.itemsFromRaw
out.itemVar = t.itemVar
}
return out
}))
parsed.tasks = tasks
const finalTasks = []
for (const t of tasks) {
if (t.type === 'loop' && t.itemsFrom && t.itemVar) {
const text = await fs.readText(await fs.resolve(t.itemsFrom))
const items = text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'))
if (items.length === 0) {
engine.setError('循环 Task "' + t.id + '" 的 items-from 文件为空: ' + t.itemsFrom)
await storage.save()
return engine.snapshot()
}
const iterations = await expandLoopTasks(fs, t, items, t.itemVar, params)
finalTasks.push(...iterations)
} else {
finalTasks.push(t)
}
}
parsed.tasks = finalTasks
engine.begin(parsed)
engine.setError(null)
const r = await storage.save()
engine.setPersist(r)
return engine.snapshot()
} catch (error) {
engine.setError(error.message)
await storage.save()
return engine.snapshot()
}
},
})
harness.registerTool(ctx, beginTool)
const statusTool = harness.defineTool({
name: 'workflow_status',
description: '按编排进展更新工作流状态并同步持久化与 UI：stage（PENDING|RUNNING|COMPLETED|FAILED）、gateResult（PASS|FAIL）、task/tasktatus 更新单个任务（PENDING|RUNNING|DONE|FAILED|SKIPPED）、retries 重试计数、error 错误信息。每次调用返回最新快照。',
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
async execute(args) {
try {
if (!args) args = {}
if (args.stage) engine.setStage(String(args.stage))
if (args.gateResult) engine.setGateResult(String(args.gateResult))
if (typeof args.retries === 'number') engine.setRetries(args.retries)
if (args.error !== undefined) engine.setError(args.error ? String(args.error) : null)
if (args.task && args.taskStatus) {
engine.updateTask(String(args.task), { status: String(args.taskStatus) })
}
const r = await storage.save()
engine.setPersist(r)
return engine.snapshot()
} catch (error) {
engine.setError(error.message)
return engine.snapshot()
}
},
})
harness.registerTool(ctx, statusTool)
}
function registerWorkflowRpc(ctx, harness, engine) {
const fs = ctx.get('fs')
harness.handle('wf:status', async () => {
return engine.snapshot()
})
harness.handle('wf:skill', async (req) => {
const id = req && req.id
if (!fs) return { id, name: id, text: '（fs 不可用）' }
const s = engine.snapshot()
const t = (s.tasks || []).find((x) => x.id === id)
if (!t) return { id, name: id, text: '（未找到节点 ' + id + '）' }
const path = t.processor
if (!path) return { id, name: t.name, text: '（该节点未配置处理器技能）' }
try {
const text = await fs.readText(await fs.resolve(path))
return { id, name: t.name, text }
} catch (e) {
return { id, name: t.name, text: '（技能文件不可读: ' + path + '）' }
}
})
harness.handle('wf:logs', async () => {
const s = engine.snapshot()
return { logs: s.logs || [] }
})
}
function hostApply(ctx) {
const engine = createWorkflowEngine()
const storage = createWorkflowStorage(ctx, engine)
if (storage) {
storage.load().catch(() => {})
}
if (ctx.get('fs')) {
registerWorkflowTools(ctx, harness, engine, storage)
registerWorkflowRpc(ctx, harness, engine)
}
console.log('[workflow-agent] host loaded, workflow=' + (engine.snapshot().workflow || '(none)'))
ctx.effect(() => () => {})
}
return { inject: ['fs', 'timer'], apply: hostApply }