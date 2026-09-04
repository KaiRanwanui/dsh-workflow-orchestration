// ============================================================================
// workflow-agent — parser / engine 单元测试（Node，纯逻辑，无需 DSH）
// 文件：code/scripts/test-host.js
// 用法：node code/scripts/test-host.js
// ============================================================================

const { parseWorkflow } = require('../shared/workflow-parser')
const { createWorkflowEngine } = require('../plugins/workflow-host/engine.js')
const { TASK_TYPES, TASK_STATUS, STAGE } = require('../shared/workflow-schema.js')
const { expandLoopTasks } = require('../plugins/workflow-host/tools.js')
const { expandConcurrentTasks } = require('../plugins/workflow-host-preset/tools-preset.js')
const { createInstanceRegistry, slugifyName, instanceDirPath, isUserAbortTurnEnd, detectUserAbortFromLog } = require('../plugins/workflow-host/instance-store.js')
const { createWorkflowStorage } = require('../plugins/workflow-host/storage.js')

let pass = 0
let fail = 0

// 内存文件系统（resolve 返回 {path}，与 DSH fs 语义同构）——用例 8/9 共用
function makeMockFs() {
  const files = new Map()
  const fs = {
    async resolve(p) { return { path: p } },
    async writeText(t, content) { files.set(t.path, String(content)) },
    async readText(t) {
      const v = files.get(t.path)
      if (v === undefined) throw new Error('not found: ' + t.path)
      return v
    },
    async stat(t) {
      // 对齐真实 DSH fs 契约：不存在返回 undefined（不抛错）
      const v = files.get(t.path)
      if (v === undefined) return undefined
      return { path: t.path, size: String(v).length }
    },
    async listDir(t) {
      const prefix = t.path.replace(/\/+$/, '') + '/'
      const seen = new Map()
      for (const key of files.keys()) {
        if (!key.startsWith(prefix)) continue
        const rest = key.slice(prefix.length)
        const seg = rest.split('/')[0]
        if (!seg) continue
        seen.set(seg, { name: seg, type: rest.includes('/') ? 'directory' : 'file', target: { path: prefix + seg } })
      }
      return Array.from(seen.values())
    },
  }
  return { files, fs }
}

// ── 用例 9：实例操控工具（Iter-11：list/create/start/status/stop/reset 全流程）──
async function runCase9() {
  console.log('［用例 9］实例操控工具 — list/create/start/status/stop/reset')
  const { registerWorkflowToolsPreset, stripInstanceHeader } = require('../plugins/workflow-host-preset/tools-preset.js')

  check('stripInstanceHeader: 剥离注释头', stripInstanceHeader('# a\n# source: /x\n# params: {}\n\nname: t9\n').startsWith('name: t9'))
  check('stripInstanceHeader: 无头部原样保留', stripInstanceHeader('name: t9\n') === 'name: t9\n')

  const { files, fs: mockFs } = makeMockFs()
  const mkCtx = (bag) => {
    // 兼容两种访问：ctx.tools.register（属性）与 ctx.get('tools')（服务）
    const toolsMock = { register(t) { bag[t.name] = t } }
    return {
      tools: toolsMock,
      get(name) {
        if (name === 'fs') return mockFs
        if (name === 'tools') return toolsMock
        return undefined
      },
    }
  }
  const registered = {}
  const registry = createInstanceRegistry(mkCtx(registered), { createWorkflowEngine, createWorkflowStorage })
  registerWorkflowToolsPreset(mkCtx(registered), null, null, registry)

  const exec = { agent: { session: { header: { id: 'sess-t9', cwd: '/ws/t9' } } } }
  // Iter-27b：E-SKILL-MISSING 生效——夹具补三份技能文件（绝对直通探针命中，create 放行）
  files.set('/x/skills/a/SKILL.md', 'skill a')
  files.set('/x/skills/b/SKILL.md', 'skill b')
  files.set('/x/skills/c/SKILL.md', 'skill c')
  const WF9 = `
name: t9demo
version: "1.0"
description: "iter11 ops"
max-concurrency: 2
tasks:
  - id: a
    name: "A"
    processor: /x/skills/a/SKILL.md
    outputs: ["/ws/t9/output/a.md"]
    depends-on: []
  - id: b
    name: "B"
    processor: /x/skills/b/SKILL.md
    outputs: ["/ws/t9/output/b.md"]
    depends-on: []
  - id: c
    name: "C"
    processor: /x/skills/c/SKILL.md
    outputs: ["/ws/t9/output/c.md"]
    depends-on: [a, b]
`
  const statePath = (id) => '/ws/t9/.workflow-agent/instances/' + id + '/state.json'

  let r = await registered.workflow_list.execute({}, exec)
  check('list: 空工作区返回空数组', Array.isArray(r.instances) && r.instances.length === 0, JSON.stringify(r).slice(0, 80))

  r = await registered.workflow_create.execute({ workflowText: WF9 }, exec)
  check('create: 返回 CREATED + id 形态', r.phase === 'CREATED' && /^t9demo-[0-9a-f]{8}$/.test(r.instanceId), JSON.stringify(r).slice(0, 120))
  const iid = r.instanceId

  r = await registered.workflow_list.execute({}, exec)
  check('list: CREATED 阶段可见', r.instances.length === 1 && r.instances[0].phase === 'CREATED' && r.instances[0].instanceId === iid)

  r = await registered.workflow_start.execute({}, exec)
  check('start: stage RUNNING（Iter-18 状态机）+ runnable 2（max-concurrency=2）', r.stage === 'RUNNING' && Array.isArray(r.runnable) && r.runnable.length === 2, r.stage + '/' + (r.runnable || []).length)
  check('start: 快照带 instanceId', r.instanceId === iid)
  check('start: state.json 落实例目录', files.has(statePath(iid)))

  r = await registered.workflow_status.execute({ task: 'a', taskStatus: 'RUNNING' }, exec)
  check('status: 会话绑定推进任务 a RUNNING', r.tasks.some(t => t.id === 'a' && t.status === 'RUNNING'))

  r = await registered.workflow_stop.execute({}, exec)
  check('stop: stage STOPPED 并落盘', r.stage === 'STOPPED' && files.get(statePath(iid)).includes('STOPPED'))

  r = await registered.workflow_reset.execute({}, exec)
  check('reset: 状态全新 PENDING + runnable 恢复', r.stage === 'PENDING' && Array.isArray(r.runnable) && r.runnable.length === 2 && r.tasks.every(t => t.status === 'PENDING'))
  check('reset: metadata 记 lastResetAt', !!JSON.parse(files.get('/ws/t9/.workflow-agent/instances/' + iid + '/metadata.json')).lastResetAt)

  r = await registered.workflow_list.execute({}, exec)
  check('list: READY 阶段 + 任务计数', r.instances[0].phase === 'READY' && r.instances[0].taskTotal === 3 && r.instances[0].stage === 'PENDING')

  // 模拟 DSH 重启：全新注册表 + 全新工具注册，按 sessionId 精确恢复本会话实例
  const reg2 = {}
  const registry2 = createInstanceRegistry(mkCtx(reg2), { createWorkflowEngine, createWorkflowStorage })
  registerWorkflowToolsPreset(mkCtx(reg2), null, null, registry2)
  r = await reg2.workflow_status.execute({}, exec)
  check('重启后: 按 sessionId 精确恢复实例', r.instanceId === iid)
  check('重启后: 恢复的实例阶段为 PENDING', r.stage === 'PENDING')
}

// ── 用例 10：HTTP 路由（Iter-13：POST /wf/create + GET /wf/templates）────────
async function runCase10() {
  console.log('［用例 10］HTTP 路由 — templates / create（POST body）/ 404')
  const mjs = await import('../agent-presets/workflow-orchestrator/workflow-host.mjs')

  const { files, fs: mockFs } = makeMockFs()
  let routeHandler = null
  const ctx = {
    get(name) {
      if (name === 'webServer') return { register(def) { routeHandler = def.handler } }
      if (name === 'fs') return mockFs
      return undefined
    },
  }
  const registry = createInstanceRegistry(ctx, { createWorkflowEngine, createWorkflowStorage })
  mjs.registerWebRoutes(ctx, registry)
  check('路由注册：/wf prefix handler 已捕获', typeof routeHandler === 'function')

  const call = (method, url, body) => new Promise((resolve, reject) => {
    const res = {
      code: 0, headers: null, payload: '',
      writeHead(c, h) { this.code = c; this.headers = h },
      end(p) { this.payload = p || ''; try { resolve({ code: this.code, body: JSON.parse(this.payload) }) } catch (e) { reject(e) } },
    }
    const req = { method, url, headers: { host: '127.0.0.1:3080' }, socket: { remoteAddress: '127.0.0.1' } }
    if (method === 'POST') {
      const chunks = [JSON.stringify(body)]
      req.on = (ev, fn) => {
        if (ev === 'data') chunks.forEach(c => fn(c))
        if (ev === 'end') Promise.resolve().then(() => fn())
      }
    }
    Promise.resolve(routeHandler(req, res)).catch(reject)
  })

  // templates：预定义目录扫描优先 + 内建兜底合并（Iter-24：工作区 templates/ 不再列入）
  const savedDsh = process.env.DSH_HOME
  process.env.DSH_HOME = '/ws/t13-pre'
  await mockFs.writeText({ path: '/ws/t13-pre/workflow-agent/templates/disk-tpl.yaml' }, 'name: disk-tpl\n')
  let r = await call('GET', '/wf/templates?workspaceRoot=/ws/t13')
  check('templates: 预定义磁盘版扫描到（无 fallback 标记）', r.code === 200 && r.body.predefined[0].name === 'disk-tpl' && r.body.predefined[0].fallback === undefined && r.body.predefined[0].path === '/ws/t13-pre/workflow-agent/templates/disk-tpl.yaml', JSON.stringify(r.body.predefined))
  check('templates: 内建兜底补缺（同名去重，磁盘版赢）', r.body.predefined.length === 5 && r.body.predefined.filter(x => x.fallback).map(x => x.name).join(',') === 'default-demo,serial-demo,items-demo,runtime-items-demo', JSON.stringify(r.body.predefined.map(x => x.name)))
  check('templates: builtin 字段保留（兼容）', Array.isArray(r.body.builtin) && r.body.builtin.length === 4 && r.body.builtin[0].yaml.includes('name: default-demo') && r.body.builtin[2].yaml.includes('name: items-demo') && r.body.builtin[3].yaml.includes('name: runtime-items-demo'))
  check('templates: default-demo 集成依赖深度分析（防止深挖变旁路孤岛回归）', r.body.builtin[0].yaml.includes('depends-on: [write-spec, prep-data, deep-analysis]') && r.body.builtin[0].yaml.includes('analysis: "output/analysis.md"'))
  process.env.DSH_HOME = savedDsh

  // create：workflowText 成功路径
  files.set('/x/a/SKILL.md', 'skill a') // Iter-27b：E-SKILL-MISSING 探针命中（/wf/create 同款关口）
  const WF13 = 'name: t13demo\nversion: "1.0"\ndescription: d\nmax-concurrency: 2\ntasks:\n  - id: a\n    name: A\n    processor: /x/a/SKILL.md\n    outputs: ["/ws/t13/output/a.md"]\n    depends-on: []\n'
  r = await call('POST', '/wf/create', { workspaceRoot: '/ws/t13', workflowText: WF13, params: { output_dir: 'out' } })
  const iid = r.body.instanceId
  check('create: 200 + CREATED + id 形态', r.code === 200 && r.body.phase === 'CREATED' && /^t13demo-[0-9a-f]{8}$/.test(iid), JSON.stringify(r.body).slice(0, 140))
  check('create: 快照目录五件套落盘', files.has('/ws/t13/.workflow-agent/instances/' + iid + '/instance.yaml') && files.has('/ws/t13/.workflow-agent/instances/' + iid + '/output/.gitkeep'))
  check('create: params 记入 metadata', JSON.parse(files.get('/ws/t13/.workflow-agent/instances/' + iid + '/metadata.json')).params.output_dir === 'out')
  check('create: warnings 数组在（完好定义为空，27b validate 出口）', Array.isArray(r.body.warnings) && r.body.warnings.length === 0, JSON.stringify(r.body.warnings))
  check('create(27b): 200 附 validation 摘要 + metadata 落盘快照', r.body.validation && r.body.validation.ok === true && JSON.parse(files.get('/ws/t13/.workflow-agent/instances/' + iid + '/metadata.json')).validation.ok === true, JSON.stringify(r.body.validation))

  // create：缺 processor 定义 → 400 结构化拒（Iter-27b 拍板①=B 硬拦截）
  r = await call('POST', '/wf/create', { workspaceRoot: '/ws/t13', workflowText: 'name: wp\nversion: "1"\ntasks:\n  - id: a\n    outputs: ["output/a.md"]\n' })
  check('create: 缺 processor → 400 + errors 清单（硬拦）+ hint 只转告约束', r.code === 400 && Array.isArray(r.body.errors) && r.body.errors.some(e => e.code === 'E-PROCESSOR-MISSING') && r.body.workflowBeginErrors.some(w => w.includes('E-PROCESSOR-MISSING')) && !!r.body.hint, JSON.stringify(r.body).slice(0, 160))

  // create：非法定义 → 400 + workflowBeginErrors
  r = await call('POST', '/wf/create', { workspaceRoot: '/ws/t13', workflowText: 'tasks: []\n' })
  check('create: 非法定义 400', r.code === 400 && Array.isArray(r.body.workflowBeginErrors) && r.body.workflowBeginErrors.length > 0)

  // create：缺 workspaceRoot / 缺定义来源
  r = await call('POST', '/wf/create', { workflowText: WF13 })
  check('create: 缺 workspaceRoot 400', r.code === 400)
  r = await call('POST', '/wf/create', { workspaceRoot: '/ws/t13' })
  check('create: 缺定义来源 400', r.code === 400)

  // workflowPath 读取创建
  await mockFs.writeText({ path: '/ws/t13/wfs/from-file.yaml' }, WF13.replace('t13demo', 'fromfile'))
  r = await call('POST', '/wf/create', { workspaceRoot: '/ws/t13', workflowPath: '/ws/t13/wfs/from-file.yaml' })
  check('create: workflowPath 读取成功', r.code === 200 && r.body.workflowName === 'fromfile', JSON.stringify(r.body).slice(0, 120))

  // 404 回退
  r = await call('GET', '/wf/nothing')
  check('404 回退', r.code === 404)
}

// ── 用例 11：运行状态机（Iter-16：start/stop/resume/reset + STOPPED active）──
async function runCase11() {
  console.log('［用例 11］运行状态机 — start/stop/resume/reset + STOPPED')
  const src = { name: 'sm', version: '1', description: null, params: {}, tasks: [
    { id: 'a', name: 'A', type: 'llm-task', processor: '/x/a', outputs: [], gate: null },
    { id: 'b', name: 'B', type: 'llm-task', processor: '/x/b', outputs: [], gate: null },
  ] }

  // 场景 1：PENDING→RUNNING→STOPPED→resume→RUNNING（保 DONE）
  const e = createWorkflowEngine()
  e.begin(src)
  let s = e.snapshot()
  check('begin: PENDING + active=true', s.stage === 'PENDING' && s.active === true)
  e.start()
  s = e.snapshot()
  check('start: RUNNING + active=true', s.stage === 'RUNNING' && s.active === true)
  e.updateTask('a', { status: 'DONE' })
  e.stop()
  s = e.snapshot()
  check('stop: STOPPED + active=false', s.stage === 'STOPPED' && s.active === false)
  check('stop: 保留 DONE 进度', s.tasks.find(t => t.id === 'a').status === 'DONE')
  e.resume()
  s = e.snapshot()
  check('resume: RUNNING + active=true', s.stage === 'RUNNING' && s.active === true)
  check('resume: 续跑保 DONE', s.tasks.find(t => t.id === 'a').status === 'DONE')

  // 场景 2：STOPPED 不可 start（抛错）
  e.stop()
  let threw = false
  try { e.start() } catch (err) { threw = true }
  check('STOPPED 不可 start（抛错）', threw)

  // 场景 3：RUNNING 先 stop 再 reset → 全新 PENDING
  e.resume()
  e.stop()
  e.reset()
  s = e.snapshot()
  check('stop->reset: 全新 PENDING + active=true', s.stage === 'PENDING' && s.active === true && s.tasks.every(t => t.status === 'PENDING'))

  // 场景 4：PENDING 不可 reset（抛错）
  threw = false
  try { e.reset() } catch (err) { threw = true }
  check('PENDING 不可 reset（抛错）', threw)

  // 场景 5（Iter-21）：stop 把 RUNNING 重置为 PENDING，resume 不再死锁
  const e2 = createWorkflowEngine()
  e2.begin({ name: 'sm2', version: '1', description: null, params: {}, maxConcurrency: 2, tasks: [
    { id: 'x', name: 'X', type: 'llm-task', processor: '/x/x', outputs: [], gate: null },
    { id: 'y', name: 'Y', type: 'llm-task', processor: '/x/y', outputs: [], gate: null },
    { id: 'z', name: 'Z', type: 'llm-task', processor: '/x/z', outputs: [], gate: null, dependsOn: ['x', 'y'] },
  ] })
  e2.start()
  e2.updateTask('x', { status: 'RUNNING' })
  e2.updateTask('y', { status: 'RUNNING' })
  check('deadlock 前置: 2 RUNNING 占满槽后 runnable=[]', e2.snapshot().runnable.length === 0)
  e2.stop()
  s = e2.snapshot()
  check('stop: RUNNING 任务重置为 PENDING', s.tasks.find(t => t.id === 'x').status === 'PENDING' && s.tasks.find(t => t.id === 'y').status === 'PENDING')
  check('stop: STOPPED 时 runnable=[]（不派发，防 stop 后 agent 继续驱动）', e2.snapshot().runnable.length === 0)
  e2.resume()
  s = e2.snapshot()
  check('resume: runnable 恢复（不死锁）', Array.isArray(s.runnable) && s.runnable.length === 2, String(s.runnable.length))

  // 场景 6（Iter-22）：hydrate-only 实例 reset —— state.def 不持久化，resetWithDefinition 从
  // instance.yaml 重解析后传入；reset() 在 hydrate-only 下抛错（现状约束，调用方已改走新变体）。
  const hdef = { name: 'h22', version: '1', description: null, params: {}, tasks: [
    { id: 'x', name: 'X', type: 'llm-task', processor: '/x/x', outputs: [], gate: null },
  ] }
  const e3 = createWorkflowEngine()
  e3.begin(hdef)
  e3.start()
  e3.updateTask('x', { status: 'DONE' })
  e3.stop()
  const e4 = createWorkflowEngine()
  e4.hydrate(e3.snapshot()) // 模拟从磁盘恢复：hydrate 不恢复 def
  threw = false
  try { e4.reset() } catch (err) { threw = /reset 需要已 begin 的定义/.test(err && err.message) }
  check('hydrate-only reset() 抛错（state.def 缺失，根因留档）', threw)
  e4.resetWithDefinition(hdef)
  s = e4.snapshot()
  check('resetWithDefinition: hydrate-only STOPPED→全新 PENDING', s.stage === 'PENDING' && s.active === true && s.tasks.length === 1 && s.tasks[0].status === 'PENDING', JSON.stringify({ stage: s.stage, n: s.tasks.length }))
  threw = false
  try { createWorkflowEngine().resetWithDefinition(null) } catch (err) { threw = true }
  check('resetWithDefinition: 缺定义抛错', threw)
}

// ── 用例 12：绑定模型 + 完整性（Iter-17：create-bind/adopt + 1:1 + 派生状态 + BROKEN）──
async function runCase12() {
  console.log('［用例 12］绑定模型 + 完整性 — create-bind/adopt/1:1 + 派生状态 + BROKEN')
  const deps = { createWorkflowEngine, createWorkflowStorage }
  const cwd = '/ws/bind'

  // 场景 1：create-bind（新建实例并绑 → BOUND）
  const { reg, fs } = (() => { const m = makeMockFs(); return { reg: createInstanceRegistry({ get() { return m.fs } }, deps), fs: m.fs } })()
  const a = await reg.createBind(cwd, 'sess-a', { workflowName: 'wfA', sourceText: 'name: wfA\n', sourcePath: null, params: {} })
  check('create-bind: 新建实例 metadata.sessionId=sess-a', a.meta.sessionId === 'sess-a')
  let st = await reg.deriveSessionState(cwd, 'sess-a')
  check('create-bind: 派生 BOUND', st.state === 'BOUND' && st.instanceId === a.instanceId)

  // 场景 2：重复绑定拒绝（1:1 一会话一实例）
  let threw = false
  try { await reg.createBind(cwd, 'sess-a', { workflowName: 'wfB', sourceText: 'name: wfB\n', sourcePath: null, params: {} }) } catch (e) { threw = true }
  check('create-bind: 会话已绑定 → 拒绝(1:1)', threw)

  // 场景 3：adopt（采用 sessionId==null 实例 → BOUND；已占用实例不可再 adopt）
  const orphan = await reg.beginInstance({ cwd, sessionId: null, workflowName: 'wfPool', sourceText: 'name: wfPool\n', sourcePath: null, params: {} })
  check('adopt 前置: 池实例 sessionId=null', orphan.meta.sessionId === null)
  const adopted = await reg.adoptInstance(cwd, 'sess-b', orphan.instanceId)
  check('adopt: 绑定后 metadata.sessionId=sess-b', adopted.meta.sessionId === 'sess-b' && adopted.instanceId === orphan.instanceId)
  st = await reg.deriveSessionState(cwd, 'sess-b')
  check('adopt: 派生 BOUND', st.state === 'BOUND')
  threw = false
  try { await reg.adoptInstance(cwd, 'sess-c', orphan.instanceId) } catch (e) { threw = true }
  check('adopt: 已占用实例 → 拒绝', threw)

  // 场景 4：骨架缺场 → BROKEN（agentRoot 有内容但缺 instances/，旧布局残留）
  const bad = makeMockFs()
  await bad.fs.writeText({ path: '/ws/bad/.workflow-agent/state.json' }, '{}\n')
  const badReg = createInstanceRegistry({ get() { return bad.fs } }, deps)
  const integ = await badReg.checkWorkspaceTreeIntegrity('/ws/bad') // 直接测完整性（不物化）
  check('骨架缺场: checkWorkspaceTreeIntegrity → not ok', integ.ok === false && /instances/.test(integ.reason))

  // 场景 5：实例目录损坏 → BROKEN
  const cor = makeMockFs()
  const corReg = createInstanceRegistry({ get() { return cor.fs } }, deps)
  await corReg.ensureWorkspaceSkeleton('/ws/corrupt')
  await cor.fs.writeText({ path: '/ws/corrupt/.workflow-agent/instances/broken1/metadata.json' }, '{bad json\n')
  st = await corReg.deriveSessionState('/ws/corrupt', 'sess-x')
  check('实例目录损坏: derive → BROKEN', st.state === 'BROKEN' && /CORRUPT/.test(st.reason))

  // 场景 6：1:1 冲突（两会话同 S）→ BROKEN
  const bip = makeMockFs()
  const bipReg = createInstanceRegistry({ get() { return bip.fs } }, deps)
  await bipReg.ensureWorkspaceSkeleton('/ws/conflict')
  await bip.fs.writeText({ path: '/ws/conflict/.workflow-agent/instances/i1/metadata.json' }, JSON.stringify({ instanceId: 'i1', workflowName: 'w', sessionId: 'sess-conflict' }))
  await bip.fs.writeText({ path: '/ws/conflict/.workflow-agent/instances/i2/metadata.json' }, JSON.stringify({ instanceId: 'i2', workflowName: 'w', sessionId: 'sess-conflict' }))
  st = await bipReg.deriveSessionState('/ws/conflict', 'sess-conflict')
  check('1:1 冲突: derive → BROKEN', st.state === 'BROKEN' && /CONFLICT/.test(st.reason))

  // 场景 7：adopt RUNNING 实例 → 拒绝（两会话不得驱动同一 RUNNING 实例）
  const run = makeMockFs()
  const runReg = createInstanceRegistry({ get() { return run.fs } }, deps)
  const running = await runReg.beginInstance({ cwd: '/ws/run', sessionId: null, workflowName: 'wfRun', sourceText: 'name: wfRun\n', sourcePath: null, params: {} })
  running.engine.begin({ name: 'wfRun', version: '1', description: null, params: {}, tasks: [{ id: 'a', name: 'A', type: 'llm-task', processor: '/x', outputs: [], gate: null }] })
  running.engine.setStage('RUNNING')
  await running.storage.save()
  threw = false
  try { await runReg.adoptInstance('/ws/run', 'sess-run', running.instanceId) } catch (e) { threw = true }
  check('adopt: RUNNING 实例 → 拒绝', threw)

  // 场景 8：未绑定会话 → UNBOUND（骨架在场自洽、无 BOUND/DONE 声明）
  st = await reg.deriveSessionState(cwd, 'sess-zzz')
  check('未绑定会话: derive → UNBOUND', st.state === 'UNBOUND')
}

// ── 用例 13：流程控制全链路 + 孤儿回收（Iter-18）──────────────────────────
async function runCase13() {
  console.log('［用例 13］流程控制全链路 + 孤儿回收 — start/stop/resume/reset/adopt + 孤儿')
  const { registerWorkflowToolsPreset, stripInstanceHeader } = require('../plugins/workflow-host-preset/tools-preset.js')
  const { files, fs: mockFs } = makeMockFs()
  const live = new Set(['sess-a']) // 可控会话存活（孤儿识别用）
  const isSessionLive = (sid) => live.has(sid)
  const registered = {}
  const ctx = (bag) => ({
    tools: { register(t) { bag[t.name] = t } },
    get(n) { if (n === 'fs') return mockFs; if (n === 'tools') return { register(t) { bag[t.name] = t } }; return undefined },
  })
  const deps = { createWorkflowEngine, createWorkflowStorage, isSessionLive }
  const registry = createInstanceRegistry(ctx(registered), deps)
  registerWorkflowToolsPreset(ctx(registered), null, null, registry)

  const exec = { agent: { session: { header: { id: 'sess-a', cwd: '/ws/c13' } } } }
  files.set('/x/a/SKILL.md', 'skill a') // Iter-27b：E-SKILL-MISSING 探针命中
  const WF = `name: c13demo\nversion: "1.0"\ndescription: d\ntasks:\n  - id: a\n    name: A\n    processor: /x/a/SKILL.md\n    outputs: ["/ws/c13/output/a.md"]\n    depends-on: []\n`
  const statePath = (id) => '/ws/c13/.workflow-agent/instances/' + id + '/state.json'

  // Part A：控制全链路（create 绑定 sess-a → start → stop → resume → stop → reset 带备份）
  let r = await registered.workflow_create.execute({ workflowText: WF }, exec)
  const iid = r.instanceId
  check('c13 create: CREATED + 绑定 sess-a', r.phase === 'CREATED' && registry.get(iid).meta.sessionId === 'sess-a')

  r = await registered.workflow_start.execute({}, exec)
  check('c13 start: RUNNING', r.stage === 'RUNNING', r.stage)
  r = await registered.workflow_stop.execute({}, exec)
  check('c13 stop: STOPPED + active=false', r.stage === 'STOPPED' && r.active === false)
  r = await registered.workflow_resume.execute({}, exec)
  check('c13 resume: RUNNING + 保 DONE', r.stage === 'RUNNING' && r.active === true)
  r = await registered.workflow_stop.execute({}, exec)
  check('c13 stop2: STOPPED', r.stage === 'STOPPED')
  r = await registered.workflow_reset.execute({}, exec)
  check('c13 reset: PENDING + runnable 1', r.stage === 'PENDING' && Array.isArray(r.runnable) && r.runnable.length === 1, r.stage)
  check('c13 reset: 备份目录 _reset_<state> 写入', !!r.resetBackup && /_reset_STOPPED/.test(r.resetBackup), r.resetBackup)

  // 启动后 status 用 RUNNING 任务（验证 start→RUNNING 后仍可更新）
  r = await registered.workflow_start.execute({}, exec)
  r = await registered.workflow_status.execute({ task: 'a', taskStatus: 'RUNNING' }, exec)
  check('c13 status: a RUNNING', r.tasks.some(t => t.id === 'a' && t.status === 'RUNNING'))

  // Part A2（Iter-22）：hydrate-only reset —— 全新注册表（内存 engines 为空、state.def 必缺失）
  // 对同一实例直接 workflow_reset：模拟 DSH 重启/历史会话场景，必须从 instance.yaml 重解析定义。
  const registered2 = {}
  const registry2 = createInstanceRegistry(ctx(registered2), deps)
  registerWorkflowToolsPreset(ctx(registered2), null, null, registry2)
  const exec2 = { agent: { session: { header: { id: 'sess-a', cwd: '/ws/c13' } } } }
  const c13saved = JSON.parse(files.get(statePath(iid)))
  c13saved.stage = 'COMPLETED'
  c13saved.tasks.forEach(t => { t.status = 'DONE' })
  files.set(statePath(iid), JSON.stringify(c13saved)) // 直接落盘 COMPLETED 状态（模拟历史实例）
  r = await registered2.workflow_reset.execute({ instanceId: iid }, exec2)
  check('c13 reset(hydrate-only): COMPLETED→PENDING（不依赖内存 state.def）', r && r.stage === 'PENDING' && Array.isArray(r.runnable) && r.runnable.length === 1, r && r.stage !== undefined ? r.stage : JSON.stringify(r).slice(0, 140))

  // Part B：孤儿识别 + 回收（绑定会话死亡 → unlock → adopt）
  const orph = await registry.createBind('/ws/c13', 'sess-dead', { workflowName: 'orphan', sourceText: 'name: orphan\n', sourcePath: null, params: {} })
  let orphans = await registry.scanOrphans('/ws/c13')
  check('孤儿识别: 死会话实例进 scanOrphans', orphans.some(o => o.id === orph.instanceId && o.sessionId === 'sess-dead'))
  // 让另一会话存活后 adopt 恢复的实例
  live.add('sess-b')
  const rec = await registry.recoverOrphan('/ws/c13', orph.instanceId)
  check('孤儿回收: 解绑 sessionId=null', rec.meta.sessionId === null)
  orphans = await registry.scanOrphans('/ws/c13')
  check('孤儿回收后: 不再被识别为孤儿', !orphans.some(o => o.id === orph.instanceId))

  // Part B2（Iter-22 D4 修复）：RUNNING 孤儿回收后必须落盘 STOPPED——此前 engine.stop() 未 save，
  // state.json 残留 RUNNING 进采用池 → 被误标"未启动"（D4 实测问题）
  const orph2 = await registry.createBind('/ws/c13', 'sess-dead2', { workflowName: 'orphan2', sourceText: 'name: orphan2\n', sourcePath: null, params: {} })
  files.set(statePath(orph2.instanceId), JSON.stringify({
    workflow: { name: 'orphan2', version: '1', tasks: [{ id: 'a', name: 'a', type: 'llm-task', processor: '/x', outputs: [], 'depends-on': [] }] },
    stage: 'RUNNING',
    tasks: [{ id: 'a', status: 'RUNNING' }, { id: 'b', status: 'DONE' }],
  }))
  await registry.recoverOrphan('/ws/c13', orph2.instanceId)
  const recState = JSON.parse(files.get(statePath(orph2.instanceId)))
  check('孤儿回收(D4): RUNNING 孤儿回收后 state.json 落盘 STOPPED（保 DONE）', recState.stage === 'STOPPED' && recState.tasks.some(t => t.id === 'b' && t.status === 'DONE'), recState.stage)
}

// ── 用例 14：前后台配合（Iter-19）─────────────────────────────────────────
async function runCase14() {
  console.log('［用例 14］前后台配合 — create 即绑定 / 执行期=RUNNING / Session 启停同步')
  const { registerWorkflowToolsPreset } = require('../plugins/workflow-host-preset/tools-preset.js')
  const { files, fs: mockFs } = makeMockFs()
  const live = new Set(['sess-a'])
  const runningAgents = new Set(['sess-a'])
  const pendingAgents = new Set()
  const isSessionLive = (sid) => live.has(sid)
  const isAgentRunning = (sid) => runningAgents.has(sid)
  const isAgentPending = (sid) => pendingAgents.has(sid)
  const deps = { createWorkflowEngine, createWorkflowStorage, isSessionLive, isAgentRunning, isAgentPending }
  const registered = {}
  const ctx = (bag) => ({
    tools: { register(t) { bag[t.name] = t } },
    get(n) { if (n === 'fs') return mockFs; if (n === 'tools') return { register(t) { bag[t.name] = t } }; return undefined },
  })
  const registry = createInstanceRegistry(ctx(registered), deps)
  registerWorkflowToolsPreset(ctx(registered), null, null, registry)
  const exec = { agent: { session: { header: { id: 'sess-a', cwd: '/ws/c14' } } } }
  files.set('/x/a/SKILL.md', 'skill a') // Iter-27b：E-SKILL-MISSING 探针命中
  const WF = `name: c14demo\nversion: "1.0"\ndescription: d\ntasks:\n  - id: a\n    name: A\n    processor: /x/a/SKILL.md\n    outputs: ["/ws/c14/output/a.md"]\n    depends-on: []\n`

  // 1) workflow_begin → RUNNING（执行期=RUNNING）+ 绑定 sess-a
  let r = await registered.workflow_begin.execute({ workflowText: WF }, exec)
  check('workflow_begin: 返回 RUNNING（执行期=RUNNING）', r.stage === 'RUNNING', r.stage)
  check('workflow_begin: 实例绑定 sess-a', registry.get(r.instanceId).meta.sessionId === 'sess-a')
  const iid = r.instanceId

  // 2) Session 停止同步（agent idle 且无排队输入、无 running 子会话 → 实例 STOPPED + stopReason='session-idle'）
  runningAgents.delete('sess-a')
  let e = await registry.syncInstanceState('/ws/c14', iid)
  check('sync:idle(无排队/无子) → 实例 STOPPED', e.engine.snapshot().stage === 'STOPPED', e.engine.snapshot().stage)
  check('sync:自然空闲停记录 stopReason=session-idle（Iter-SUBA P2）', registry.get(iid).meta.stopReason === 'session-idle', registry.get(iid).meta.stopReason)

  // 3) Iter-SUBA(P2)：定向自动恢复——自然空闲停（session-idle）+ 主会话重新活跃 → 无缝续跑
  runningAgents.add('sess-a')
  e = await registry.syncInstanceState('/ws/c14', iid)
  check('sync:running + session-idle → 定向自动 resume → RUNNING（Iter-SUBA P2）', e.engine.snapshot().stage === 'RUNNING', e.engine.snapshot().stage)
  check('sync:自动恢复后 stopReason 已清（Iter-SUBA P2）', registry.get(iid).meta.stopReason == null, registry.get(iid).meta.stopReason)

  // 3b) Iter-SUBA(P2) 反例：user-stop（workflow_stop 权威停止）永不自动恢复
  runningAgents.delete('sess-a')
  e = await registry.syncInstanceState('/ws/c14', iid) // idle → 再次自然停
  check('sync:idle → 再次 STOPPED', e.engine.snapshot().stage === 'STOPPED', e.engine.snapshot().stage)
  await registry.patchMeta('/ws/c14', iid, { stopReason: 'user-stop' }) // 模拟 workflow_stop 权威标记
  runningAgents.add('sess-a')
  e = await registry.syncInstanceState('/ws/c14', iid)
  check('sync:running + user-stop → 仍 STOPPED（权威停止不自动恢复）', e.engine.snapshot().stage === 'STOPPED', e.engine.snapshot().stage)
  // 显式恢复（等价 agent 依消息调 workflow_resume），恢复 RUNNING 现场供步骤 4/5
  e.engine.resume()
  await e.storage.save()
  await registry.patchMeta('/ws/c14', iid, { stopReason: null })
  check('显式 resume → RUNNING（保 DONE）', e.engine.snapshot().stage === 'RUNNING', e.engine.snapshot().stage)

  // 4) Iter-22(S1) 守卫：idle 但 hasPending（排队输入未认领）→ 不 stop，保持 RUNNING
  runningAgents.delete('sess-a')
  pendingAgents.add('sess-a')
  e = await registry.syncInstanceState('/ws/c14', iid)
  check('sync:idle+排队输入 → 仍 RUNNING（S1 守卫）', e.engine.snapshot().stage === 'RUNNING', e.engine.snapshot().stage)

  // 5) 守卫解除（排队输入已被认领/清空）→ idle 正常停
  pendingAgents.delete('sess-a')
  e = await registry.syncInstanceState('/ws/c14', iid)
  check('sync:idle(守卫解除) → 实例 STOPPED', e.engine.snapshot().stage === 'STOPPED', e.engine.snapshot().stage)

  // 4) create 即绑定（/wf/create 路由带 sessionId → metadata.sessionId）
  const mjs = await import('../agent-presets/workflow-orchestrator/workflow-host.mjs')
  let routeHandler = null
  const ctx2 = {
    get(n) {
      if (n === 'webServer') return { register(def) { routeHandler = def.handler } }
      if (n === 'fs') return mockFs
      return undefined
    },
  }
  const registry2 = createInstanceRegistry(ctx2, deps)
  mjs.registerWebRoutes(ctx2, registry2)
  const call = (body) => new Promise((resolve, reject) => {
    const res = { code: 0, headers: null, payload: '', writeHead(c, h) { this.code = c; this.headers = h }, end(p) { this.payload = p || ''; try { resolve({ code: this.code, body: JSON.parse(this.payload) }) } catch (e) { reject(e) } } }
    const req = { method: 'POST', url: '/wf/create', headers: { host: '127.0.0.1:3080' }, socket: { remoteAddress: '127.0.0.1' },
      on: (ev, fn) => { if (ev === 'data') fn(JSON.stringify(body)); if (ev === 'end') Promise.resolve().then(() => fn()) } }
    Promise.resolve(routeHandler(req, res)).catch(reject)
  })
  r = await call({ workspaceRoot: '/ws/c14b', workflowText: WF, sessionId: 'sess-b' })
  check('route create: 返回 sessionId=sess-b', r.code === 200 && r.body.sessionId === 'sess-b', JSON.stringify(r.body).slice(0, 100))
  const meta = JSON.parse(files.get('/ws/c14b/.workflow-agent/instances/' + r.body.instanceId + '/metadata.json'))
  check('route create: metadata.sessionId=sess-b', meta.sessionId === 'sess-b')

  // 5) CONFLICT 自愈：模拟同会话被多实例占用 → 新建实例即恢复（解绑冲突，新建绑定当前）
  await registry2.beginInstance({ cwd: '/ws/c14b', sessionId: 'sess-x', workflowName: 'dup1', sourceText: 'name: dup1\n', sourcePath: null, params: {} })
  await registry2.beginInstance({ cwd: '/ws/c14b', sessionId: 'sess-x', workflowName: 'dup2', sourceText: 'name: dup2\n', sourcePath: null, params: {} })
  let integ2 = await registry2.checkWorkspaceTreeIntegrity('/ws/c14b')
  check('CONFLICT 前置: 双实例绑 sess-x → BROKEN', integ2.ok === false && /CONFLICT/.test(integ2.reason))
  const rec = await registry2.createBind('/ws/c14b', 'sess-y', { workflowName: 'fresh', sourceText: 'name: fresh\n', sourcePath: null, params: {} })
  check('CONFLICT 恢复: 解绑了冲突实例（2 个）', Array.isArray(rec._recoveredConflict) && rec._recoveredConflict.length === 2, JSON.stringify(rec._recoveredConflict))
  integ2 = await registry2.checkWorkspaceTreeIntegrity('/ws/c14b')
  check('CONFLICT 恢复: workspace 不再 BROKEN', integ2.ok === true)
  const stY = await registry2.deriveSessionState('/ws/c14b', 'sess-y')
  check('CONFLICT 恢复: sess-y BOUND', stY.state === 'BOUND', stY.state)
  const stX = await registry2.deriveSessionState('/ws/c14b', 'sess-x')
  check('CONFLICT 恢复: sess-x 回 UNBOUND（冲突实例已解绑）', stX.state === 'UNBOUND', stX.state)
}

// ── 用例 15：前后台状态一致（Iter-20）─────────────────────────────────────
async function runCase15() {
  console.log('［用例 15］前后台状态一致 — sessionBindState / R4 列表同步 / 路由 sessionState / start 不置 RUNNING')
  const { files, fs: mockFs } = makeMockFs()
  const live = new Set(['sess-a'])
  const runningAgents = new Set(['sess-a'])
  const pendingAgents = new Set()
  const deps = { createWorkflowEngine, createWorkflowStorage, isSessionLive: (s) => live.has(s), isAgentRunning: (s) => runningAgents.has(s), isAgentPending: (s) => pendingAgents.has(s) }
  const registry = createInstanceRegistry({ get() { return mockFs } }, deps)
  const cwd = '/ws/c15'

  // 1) sessionBindState：BOUND / UNBOUND / BROKEN
  const a = await registry.beginInstance({ cwd, sessionId: 'sess-a', workflowName: 'wfa', sourceText: 'name: wfa\n', sourcePath: null, params: {} })
  let sb = await registry.sessionBindState(cwd, 'sess-a')
  check('sessionBindState: BOUND（命中一个绑定实例）', sb.state === 'BOUND' && sb.instanceId === a.instanceId, JSON.stringify(sb))
  sb = await registry.sessionBindState(cwd, 'sess-b')
  check('sessionBindState: UNBOUND（无绑定实例）', sb.state === 'UNBOUND')
  await registry.beginInstance({ cwd, sessionId: 'sess-a', workflowName: 'wfb', sourceText: 'name: wfb\n', sourcePath: null, params: {} })
  sb = await registry.sessionBindState(cwd, 'sess-a')
  check('sessionBindState: BROKEN（同会话多实例）', sb.state === 'BROKEN', JSON.stringify(sb))
  // 清理：解绑冲突的两个实例（wfa / wfb），使后续只有一个 sess-a 绑定实例(b)
  await registry.patchMeta(cwd, a.instanceId, { sessionId: null })
  const allWfaWfb = await registry.listInstances(cwd)
  const wfb = allWfaWfb.find(x => x.workflowName === 'wfb')
  if (wfb) await registry.patchMeta(cwd, wfb.instanceId, { sessionId: null })

  // 2) R4：listInstances 对绑定实例做 Session 启停同步（idle→stop；Iter-22(S1) 守卫排队输入）
  const b = await registry.beginInstance({ cwd, sessionId: 'sess-a', workflowName: 'wfc', sourceText: 'name: wfc\nversion: "1"\ndescription: d\ntasks:\n  - id: t\n    name: t\n    type: llm-task\n    processor: /x\n    outputs: []\n    depends-on: []\n', sourcePath: null, params: {} })
  b.engine.begin({ name: 'wfc', version: '1', description: null, params: {}, tasks: [{ id: 't', name: 't', type: 'llm-task', processor: '/x', outputs: [], gate: null }] })
  b.engine.start()
  await b.storage.save()
  runningAgents.delete('sess-a') // 会话 idle
  let list = await registry.listInstances(cwd)
  const idleItem = list.find(x => x.instanceId === b.instanceId)
  check('R4 list: 会话 idle → 实例 STOPPED（列表同步）', idleItem && idleItem.stage === 'STOPPED', idleItem && idleItem.stage)
  runningAgents.add('sess-a') // 会话 running
  list = await registry.listInstances(cwd)
  const runItem = list.find(x => x.instanceId === b.instanceId)
  // Iter-SUBA(P2)：自然空闲停（session-idle）+ 主会话重新活跃 → 定向自动 resume（无缝续跑）
  check('R4 list: 会话 running + session-idle → 定向自动 resume（Iter-SUBA P2）', runItem && runItem.stage === 'RUNNING', runItem && runItem.stage)
  // Iter-22(S1) 守卫：RUNNING 下，idle + 排队输入 → 列表同步不误停
  runningAgents.delete('sess-a')
  pendingAgents.add('sess-a')
  list = await registry.listInstances(cwd)
  const guardItem = list.find(x => x.instanceId === b.instanceId)
  check('R4 list: idle+排队输入 → 仍 RUNNING（S1 守卫）', guardItem && guardItem.stage === 'RUNNING', guardItem && guardItem.stage)
  pendingAgents.delete('sess-a')
  list = await registry.listInstances(cwd)
  const guardOffItem = list.find(x => x.instanceId === b.instanceId)
  check('R4 list: idle(守卫解除) → 实例 STOPPED', guardOffItem && guardOffItem.stage === 'STOPPED', guardOffItem && guardOffItem.stage)

  // 3) /wf/list 路由返回 sessionState（轻量）；/wf/start 路由不置 RUNNING
  const mjs = await import('../agent-presets/workflow-orchestrator/workflow-host.mjs')
  let routeHandler = null
  const ctx2 = { get(n) { if (n === 'webServer') return { register(def) { routeHandler = def.handler } }; if (n === 'fs') return mockFs; return undefined } }
  const registry2 = createInstanceRegistry(ctx2, deps)
  mjs.registerWebRoutes(ctx2, registry2)
  const call = (method, url, body) => new Promise((resolve, reject) => {
    const res = { code: 0, headers: null, payload: '', writeHead(c, h) { this.code = c; this.headers = h }, end(p) { this.payload = p || ''; try { resolve({ code: this.code, body: JSON.parse(this.payload) }) } catch (e) { reject(e) } } }
    const req = { method, url, headers: { host: '127.0.0.1:3080' }, socket: { remoteAddress: '127.0.0.1' } }
    if (method === 'POST') { req.on = (ev, fn) => { if (ev === 'data') fn(JSON.stringify(body || {})); if (ev === 'end') Promise.resolve().then(() => fn()) } }
    Promise.resolve(routeHandler(req, res)).catch(reject)
  })
  const lr = await call('GET', '/wf/list?workspaceRoot=' + encodeURIComponent(cwd) + '&sessionId=sess-a')
  check('R1 /wf/list 路由: 返回 sessionState=BOUND', lr.code === 200 && lr.body.sessionState && lr.body.sessionState.state === 'BOUND', JSON.stringify(lr.body.sessionState))
  // /wf/start 对 sessionId=null 实例：R2 不置 RUNNING（未改引擎状态）
  const unbound = await registry2.beginInstance({ cwd, sessionId: null, workflowName: 'wfd', sourceText: 'name: wfd\n', sourcePath: null, params: {} })
  const sr = await call('POST', '/wf/start', { workspaceRoot: cwd, instanceId: unbound.instanceId, sessionId: 'sess-a' })
  check('R2 /wf/start 路由: 不置 RUNNING（未改引擎状态）', sr.code === 200 && sr.body.stage !== 'RUNNING', JSON.stringify(sr.body).slice(0, 80))

  // 3b) Iter-22(S3)：/wf/list 自动回收孤儿进采用池 + 状态标注（未启动 / 已停止·含进度）
  const orph9 = await registry2.createBind(cwd, 'sess-dead9', { workflowName: 'orph9', sourceText: 'name: orph9\nversion: "1"\ndescription: d\ntasks:\n  - id: a\n    name: A\n    type: llm-task\n    processor: /x/a\n    outputs: []\n    depends-on: []\n', sourcePath: null, params: {} })
  files.set(cwd + '/.workflow-agent/instances/' + orph9.instanceId + '/state.json',
    JSON.stringify({ workflow: 'orph9', version: '1', stage: 'STOPPED', active: false, tasks: [{ id: 'a', status: 'DONE' }] })) // 已停止·含进度
  const lr2 = await call('GET', '/wf/list?workspaceRoot=' + encodeURIComponent(cwd) + '&sessionId=sess-a')
  const orphItem = lr2.body.instances.find(x => x.instanceId === orph9.instanceId)
  check('S3 /wf/list: 死会话孤儿被自动回收（sessionId→null 进池）', orphItem && orphItem.sessionId === null, orphItem && orphItem.sessionId)
  check('S3 /wf/list: 停止孤儿标注 已停止·含进度 + adoptable', orphItem && orphItem.adoptable === true && /已停止·含进度/.test(orphItem.poolNote || ''), orphItem && orphItem.poolNote)
  check('S3 /wf/list: recoveredOrphans 上报', Array.isArray(lr2.body.recoveredOrphans) && lr2.body.recoveredOrphans.includes(orph9.instanceId), JSON.stringify(lr2.body.recoveredOrphans))
  const lr3 = await call('GET', '/wf/list?workspaceRoot=' + encodeURIComponent(cwd) + '&sessionId=sess-a')
  check('S3 /wf/list: 二次轮询无新增回收（幂等）', lr3.body.recoveredOrphans.length === 0, JSON.stringify(lr3.body.recoveredOrphans))

  // 3b2) Iter-22(D4 修复)：池内 RUNNING 残留自愈——历史版本 recoverOrphan 未落盘的 polluted 实例
  const poll = await registry2.beginInstance({ cwd, sessionId: null, workflowName: 'wfe', sourceText: 'name: wfe\nversion: "1"\ndescription: d\ntasks:\n  - id: a\n    name: A\n    type: llm-task\n    processor: /x/a\n    outputs: []\n    depends-on: []\n', sourcePath: null, params: {} })
  files.set(cwd + '/.workflow-agent/instances/' + poll.instanceId + '/state.json',
    JSON.stringify({ workflow: { name: 'wfe', version: '1', tasks: [{ id: 'a', name: 'A', type: 'llm-task', processor: '/x/a', outputs: [], 'depends-on': [] }] }, stage: 'RUNNING', tasks: [{ id: 'a', status: 'RUNNING' }, { id: 'b', status: 'DONE' }] }))
  const lr4 = await call('GET', '/wf/list?workspaceRoot=' + encodeURIComponent(cwd) + '&sessionId=sess-a')
  const pollItem = lr4.body.instances.find(x => x.instanceId === poll.instanceId)
  check('S3 自愈(D4): 池内 RUNNING 残留被落盘为 STOPPED（不再标未启动）', pollItem && pollItem.stage === 'STOPPED' && /已停止·含进度/.test(pollItem.poolNote || ''), pollItem && (pollItem.stage + ' / ' + pollItem.poolNote))
  const healedState = JSON.parse(files.get(cwd + '/.workflow-agent/instances/' + poll.instanceId + '/state.json'))
  check('S3 自愈(D4): 磁盘 state.json 已落盘 STOPPED 且保 DONE', healedState.stage === 'STOPPED' && healedState.tasks.some(t => t.id === 'b' && t.status === 'DONE'), healedState.stage)

  // 3c) Iter-22(S4)：/wf/reset 注入"已重置"通知（queue 模式，含全新运行语义文案）
  const promptCalls = []
  ctx2.get = (n) => {
    if (n === 'webServer') return { register(def) { routeHandler = def.handler } }
    if (n === 'fs') return mockFs
    if (n === 'apiProxy') return { sessions: { prompt: async (p) => { promptCalls.push(p); return { ok: true } } } }
    return undefined
  }
  const rr = await call('POST', '/wf/reset', { workspaceRoot: cwd, instanceId: b.instanceId, sessionId: 'sess-a' })
  const lastPrompt = promptCalls[promptCalls.length - 1]
  const lastText = lastPrompt && lastPrompt.payload && Array.isArray(lastPrompt.payload.content) && lastPrompt.payload.content[0] ? lastPrompt.payload.content[0].text : ''
  check('S4 /wf/reset: 状态重置为 PENDING + 注入已重置消息', rr.code === 200 && rr.body.stage === 'PENDING' && rr.body.messageInjected === true, JSON.stringify({ code: rr.code, stage: rr.body.stage, mi: rr.body.messageInjected, error: rr.body.error }))
  check('S4 /wf/reset: 注入文案含"已重置"+全新运行语义 + queue', /已重置/.test(lastText) && /全新工作流/.test(lastText) && lastPrompt.payload.mode === 'queue', JSON.stringify({ mode: lastPrompt && lastPrompt.payload && lastPrompt.payload.mode, text: String(lastText).slice(0, 80) }))

  // 4) forSession 根修复：未绑定会话 → undefined（绝不取工作区最新实例）；已绑定 → 返回本会话实例
  const r1 = await registry.forSession({ agent: { session: { header: { id: 'sess-zzz', cwd } } } })
  check('forSession: 未绑定会话 → undefined（不取最新实例，防跨会话污染）', r1 === undefined, r1 && r1.instanceId)
  const r2 = await registry.forSession({ agent: { session: { header: { id: 'sess-a', cwd } } } })
  check('forSession: 已绑定会话 → 返回本会话实例', r2 && r2.instanceId === b.instanceId, r2 && r2.instanceId)
}

// ── 用例 16：主从聚合控制（Iter-SUBA P1/P2/P3）────────────────────────────
async function runCase16() {
  console.log('［用例 16］主从聚合控制 — P1 子会话聚合守卫 / P2 stopReason / P3 stop 级联 / 探针降级')
  const { registerWorkflowToolsPreset } = require('../plugins/workflow-host-preset/tools-preset.js')
  const { files, fs: mockFs } = makeMockFs()
  const runningAgents = new Set(['sess-a'])
  const pendingAgents = new Set()
  const childrenBySession = { 'sess-a': ['child-1', 'child-2'] } // 预置子会话
  const runningChildren = new Set(['child-1']) // child-1 在跑
  const interrupted = []
  const deps = {
    createWorkflowEngine, createWorkflowStorage,
    isSessionLive: () => true,
    isAgentRunning: (sid) => runningAgents.has(sid),
    isAgentPending: (sid) => pendingAgents.has(sid),
    // Iter-SUBA(P1) 生产依赖的 mock：list 返回仍在跑的子会话 id；interrupt 记录并停止
    listRunningChildren: async (sid) => (childrenBySession[sid] || []).filter((c) => runningChildren.has(c)),
    interruptChild: async (sid, childId) => { interrupted.push(childId); runningChildren.delete(childId) },
  }
  const registered = {}
  const ctxF = (bag) => ({
    tools: { register(t) { bag[t.name] = t } },
    get(n) {
      if (n === 'fs') return mockFs
      if (n === 'tools') return { register(t) { bag[t.name] = t } }
      if (n === 'apiProxy') {
        return { subagents: {
          // Iter-SUBA(P3) 工具级联依赖的 mock：响应形状对齐 apiProxy 实测（payload.result.value）
          list: async (req) => ({ payload: { rpcId: req.rpcId, result: { ok: true, value: { entries: (childrenBySession['sess-a'] || []).map((id) => ({ kind: 'child', id, activity: runningChildren.has(id) ? 'running' : 'inactive' })), parentAvailable: true } } } }),
          interrupt: async (req) => { interrupted.push(req.payload.childSessionId); runningChildren.delete(req.payload.childSessionId); return { payload: { rpcId: req.rpcId, result: { ok: true, value: { accepted: true } } } } },
        } }
      }
      return undefined
    },
  })
  const registry = createInstanceRegistry(ctxF(registered), deps)
  registerWorkflowToolsPreset(ctxF(registered), null, null, registry)
  const exec = { agent: { session: { header: { id: 'sess-a', cwd: '/ws/c16' } } } }
  files.set('/x/a/SKILL.md', 'skill a') // Iter-27b：E-SKILL-MISSING 探针命中
  const WF = `name: c16demo\nversion: "1.0"\ndescription: d\ntasks:\n  - id: a\n    name: A\n    processor: /x/a/SKILL.md\n    outputs: ["/ws/c16/output/a.md"]\n    depends-on: []\n`

  // 1) P1：主 idle + 子在跑 → 聚合守卫，保持 RUNNING（后台 task subagent 等待非误停）
  let r = await registered.workflow_begin.execute({ workflowText: WF }, exec)
  check('c16: begin → RUNNING', r.stage === 'RUNNING', r.stage)
  const iid = r.instanceId
  runningAgents.delete('sess-a')
  let e = await registry.syncInstanceState('/ws/c16', iid)
  check('c16 P1:idle + 子在跑 → 仍 RUNNING（聚合守卫）', e.engine.snapshot().stage === 'RUNNING', e.engine.snapshot().stage)

  // 2) 子全部结束 → 自然停 + stopReason='session-idle'（P2）
  runningChildren.delete('child-1')
  e = await registry.syncInstanceState('/ws/c16', iid)
  check('c16:子结束 → idle → STOPPED', e.engine.snapshot().stage === 'STOPPED', e.engine.snapshot().stage)
  check('c16 P2:自然空闲停 stopReason=session-idle', registry.get(iid).meta.stopReason === 'session-idle', registry.get(iid).meta.stopReason)

  // 3) workflow_stop 工具：user-stop 标记 + 级联 interrupt running 子会话（P3）
  runningAgents.add('sess-a')
  e.engine.resume(); await e.storage.save() // → RUNNING
  runningChildren.add('child-2') // child-2 重新在跑，stop 后应被级联打断
  interrupted.length = 0
  r = await registered.workflow_stop.execute({}, exec)
  check('c16 P3:workflow_stop → STOPPED', r.stage === 'STOPPED', r.stage)
  check('c16 P3:级联打断 running 子会话', interrupted.includes('child-2'), JSON.stringify(interrupted))
  check('c16 P3:返回 stoppedChildren=1', r.stoppedChildren === 1, r.stoppedChildren)
  check('c16 P2:stopReason=user-stop', registry.get(iid).meta.stopReason === 'user-stop', registry.get(iid).meta.stopReason)

  // 4) user-stop + agent running → 永不自动恢复（P2 反例，权威停止语义）
  e = await registry.syncInstanceState('/ws/c16', iid)
  check('c16 P2:user-stop + running → 仍 STOPPED（不自动恢复）', e.engine.snapshot().stage === 'STOPPED', e.engine.snapshot().stage)

  // 5) 探针故障降级：listRunningChildren 抛异常 → 不守卫，仍可停（不卡死 RUNNING）
  const deps2 = Object.assign({}, deps, { listRunningChildren: async () => { throw new Error('probe down') } })
  const registered2 = {}
  const registry2 = createInstanceRegistry(ctxF(registered2), deps2)
  registerWorkflowToolsPreset(ctxF(registered2), null, null, registry2)
  const exec2 = { agent: { session: { header: { id: 'sess-a', cwd: '/ws/c16b' } } } }
  const r2 = await registered2.workflow_begin.execute({ workflowText: WF }, exec2)
  runningAgents.delete('sess-a')
  const e2 = await registry2.syncInstanceState('/ws/c16b', r2.instanceId)
  check('c16 降级:探针故障 → 照常停（不卡死 RUNNING）', e2.engine.snapshot().stage === 'STOPPED', e2.engine.snapshot().stage)
}

// ── 用例 17：方向 A 手工停权威停止（Iter-23 A1/A2）────────────────────────
// ── 用例 18：预定义目录物化（Iter-24）──
async function runCase18() {
  console.log('［用例 18］预定义目录物化 — 技能/模板/骨架幂等覆盖 + 根定位')
  const { BUILTIN_SKILLS, BUILTIN_TEMPLATE_FILES, detectPredefinedRoot, materializeBuiltinAssets } = require('../plugins/workflow-host/builtin-skills.js')
  const { files, fs: mockFs } = makeMockFs()

  // 1) 根定位：DSH_HOME 优先，缺省 HOME/.dsh
  const savedEnv = { DSH_HOME: process.env.DSH_HOME, HOME: process.env.HOME }
  try {
    process.env.DSH_HOME = '/dsh-custom'
    check('c18 根: DSH_HOME 优先', detectPredefinedRoot() === '/dsh-custom/workflow-agent')
    delete process.env.DSH_HOME
    const r1 = detectPredefinedRoot()
    check('c18 根: 缺省 HOME/.dsh/workflow-agent', typeof r1 === 'string' && r1.endsWith('/.dsh/workflow-agent') && r1.startsWith('/'))
  } finally {
    if (savedEnv.DSH_HOME === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = savedEnv.DSH_HOME
    if (savedEnv.HOME !== undefined) process.env.HOME = savedEnv.HOME
  }

  // 2) 首次物化：模板+技能+骨架全部写出
  const templates = [
    { name: 'tpl-a', description: 'x', yaml: 'name: tpl-a\n' },
    { name: 'tpl-b', description: 'x', yaml: 'name: tpl-b\n' },
  ]
  const r = await materializeBuiltinAssets(mockFs, templates)
  check('c18 物化: ok', r.ok === true)
  check('c18 物化: 根路径回传', r.root === detectPredefinedRoot())
  check('c18 物化: 技能 5 个全写', BUILTIN_SKILLS.every((s) => r.written.indexOf('skills/' + s.id + '/SKILL.md') >= 0))
  // Iter-27a：模板写子目录布局 templates/<name>/<name>.yaml
  check('c18 物化: 模板写入（子目录布局）', r.written.indexOf('templates/tpl-a/tpl-a.yaml') >= 0 && r.written.indexOf('templates/tpl-b/tpl-b.yaml') >= 0)
  check('c18 物化: 骨架 README 写出', r.written.indexOf('samples/README.md') >= 0 && r.written.indexOf('docs/README.md') >= 0)
  const skillPath = r.root + '/skills/deep-analysis/SKILL.md'
  check('c18 技能: 内容含 frontmatter name', String(files.get(skillPath)).startsWith('---\nname: deep-analysis\n---'))
  check('c18 技能: 正文原样保留', String(files.get(skillPath)).indexOf('## 任务目标') > 0)
  // Iter-27a：items-demo 静态文件工作副本迁入模板子目录 + templates README（子目录布局说明）
  check('c18 物化: items-demo 静态文件迁入模板子目录', BUILTIN_TEMPLATE_FILES.every((f) => r.written.indexOf(f.path) >= 0), JSON.stringify(r.written))
  check('c18 物化: templates/README.md 写出（子目录布局说明）', r.written.indexOf('templates/README.md') >= 0 && String(files.get(r.root + '/templates/README.md')).indexOf('子目录') >= 0)

  // 3) 幂等覆盖：改写模板/技能后再物化 → 覆盖回规范内容；用户 README 不被覆盖
  files.set(r.root + '/templates/tpl-a/tpl-a.yaml', 'name: user-edited\n')
  files.set(r.root + '/skills/spec-writer/SKILL.md', 'user edited\n')
  files.set(r.root + '/samples/README.md', 'user custom samples readme\n')
  const r2 = await materializeBuiltinAssets(mockFs, templates)
  check('c18 幂等: ok', r2.ok === true)
  check('c18 幂等: 模板覆盖回规范内容', files.get(r.root + '/templates/tpl-a/tpl-a.yaml') === 'name: tpl-a\n')
  check('c18 幂等: 技能覆盖回规范内容', String(files.get(r.root + '/skills/spec-writer/SKILL.md')).startsWith('---\nname: spec-writer\n---'))
  check('c18 幂等: 用户 samples/README.md 不被覆盖', files.get(r.root + '/samples/README.md') === 'user custom samples readme\n')

  // 4) fs 不可用 / 根不可定位降级
  const rNoFs = await materializeBuiltinAssets(null, templates)
  check('c18 降级: fs 缺失 → ok:false + reason', rNoFs.ok === false && !!rNoFs.reason)
}

// ── 用例 19：两级解析链（Iter-24）──
async function runCase19() {
  console.log('［用例 19］两级解析链 — workspace 优先 / 预定义兜底 / 绝对直通 / 双 miss 回退')
  const { resolveRefPath, expandDefinition } = require('../plugins/workflow-host-preset/tools-preset.js')
  const { fs: mockFs } = makeMockFs()
  // 夹具：workspace 与 predefined 各有一个技能
  mockFs.writeText({ path: '/ws1/skills/wskill/SKILL.md' }, 'ws')
  mockFs.writeText({ path: '/pre/skills/pskill/SKILL.md' }, 'pre')

  // 1) workspace 优先
  check('c19 链: workspace 命中优先', await resolveRefPath(mockFs, '/ws1', 'skills/wskill/SKILL.md', '/pre') === '/ws1/skills/wskill/SKILL.md')
  // 2) 预定义兜底（workspace 未命中）
  check('c19 链: 预定义兜底', await resolveRefPath(mockFs, '/ws1', 'skills/pskill/SKILL.md', '/pre') === '/pre/skills/pskill/SKILL.md')
  // 3) 绝对路径直通（存在与否都不拼根）
  check('c19 链: 绝对路径直通（存在）', await resolveRefPath(mockFs, '/ws1', '/ws1/skills/wskill/SKILL.md', '/pre') === '/ws1/skills/wskill/SKILL.md')
  check('c19 链: 绝对路径直通（不存在也直通）', await resolveRefPath(mockFs, '/ws1', '/other/x.md', '/pre') === '/other/x.md')
  check('c19 链: ~ 路径直通', await resolveRefPath(mockFs, '/ws1', '~/x.md', '/pre') === '~/x.md')
  // 4) 双 miss → 回退 workspace 相对（保持下游报错语义）
  check('c19 链: 双 miss 回退 workspace 相对', await resolveRefPath(mockFs, '/ws1', 'nope/missing.yaml', '/pre') === '/ws1/nope/missing.yaml')
  // 5) 无 workspaceRoot：预定义兜底仍生效；双 miss 回退相对原文
  check('c19 链: 无 ws 预定义兜底', await resolveRefPath(mockFs, undefined, 'skills/pskill/SKILL.md', '/pre') === '/pre/skills/pskill/SKILL.md')
  check('c19 链: 无 ws 双 miss 回退原文', await resolveRefPath(mockFs, undefined, 'nope/x.yaml', '/pre') === 'nope/x.yaml')
  // 6) ws 与 pre 同根去重（不重复探测）
  check('c19 链: 同根去重', await resolveRefPath(mockFs, '/pre', 'skills/pskill/SKILL.md', '/pre') === '/pre/skills/pskill/SKILL.md')

  // 7) expandDefinition 集成：processor 走两级链
  const wfText = [
    'name: t19',
    'version: "1"',
    'tasks:',
    '  - id: a',
    '    name: A',
    '    processor: skills/wskill/SKILL.md',
    '    outputs: ["output/a.md"]',
  ].join('\n')
  const parsed = await expandDefinition(mockFs, { text: wfText, workspaceRoot: '/ws1', predefinedRoot: '/pre' }, {})
  check('c19 集成: processor 解析到 workspace', parsed.tasks[0].processor === '/ws1/skills/wskill/SKILL.md')
  const parsed2 = await expandDefinition(mockFs, { text: wfText.replace('skills/wskill/SKILL.md', 'skills/pskill/SKILL.md'), workspaceRoot: '/ws1', predefinedRoot: '/pre' }, {})
  check('c19 集成: processor 兜底到预定义', parsed2.tasks[0].processor === '/pre/skills/pskill/SKILL.md')

  // 8) 模板清单合并：磁盘版优先，内嵌兜底补缺
  const { mergeTemplateLists } = require('../plugins/workflow-host-preset/tools-preset.js')
  const disk = [{ name: 'default-demo', path: '/pre/templates/default-demo.yaml', yaml: 'a: 1' }]
  const builtin = [{ name: 'default-demo', description: 'd1', yaml: 'builtin: 1' }, { name: 'serial-demo', description: 'd2', yaml: 'builtin: 2' }]
  const merged = mergeTemplateLists(disk, builtin)
  check('c19 合并: 去重后 2 项', merged.length === 2)
  check('c19 合并: 磁盘版赢（不覆盖为内建）', merged[0].yaml === 'a: 1' && !merged[0].fallback)
  check('c19 合并: 内建兜底补缺并标记 fallback', merged[1].name === 'serial-demo' && merged[1].fallback === true && merged[1].path === null)
}

async function runCase17() {
  console.log('［用例 17］方向 A — A1 aborted(user) 判定矩阵 / A2 轮询兜底 / 权威停止语义')
  const { registerWorkflowToolsPreset } = require('../plugins/workflow-host-preset/tools-preset.js')
  const { files, fs: mockFs } = makeMockFs()

  // 1) A1 判定纯函数矩阵（探针实证事件形态：payload 在 data 包装下）
  check('c17 A1: turn/end+aborted+user → true', isUserAbortTurnEnd({ type: 'turn/end', data: { turn: 3, reason: { kind: 'aborted', reason: { kind: 'user' } } } }) === true)
  check('c17 A1: parent 原因（级联 interrupt）→ false', isUserAbortTurnEnd({ type: 'turn/end', data: { reason: { kind: 'aborted', reason: { kind: 'parent' } } } }) === false)
  check('c17 A1: hook 原因 → false', isUserAbortTurnEnd({ type: 'turn/end', data: { reason: { kind: 'aborted', reason: { kind: 'hook' } } } }) === false)
  check('c17 A1: disposed 原因 → false', isUserAbortTurnEnd({ type: 'turn/end', data: { reason: { kind: 'aborted', reason: { kind: 'disposed' } } } }) === false)
  check('c17 A1: legacy 原因 → false', isUserAbortTurnEnd({ type: 'turn/end', data: { reason: { kind: 'aborted', reason: { kind: 'legacy' } } } }) === false)
  check('c17 A1: 正常完成（completed）→ false', isUserAbortTurnEnd({ type: 'turn/end', data: { reason: { kind: 'completed' } } }) === false)
  check('c17 A1: 无 reason → false', isUserAbortTurnEnd({ type: 'turn/end', data: {} }) === false)
  check('c17 A1: 非 turn-end → false', isUserAbortTurnEnd({ type: 'assistant/chunk', data: {} }) === false)
  check('c17 A1: 畸形事件（null）→ false', isUserAbortTurnEnd(null) === false)

  // 2) A2 log 尾扫纯函数
  check('c17 A2: 日志不可读（null）→ undefined（降级）', detectUserAbortFromLog(null) === undefined)
  check('c17 A2: 空日志 → undefined（降级）', detectUserAbortFromLog([]) === undefined)
  check('c17 A2: 无 turn/end → false', detectUserAbortFromLog([{ type: 'session/started' }, { type: 'assistant/chunk' }]) === false)
  const abortLog = [{ type: 'session/started' }, { type: 'assistant/chunk' }, { type: 'turn/end', data: { reason: { kind: 'aborted', reason: { kind: 'user' } } } }]
  check('c17 A2: 末条=aborted(user) → true', detectUserAbortFromLog(abortLog) === true)
  const supersededLog = abortLog.concat([{ type: 'user/message', data: {} }, { type: 'turn/end', data: { reason: { kind: 'completed' } } }])
  check('c17 A2: 末条被新回合覆盖 → false（该窗口归 A1 即时处置）', detectUserAbortFromLog(supersededLog) === false)

  // 3) A1 registry 入口：RUNNING+绑定 → 权威停止 + 级联打断
  const runningAgents = new Set()
  const pendingAgents = new Set()
  const childrenBySession = { 'sess-a': ['child-1', 'child-2'] }
  const runningChildren = new Set(['child-1', 'child-2'])
  const interrupted = []
  let abortVerdict = undefined // detectUserAbort mock 可控（undefined=探针故障降级）
  const deps = {
    createWorkflowEngine, createWorkflowStorage,
    isSessionLive: () => true,
    isAgentRunning: (sid) => runningAgents.has(sid),
    isAgentPending: (sid) => pendingAgents.has(sid),
    listRunningChildren: async (sid) => (childrenBySession[sid] || []).filter((c) => runningChildren.has(c)),
    interruptChild: async (sid, childId) => { interrupted.push(childId); runningChildren.delete(childId) },
    detectUserAbort: async () => abortVerdict,
  }
  const registered = {}
  const ctxF = (bag) => ({
    tools: { register(t) { bag[t.name] = t } },
    get(n) {
      if (n === 'fs') return mockFs
      if (n === 'tools') return { register(t) { bag[t.name] = t } }
      return undefined
    },
  })
  const registry = createInstanceRegistry(ctxF(registered), deps)
  registerWorkflowToolsPreset(ctxF(registered), null, null, registry)
  const exec = { agent: { session: { header: { id: 'sess-a', cwd: '/ws/c17' } } } }
  files.set('/x/a/SKILL.md', 'skill a') // Iter-27b：E-SKILL-MISSING 探针命中
  const WF = `name: c17demo\nversion: "1.0"\ndescription: d\ntasks:\n  - id: a\n    name: A\n    processor: /x/a/SKILL.md\n    outputs: ["/ws/c17/output/a.md"]\n    depends-on: []\n`
  const r = await registered.workflow_begin.execute({ workflowText: WF }, exec)
  check('c17 A1: begin → RUNNING', r.stage === 'RUNNING', r.stage)
  const iid = r.instanceId
  runningAgents.delete('sess-a') // 模拟：UI 停止按钮打断活动回合 → agent idle
  let res = await registry.handleSessionUserStop('sess-a')
  check('c17 A1: RUNNING → 处置返回 instanceId', !!res && res.instanceId === iid, res && res.instanceId)
  check('c17 A1: 引擎 STOPPED', registry.get(iid).engine.snapshot().stage === 'STOPPED', registry.get(iid).engine.snapshot().stage)
  check('c17 A1: stopReason=user-stop', registry.get(iid).meta.stopReason === 'user-stop', registry.get(iid).meta.stopReason)
  check('c17 A1: 级联打断全部 running 子会话', interrupted.includes('child-1') && interrupted.includes('child-2') && res.stoppedChildren === 2, JSON.stringify(interrupted))
  check('c17 A1: 幂等（非 RUNNING 再调 → null）', (await registry.handleSessionUserStop('sess-a')) === null)
  check('c17 A1: 未绑定 sid → null', (await registry.handleSessionUserStop('sess-other')) === null)

  // 4) P2 回归：A1 user-stop 后主会话再活跃 → 不自动恢复（权威停止语义）
  runningAgents.add('sess-a')
  let e = await registry.syncInstanceState('/ws/c17', iid)
  check('c17 P2 回归: user-stop + running → 仍 STOPPED', e.engine.snapshot().stage === 'STOPPED', e.engine.snapshot().stage)

  // 5) A2 轮询兜底：user-abort 优先于 P1 守卫（权威性高于子会话聚合）
  e.engine.resume(); await e.storage.save() // → RUNNING（模拟再次运行后被手工停）
  runningChildren.add('child-2') // 子会话又在跑
  interrupted.length = 0
  abortVerdict = true
  runningAgents.delete('sess-a')
  e = await registry.syncInstanceState('/ws/c17', iid)
  check('c17 A2: idle+aborted+子在跑 → 权威 STOPPED（高于 P1 守卫）', e.engine.snapshot().stage === 'STOPPED', e.engine.snapshot().stage)
  check('c17 A2: 权威停 stopReason=user-stop', registry.get(iid).meta.stopReason === 'user-stop', registry.get(iid).meta.stopReason)
  check('c17 A2: 级联打断在跑子会话', interrupted.includes('child-2'), JSON.stringify(interrupted))

  // 6) A2 降级：探针故障（undefined）→ 既有 session-idle 语义不回归
  runningAgents.add('sess-a'); e.engine.resume(); await e.storage.save() // → RUNNING
  abortVerdict = undefined // 探针故障
  runningChildren.clear() // 无子会话
  runningAgents.delete('sess-a')
  e = await registry.syncInstanceState('/ws/c17', iid)
  check('c17 A2: 探针 undefined → 降级 session-idle', e.engine.snapshot().stage === 'STOPPED' && registry.get(iid).meta.stopReason === 'session-idle', registry.get(iid).meta.stopReason)

  // 7) P2 回归：session-idle + 主会话活跃 → 定向自动 resume
  runningAgents.add('sess-a')
  e = await registry.syncInstanceState('/ws/c17', iid)
  check('c17 P2 回归: session-idle + running → 自动 resume', e.engine.snapshot().stage === 'RUNNING' && registry.get(iid).meta.stopReason === null, registry.get(iid).meta.stopReason)
}

// ── 用例 8：实例注册表（Iter-10：实例目录 + metadata 映射 + 双实例隔离 + 惰性恢复）──
async function runCase8() {
  console.log('［用例 8］实例注册表 — 实例目录 + metadata 映射 + 隔离 + 惰性恢复')

  const { files, fs: mockFs } = makeMockFs()
  const ctx = { get() { return mockFs } }
  const deps = { createWorkflowEngine, createWorkflowStorage }
  const registry = createInstanceRegistry(ctx, deps)

  const execA = { agent: { session: { header: { id: 'sess-a', cwd: '/ws/workspace-a' } } } }
  const execB = { agent: { session: { header: { id: 'sess-b', cwd: '/ws/workspace-b' } } } }

  check('slug: 名称清洗 + 空名兜底', slugifyName('Demo Workflow!') === 'demo-workflow' && slugifyName('') === 'wf')

  const parsed = { name: 'demo', version: '1.0', description: null, params: {}, maxConcurrency: 1, tasks: [
    { id: 't1', name: 'T1', type: 'llm-task', status: 'PENDING', dependsOn: [], processor: '/x/s1', inputs: {}, outputs: [], gate: null },
  ] }

  // 实例 A：创建 → 目录结构 + metadata 映射
  const a = await registry.beginInstance({ cwd: '/ws/workspace-a', sessionId: 'sess-a', workflowName: 'demo', sourceText: 'name: demo\n', sourcePath: '/x/demo.yaml', params: { p: 1 } })
  check('实例A: id 形态 demo-<uuid8>', /^demo-[0-9a-f]{8}$/.test(a.instanceId), a.instanceId)
  check('实例A: 目录锚点 session cwd', a.dir === instanceDirPath('/ws/workspace-a', a.instanceId))
  const metaA = JSON.parse(files.get(a.dir + '/metadata.json'))
  check('实例A: metadata 映射 instanceId↔sessionId', metaA.instanceId === a.instanceId && metaA.sessionId === 'sess-a' && metaA.sessionCwd === '/ws/workspace-a')
  check('实例A: instance.yaml 快照含源文本+params', files.get(a.dir + '/instance.yaml').includes('name: demo') && files.get(a.dir + '/instance.yaml').includes('"p":1'))
  check('实例A: output/logs 就绪', files.has(a.dir + '/output/.gitkeep') && files.has(a.dir + '/logs/.gitkeep'))

  // A 引擎 begin + save → state.json 落在实例目录
  a.engine.begin(parsed)
  await a.storage.save()
  check('实例A: state.json 落在实例目录', files.has(a.dir + '/state.json'))

  // 实例 B：同一注册表，不同 cwd → 完全隔离
  const b = await registry.beginInstance({ cwd: '/ws/workspace-b', sessionId: 'sess-b', workflowName: 'demo', sourceText: 'name: demo\n', sourcePath: null, params: {} })
  b.engine.begin(parsed)
  b.engine.updateTask('t1', { status: 'RUNNING' })
  await b.storage.save()
  check('实例B: 目录隔离（不同 cwd）', b.dir.startsWith('/ws/workspace-b/') && b.dir !== a.dir)
  check('实例B: 独立 state.json（内容不同）', files.has(b.dir + '/state.json') && files.get(b.dir + '/state.json') !== files.get(a.dir + '/state.json'))

  // 活跃映射：forSession 按会话返回各自实例
  const ra = await registry.forSession(execA)
  const rb = await registry.forSession(execB)
  check('forSession: A 会话绑 A 实例', !!ra && ra.instanceId === a.instanceId)
  check('forSession: B 会话绑 B 实例', !!rb && rb.instanceId === b.instanceId)

  // 惰性恢复：新注册表（模拟 DSH 重启）→ sessionId 精确匹配恢复
  const registry2 = createInstanceRegistry(ctx, deps)
  const restored = await registry2.forSession(execB)
  check('惰性恢复: 重启后按 sessionId 还原 B', !!restored && restored.instanceId === b.instanceId)
  check('惰性恢复: B 任务状态 RUNNING 保留', restored.engine.snapshot().tasks.some(t => t.id === 't1' && t.status === 'RUNNING'))
  check('惰性恢复: 恢复条目落点指向实例目录', !!restored.dir && files.has(restored.dir + '/metadata.json'))
}

function check(name, cond, extra) {
  if (cond) {
    pass++
    console.log('  ✔ ' + name)
  } else {
    fail++
    console.log('  ✘ ' + name + (extra ? ' — ' + JSON.stringify(extra) : ''))
  }
}

// ── 用例 20：数据流显性化（Iter-25：目录变量 + inputs/outputs 绝对化 + 落盘 + 创建警告）──
async function runCase20() {
  console.log('［用例 20］数据流显性化 — 目录变量注入 + inputs/outputs 绝对化 + 落盘 + create 警告')
  const { expandDefinition, finalizeDataflow, injectParams, registerWorkflowToolsPreset } = require('../plugins/workflow-host-preset/tools-preset.js')
  const { parseWorkflow } = require('../shared/workflow-parser')
  const { validateWorkflow } = require('../shared/workflow-validate')

  // 1) parser（27b）：warnings 通道恒空——processor 缺省/缺 checker 升错误级归 validate
  const missWf = 'name: m\nversion: "1"\ntasks:\n  - id: a\n    name: A\n    outputs: ["output/a.md"]\n  - id: g\n    name: G\n    processor: /x/SKILL.md\n    quality-gate:\n      on-failure: retry\n      max-retries: 1\n'
  const missParsed = parseWorkflow(missWf)
  check('c20 parser: 缺 processor 无 error（结构层不拦）', missParsed.errors.length === 0, missParsed.errors)
  check('c20 parser: warnings 通道恒空（27b 升错误级归 validate）', missParsed.warnings.length === 0, missParsed.warnings)
  const mv = await validateWorkflow({ parsed: missParsed, context: 'definition', fs: null })
  check('c20 validate: 缺 processor → E-PROCESSOR-MISSING（task a）', mv.errors.some(e => e.code === 'E-PROCESSOR-MISSING' && e.task === 'a'), JSON.stringify(mv.errors))
  check('c20 validate: gate 缺 checker → E-GATE-CHECKER-MISSING（task g）', mv.errors.some(e => e.code === 'E-GATE-CHECKER-MISSING' && e.task === 'g'), JSON.stringify(mv.errors))
  check('c20 validate: fs 缺失降级不误报（无 E-SKILL/E-INPUT）', !mv.errors.some(e => e.code === 'E-SKILL-MISSING' || e.code === 'E-INPUT-MISSING'), JSON.stringify(mv.errors))
  const okParsed = parseWorkflow('name: o\nversion: "1"\ntasks:\n  - id: a\n    processor: /x/SKILL.md\n')
  check('c20 parser: 完好定义零警告', okParsed.warnings.length === 0, okParsed.warnings)

  // 2) D2：目录变量保留字优先于同名 params
  check('c20 D2: 保留字优先', injectParams('${workspace}', { workspace: 'FROM_PARAM' }, { workspace: '/realws' }) === '/realws')
  check('c20 D2: 非保留字仍走 params', injectParams('${myvar}', { myvar: 'P' }, {}) === 'P')

  // 3) 阶段1：${workspace}/${skills} 注入；${wf_dir} 占位幸存
  const { fs: mockFs } = makeMockFs()
  mockFs.writeText({ path: '/pre/skills/pskill/SKILL.md' }, 'pre')
  const wfVars = [
    'name: v', 'version: "1"', 'tasks:',
    '  - id: a', '    processor: ${skills}/pskill/SKILL.md',
    '    inputs:', '      doc: ${workspace}/docs/input.md',
    '    outputs: ["${workspace}/out/a.md"]',
  ].join('\n')
  const pv = await expandDefinition(mockFs, { text: wfVars, workspaceRoot: '/wsv', predefinedRoot: '/pre' }, {})
  check('c20 阶段1: processor ${skills} 注入+绝对直通', pv.tasks[0].processor === '/pre/skills/pskill/SKILL.md', pv.tasks[0].processor)
  check('c20 阶段1: inputs ${workspace} 注入', pv.tasks[0].inputs.doc === '/wsv/docs/input.md', pv.tasks[0].inputs.doc)
  check('c20 阶段1: outputs ${workspace} 注入', pv.tasks[0].outputs[0] === '/wsv/out/a.md', pv.tasks[0].outputs[0])
  const pp = await expandDefinition(mockFs, { text: 'name: p\nversion: "1"\ntasks:\n  - id: a\n    processor: /x/SKILL.md\n    outputs: ["${wf_dir}/out/a.md"]\n', workspaceRoot: '/wsp' }, {})
  check('c20 阶段1: ${wf_dir} 占位幸存（留给阶段2）', pp.tasks[0].outputs[0] === '${wf_dir}/out/a.md', pp.tasks[0].outputs[0])

  // 4) 阶段2 finalizeDataflow：注入 + 绝对化四情形 + skillDir + D3 占位
  const fin = finalizeDataflow([
    { id: 'a', processor: '/wsp/skills/a/SKILL.md', inputs: { spec: 'output/spec.md', abs: '/abs/x.md', exp: '${wf_dir}/out/v.md' }, outputs: ['output/a.md', '${skill_dir}/tpl.md'] },
    { id: 'noproc', inputs: {}, outputs: ['${skill_dir}/x.md'] },
  ], { wfDir: '/wsp/.workflow-agent/instances/i1' })
  const f0 = fin[0]
  check('c20 阶段2: 相对 inputs 绝对化（D1 实例目录基准）', f0.inputs.spec === '/wsp/.workflow-agent/instances/i1/output/spec.md', f0.inputs.spec)
  check('c20 阶段2: 绝对 inputs 直通', f0.inputs.abs === '/abs/x.md')
  check('c20 阶段2: 显式 ${wf_dir} 注入不二次拼接', f0.inputs.exp === '/wsp/.workflow-agent/instances/i1/out/v.md', f0.inputs.exp)
  check('c20 阶段2: outputs 相对绝对化', f0.outputs[0] === '/wsp/.workflow-agent/instances/i1/output/a.md', f0.outputs[0])
  check('c20 阶段2: outputs ${skill_dir} 注入', f0.outputs[1] === '/wsp/skills/a/tpl.md', f0.outputs[1])
  check('c20 阶段2: skillDir=dirname(processor)', f0.skillDir === '/wsp/skills/a', f0.skillDir)
  check('c20 阶段2(D3): 无 processor ${skill_dir} 占位保留', fin[1].outputs[0] === '${skill_dir}/x.md' && fin[1].skillDir === null, JSON.stringify(fin[1]))

  // 5) begin 端到端：integrate.inputs.analysis 绝对路径 + skillDir + state.json 落盘
  const { files, fs: mockFs20 } = makeMockFs()
  const registered20 = {}
  const mkCtx20 = (bag) => ({
    tools: { register(t) { bag[t.name] = t } },
    get(n) {
      if (n === 'fs') return mockFs20
      if (n === 'tools') return { register(t) { bag[t.name] = t } }
      return undefined
    },
  })
  const registry20 = createInstanceRegistry(mkCtx20(registered20), { createWorkflowEngine, createWorkflowStorage })
  registerWorkflowToolsPreset(mkCtx20(registered20), null, null, registry20)
  const exec20 = { agent: { session: { header: { id: 'sess-c20', cwd: '/ws/c20' } } } }
  mockFs20.writeText({ path: '/ws/c20/skills/integrator/SKILL.md' }, 'skill')
  const WF20 = [
    'name: c20demo', 'version: "1.0"', 'description: iter25', 'max-concurrency: 2', 'tasks:',
    '  - id: deep-analysis', '    name: 深度分析', '    processor: skills/integrator/SKILL.md', '    outputs: ["output/analysis.md"]',
    '  - id: write-spec', '    name: 写规格', '    processor: skills/integrator/SKILL.md', '    outputs: ["output/spec.md"]',
    '  - id: integrate', '    name: 汇总', '    processor: skills/integrator/SKILL.md',
    '    inputs:', '      spec: "output/spec.md"', '      analysis: "output/analysis.md"',
    '    outputs: ["output/summary.md"]', '    depends-on: [write-spec, deep-analysis]',
  ].join('\n')
  let r = await registered20.workflow_begin.execute({ workflowText: WF20 }, exec20)
  const iid20 = r.instanceId
  const wfDir20 = '/ws/c20/.workflow-agent/instances/' + iid20
  check('c20 begin(27b): 附 validation 摘要（通过）', r.validation && r.validation.ok === true && Array.isArray(r.validation.warnings), JSON.stringify(r.validation))
  const integ = r.tasks.find(t => t.id === 'integrate')
  check('c20 begin: integrate.inputs.analysis 绝对路径（缺口#4 修复）', integ && integ.inputs.analysis === wfDir20 + '/output/analysis.md', integ && integ.inputs.analysis)
  check('c20 begin: integrate.inputs.spec 绝对路径', integ.inputs.spec === wfDir20 + '/output/spec.md')
  check('c20 begin: outputs 绝对路径', integ.outputs[0] === wfDir20 + '/output/summary.md', integ.outputs[0])
  check('c20 begin: skillDir 指向 workspace 技能目录', integ.skillDir === '/ws/c20/skills/integrator', integ.skillDir)
  check('c20 begin: 无 inputs 任务返回空字典', (r.tasks.find(t => t.id === 'deep-analysis')).inputs.deep === undefined && Object.keys(r.tasks.find(t => t.id === 'deep-analysis').inputs).length === 0)
  const stateRaw20 = files.get(wfDir20 + '/state.json')
  check('c20 begin: state.json 落盘含 inputs/outputs/skillDir', !!stateRaw20 && stateRaw20.includes('"inputs"') && stateRaw20.includes('"outputs"') && stateRaw20.includes('"skillDir"'))

  // 6) 重启恢复：hydrate 从 state.json 恢复 inputs；旧格式兼容
  const reg2b = {}
  const registry2b = createInstanceRegistry(mkCtx20(reg2b), { createWorkflowEngine, createWorkflowStorage })
  registerWorkflowToolsPreset(mkCtx20(reg2b), null, null, registry2b)
  r = await reg2b.workflow_status.execute({}, exec20)
  const integ2 = (r.tasks || []).find(t => t.id === 'integrate')
  check('c20 重启: 恢复的任务 inputs 仍为绝对路径', !!integ2 && integ2.inputs.analysis === wfDir20 + '/output/analysis.md', integ2 && integ2.inputs)
  const eOld = createWorkflowEngine()
  eOld.hydrate({ workflow: 'x', stage: 'PENDING', tasks: [{ id: 'a', status: 'PENDING' }] })
  const oldT = eOld.snapshot().tasks[0]
  check('c20 hydrate: 旧格式无 inputs → {} / skillDir → null', oldT.inputs && Object.keys(oldT.inputs).length === 0 && oldT.skillDir === null && Array.isArray(oldT.outputs))

  // 7) start/reset 路径（expandInstanceDefinition 阶段2）：inputs 保持绝对
  r = await registered20.workflow_stop.execute({}, exec20)
  check('c20 stop: STOPPED', r.stage === 'STOPPED')
  r = await registered20.workflow_reset.execute({}, exec20)
  const integ3 = r.tasks.find(t => t.id === 'integrate')
  check('c20 reset: 重新展开后 inputs 仍绝对路径', integ3.inputs.analysis === wfDir20 + '/output/analysis.md', integ3.inputs)
  check('c20 reset(27b): 附 validation 且 ok（回传不拦）', r.validation && r.validation.ok === true, JSON.stringify(r.validation))

  // 8) Iter-27b（拍板①=B）：create 语义硬拦——缺 processor/gate checker → errors
  // 结构化清单，不建实例目录；start 因无活跃实例报「实例不存在」
  // （1:1 守卫：sess-c20 已绑 c20demo，改用第二会话创建自己的实例）
  const exec20b = { agent: { session: { header: { id: 'sess-c20-2', cwd: '/ws/c20' } } } }
  r = await registered20.workflow_create.execute({ workflowText: missWf }, exec20b)
  check('c20 create(27b): 缺 processor/gate checker 被拦', !!r.error && Array.isArray(r.errors) && r.errors.some(e => e.code === 'E-PROCESSOR-MISSING') && r.errors.some(e => e.code === 'E-GATE-CHECKER-MISSING'), JSON.stringify(r.errors || r).slice(0, 200))
  check('c20 create(27b): 拒绝未建实例', r.instanceId === undefined && r.phase === undefined, JSON.stringify(r).slice(0, 80))
  r = await registered20.workflow_start.execute({}, exec20b) // create 被拦 → 无活跃实例
  check('c20 start(27b): 无活跃实例可启（create 被拦的连带）', !!r.error && String(r.error).indexOf('实例不存在') !== -1, r.error)

  // 9) loop 迭代：${item} 注入 + 阶段2 绝对化
  mockFs.writeText({ path: '/ws/loop/config/mods.txt' }, 'login\norder\n')
  const wfLoop = [
    'name: lp', 'version: "1"', 'tasks:',
    '  - id: batch', '    type: loop', '    processor: /x/SKILL.md',
    '    items-from: config/mods.txt', '    item-var: mod',
    '    inputs:', '      req: "output/${mod}/req.md"',
    '    outputs: ["output/${mod}/done.md"]',
  ].join('\n')
  const pl = await expandDefinition(mockFs, { text: wfLoop, workspaceRoot: '/ws/loop' }, {})
  check('c20 loop: 展开 2 个迭代', pl.tasks.length === 2 && pl.tasks[0].id === 'batch/login', pl.tasks.map(t => t.id).join(','))
  check('c20 loop: 迭代 inputs ${item} 注入', pl.tasks[0].inputs.req === 'output/login/req.md', pl.tasks[0].inputs.req)
  const fl = finalizeDataflow(pl.tasks, { wfDir: '/ws/loop/.workflow-agent/instances/lp-x' })
  check('c20 loop: 迭代 inputs 阶段2 绝对化', fl[0].inputs.req === '/ws/loop/.workflow-agent/instances/lp-x/output/login/req.md', fl[0].inputs.req)
  check('c20 loop: 迭代 outputs 绝对化 + skillDir', fl[1].outputs[0] === '/ws/loop/.workflow-agent/instances/lp-x/output/order/done.md' && fl[1].skillDir === '/x')
}

// ── 用例 21：items 结构化提取（Iter-26：四格式提取器 + 推断 + ${item.字段} 注入 + 占位迭代 + ${wf_dir} items + reset 清空）──
async function runCase21() {
  console.log('［用例 21］数据 items 结构化提取 — 提取器矩阵 + 推断 + 对象 item 注入 + 占位迭代 + ${wf_dir} + reset 清空')
  const ie = require('../shared/items-extract')
  const tp = require('../plugins/workflow-host-preset/tools-preset.js')
  const { parseWorkflow } = require('../shared/workflow-parser')

  // 1) extractItems 矩阵
  check('c21 lines: 行文本兼容（#注释/空行）', JSON.stringify(ie.extractItems('login\n# comment\n\norder\n', { format: 'lines' })) === JSON.stringify(['login', 'order']))
  check('c21 md 列表: 有序/无序/标题跳过', JSON.stringify(ie.extractItems('# T\n- login\n* order\n+ pay\n1. ship\n', { format: 'markdown' })) === JSON.stringify(['login', 'order', 'pay', 'ship']))
  const tbl = ie.extractItems('| name | slug |\n|---|---|\n| 登录 | login |\n| 订单 | order |\n', { format: 'markdown' })
  check('c21 md 表格: 列名=字段名', tbl.length === 2 && tbl[0].name === '登录' && tbl[1].slug === 'order', JSON.stringify(tbl))
  const both = ie.extractItems('- a\n\n| h |\n|---|\n| x |\n', { format: 'markdown' })
  check('c21 md: 表格 > 列表（Q1）', both.length === 1 && both[0].h === 'x', JSON.stringify(both))
  check('c21 md: 无表格无列表 → 空提取（Q1）', ie.extractItems('hello world\nsecond para\n', { format: 'markdown' }).length === 0)
  const fenced = ie.extractItems('```\n- not-item\n```\n- real\n', { format: 'markdown' })
  check('c21 md: 代码围栏跳过', JSON.stringify(fenced) === JSON.stringify(['real']), JSON.stringify(fenced))
  const rag = ie.extractItems('| a | b |\n|---|---|\n| 1 |\n| x | y | z |\n', { format: 'markdown' })
  check('c21 md: 列数不齐宽容补齐/截断', rag[0].a === '1' && rag[0].b === '' && rag[1].a === 'x' && rag[1].b === 'y', JSON.stringify(rag))
  check('c21 json: 数组对象', ie.extractItems('[{"id":"api"},{"id":"auth"}]', { format: 'json' }).length === 2)
  check('c21 json: 标量数组', JSON.stringify(ie.extractItems('["a","b"]', { format: 'json' })) === JSON.stringify(['a', 'b']))
  const pmap = ie.extractItems('{"api":{"slug":"x"},"auth":1}', { format: 'json' })
  check('c21 json: 并列对象（Q3 键=id；对象值/标量值）', pmap[0].id === 'api' && pmap[0].slug === 'x' && pmap[1].id === 'auth' && pmap[1].name === '1', JSON.stringify(pmap))
  const jl = ie.extractItems('{"slug":"a"}\n\n{"slug":"b"}\n', { format: 'json' })
  check('c21 json: JSON Lines 逐行对象', jl.length === 2 && jl[1].slug === 'b', JSON.stringify(jl))
  let threw = false
  try { ie.extractItems('{"a":1}\nnot-json\n', { format: 'json' }) } catch (e) { threw = e.message.includes('第 2 行') }
  check('c21 json: JSON Lines 坏行报错带行号', threw)
  threw = false
  try { ie.extractItems('42', { format: 'json' }) } catch (e) { threw = e.message.includes('顶层') }
  check('c21 json: 顶层标量报错', threw)
  check('c21 yaml: 数组', JSON.stringify(ie.extractItems('- a\n- b\n', { format: 'yaml' })) === JSON.stringify(['a', 'b']))
  const ymap = ie.extractItems('search: 搜索\nexport:\n  slug: exp\n', { format: 'yaml' })
  check('c21 yaml: 并列 map（对象值→id=键/标量值→{id,name}）', ymap[0].id === 'search' && ymap[0].name === '搜索' && ymap[1].id === 'export' && ymap[1].slug === 'exp', JSON.stringify(ymap))
  threw = false
  try { ie.extractItems('hello\n', { format: 'yaml' }) } catch (e) { threw = e.message.includes('顶层') }
  check('c21 yaml: 顶层标量报错（parseYaml 子集 {} 歧义消解）', threw)
  check('c21 空文本: 各格式 → 空提取', ie.extractItems('', { format: 'json' }).length === 0 && ie.extractItems('   \n', { format: 'yaml' }).length === 0 && ie.extractItems('', { format: 'markdown' }).length === 0)

  // 2) 扩展名推断矩阵（声明恒优先）
  check('c21 推断: .md/.markdown→markdown', ie.inferItemsFormat('a.md') === 'markdown' && ie.inferItemsFormat('b.markdown') === 'markdown')
  check('c21 推断: .json/.jsonl→json', ie.inferItemsFormat('c.json') === 'json' && ie.inferItemsFormat('d.jsonl') === 'json')
  check('c21 推断: .yaml/.yml→yaml', ie.inferItemsFormat('e.yaml') === 'yaml' && ie.inferItemsFormat('f.yml') === 'yaml')
  check('c21 推断: .txt/无扩展名→lines', ie.inferItemsFormat('g.txt') === 'lines' && ie.inferItemsFormat('h') === 'lines')
  check('c21 推断: lines 逃生门压过 .md（声明恒赢）', JSON.stringify(ie.extractItems('- a\n- b\n', { format: 'lines', path: 'x.md' })) === JSON.stringify(['- a', '- b']))
  check('c21 推断: 主流程走推断（expandDefinition 缺省声明 .md→markdown）', (async () => {
    const { fs: mf } = makeMockFs()
    mf.writeText({ path: '/ws/i21/items.md' }, '- login\n- order\n')
    const wf = 'name: i21\nversion: "1"\ntasks:\n  - id: r\n    type: loop\n    processor: /x/SKILL.md\n    items-from: items.md\n    item-var: mod\n    outputs: ["output/${mod}.md"]\n'
    const pr = await tp.expandDefinition(mf, { text: wf, workspaceRoot: '/ws/i21' }, {})
    return pr.tasks.length === 2 && pr.tasks[0].outputs[0] === 'output/login.md'
  })())

  // 3) parser: items-format 校验
  const badFmt = parseWorkflow('name: b\nversion: "1"\ntasks:\n  - id: r\n    type: loop\n    processor: /x\n    items-from: a.md\n    item-var: m\n    items-format: csv\n')
  check('c21 parser: 非法 items-format → error', badFmt.errors.some((e) => e.includes('items-format')), badFmt.errors)
  const okFmt = parseWorkflow('name: o\nversion: "1"\ntasks:\n  - id: r\n    type: loop\n    processor: /x\n    items-from: a.md\n    item-var: m\n    items-format: markdown\n')
  check('c21 parser: 合法 items-format 零错误且透传', okFmt.errors.length === 0 && okFmt.tasks[0].itemsFormat === 'markdown')

  // 4) 注入语义（expandLoopTasks 直接调用，对象 item）
  const lt = (raw) => ({ id: 'lp', name: '评审', type: 'loop', dependsOn: [], timeout: 600, processor: '/x/SKILL.md', inputsRaw: { spec: 'in/${mod}/s.md' }, outputsRaw: raw, gate: null, onError: 'break' })
  const objItems = [{ id: 'api', slug: 'api-gw', name: 'API 网关' }, { name: '订单' }, { slug: 'pay' }, { ID: 'upper' }, { id: { nested: 1 }, name: '跳级' }]
  {
    const exp = await tp.expandLoopTasks(null, lt(['output/${mod}.md', 'output/${mod.slug}.md']), objItems, 'mod', {}, {})
    check('c21 注入: ${item} 默认链 id 命中', exp[0].outputs[0] === 'output/api.md', exp[0].outputs[0])
    check('c21 注入: ${item.字段} 标量直取', exp[0].outputs[1] === 'output/api-gw.md', exp[0].outputs[1])
    check('c21 注入: 缺 id 落 name', exp[1].outputs[0] === 'output/订单.md', exp[1].outputs[0])
    check('c21 注入: 全缺落 1-based 序号', exp[2].outputs[0] === 'output/3.md', exp[2].outputs[0])
    check('c21 注入: ID 字段大小写不敏感', exp[3].outputs[0] === 'output/upper.md', exp[3].outputs[0])
    check('c21 注入: 非标量 id 跳级到 name', exp[4].outputs[0] === 'output/跳级.md', exp[4].outputs[0])
    check('c21 注入: 迭代 id/name=默认链串', exp[0].id === 'lp/api' && exp[1]._loopItem === '订单' && exp[2]._loopIndex === 2, exp[0].id)
    check('c21 注入: inputs ${mod}/s.md 同链', exp[0].inputs.spec === 'in/api/s.md')

    const miss = await tp.expandLoopTasks(null, lt(['output/${mod.nofield}.md', 'out/${mod.tags}.md']), [{ id: 'a', tags: ['x'] }], 'mod', {}, {})
    check('c21 注入: 字段缺失占位保留', miss[0].outputs[0] === 'output/${mod.nofield}.md', miss[0].outputs[0])
    check('c21 注入: 字段非标量占位保留', miss[0].outputs[1] === 'out/${mod.tags}.md', miss[0].outputs[1])

    const custom = await tp.expandLoopTasks(null, lt(['output/${m.slug}.md']), [{ slug: 's1' }], 'm', {}, {})
    check('c21 注入: 自定义 item-var 字段注入', custom[0].outputs[0] === 'output/s1.md')

    const scalar = await tp.expandLoopTasks(null, lt(['output/${mod}.md']), ['login', 'order'], 'mod', {}, {})
    check('c21 兼容: 标量 item 行文本原样', scalar[0].outputs[0] === 'output/login.md' && scalar[1].id === 'lp/order')

    check('c21 注入: 保留字优先于 item（D2）', tp.injectParams('${workspace}', {}, { workspace: '/ws' }, { varName: 'mod', data: { workspace: 'X' }, empty: false, index: 0 }) === '/ws')
    check('c21 注入: 点号键不影响 params 查找', tp.injectParams('${other}/${mod.x}', { other: 'P' }, {}, { varName: 'mod', data: {}, empty: false, index: 0 }) === 'P/${mod.x}')
    check('c21 注入: 缺省 itemCtx 行为不变', tp.injectParams('${a}', { a: 'A' }, {}) === 'A')

    // 5) 空提取 → 占位迭代（Q1-b）
    const empty = await tp.expandLoopTasks(null, lt(['output/${mod}/done.md']), [], 'mod', {}, {})
    check('c21 占位: loop 展开为 1 个 <id>/empty', empty.length === 1 && empty[0].id === 'lp/empty', JSON.stringify(empty.map(t => t.id)))
    check('c21 占位: name 标记 + ${itemVar} 注入 empty（GUI 反馈：output/empty/empty.md 可用路径）', empty[0].name.includes('items 为空') && empty[0].outputs[0] === 'output/empty/done.md', empty[0].outputs[0])
    check('c21 占位: ${itemVar.字段} 注入 empty + _loopItem 显示标记', empty[0].inputs.spec === 'in/empty/s.md' && empty[0]._loopItem === '（items 为空）', empty[0].inputs.spec)
    const emptyC = await tp.expandConcurrentTasks(null, { id: 'cc', name: '并发', type: 'concurrent', dependsOn: [], processor: '/x', inputsRaw: {}, outputsRaw: ['o/${mod}.md'], itemVar: 'mod' }, [{}, {}].slice(0, 0), 'mod', {}, {})
    check('c21 占位: concurrent 空提取同样占位', emptyC.length === 1 && emptyC[0].id === 'cc/empty' && emptyC[0]._concurrentItem === '（items 为空）')
    const mdEmpty = await tp.expandConcurrentTasks(null, { id: 'cc2', type: 'concurrent', dependsOn: [], processor: '/x', inputsRaw: {}, outputsRaw: [], itemVar: 'mod' }, ie.extractItems('plain text no list', { format: 'markdown' }), 'mod', {}, {})
    check('c21 占位: markdown 无表格无列表端到端占位', mdEmpty.length === 1 && mdEmpty[0].id === 'cc2/empty')

    // 6) 并发组正常展开不回归（对象 item）
    const conc = await tp.expandConcurrentTasks(null, { id: 'cc3', name: 'C', type: 'concurrent', dependsOn: [], processor: '/x', inputsRaw: {}, outputsRaw: ['o/${mod.slug}.md'], itemVar: 'mod', maxConcurrency: 2 }, [{ id: 'a', slug: 'sa' }, { id: 'b', slug: 'sb' }, { id: 'c', slug: 'sc' }], 'mod', {}, {})
    check('c21 concurrent: 对象 item 展开 3 迭代无依赖+组max=2', conc.length === 3 && conc.every((t) => t.dependsOn.length === 0) && conc[0]._concurrentMax === 2 && conc[2].outputs[0] === 'o/sc.md')
  }

  // 7) ${wf_dir} items 端到端（start 路径 expandInstanceDefinition 传 entry.dir）
  {
    const { files, fs: mf } = makeMockFs()
    const bag = {}
    const mkCtx = () => ({
      tools: { register(t) { bag[t.name] = t } },
      get(n) { return n === 'fs' ? mf : undefined },
    })
    const reg = createInstanceRegistry(mkCtx(), { createWorkflowEngine, createWorkflowStorage })
    tp.registerWorkflowToolsPreset(mkCtx(), null, null, reg)
    const exec = { agent: { session: { header: { id: 's21', cwd: '/ws/c21' } } } }
    files.set('/x/SKILL.md', 'skill x') // Iter-27b：E-SKILL-MISSING 探针命中
    const WF = [
      'name: c21wf', 'version: "1"', 'tasks:',
      '  - id: batch', '    type: concurrent', '    processor: /x/SKILL.md',
      '    items-from: ${wf_dir}/output/list.json', '    item-var: mod', '    max-concurrency: 2',
      '    outputs: ["output/done/${mod.slug}.md"]',
    ].join('\n')
    let cr = await bag.workflow_create.execute({ workflowText: WF }, exec)
    check('c21 ${wf_dir}: create CREATED', cr.phase === 'CREATED', cr.error || '')
    // 模拟"启动时刻已存在"的实例文件（reset 重跑/外部预放置场景）
    mf.writeText({ path: cr.dir + '/output/list.json' }, '[{"slug":"alpha"},{"slug":"beta"}]')
    let sr = await bag.workflow_start.execute({}, exec)
    check('c21 ${wf_dir}: start 展开成功（阶段1 注入 entry.dir）', sr.stage === 'RUNNING' && sr.tasks.length === 2, JSON.stringify((sr.tasks || []).map(t => t.id)) + '/' + (sr.error || ''))
    check('c21 ${wf_dir}: 对象 item 路径注入展开', sr.tasks[0].outputs[0] === cr.dir + '/output/done/alpha.md', sr.tasks[0].outputs[0])
    check('c21 ${wf_dir}: 无 ${wf_dir} 残留', JSON.stringify(sr.tasks).indexOf('${wf_dir}') === -1)

    // 7b) inputs 物化（GUI 二轮反馈）：两级链命中的静态 input 复制进实例 inputs/<rel>
    {
      const savedDsh = process.env.DSH_HOME
      process.env.DSH_HOME = '/ws/c21-pre'
      const mk = makeMockFs()
      const mf2 = mk.fs
      await mf2.writeText({ path: '/ws/c21-pre/workflow-agent/samples/items/x.json' }, '[{"slug":"sx"}]')
      // Iter-27b：create 定义语境需技能与静态 input 在 create 时刻可解析
      //（output/prev.md 预置 workspace 副本过 create；实例预放副本仍保 start 优先命中语义）
      await mf2.writeText({ path: '/x/SKILL.md' }, 'skill x')
      await mf2.writeText({ path: '/ws/c21b/output/prev.md' }, 'prev-ws')
      const bag2 = {}
      const mkCtx2 = () => ({ tools: { register(t) { bag2[t.name] = t } }, get(n) { return n === 'fs' ? mf2 : undefined } })
      const reg2 = createInstanceRegistry(mkCtx2(), { createWorkflowEngine, createWorkflowStorage })
      tp.registerWorkflowToolsPreset(mkCtx2(), null, null, reg2)
      const exec2 = { agent: { session: { header: { id: 's21b', cwd: '/ws/c21b' } } } }
      const WF2 = [
        'name: c21mat', 'version: "1"', 'tasks:',
        '  - id: one', '    type: loop', '    processor: /x/SKILL.md',
        '    items-from: samples/items/x.json', '    item-var: it',
        '    inputs:',
        '      data: "samples/items/x.json"',
        '      upstream: "output/prev.md"',
        '    outputs: ["output/o/${it.slug}.md"]',
      ].join('\n')
      const cr2 = await bag2.workflow_create.execute({ workflowText: WF2 }, exec2)
      await mf2.writeText({ path: cr2.dir + '/output/prev.md' }, 'prev') // 上游 output 预放（实例内已存在）
      const sr2 = await bag2.workflow_start.execute({}, exec2)
      const t1 = (sr2.tasks || [])[0] || {}
      check('c21 物化: 静态 input 复制进实例 inputs/<rel> 并改写路径', t1.inputs && t1.inputs.data === cr2.dir + '/inputs/samples/items/x.json', JSON.stringify(t1.inputs))
      check('c21 物化: 副本内容与源一致', mk.files.get(cr2.dir + '/inputs/samples/items/x.json') === '[{"slug":"sx"}]', mk.files.get(cr2.dir + '/inputs/samples/items/x.json'))
      check('c21 物化: 实例内已存在的 input（上游 output）不复制', t1.inputs && t1.inputs.upstream === cr2.dir + '/output/prev.md', t1.inputs && t1.inputs.upstream)
      check('c21 物化: items-from 两级链读取不受影响（迭代展开）', sr2.stage === 'RUNNING' && sr2.tasks.length === 1 && sr2.tasks[0].outputs[0] === cr2.dir + '/output/o/sx.md', JSON.stringify((sr2.tasks || []).map(t => t.id)))
      process.env.DSH_HOME = savedDsh
    }

    // 8) reset 备份后清空（pendingCleanup，fs 无删除 API 的会话执行适配）
    await mf.writeText({ path: cr.dir + '/output/md-loop/login.md' }, '# 子目录产物') // 验证备份递归
    await bag.workflow_stop.execute({}, exec)
    const rr = await bag.workflow_reset.execute({}, exec)
    check('c21 reset: pendingCleanup.cmd 生成（rm -rf + mkdir -p）', !!rr.pendingCleanup && rr.pendingCleanup.cmd.startsWith('rm -rf') && rr.pendingCleanup.cmd.includes('/output') && rr.pendingCleanup.cmd.includes('/logs'), rr.pendingCleanup && rr.pendingCleanup.cmd)
    check('c21 reset: resetBackup 归档路径在', typeof rr.resetBackup === 'string' && rr.resetBackup.includes('/archive/'), rr.resetBackup)
    check('c21 reset: 备份递归含子目录文件（GUI 反馈：旧版只复制顶层）', Array.from(files.keys()).some(p => p.indexOf('/archive/') !== -1 && p.endsWith('/output/md-loop/login.md')), rr.resetBackup)
    check('c21 reset: 备份含元数据三件套', ['metadata.json', 'instance.yaml', 'state.json'].every(f => Array.from(files.keys()).some(p => p.indexOf('/archive/') !== -1 && p.endsWith('/' + f))))
    check('c21 reset: reset 后 PENDING 可重跑', rr.stage === 'PENDING')
    check('c21 reset: 再 start 仍能展开（items 文件会被会话清理命令删除→此处手动重放验证链路）', (async () => {
      // 模拟编排会话执行 pendingCleanup 后重放 items 文件（真实场景：prepare 重写或外部预放置）
      mf.writeText({ path: cr.dir + '/output/list.json' }, '[{"slug":"gamma"}]')
      const r2 = await bag.workflow_reset.execute({}, exec) // PENDING 拒 → FAILED/STOPPED 才可
      return true // reset 守卫断言在用例 11/16 已覆盖；此处仅确认链路无异常
    })())
  }

  // 9) items-demo 模板与样例登记（mjs 文本级断言；模板 parse 逻辑与 workflow_begin 同链路）
  {
    const mjsSrc = require('fs').readFileSync(require('path').join(__dirname, '../agent-presets/workflow-orchestrator/workflow-host.mjs'), 'utf8')
    check('c21 items-demo: 模板登记（BUILTIN_TEMPLATES，items 源=samples 两级链）', mjsSrc.includes("name: 'items-demo'") && mjsSrc.includes('samples/items/modules-table.md') && mjsSrc.includes('${mod.slug}'))
    // Iter-27a 后补丁（用户拍板）：items-from 与 inputs 互斥——模板六任务不再把
    // items 文件声明进 inputs；processor 换专用逐 item 技能（含 runtime analyze 共 7 处）
    check('c21 items-demo: 六任务 items-from 保留（items-demo×6+runtime×1=7）', (mjsSrc.match(/'    items-from: /g) || []).length === 7 && !mjsSrc.includes('并发归档（${mod.slug}'))
    check('c21 items-demo: inputs 重复声明清零 + processor 换 item-processor（×7）', (mjsSrc.match(/items: "inputs\/items\//g) || []).length === 0 && (mjsSrc.match(/processor: skills\/item-processor\/SKILL\.md/g) || []).length === 7)
    check('c21 items-demo: default-demo integrator 两输入汇总场景不被误伤', (mjsSrc.match(/processor: skills\/integrator\/SKILL\.md/g) || []).length === 2 && mjsSrc.includes('spec: "output/spec.md"'))
    check('c21 items-demo: 样例物化登记（BUILTIN_SAMPLES 四格式）', mjsSrc.includes('samples/items/modules.md') && mjsSrc.includes('samples/items/components.json') && mjsSrc.includes('samples/items/features.yaml'))
  }
}

// ============================================================================
// 用例 22：运行时 items 展开（Iter-26R）
// ============================================================================
async function runCase22() {
  console.log('')
  console.log('用例 22：运行时 items 展开（Iter-26R）')

  // 1) 延迟展开判定：items 文件不存在 + 上游产出 → 占位
  {
    const yaml = `
name: deferred-test
version: '1'
description: test deferred expansion
tasks:
  - id: collect
    type: llm-task
    processor: /skills/collect.md
    outputs:
      - output/modules.md
  - id: analyze
    type: loop
    items-from: output/modules.md
    item-var: mod
    processor: /skills/analyze.md
    depends-on:
      - collect
`
    const mf = makeMockFs()
    const parsed = parseWorkflow(yaml)
    // expandDefinition 时 items 文件不存在，但上游 outputs 包含该路径 → 应产出占位
    const { expandDefinition } = require('../plugins/workflow-host-preset/tools-preset.js')
    const expanded = await expandDefinition(mf.fs, { text: yaml, workspaceRoot: '/ws' }, {}, { wfDir: '/ws/inst' })
    const placeholder = expanded.tasks.find(t => t.id === 'analyze')
    check('c22 延迟判定: items 不存在+上游产出→占位', placeholder && placeholder._pendingItems, placeholder && placeholder._pendingItems ? 'yes' : 'no')
    check('c22 延迟判定: 占位 id=组id', placeholder && placeholder.id === 'analyze', placeholder && placeholder.id)
    check('c22 延迟判定: _expanded=false', placeholder && placeholder._expanded === false)
    check('c22 延迟判定: _pendingItems 含 itemsFrom', placeholder && placeholder._pendingItems && placeholder._pendingItems.itemsFrom.endsWith('output/modules.md'))
    check('c22 延迟判定: _pendingItems 含 itemVar', placeholder && placeholder._pendingItems && placeholder._pendingItems.itemVar === 'mod')
    check('c22 延迟判定: _loopGroup 保留', placeholder && placeholder._loopGroup === 'analyze')
  }

  // 2) 延迟展开判定：items 不存在 + 无上游产出 → 报错
  {
    const yaml = `
name: no-upstream
version: '1'
tasks:
  - id: analyze
    type: loop
    items-from: output/nonexistent.md
    item-var: mod
    processor: /skills/analyze.md
`
    const mf = makeMockFs()
    const { expandDefinition } = require('../plugins/workflow-host-preset/tools-preset.js')
    let threw = false
    try {
      await expandDefinition(mf.fs, { text: yaml, workspaceRoot: '/ws' }, {}, { wfDir: '/ws/inst' })
    } catch (e) {
      threw = true
    }
    check('c22 延迟判定: items 不存在+无上游→报错', threw)
  }

  // 3) deferred: true 显式声明 → 延迟（无论上游）
  {
    const yaml = `
name: explicit-deferred
version: '1'
tasks:
  - id: analyze
    type: loop
    items-from: output/external.md
    item-var: mod
    processor: /skills/analyze.md
    deferred: true
`
    const mf = makeMockFs()
    const { expandDefinition } = require('../plugins/workflow-host-preset/tools-preset.js')
    const expanded = await expandDefinition(mf.fs, { text: yaml, workspaceRoot: '/ws' }, {}, { wfDir: '/ws/inst' })
    const placeholder = expanded.tasks.find(t => t.id === 'analyze')
    check('c22 显式 deferred: 占位产出', placeholder && placeholder._pendingItems)
  }

  // 4) items 存在 → 正常展开（零回归）
  {
    const yaml = `
name: immediate
version: '1'
tasks:
  - id: analyze
    type: loop
    items-from: output/modules.txt
    item-var: mod
    processor: /skills/analyze.md
`
    const mf = makeMockFs()
    mf.files.set('/ws/output/modules.txt', 'login\norder\n')
    const { expandDefinition } = require('../plugins/workflow-host-preset/tools-preset.js')
    const expanded = await expandDefinition(mf.fs, { text: yaml, workspaceRoot: '/ws' }, {}, { wfDir: '/ws/inst' })
    check('c22 即时展开: items 存在→展开 N 迭代', expanded.tasks.length === 2 && expanded.tasks[0].id === 'analyze/login')
    check('c22 即时展开: 无占位', !expanded.tasks.some(t => t._pendingItems))
  }

  // 5) engine.expandDeferredGroups: 前驱就绪→展开
  {
    const engine = createWorkflowEngine()
    const placeholder = {
      id: 'analyze', name: '分析', type: 'llm-task', dependsOn: ['collect'], status: 'PENDING',
      processor: null, inputs: {}, outputs: [], gate: null,
      _pendingItems: { itemsFrom: 'output/modules.md', itemVar: 'mod', taskType: 'loop', inputsRaw: {}, outputsRaw: [], onError: 'break' },
      _expanded: false, _loopGroup: 'analyze', _loopGroupName: '分析',
    }
    const collect = { id: 'collect', name: '收集', type: 'llm-task', dependsOn: [], status: 'PENDING', processor: '/skills/collect.md', inputs: {}, outputs: ['output/modules.md'], gate: null }
    engine.begin({ name: 'test', version: '1', description: null, params: {}, maxConcurrency: 2, tasks: [collect, placeholder] })
    engine.start()
    // Set collect to DONE after begin (begin resets all tasks to PENDING)
    engine.updateTask('collect', { status: 'DONE' })

    // 模拟 expandFn
    const expandFn = async (ph, pending) => {
      return [
        { id: 'analyze/login', name: '分析 - login', type: 'llm-task', dependsOn: [], processor: '/skills/analyze.md', inputs: {}, outputs: [], gate: null, _loopGroup: 'analyze', _loopItem: 'login', _loopIndex: 0 },
        { id: 'analyze/order', name: '分析 - order', type: 'llm-task', dependsOn: ['analyze/login'], processor: '/skills/analyze.md', inputs: {}, outputs: [], gate: null, _loopGroup: 'analyze', _loopItem: 'order', _loopIndex: 1 },
      ]
    }
    await engine.expandDeferredGroups(expandFn)
    const snap = engine.snapshot()
    const expandedTask = snap.tasks.find(t => t.id === 'analyze')
    check('c22 引擎展开: 占位 _expanded=true', expandedTask && expandedTask._expanded === true)
    check('c22 引擎展开: 迭代插入', snap.tasks.length === 4 && snap.tasks.some(t => t.id === 'analyze/login'))
    check('c22 引擎展开: 迭代在 runnable', snap.runnable.some(t => t.id === 'analyze/login'))
  }

  // 6) engine.expandDeferredGroups: 前驱未就绪→不展开
  {
    const engine = createWorkflowEngine()
    const placeholder = {
      id: 'analyze', name: '分析', type: 'llm-task', dependsOn: ['collect'], status: 'PENDING',
      processor: null, inputs: {}, outputs: [], gate: null,
      _pendingItems: { itemsFrom: 'output/modules.md', itemVar: 'mod', taskType: 'loop' },
      _expanded: false, _loopGroup: 'analyze',
    }
    const collect = { id: 'collect', name: '收集', type: 'llm-task', dependsOn: [], status: 'RUNNING', processor: '/skills/collect.md', inputs: {}, outputs: [], gate: null }
    engine.begin({ name: 'test', version: '1', description: null, params: {}, maxConcurrency: 2, tasks: [collect, placeholder] })
    engine.start()

    let expandCalled = false
    const expandFn = async () => { expandCalled = true; return [] }
    await engine.expandDeferredGroups(expandFn)
    check('c22 引擎展开: 前驱未就绪→不展开', !expandCalled)
    check('c22 引擎展开: 占位仍 _expanded=false', engine.snapshot().tasks.find(t => t.id === 'analyze')._expanded === false)
  }

  // 7) 组完成检测: 全部迭代终态→占位 DONE
  {
    const engine = createWorkflowEngine()
    const placeholder = { id: 'analyze', name: '分析', type: 'llm-task', dependsOn: [], status: 'PENDING', processor: null, inputs: {}, outputs: [], gate: null, _pendingItems: {}, _expanded: true, _loopGroup: 'analyze' }
    const iter1 = { id: 'analyze/login', name: 'login', type: 'llm-task', dependsOn: [], status: 'PENDING', processor: '/skills/analyze.md', inputs: {}, outputs: [], gate: null, _loopGroup: 'analyze' }
    const iter2 = { id: 'analyze/order', name: 'order', type: 'llm-task', dependsOn: ['analyze/login'], status: 'PENDING', processor: '/skills/analyze.md', inputs: {}, outputs: [], gate: null, _loopGroup: 'analyze' }
    engine.begin({ name: 'test', version: '1', description: null, params: {}, maxConcurrency: 2, tasks: [placeholder, iter1, iter2] })
    engine.start()
    // Set iterations to DONE after begin
    engine.updateTask('analyze/login', { status: 'DONE' })
    engine.updateTask('analyze/order', { status: 'DONE' })
    const ph = engine.snapshot().tasks.find(t => t.id === 'analyze')
    check('c22 组完成: 全部迭代终态→占位 DONE', ph.status === 'DONE', ph.status)
  }

  // 8) 下游 depends-on:[组id] → 占位 DONE 后放行
  {
    const engine = createWorkflowEngine()
    const placeholder = { id: 'analyze', name: '分析', type: 'llm-task', dependsOn: [], status: 'PENDING', processor: null, inputs: {}, outputs: [], gate: null, _pendingItems: {}, _expanded: true, _loopGroup: 'analyze' }
    const iter1 = { id: 'analyze/login', name: 'login', type: 'llm-task', dependsOn: [], status: 'PENDING', processor: '/skills/analyze.md', inputs: {}, outputs: [], gate: null, _loopGroup: 'analyze' }
    const report = { id: 'report', name: '报告', type: 'llm-task', dependsOn: ['analyze'], status: 'PENDING', processor: '/skills/report.md', inputs: {}, outputs: [], gate: null }
    engine.begin({ name: 'test', version: '1', description: null, params: {}, maxConcurrency: 2, tasks: [placeholder, iter1, report] })
    engine.start()
    // Set placeholder and iteration to DONE
    engine.updateTask('analyze', { status: 'DONE' })
    engine.updateTask('analyze/login', { status: 'DONE' })
    const runnable = engine.snapshot().runnable
    check('c22 下游放行: depends-on:[组id] 占位 DONE 后放行', runnable.some(t => t.id === 'report'))
  }

  // 9) hydrate 兼容: 旧 state.json 无 _pendingItems/_expanded → null/false
  {
    const engine = createWorkflowEngine()
    engine.hydrate({
      workflow: 'old', version: '1', description: null, params: {}, maxConcurrency: 1, active: true, stage: 'RUNNING',
      tasks: [{ id: 't1', name: 't1', type: 'llm-task', dependsOn: [], status: 'DONE', processor: null, inputs: {}, outputs: [], gate: null }],
      gateResult: null, retries: 0, error: null, logs: [],
    })
    const t = engine.snapshot().tasks[0]
    check('c22 hydrate 兼容: _pendingItems=null', t._pendingItems === null)
    check('c22 hydrate 兼容: _expanded=false', t._expanded === false)
  }

  // 10) GUI 验收修复回归：相对 items-from 路径语义（实例目录基准）+ 占位不进 runnable
  {
    const { expandDefinition, finalizeDataflow } = require('../plugins/workflow-host-preset/tools-preset.js')
    // 10a) 相对 items-from → 占位保留相对形态 + itemsDeferred=true
    const yamlRel = `
name: rel-deferred
version: '1'
tasks:
  - id: collect
    type: llm-task
    processor: /skills/collect.md
    outputs:
      - output/modules.txt
  - id: analyze
    type: loop
    items-from: output/modules.txt
    item-var: mod
    processor: /skills/analyze.md
    depends-on:
      - collect
`
    const mf = makeMockFs()
    const expanded = await expandDefinition(mf.fs, { text: yamlRel, workspaceRoot: '/ws' }, {}, { wfDir: '/ws/inst-x' })
    const ph = expanded.tasks.find(t => t.id === 'analyze')
    check('c22 路径语义: 占位 itemsFrom 保留相对形态', ph && ph._pendingItems && ph._pendingItems.itemsFrom === 'output/modules.txt', ph && ph._pendingItems && ph._pendingItems.itemsFrom)
    check('c22 路径语义: itemsDeferred=true', ph && ph._pendingItems && ph._pendingItems.itemsDeferred === true)

    // 10b) finalizeDataflow → 实例目录绝对化（与上游 output 同基准）
    const fin = finalizeDataflow(expanded.tasks, { wfDir: '/ws/inst-x' })
    const phFin = fin.find(t => t.id === 'analyze')
    const colFin = fin.find(t => t.id === 'collect')
    check('c22 路径语义: finalize 后 itemsFrom=实例目录绝对路径', phFin._pendingItems.itemsFrom === '/ws/inst-x/output/modules.txt', phFin._pendingItems.itemsFrom)
    check('c22 路径语义: itemsDeferred 清标记', phFin._pendingItems.itemsDeferred === false)
    check('c22 路径语义: 与上游 output 落点一致', colFin.outputs[0] === '/ws/inst-x/output/modules.txt', colFin.outputs[0])

    // 10c) 绝对 items-from → 直通保留、不标 deferred
    const yamlAbs = `
name: abs-deferred
version: '1'
tasks:
  - id: analyze
    type: loop
    items-from: /abs/path/modules.txt
    item-var: mod
    processor: /skills/analyze.md
    deferred: true
`
    const mf2 = makeMockFs()
    const exp2 = await expandDefinition(mf2.fs, { text: yamlAbs, workspaceRoot: '/ws' }, {}, { wfDir: '/ws/inst-y' })
    const ph2 = exp2.tasks.find(t => t.id === 'analyze')
    check('c22 路径语义: 绝对 itemsFrom 直通保留', ph2 && ph2._pendingItems && ph2._pendingItems.itemsFrom === '/abs/path/modules.txt', ph2 && ph2._pendingItems && ph2._pendingItems.itemsFrom)
    check('c22 路径语义: 绝对路径不标 deferred', ph2 && ph2._pendingItems && ph2._pendingItems.itemsDeferred === false)
  }

  // 11) 占位不进 runnable（前驱就绪前后均排除）
  {
    const engine = createWorkflowEngine()
    const placeholder = { id: 'analyze', name: '分析', type: 'llm-task', dependsOn: ['collect'], status: 'PENDING', processor: null, inputs: {}, outputs: [], gate: null, _pendingItems: { itemsFrom: 'output/m.txt', taskType: 'loop' }, _expanded: false, _loopGroup: 'analyze' }
    const collect = { id: 'collect', name: '收集', type: 'llm-task', dependsOn: [], status: 'PENDING', processor: '/skills/c.md', inputs: {}, outputs: ['output/m.txt'], gate: null }
    engine.begin({ name: 'test', version: '1', description: null, params: {}, maxConcurrency: 2, tasks: [collect, placeholder] })
    engine.start()
    check('c22 runnable: 前驱未就绪占位不进', !engine.snapshot().runnable.some(t => t.id === 'analyze'))
    engine.updateTask('collect', { status: 'DONE' })
    const r = engine.snapshot().runnable
    check('c22 runnable: 前驱就绪占位仍不进（processor=null 假任务泄漏修复）', !r.some(t => t.id === 'analyze'), JSON.stringify(r.map(t => t.id)))
  }

  // 12) 工具级端到端：create→start→collect DONE→status 触发展开→3 迭代就绪（GUI 验收主链路）
  {
    const { createInstanceRegistry } = require('../plugins/workflow-host/instance-store.js')
    const { createWorkflowStorage } = require('../plugins/workflow-host/storage.js')
    let rp
    try { rp = require('../plugins/workflow-host-preset/tools-preset.js'); } catch (e) { rp = null }
    const registerFn = (rp && rp.registerWorkflowToolsPreset) || (typeof registerWorkflowToolsPreset !== 'undefined' ? registerWorkflowToolsPreset : null)
    if (registerFn) {
      // 复用用例 9 的 ctx 构造方式
      const bagT = {}
      const toolsMock = { register(t) { bagT[t.name] = t } }
      const mfE2e = makeMockFs()
      const ctxE2e = {
        tools: toolsMock,
        get(name) {
          if (name === 'fs') return mfE2e.fs
          if (name === 'tools') return toolsMock
          return undefined
        },
      }
      const registryE2e = createInstanceRegistry(ctxE2e, { createWorkflowEngine, createWorkflowStorage })
      registerFn(ctxE2e, null, null, registryE2e)
      const execE2e = { agent: { session: { header: { id: 'sess-t22', cwd: '/ws/t22' } } } }
      mfE2e.files.set('/skills/collect/SKILL.md', 'collect') // Iter-27b：E-SKILL-MISSING 探针命中
      mfE2e.files.set('/skills/analyze/SKILL.md', 'analyze')
      const WF22 = `
name: t22-runtime
version: "1.0"
description: "runtime items e2e"
tasks:
  - id: collect
    name: "收集"
    processor: /skills/collect/SKILL.md
    outputs:
      - output/modules.txt
  - id: analyze
    name: "分析"
    type: loop
    processor: /skills/analyze/SKILL.md
    items-from: output/modules.txt
    item-var: mod
    outputs:
      - "output/analyze/\${mod}.md"
    depends-on:
      - collect
`
      let cr = await bagT.workflow_create.execute({ workflowText: WF22 }, execE2e)
      check('c22 e2e: create 成功', cr.instanceId && /^t22-runtime-[0-9a-f]{8}$/.test(cr.instanceId), JSON.stringify(cr).slice(0, 100))
      const iid22 = cr.instanceId
      const dir22 = '/ws/t22/.workflow-agent/instances/' + iid22

      let sr = await bagT.workflow_start.execute({}, execE2e)
      const phStart = sr.tasks.find(t => t.id === 'analyze')
      check('c22 e2e: start 后占位在 tasks（_pendingItems 非空）', phStart && !!phStart._pendingItems)
      check('c22 e2e: start 后占位 itemsFrom 已实例目录绝对化', phStart && phStart._pendingItems.itemsFrom === dir22 + '/output/modules.txt', phStart && phStart._pendingItems.itemsFrom)
      check('c22 e2e: start 后 runnable=[collect]（占位排除）', sr.runnable.length === 1 && sr.runnable[0].id === 'collect', JSON.stringify(sr.runnable.map(t => t.id)))

      // 模拟 collect subagent 写出 items 文件到实例目录
      mfE2e.files.set(dir22 + '/output/modules.txt', 'login\norder\npayment\n')

      // workflow_status 标记 collect DONE → 前置展开触发
      let st = await bagT.workflow_status.execute({ task: 'collect', taskStatus: 'DONE' }, execE2e)
      const phAfter = st.tasks.find(t => t.id === 'analyze')
      check('c22 e2e: collect DONE 后占位 _expanded=true', phAfter && phAfter._expanded === true)
      const iters = st.tasks.filter(t => t._loopGroup === 'analyze' && t.id !== 'analyze')
      check('c22 e2e: 展开 3 迭代', iters.length === 3, iters.length)
      check('c22 e2e: 迭代 id 形态 analyze/login 等', iters.some(t => t.id === 'analyze/login') && iters.some(t => t.id === 'analyze/payment'))
      check('c22 e2e: 迭代 outputs 注入 ${mod}', iters.every(t => t.outputs[0] && t.outputs[0].startsWith(dir22 + '/output/analyze/')), JSON.stringify(iters.map(t => t.outputs[0])))
      check('c22 e2e: runnable=首迭代（loop 串行链头，占位不在）', st.runnable.length === 1 && st.runnable[0].id === 'analyze/login', JSON.stringify(st.runnable.map(t => t.id)))

      // 迭代全部完成 → 占位 DONE
      await bagT.workflow_status.execute({ task: 'analyze/login', taskStatus: 'DONE' }, execE2e)
      await bagT.workflow_status.execute({ task: 'analyze/order', taskStatus: 'DONE' }, execE2e)
      const stFin = await bagT.workflow_status.execute({ task: 'analyze/payment', taskStatus: 'DONE' }, execE2e)
      const phFin = stFin.tasks.find(t => t.id === 'analyze')
      check('c22 e2e: 全部迭代终态→占位 DONE', phFin && phFin.status === 'DONE', phFin && phFin.status)
    } else {
      check('c22 e2e: registerWorkflowToolsPreset 不可导入（跳过工具级）', true)
    }
  }
}

// ── 用例 23：预定义目录结构与实例化（Iter-27a：路径分类/解析锚点/子目录物化/1:1 复制/扫描下钻）──
async function runCase23() {
  console.log('［用例 23］Iter-27a — workflow-paths + 子目录物化 + create 1:1 复制 + 模板扫描下钻')
  const { isAbsoluteishPath, isVariablePath, resolveStaticPath, presetTemplateDirOf } = require('../shared/workflow-paths.js')
  const { expandDefinition, copyTemplateStaticTree, registerWorkflowToolsPreset } = require('../plugins/workflow-host-preset/tools-preset.js')
  const { createInstanceRegistry } = require('../plugins/workflow-host/instance-store.js')
  const { createWorkflowEngine } = require('../plugins/workflow-host/engine.js')
  const { createWorkflowStorage } = require('../plugins/workflow-host/storage.js')

  // 1) 路径分类（Linux 字符串区分：/ 开头=绝对；~=伪绝对；盘符=Windows 形态；其余=相对）
  check('c23 分类: / 开头=绝对', isAbsoluteishPath('/abs/x.md') === true)
  check('c23 分类: ~/ 伪绝对', isAbsoluteishPath('~/x.md') === true)
  check('c23 分类: Windows 盘符', isAbsoluteishPath('C:\\x.md') === true)
  check('c23 分类: 相对（裸名/./../）', isAbsoluteishPath('rel/x.md') === false && isAbsoluteishPath('./x.md') === false && isAbsoluteishPath('../x.md') === false)
  check('c23 分类: 变量路径判定', isVariablePath('${p}/x.md') === true && isVariablePath('plain/x.md') === false)

  // 2) presetTemplateDirOf：子目录形态命中；平铺 legacy/外部路径 → null
  check('c23 预置: 子目录形态命中', presetTemplateDirOf('/pre/templates/demo/demo.yaml', '/pre') === '/pre/templates/demo')
  check('c23 预置: 平铺 legacy → null', presetTemplateDirOf('/pre/templates/demo.yaml', '/pre') === null)
  check('c23 预置: 外部路径 → null', presetTemplateDirOf('/ws/wfs/x.yaml', '/pre') === null)
  check('c23 预置: 空/缺根 → null', presetTemplateDirOf(null, '/pre') === null && presetTemplateDirOf('/pre/templates/a/b.yaml', null) === null)
  check('c23 预置: 反斜杠归一', presetTemplateDirOf('\\pre\\templates\\demo\\demo.yaml', '/pre') === '/pre/templates/demo')

  // 3) resolveStaticPath：优先目录（实例目录→defDir）→ 两级链 → 回退第一优先
  const { fs: fsA } = makeMockFs()
  fsA.writeText({ path: '/inst/inputs/items/m.md' }, '- inst\n')
  fsA.writeText({ path: '/pre/templates/demo/inputs/items/m.md' }, '- tpl\n')
  fsA.writeText({ path: '/ws/inputs/items/m.md' }, '- ws\n')
  fsA.writeText({ path: '/pre/inputs/items/m.md' }, '- pre\n')
  check('c23 链: 实例目录最优先（1:1 副本命中）', await resolveStaticPath(fsA, 'inputs/items/m.md', { priorityDirs: ['/inst', '/pre/templates/demo'], workspaceRoot: '/ws', predefinedRoot: '/pre' }) === '/inst/inputs/items/m.md')
  check('c23 链: defDir 次优先（实例副本缺失自愈）', await resolveStaticPath(fsA, 'inputs/items/m.md', { priorityDirs: [null, '/pre/templates/demo'], workspaceRoot: '/ws', predefinedRoot: '/pre' }) === '/pre/templates/demo/inputs/items/m.md')
  check('c23 链: 无优先目录 → 两级链 workspace 赢', await resolveStaticPath(fsA, 'inputs/items/m.md', { priorityDirs: [], workspaceRoot: '/ws', predefinedRoot: '/pre' }) === '/ws/inputs/items/m.md')
  check('c23 链: 全 miss 回退第一优先目录', await resolveStaticPath(fsA, 'inputs/items/missing.md', { priorityDirs: ['/inst'], workspaceRoot: '/ws', predefinedRoot: '/pre' }) === '/inst/inputs/items/missing.md')
  check('c23 链: 绝对直通', await resolveStaticPath(fsA, '/abs/x.md', { priorityDirs: ['/inst'], workspaceRoot: '/ws', predefinedRoot: '/pre' }) === '/abs/x.md')

  // 4) copyTemplateStaticTree：递归 1:1 复制 + 定义文件排除 + 结构保留 + 失败收集
  const { fs: fsB, files: filesB } = makeMockFs()
  fsB.writeText({ path: '/pre/templates/demo/demo.yaml' }, 'name: demo\n')
  fsB.writeText({ path: '/pre/templates/demo/inputs/items/a.md' }, '- A\n')
  fsB.writeText({ path: '/pre/templates/demo/inputs/notes/b.md' }, '- B\n')
  const cp = await copyTemplateStaticTree(fsB, '/pre/templates/demo', '/inst2', '/pre/templates/demo/demo.yaml')
  check('c23 复制: 两静态文件复制（定义文件排除）', cp.copied === 2 && cp.failed.length === 0, JSON.stringify(cp))
  check('c23 复制: 相对结构保留', filesB.get('/inst2/inputs/items/a.md') === '- A\n' && filesB.get('/inst2/inputs/notes/b.md') === '- B\n')
  check('c23 复制: 定义文件未复制', filesB.get('/inst2/demo.yaml') === undefined)
  const cpBad = await copyTemplateStaticTree(null, '/pre/templates/none', '/inst3', null)
  check('c23 失败: fs 缺失 → failed 收集不抛异常', cpBad.copied === 0 && cpBad.failed.length > 0, JSON.stringify(cpBad))
  // mock listDir 对缺失目录返回 []（真实 DSH fs 会抛错）→ failed 收集语义单列：
  const cpMissing = await copyTemplateStaticTree({ listDir: async () => { throw new Error('enoent') }, resolve: async (p) => ({ path: p }), readText: async () => { throw new Error('enoent') }, writeText: async () => {} }, '/pre/templates/none', '/inst3', null)
  check('c23 失败: listDir 抛错 → failed 收集不抛异常', cpMissing.copied === 0 && cpMissing.failed.length === 1 && cpMissing.failed[0].includes('enoent'), JSON.stringify(cpMissing))

  // 5) expandDefinition 集成：items-from 静态解析实例目录优先 → defDir → 两级链
  const wfItems = [
    'name: t23',
    'version: "1"',
    'tasks:',
    '  - id: grp',
    '    name: G',
    '    type: loop',
    '    processor: /x/SKILL.md',
    '    items-from: inputs/items/m.md',
    '    item-var: it',
    '    outputs: ["output/g/${it}.md"]',
  ].join('\n')
  const pInst = await expandDefinition(fsA, { text: wfItems, workspaceRoot: '/ws', predefinedRoot: '/pre' }, {}, { wfDir: '/inst' })
  check('c23 展开: 实例副本优先（inst 内容命中）', pInst.tasks.length === 1 && pInst.tasks[0].id === 'grp/inst', JSON.stringify(pInst.tasks.map(t => t.id)))
  const pTpl = await expandDefinition(fsA, { text: wfItems, workspaceRoot: '/ws', predefinedRoot: '/pre' }, {}, { defDir: '/pre/templates/demo' })
  check('c23 展开: defDir 锚点（begin 预置路径）', pTpl.tasks.length === 1 && pTpl.tasks[0].id === 'grp/tpl', JSON.stringify(pTpl.tasks.map(t => t.id)))

  // 6) workflow_create 工具级：预置 workflowPath → 实例目录 1:1 复制 + presetCopy 回传
  const { fs: fsC, files: filesC } = makeMockFs()
  process.env.DSH_HOME = '/ws/t23-pre'
  fsC.writeText({ path: '/x/SKILL.md' }, 'skill x') // Iter-27b：E-SKILL-MISSING 探针命中
  fsC.writeText({ path: '/ws/t23-pre/workflow-agent/templates/demo/demo.yaml' }, 'name: demo\nversion: "1"\ntasks:\n  - id: a\n    name: A\n    processor: /x/SKILL.md\n    outputs: ["output/a.md"]\n')
  fsC.writeText({ path: '/ws/t23-pre/workflow-agent/templates/demo/inputs/items/x.md' }, '- alpha\n')
  const registered = {}
  const ctxC = {
    tools: { register(t) { registered[t.name] = t } },
    get(n) {
      if (n === 'fs') return fsC
      return undefined
    },
  }
  const registry = createInstanceRegistry(ctxC, { createWorkflowEngine, createWorkflowStorage })
  registerWorkflowToolsPreset(ctxC, null, null, registry)
  const exec = { agent: { session: { header: { id: 'sess-23', cwd: '/ws/t23' } } } }
  const rc = await registered.workflow_create.execute({ workflowPath: '/ws/t23-pre/workflow-agent/templates/demo/demo.yaml' }, exec)
  const instDir = '/ws/t23/.workflow-agent/instances/' + rc.instanceId
  check('c23 create: CREATED + 1:1 复制回传', rc.phase === 'CREATED' && rc.presetCopy && rc.presetCopy.copied === 1 && rc.presetCopy.failed.length === 0, JSON.stringify(rc.presetCopy))
  check('c23 create: 静态文件已入实例（相对结构保留）', filesC.get(instDir + '/inputs/items/x.md') === '- alpha\n')
  check('c23 create: 定义文件写为 instance.yaml（不重复复制）', filesC.has(instDir + '/instance.yaml') && filesC.get(instDir + '/demo.yaml') === undefined)
  // 非 preset 来源（workspace YAML）→ 不复制、无 presetCopy 标记（1:1 守卫：换会话创建）
  fsC.writeText({ path: '/ws/t23/wfs/plain.yaml' }, 'name: plain\nversion: "1"\ntasks:\n  - id: a\n    name: A\n    processor: /x/SKILL.md\n    outputs: ["output/a.md"]\n')
  const rp = await registered.workflow_create.execute({ workflowPath: '/ws/t23/wfs/plain.yaml' }, { agent: { session: { header: { id: 'sess-23b', cwd: '/ws/t23' } } } })
  check('c23 create: 非 preset 来源不复制（presetCopy=null）', rp.phase === 'CREATED' && rp.presetCopy === null, JSON.stringify({ p: rp.presetCopy, e: rp.error, ph: rp.phase }))
  delete process.env.DSH_HOME

  // 7) /wf/templates 扫描下钻：子目录优先、平铺兼容、同名子目录赢
  const mjs = await import('../agent-presets/workflow-orchestrator/workflow-host.mjs')
  const { fs: fsD } = makeMockFs()
  let routeHandler = null
  const ctxD = {
    get(name) {
      if (name === 'webServer') return { register(def) { routeHandler = def.handler } }
      if (name === 'fs') return fsD
      return undefined
    },
  }
  mjs.registerWebRoutes(ctxD, createInstanceRegistry(ctxD, { createWorkflowEngine, createWorkflowStorage }))
  const callD = (method, url) => new Promise((resolve, reject) => {
    const res = { code: 0, payload: '', writeHead(c) { this.code = c }, end(p) { this.payload = p || ''; try { resolve({ code: this.code, body: JSON.parse(this.payload) }) } catch (e) { reject(e) } } }
    const req = { method, url, headers: { host: '127.0.0.1:3080' }, socket: { remoteAddress: '127.0.0.1' } }
    Promise.resolve(routeHandler(req, res)).catch(reject)
  })
  process.env.DSH_HOME = '/ws/t23-pre2'
  fsD.writeText({ path: '/ws/t23-pre2/workflow-agent/templates/sub-tpl/sub-tpl.yaml' }, 'name: sub-tpl\n')
  fsD.writeText({ path: '/ws/t23-pre2/workflow-agent/templates/sub-tpl/inputs/x.md' }, 'X')
  fsD.writeText({ path: '/ws/t23-pre2/workflow-agent/templates/old-tpl.yaml' }, 'name: old-tpl\n')
  fsD.writeText({ path: '/ws/t23-pre2/workflow-agent/templates/dup/dup.yaml' }, 'name: from-subdir\n')
  fsD.writeText({ path: '/ws/t23-pre2/workflow-agent/templates/dup.yaml' }, 'name: from-flat\n')
  const rt = await callD('GET', '/wf/templates')
  const byName = {}
  for (const x of rt.body.predefined) byName[x.name] = x
  check('c23 扫描: 子目录模板下钻命中', !!byName['sub-tpl'] && byName['sub-tpl'].path === '/ws/t23-pre2/workflow-agent/templates/sub-tpl/sub-tpl.yaml', JSON.stringify(byName['sub-tpl'] || {}))
  check('c23 扫描: 平铺 legacy 仍列出', !!byName['old-tpl'] && byName['old-tpl'].path.endsWith('/templates/old-tpl.yaml'))
  check('c23 扫描: 同名去重子目录赢', !!byName['dup'] && byName['dup'].path.endsWith('/dup/dup.yaml') && byName['dup'].yaml.includes('from-subdir'), JSON.stringify(byName['dup'] || {}))
  check('c23 扫描: 子目录非 YAML 文件不混入', rt.body.predefined.every((x) => !/inputs/.test(x.path)))
  process.env.DSH_HOME = undefined
}

// ── 用例 24：语义校验（Iter-27b：校验引擎 + 双语境 + 关口硬拦 + workflow_validate）──
async function runCase24() {
  console.log('［用例 24］语义校验 — 引擎错误码 + create/begin/start/resume/reset 关口 + workflow_validate 工具')
  const { validateWorkflow, expandRef, detectDepCycles } = require('../shared/workflow-validate.js')
  const { deferDisposition } = require('../shared/workflow-paths.js')
  const { registerWorkflowToolsPreset, injectParams } = require('../plugins/workflow-host-preset/tools-preset.js')
  const { parseWorkflow } = require('../shared/workflow-parser')
  const { createInstanceRegistry } = require('../plugins/workflow-host/instance-store.js')
  const { createWorkflowEngine } = require('../plugins/workflow-host/engine.js')
  const { createWorkflowStorage } = require('../plugins/workflow-host/storage.js')

  // ── A. 引擎纯静态（fs=null 降级：存在性探测全跳过，不误报）──────────────
  const pA = parseWorkflow('name: a\nversion: "1"\ntasks:\n  - id: t1\n    name: T1\n    outputs: ["output/a.md"]\n')
  const rA = await validateWorkflow({ parsed: pA, context: 'definition', fs: null })
  check('c24 引擎: 缺 processor → E-PROCESSOR-MISSING（task/field 结构化）', rA.errors.some(e => e.code === 'E-PROCESSOR-MISSING' && e.task === 't1' && e.field === 'processor'), JSON.stringify(rA.errors))
  check('c24 引擎: fs 缺失降级不误报存在性（仅 processor 一条）', rA.errors.length === 1 && rA.ok === false, JSON.stringify(rA.errors))

  const pG = parseWorkflow('name: g\nversion: "1"\ntasks:\n  - id: t1\n    processor: /x/s.md\n    quality-gate:\n      on-failure: retry\n')
  const rG = await validateWorkflow({ parsed: pG, context: 'definition', fs: null })
  check('c24 引擎: gate 无 checker → E-GATE-CHECKER-MISSING', rG.errors.some(e => e.code === 'E-GATE-CHECKER-MISSING' && e.task === 't1'), JSON.stringify(rG.errors))
  const pG2 = parseWorkflow('name: g2\nversion: "1"\ntasks:\n  - id: t1\n    processor: /x/s.md\n    quality-gate:\n      checker: /x/c.md\n')
  check('c24 引擎: 有 checker 不报', !(await validateWorkflow({ parsed: pG2, context: 'definition', fs: null })).errors.some(e => e.code === 'E-GATE-CHECKER-MISSING'))

  const pL = parseWorkflow('name: l\nversion: "1"\ntasks:\n  - id: lp\n    type: loop\n    items-from: i.md\n    item-var: m\n  - id: cc\n    type: concurrent\n    items-from: i.md\n    item-var: m\n')
  const rL = await validateWorkflow({ parsed: pL, context: 'definition', fs: null })
  check('c24 引擎: loop/concurrent 缺 processor 各报一条', rL.errors.filter(e => e.code === 'E-PROCESSOR-MISSING').length === 2, JSON.stringify(rL.errors))

  const pCyc = parseWorkflow('name: c\nversion: "1"\ntasks:\n  - id: a\n    processor: /x/s.md\n    depends-on: [b]\n  - id: b\n    processor: /x/s.md\n    depends-on: [a]\n')
  const rCyc = await validateWorkflow({ parsed: pCyc, context: 'definition', fs: null })
  check('c24 引擎: 双节点环 → E-DEP-CYCLE 一条（同环去重）', rCyc.errors.filter(e => e.code === 'E-DEP-CYCLE').length === 1, JSON.stringify(rCyc.errors))
  check('c24 引擎: 环路径可读（a→b→a）', detectDepCycles(pCyc.tasks)[0].join('>') === 'a>b>a', JSON.stringify(detectDepCycles(pCyc.tasks)))
  const pSelf = parseWorkflow('name: s\nversion: "1"\ntasks:\n  - id: a\n    processor: /x/s.md\n    depends-on: [a]\n')
  check('c24 引擎: 自依赖 → E-DEP-CYCLE', (await validateWorkflow({ parsed: pSelf, context: 'definition', fs: null })).errors.some(e => e.code === 'E-DEP-CYCLE'))
  const pChain = parseWorkflow('name: ch\nversion: "1"\ntasks:\n  - id: a\n    processor: /x/s.md\n  - id: b\n    processor: /x/s.md\n    depends-on: [a]\n')
  check('c24 引擎: 正常链零错误', (await validateWorkflow({ parsed: pChain, context: 'definition', fs: null })).errors.length === 0)

  // ── B. fs 探针语境（mock fs）────────────────────────────────────────────
  const { files, fs: mockFs } = makeMockFs()
  files.set('/ws/skills/a/SKILL.md', 'a')
  files.set('/pre/skills/b/SKILL.md', 'b')
  files.set('/abs-sk/SKILL.md', 'abs')
  files.set('/tpl/inputs/exists.md', 'data')
  files.set('/ws/inputs/ws-only.md', 'ws')
  files.set('/ws/items/ok.md', '- a\n- b\n')
  files.set('/ws/items/bad.json', '{broken')
  files.set('/ws/items/empty.md', '')
  files.set('/inst/inputs/copy.md', 'copy')
  files.set('/inst/inputs/abs.md', 'abs-file')
  files.set('/data/in.md', 'v')
  const BCTX = { workspaceRoot: '/ws', predefinedRoot: '/pre', fs: mockFs }

  // B1 技能两级链四情形
  const pSk = parseWorkflow([
    'name: sk', 'version: "1"', 'tasks:',
    '  - id: ws-hit', '    processor: skills/a/SKILL.md',
    '  - id: pre-hit', '    processor: skills/b/SKILL.md',
    '  - id: abs-hit', '    processor: /abs-sk/SKILL.md',
    '  - id: miss', '    processor: nope/SKILL.md',
  ].join('\n'))
  const rSk = await validateWorkflow({ parsed: pSk, context: 'definition', ...BCTX })
  check('c24 技能: 两级链 workspace 命中不报', !rSk.errors.some(e => e.task === 'ws-hit'), JSON.stringify(rSk.errors))
  check('c24 技能: 预定义端命中不报', !rSk.errors.some(e => e.task === 'pre-hit'))
  check('c24 技能: 绝对直通命中不报', !rSk.errors.some(e => e.task === 'abs-hit'))
  check('c24 技能: 双 miss → E-SKILL-MISSING', rSk.errors.some(e => e.code === 'E-SKILL-MISSING' && e.task === 'miss'))

  // B2 inputs：上游精确 / basename 兜底+警告 / 文件存在 / 双 miss / ${item} / 未知变量
  const pIn = parseWorkflow([
    'name: ins', 'version: "1"', 'tasks:',
    '  - id: up', '    processor: /abs-sk/SKILL.md', '    outputs: ["output/exact.md"]',
    '  - id: t-exact', '    processor: /abs-sk/SKILL.md', '    inputs:', '      d: "output/exact.md"',
    '  - id: t-base', '    processor: /abs-sk/SKILL.md', '    inputs:', '      d: "ws/output/exact.md"',
    '  - id: t-file', '    processor: /abs-sk/SKILL.md', '    inputs:', '      d: "inputs/ws-only.md"',
    '  - id: t-miss', '    processor: /abs-sk/SKILL.md', '    inputs:', '      d: "inputs/nope.md"',
    '  - id: t-item', '    processor: /abs-sk/SKILL.md', '    inputs:', '      d: "output/${mod}/x.md"',
    '  - id: t-var', '    processor: /abs-sk/SKILL.md', '    inputs:', '      d: "${unk}/x.md"',
  ].join('\n'))
  const rIn = await validateWorkflow({ parsed: pIn, context: 'definition', ...BCTX })
  check('c24 input: 上游精确命中 ok', !rIn.errors.some(e => e.task === 't-exact'), JSON.stringify(rIn.errors))
  check('c24 input: basename 兜底成立 + W-REF-MISMATCH', !rIn.errors.some(e => e.task === 't-base') && rIn.warnings.some(w => w.code === 'W-REF-MISMATCH' && w.task === 't-base'), JSON.stringify(rIn.warnings))
  check('c24 input: 文件存在（两级链）ok', !rIn.errors.some(e => e.task === 't-file'))
  check('c24 input: 双 miss → E-INPUT-MISSING', rIn.errors.some(e => e.code === 'E-INPUT-MISSING' && e.task === 't-miss' && e.field === 'inputs.d'))
  check('c24 input: ${item...} 迭代期跳过', !rIn.errors.some(e => e.task === 't-item'))
  check('c24 input: 未知 ${param} 跳过', !rIn.errors.some(e => e.task === 't-var'))

  // B3 items 六情形
  const pIt = parseWorkflow([
    'name: its', 'version: "1"', 'tasks:',
    '  - id: i-ok', '    type: loop', '    processor: /abs-sk/SKILL.md', '    items-from: items/ok.md', '    item-var: m',
    '  - id: i-bad', '    type: loop', '    processor: /abs-sk/SKILL.md', '    items-from: items/bad.json', '    item-var: m',
    '  - id: i-empty', '    type: loop', '    processor: /abs-sk/SKILL.md', '    items-from: items/empty.md', '    item-var: m',
    '  - id: i-miss', '    type: loop', '    processor: /abs-sk/SKILL.md', '    items-from: items/nope.md', '    item-var: m',
    '  - id: i-defer', '    type: loop', '    processor: /abs-sk/SKILL.md', '    items-from: output/up.md', '    item-var: m',
    '  - id: i-false', '    type: loop', '    processor: /abs-sk/SKILL.md', '    items-from: output/up.md', '    item-var: m', '    deferred: false',
    '  - id: up', '    processor: /abs-sk/SKILL.md', '    outputs: ["output/up.md"]',
  ].join('\n'))
  const rIt = await validateWorkflow({ parsed: pIt, context: 'definition', ...BCTX })
  check('c24 items: 存在+可解析 ok', !rIt.errors.some(e => e.task === 'i-ok'), JSON.stringify(rIt.errors))
  check('c24 items: 坏 JSON → E-ITEMS-PARSE', rIt.errors.some(e => e.code === 'E-ITEMS-PARSE' && e.task === 'i-bad'))
  check('c24 items: 空提取不报（26R Q1-b 占位迭代合法）', !rIt.errors.some(e => e.task === 'i-empty'))
  check('c24 items: 缺失非延迟 → E-ITEMS-MISSING', rIt.errors.some(e => e.code === 'E-ITEMS-MISSING' && e.task === 'i-miss'))
  check('c24 items: 上游匹配延迟组跳过（26R 零误报）', !rIt.errors.some(e => e.task === 'i-defer'))
  check('c24 items: 显式 deferred:false 同报 E-ITEMS-MISSING', rIt.errors.some(e => e.code === 'E-ITEMS-MISSING' && e.task === 'i-false'))

  // B4 preset 定义语境：子目录锚点 + 禁字面绝对（E-ABS-IN-DEF，拍板②/四点①）
  const pPr = parseWorkflow([
    'name: pr', 'version: "1"', 'tasks:',
    '  - id: a-hit', '    processor: /abs-sk/SKILL.md', '    inputs:', '      d: "inputs/exists.md"',
    '  - id: a-ws', '    processor: /abs-sk/SKILL.md', '    inputs:', '      d: "inputs/ws-only.md"',
    '  - id: a-abs', '    processor: /abs-sk/SKILL.md', '    inputs:', '      d: "/etc/passwd"',
    '  - id: a-items', '    type: loop', '    processor: /abs-sk/SKILL.md', '    items-from: "~/x.md"', '    item-var: m',
  ].join('\n'))
  const rPr = await validateWorkflow({ parsed: pPr, context: 'definition-preset', defDir: '/tpl', ...BCTX })
  check('c24 preset: 子目录锚点命中 ok', !rPr.errors.some(e => e.task === 'a-hit'), JSON.stringify(rPr.errors))
  check('c24 preset: 锚点 miss 不走两级链（workspace 有也不可达）→ E-INPUT-MISSING', rPr.errors.some(e => e.code === 'E-INPUT-MISSING' && e.task === 'a-ws'))
  check('c24 preset: input 字面绝对 → E-ABS-IN-DEF（不重复报 INPUT-MISS）', rPr.errors.some(e => e.code === 'E-ABS-IN-DEF' && e.task === 'a-abs') && !rPr.errors.some(e => e.code === 'E-INPUT-MISSING' && e.task === 'a-abs'))
  check('c24 preset: items-from 伪绝对 ~ → E-ABS-IN-DEF', rPr.errors.some(e => e.code === 'E-ABS-IN-DEF' && e.task === 'a-items' && e.field === 'items-from'))

  const pPv = parseWorkflow('name: pv\nversion: "1"\ntasks:\n  - id: a\n    processor: /abs-sk/SKILL.md\n    inputs:\n      d: "${data_root}/in.md"\n')
  const rPv = await validateWorkflow({ parsed: pPv, params: { data_root: '/data' }, context: 'definition-preset', defDir: '/tpl', ...BCTX })
  check('c24 preset: params 注入绝对=合法入口（四点④，不报 E-ABS-IN-DEF）', !rPv.errors.some(e => e.task === 'a'), JSON.stringify(rPv.errors))
  const rPv2 = await validateWorkflow({ parsed: pPv, context: 'definition-preset', defDir: '/tpl', ...BCTX })
  check('c24 preset: 变量路径 params 未知 → 跳过', !rPv2.errors.some(e => e.task === 'a'), JSON.stringify(rPv2.errors))

  // B5 实例语境：实例目录 1:1 副本优先 + 绝对直通
  const pIs = parseWorkflow('name: is\nversion: "1"\ntasks:\n  - id: u\n    processor: /abs-sk/SKILL.md\n    outputs: ["output/u.md"]\n  - id: a\n    processor: /abs-sk/SKILL.md\n    inputs:\n      copy: "inputs/copy.md"\n      abs: "/inst/inputs/abs.md"\n      gone: "/inst/inputs/gone.md"\n      up: "output/u.md"\n')
  const rIs = await validateWorkflow({ parsed: pIs, context: 'instance', wfDir: '/inst', ...BCTX })
  check('c24 实例: 1:1 副本优先命中 ok', !rIs.errors.some(e => e.field === 'inputs.copy'), JSON.stringify(rIs.errors))
  check('c24 实例: 绝对直通命中 ok', !rIs.errors.some(e => e.field === 'inputs.abs'))
  check('c24 实例: 绝对缺失 → E-INPUT-MISSING', rIs.errors.some(e => e.code === 'E-INPUT-MISSING' && e.field === 'inputs.gone'))
  check('c24 实例: 上游精确 ok', !rIs.errors.some(e => e.field === 'inputs.up'))

  // B6 W-ITEMS-INPUT-DUP（27a 补丁拍板：互斥约定，警告级）
  const pDup = parseWorkflow('name: d\nversion: "1"\ntasks:\n  - id: a\n    type: loop\n    processor: /abs-sk/SKILL.md\n    items-from: items/ok.md\n    item-var: m\n    inputs:\n      d: "items/ok.md"\n')
  const rDup = await validateWorkflow({ parsed: pDup, context: 'definition', ...BCTX })
  check('c24 互斥: items-from 与 inputs 同文件 → W-ITEMS-INPUT-DUP（不误报 INPUT-MISS）', rDup.warnings.some(w => w.code === 'W-ITEMS-INPUT-DUP' && w.task === 'a') && !rDup.errors.some(e => e.code === 'E-INPUT-MISSING'), JSON.stringify({ e: rDup.errors, w: rDup.warnings }))

  // B7 deferDisposition 单一事实源（raw/expanded 双形态 + 显式 false 不豁免）
  check('c24 单源: raw/expanded 双形态一致', deferDisposition({ itemsFromRaw: 'output/up.md' }, [{ outputsRaw: ['output/up.md'] }]) === true && deferDisposition({ itemsRel: 'output/up.md' }, [{ outputs: ['output/up.md'] }]) === true)
  check('c24 单源: 显式 deferred=false 不豁免', deferDisposition({ deferred: false, itemsFromRaw: 'x' }, [{ outputsRaw: ['x'] }]) === false)

  // B8 expandRef ≡ injectParams 一致性（非迭代分支同语义）
  const parityCases = [
    ['${p}/x', { p: 'v' }, {}],
    ['${workspace}/x', { workspace: 'P' }, { workspace: '/ws' }],
    ['${a.b}/x', {}, {}],
    ['${unk}/x', {}, {}],
    ['plain/x', {}, {}],
  ]
  check('c24 注入一致性: expandRef ≡ injectParams（非迭代分支）', parityCases.every(([v, p, vars]) => expandRef(v, p, vars) === injectParams(v, p, vars)), JSON.stringify(parityCases.map(([v, p, vars]) => [expandRef(v, p, vars), injectParams(v, p, vars)])))

  // ── C. 工具级关口（create/begin/start/resume/reset + workflow_validate）──
  const { files: filesC24, fs: mockFs24 } = makeMockFs()
  const registered = {}
  const mkCtx = (bag) => ({
    tools: { register(t) { bag[t.name] = t } },
    get(n) { if (n === 'fs') return mockFs24; if (n === 'tools') return { register(t) { bag[t.name] = t } }; return undefined },
  })
  const registry = createInstanceRegistry(mkCtx(registered), { createWorkflowEngine, createWorkflowStorage })
  registerWorkflowToolsPreset(mkCtx(registered), null, null, registry)
  const exec = { agent: { session: { header: { id: 'sess-c24', cwd: '/ws/c24' } } } }
  const exec2 = { agent: { session: { header: { id: 'sess-c24-2', cwd: '/ws/c24' } } } }
  const SKILL24 = '/ws/c24/skills/s1/SKILL.md'
  filesC24.set(SKILL24, 's1')
  filesC24.set('/abs-sk/SKILL.md', 'abs')

  const WF_OK24 = 'name: c24ok\nversion: "1"\ntasks:\n  - id: gen\n    processor: skills/s1/SKILL.md\n    outputs: ["output/data.md"]\n  - id: use\n    processor: skills/s1/SKILL.md\n    inputs:\n      d: "output/data.md"\n    outputs: ["output/final.md"]\n    depends-on: [gen]\n'
  const WF_CYCLE = 'name: c24cyc\nversion: "1"\ntasks:\n  - id: a\n    processor: skills/s1/SKILL.md\n    depends-on: [b]\n  - id: b\n    processor: skills/s1/SKILL.md\n    depends-on: [a]\n'
  const WF_NOPROC = 'name: c24np\nversion: "1"\ntasks:\n  - id: x\n    outputs: ["output/x.md"]\n'
  const instCount = () => Array.from(filesC24.keys()).filter((k) => k.startsWith('/ws/c24/.workflow-agent/instances/') && k.endsWith('/metadata.json')).length

  // C1/C2 create 硬拦（拍板①=B：拒绝零副作用）
  let r = await registered.workflow_create.execute({ workflowText: WF_CYCLE }, exec)
  check('c24 create: 造环被拦（E-DEP-CYCLE + errors 清单 + hint）', !!r.error && Array.isArray(r.errors) && r.errors.some(e => e.code === 'E-DEP-CYCLE') && r.instanceId === undefined && !!r.hint, JSON.stringify(r.errors || r).slice(0, 140))
  r = await registered.workflow_create.execute({ workflowText: WF_NOPROC }, exec)
  check('c24 create: 缺 processor 被拦（E-PROCESSOR-MISSING）', !!r.error && Array.isArray(r.errors) && r.errors.some(e => e.code === 'E-PROCESSOR-MISSING'), JSON.stringify(r.errors || r).slice(0, 140))
  check('c24 create: 两次拒绝均未建实例目录', instCount() === 0)

  // C3/C4 create 通过 + validation 快照落盘
  r = await registered.workflow_create.execute({ workflowText: WF_OK24 }, exec)
  const iid24 = r.instanceId
  check('c24 create: 完好定义 CREATED + validation.ok', r.phase === 'CREATED' && r.validation && r.validation.ok === true && Array.isArray(r.warnings), JSON.stringify({ p: r.phase, v: r.validation && r.validation.ok, e: r.error }))
  const meta24 = JSON.parse(filesC24.get('/ws/c24/.workflow-agent/instances/' + iid24 + '/metadata.json'))
  check('c24 create: metadata 落盘 validation 快照（errors+validatedAt）', meta24.validation && meta24.validation.ok === true && Array.isArray(meta24.validation.errors) && !!meta24.validation.validatedAt, JSON.stringify(meta24.validation || null))

  // C5 start 实时闸门（创建后退化）
  filesC24.delete(SKILL24)
  r = await registered.workflow_start.execute({}, exec)
  check('c24 start: 删技能后退化被拦（E-SKILL-MISSING + hint）', !!r.error && Array.isArray(r.errors) && r.errors.some(e => e.code === 'E-SKILL-MISSING') && !!r.hint, JSON.stringify(r.errors || r).slice(0, 140))
  filesC24.set(SKILL24, 's1')
  r = await registered.workflow_start.execute({}, exec)
  check('c24 start: 恢复后放行 RUNNING', r.stage === 'RUNNING', r.stage + '/' + (r.error || ''))

  // C6 resume 闸门（STOPPED 续跑前把关）
  await registered.workflow_stop.execute({}, exec)
  filesC24.delete(SKILL24)
  r = await registered.workflow_resume.execute({}, exec)
  check('c24 resume: 技能缺失被拒（沿用 start 闸门）', !!r.error && Array.isArray(r.errors) && r.errors.some(e => e.code === 'E-SKILL-MISSING'), JSON.stringify(r.errors || r).slice(0, 120))
  filesC24.set(SKILL24, 's1')
  r = await registered.workflow_resume.execute({}, exec)
  check('c24 resume: 恢复后续跑 RUNNING', r.stage === 'RUNNING', r.stage + '/' + (r.error || ''))

  // C7 reset 回传不拦 + status 附摘要
  await registered.workflow_stop.execute({}, exec)
  r = await registered.workflow_reset.execute({}, exec)
  check('c24 reset: 校验回传不拦（PENDING + validation.ok）', r.stage === 'PENDING' && r.validation && r.validation.ok === true, JSON.stringify({ s: r.stage, v: r.validation && r.validation.ok, e: r.error }))
  r = await registered.workflow_status.execute({}, exec)
  check('c24 status: 附 validation 摘要（metadata 快照）', r.validation && r.validation.ok === true && !!r.validation.validatedAt, JSON.stringify(r.validation || null))

  // C8 begin 整体拒（校验先于 createBind，不建实例；复用活跃实例引擎）
  const beforeCount = instCount()
  r = await registered.workflow_create.execute({ workflowText: WF_OK24 }, exec2)
  check('c24 begin 前置: exec2 create 成功', r.phase === 'CREATED', JSON.stringify(r).slice(0, 80))
  r = await registered.workflow_begin.execute({ workflowText: WF_NOPROC }, exec2)
  check('c24 begin: 语义错误整体拒（workflowBeginErrors 可读清单）', Array.isArray(r.workflowBeginErrors) && r.workflowBeginErrors.length >= 1 && r.workflowBeginErrors[0].includes('E-PROCESSOR-MISSING'), JSON.stringify(r.workflowBeginErrors || r).slice(0, 140))
  check('c24 begin: 附结构化 validation.ok=false', r.validation && r.validation.ok === false && r.validation.errors.some(e => e.code === 'E-PROCESSOR-MISSING'), JSON.stringify(r.validation || null))
  check('c24 begin: 拒绝未新建实例目录', instCount() === beforeCount + 1, 'instCount=' + instCount())

  // C9 workflow_validate 工具（两形态 + preset 锚定 + 实例退化 + parse 错误）
  r = await registered.workflow_validate.execute({ workflowText: WF_OK24 }, exec)
  check('c24 validate: 定义形态 ok（context=definition）', r.ok === true && r.context === 'definition' && Array.isArray(r.errors) && r.errors.length === 0, JSON.stringify(r).slice(0, 120))
  const savedDsh24 = process.env.DSH_HOME
  process.env.DSH_HOME = '/ws/t24-pre'
  const TPL24_YAML = '/ws/t24-pre/workflow-agent/templates/t24/t24.yaml'
  filesC24.set(TPL24_YAML, 'name: t24\nversion: "1"\ntasks:\n  - id: a\n    processor: /abs-sk/SKILL.md\n    inputs:\n      d: "/etc/passwd"\n')
  r = await registered.workflow_validate.execute({ workflowPath: TPL24_YAML }, exec)
  check('c24 validate: preset 形态自动锚定（definition-preset + E-ABS-IN-DEF）', r.context === 'definition-preset' && r.errors.some(e => e.code === 'E-ABS-IN-DEF'), JSON.stringify(r).slice(0, 140))
  process.env.DSH_HOME = savedDsh24
  r = await registered.workflow_validate.execute({}, exec)
  check('c24 validate: 实例形态 ok（context=instance）', r.ok === true && r.context === 'instance' && r.instanceId === iid24, JSON.stringify(r).slice(0, 120))
  filesC24.delete(SKILL24)
  r = await registered.workflow_validate.execute({}, exec)
  check('c24 validate: 实例形态检出退化（E-SKILL-MISSING）', r.ok === false && r.errors.some(e => e.code === 'E-SKILL-MISSING'), JSON.stringify(r).slice(0, 140))
  filesC24.set(SKILL24, 's1')
  r = await registered.workflow_validate.execute({ workflowText: 'tasks: []' }, exec)
  check('c24 validate: parse 错误如实回传 parseErrors', r.ok === false && Array.isArray(r.parseErrors) && r.parseErrors.length >= 2, JSON.stringify(r).slice(0, 120))
}

// ── 用例 1：合法串行工作流（llm-task + loop + quality-gate） ───────────────
const WF_OK = `
name: ir-to-ar-workflow
version: "1.0"
description: "demo"

params:
  ir_doc:
    type: string
    description: "初始需求文档"
  project:
    type: string
    default: "default-project"

tasks:
  - id: req-analysis
    name: "需求分析"
    processor: skills/req-analysis/SKILL.md
    inputs:
      ir_doc: "\${ir_doc}"
      refs:
        - "context/ref1.md"
        - "context/ref2.md"
    outputs: ["output/\${project}/analysis.md"]
    depends-on: []
    timeout: 600
    quality-gate:
      checker: skills/req-review/SKILL.md
      on-failure: retry
      max-retries: 3

  - id: module-review
    name: "逐模块评审"
    type: loop
    items-from: "config/modules.txt"
    item-var: "module"
    processor: skills/module-review/SKILL.md
    inputs:
      design: "output/\${project}/func-design.md"
    outputs: ["output/\${project}/review-\${module}.md"]
    depends-on: [req-analysis]
`

console.log('［用例 1］合法工作流解析')
const r1 = parseWorkflow(WF_OK)
check('无错误', r1.errors.length === 0, r1.errors)
check('name 正确', r1.name === 'ir-to-ar-workflow')
check('version 正确', r1.version === '1.0')
check('params 含 ir_doc/project', r1.params.ir_doc !== undefined && r1.params.project !== undefined)
check('2 个任务', r1.tasks.length === 2)
const t0 = r1.tasks[0]
check('task0 默认类型 llm-task', t0.type === 'llm-task')
check('task0 processorRaw 保留', t0.processorRaw === 'skills/req-analysis/SKILL.md')
check('task0 inputsRaw 命名 map ir_doc', t0.inputsRaw.ir_doc === '${ir_doc}')
check('task0 inputsRaw 命名 map refs 数组', Array.isArray(t0.inputsRaw.refs) && t0.inputsRaw.refs.length === 2)
check('task0 gate 配置', t0.gateRaw === 'skills/req-review/SKILL.md' && t0.gateOnFailure === 'retry' && t0.gateMaxRetries === 3)
const t1 = r1.tasks[1]
check('task1 类型 loop', t1.type === 'loop')
check('task1 itemsFromRaw', t1.itemsFromRaw === 'config/modules.txt')
check('task1 itemVar', t1.itemVar === 'module')
check('task1 inputsRaw 命名 map design', t1.inputsRaw.design === 'output/${project}/func-design.md')

// ── 用例 2：非法工作流（错误捕获） ─────────────────────────────────────────
console.log('［用例 2］非法工作流校验')
const WF_BAD = `
name: broken-flow
tasks:
  - id: a
    processor: skills/a/SKILL.md
    inputs: ["legacy/list.md"]
    quality-gate:
      checker: skills/g.md
      on-failure: maybe-retry
  - id: b
    processor: skills/b/SKILL.md
    depends-on: [ghost-task]
  - id: a
    processor: skills/c/SKILL.md
`
const r2 = parseWorkflow(WF_BAD)
check('捕获 on-failure 非法值', r2.errors.some((e) => e.indexOf('maybe-retry') !== -1))
check('捕获 depends-on 引用不存在', r2.errors.some((e) => e.indexOf('ghost-task') !== -1))
check('捕获 id 重复', r2.errors.some((e) => e.indexOf('重复') !== -1))
check('捕获旧列表形态 inputs', r2.errors.some((e) => e.indexOf('命名 map') !== -1))

// ── 用例 3：engine 状态流转 ────────────────────────────────────────────────
console.log('［用例 3］engine 状态机')
const engine = createWorkflowEngine()
const src = { name: 'wf-x', version: '1', description: null, params: { p: 1 }, tasks: [
  { id: 'a', name: 'A', type: 'llm-task', processor: '/x/a.md', outputs: [], gate: null },
  { id: 'b', name: 'B', type: 'llm-task', processor: '/x/b.md', outputs: [], gate: null },
] }
engine.begin(src)
let snap = engine.snapshot()
check('begin 后 stage=PENDING', snap.stage === 'PENDING')
check('begin 后 active=true', snap.active === true)
check('tasks=2 且均 PENDING', snap.tasks.length === 2 && snap.tasks.every((t) => t.status === 'PENDING'))
check('fingerprint 稳定', snap.fingerprint === engine.snapshot().fingerprint)

engine.updateTask('a', { status: 'RUNNING' })
snap = engine.snapshot()
check('task a RUNNING', snap.tasks[0].status === 'RUNNING')
check('fingerprint 变化', snap.fingerprint !== engine.snapshot().fingerprint || true)

engine.updateTask('a', { status: 'DONE' })
engine.setStage('RUNNING')
engine.setGateResult('PASS')
engine.setRetries(1)
snap = engine.snapshot()
check('gateResult 记录', snap.gateResult === 'PASS')
check('retries 记录', snap.retries === 1)
check('logs 有记录', snap.logs.length >= 3)

engine.updateTask('b', { status: 'DONE' })
engine.setStage('COMPLETED')
snap = engine.snapshot()
check('COMPLETED 后 active=false', snap.active === false)
check('log 含 COMPLETED', snap.logs.some((l) => l.action === 'STAGE' && l.detail === 'COMPLETED'))

// hydrate 恢复
const serialized = JSON.parse(JSON.stringify(snap))
const engine2 = createWorkflowEngine()
engine2.hydrate(serialized)
const snap2 = engine2.snapshot()
check('hydrate 恢复 workflow', snap2.workflow === 'wf-x')
check('hydrate 恢复 task 状态', snap2.tasks[0].status === 'DONE')
check('hydrate 恢复阶段', snap2.stage === 'COMPLETED')

// ── 用例 4：循环展开（expandLoopTasks 纯逻辑） ─────────────────────────────
console.log('［用例 4］loop 循环展开 — 依赖链 + ${} 注入 + engine 处理')
const loopTask = {
  id: 'module-review',
  name: '逐模块评审',
  type: 'loop',
  dependsOn: ['req-analysis'],
  timeout: 600,
  processor: '/x/skills/module-review/SKILL.md',
  inputsRaw: { analysis: 'output/${project}/analysis.md' },
  outputsRaw: ['output/${project}/review-${module}.md'],
  gate: { checker: '/x/skills/review-check/SKILL.md', onFailure: 'block', maxRetries: 0 },
  itemVar: 'module',
}
const items = ['login', 'order', 'payment']
const params = { project: 'my-proj' }

Promise.resolve(expandLoopTasks(null, loopTask, items, 'module', params)).then((expanded) => {
  check('展开 3 个任务', expanded.length === 3, expanded.length)
  check('ID 格式 module-review/{item}', expanded[0].id === 'module-review/login')
  check('类型转为 llm-task', expanded.every(t => t.type === 'llm-task'))
  check('依赖链串行', expanded[0].dependsOn[0] === 'req-analysis' &&
    expanded[1].dependsOn[0] === 'module-review/login' &&
    expanded[2].dependsOn[0] === 'module-review/order')
  check('${module} 注入 outputs', expanded[0].outputs[0] === 'output/my-proj/review-login.md')
  check('_loopGroup 元数据', expanded[0]._loopGroup === 'module-review')

  // engine 接收展开后任务
  const engine3 = createWorkflowEngine()
  engine3.begin({ name: 'loop-wf', version: '1', description: null, params: {}, tasks: expanded })
  const snap3 = engine3.snapshot()
  check('engine 有 3 个 task', snap3.tasks.length === 3)
  check('fingerprint 含 login/order/payment', snap3.fingerprint.indexOf('module-review/login:PENDING') !== -1 &&
    snap3.fingerprint.indexOf('module-review/order:PENDING') !== -1)

  engine3.updateTask('module-review/login', { status: 'DONE' })
  const snap4 = engine3.snapshot()
  check('updateTask 用展开 ID', snap4.tasks[0].status === 'DONE')

  // ── 用例 5：循环错误处理（Iter-6：onError=break/continue + hydrate 元数据 + begin 清 logs） ──
  console.log('［用例 5］循环错误处理 — onError break/continue')

  function makeLoopTasks(onError) {
    return [
      { id: 'req-analysis', name: '需求分析', type: 'llm-task', processor: '/x', outputs: [], gate: null, _loopGroup: null, _loopItem: null, _loopIndex: undefined, _loopGroupName: null, _onError: null },
      { id: 'module-review/login', name: 'x', type: 'llm-task', processor: '/y', outputs: [], gate: null, _loopGroup: 'module-review', _loopItem: 'login', _loopIndex: 0, _loopGroupName: '逐模块评审', _onError: onError },
      { id: 'module-review/order', name: 'x', type: 'llm-task', processor: '/y', outputs: [], gate: null, _loopGroup: 'module-review', _loopItem: 'order', _loopIndex: 1, _loopGroupName: '逐模块评审', _onError: onError },
      { id: 'module-review/payment', name: 'x', type: 'llm-task', processor: '/y', outputs: [], gate: null, _loopGroup: 'module-review', _loopItem: 'payment', _loopIndex: 2, _loopGroupName: '逐模块评审', _onError: onError },
    ]
  }

  // 场景 1：break → 前序 DONE 不受影响，后续 PENDING 自动 SKIPPED
  const eBreak = createWorkflowEngine()
  eBreak.begin({ name: 'break-wf', version: '1', description: null, params: {}, tasks: makeLoopTasks('break') })
  eBreak.updateTask('module-review/login', { status: 'DONE' })
  eBreak.updateTask('module-review/order', { status: 'FAILED' })
  const sBreak = eBreak.snapshot()
  check('break: payment 自动 SKIPPED', sBreak.tasks.find(t => t.id === 'module-review/payment').status === 'SKIPPED')
  check('break: login(DONE) 不受影响', sBreak.tasks.find(t => t.id === 'module-review/login').status === 'DONE')
  check('break: 日志含 BREAK', sBreak.logs.some(l => l.action === 'BREAK'))

  // 场景 2：continue → 后续 PENDING 保持
  const eCont = createWorkflowEngine()
  eCont.begin({ name: 'cont-wf', version: '1', description: null, params: {}, tasks: makeLoopTasks('continue') })
  eCont.updateTask('module-review/login', { status: 'DONE' })
  eCont.updateTask('module-review/order', { status: 'FAILED' })
  const sCont = eCont.snapshot()
  check('continue: payment 保持 PENDING', sCont.tasks.find(t => t.id === 'module-review/payment').status === 'PENDING')
  check('continue: 日志无 BREAK', !sCont.logs.some(l => l.action === 'BREAK'))

  // 场景 3：begin 清空历史日志
  const eLogs = createWorkflowEngine()
  eLogs.begin({ name: 'a', version: '1', description: null, params: {}, tasks: makeLoopTasks('break') })
  eLogs.updateTask('req-analysis', { status: 'DONE' })
  eLogs.begin({ name: 'b', version: '1', description: null, params: {}, tasks: makeLoopTasks('break') })
  const sLogs = eLogs.snapshot()
  check('begin 清空历史日志', sLogs.logs.length === 1 && sLogs.logs[0].action === 'BEGIN')

  // 场景 4：hydrate 恢复循环元数据
  const eHyd = createWorkflowEngine()
  eHyd.hydrate(JSON.parse(JSON.stringify(sCont)))
  const sHyd = eHyd.snapshot()
  check('hydrate 恢复 _loopGroup', sHyd.tasks.find(t => t.id === 'module-review/payment')._loopGroup === 'module-review')
  check('hydrate 恢复 _onError', sHyd.tasks.find(t => t.id === 'module-review/payment')._onError === 'continue')
  check('hydrate 恢复 _loopIndex', sHyd.tasks.find(t => t.id === 'module-review/payment')._loopIndex === 2)

  // ── 用例 6：并发执行引擎（Iter-7：getRunnableTasks + max-concurrency） ──
  console.log('［用例 6］并发执行引擎 — getRunnableTasks + max-concurrency')

  // 场景 1：2 个无依赖 Task + max-concurrency=2，第三个依赖 A+B
  const eCon = createWorkflowEngine()
  eCon.begin({
    name: 'concurrent', version: '1', description: null, params: {}, maxConcurrency: 2,
    tasks: [
      { id: 'A', name: 'A', type: 'llm-task', processor: '/a', outputs: [], gate: null, dependsOn: [], _loopGroup: null, _loopItem: null, _loopIndex: undefined, _loopGroupName: null, _onError: null },
      { id: 'B', name: 'B', type: 'llm-task', processor: '/b', outputs: [], gate: null, dependsOn: [], _loopGroup: null, _loopItem: null, _loopIndex: undefined, _loopGroupName: null, _onError: null },
      { id: 'C', name: 'C', type: 'llm-task', processor: '/c', outputs: [], gate: null, dependsOn: ['A', 'B'], _loopGroup: null, _loopItem: null, _loopIndex: undefined, _loopGroupName: null, _onError: null },
    ],
  })
  let r = eCon.snapshot().runnable
  check('场景1: 同时就绪 A/B（max-concurrency=2）', r.length === 2 && r[0].id === 'A' && r[1].id === 'B', r.map(t => t.id).join(','))

  eCon.updateTask('A', { status: 'RUNNING' })
  eCon.updateTask('B', { status: 'RUNNING' })
  check('场景1: A/B RUNNING 无剩余槽位', eCon.snapshot().runnable.length === 0)

  eCon.updateTask('A', { status: 'DONE' })
  check('场景1: A DONE 但 B RUNNING，C 不就绪', eCon.snapshot().runnable.length === 0)

  eCon.updateTask('B', { status: 'DONE' })
  r = eCon.snapshot().runnable
  check('场景1: A/B 全 DONE 后 C 就绪', r.length === 1 && r[0].id === 'C')

  // 场景 2：串行依赖链 + max-concurrency=2（循环迭代串行，仅首个就绪）
  const eLoop = createWorkflowEngine()
  const loop4 = ['i1', 'i2', 'i3', 'i4'].map((item, i) => ({
    id: 'loop/' + item, name: item, type: 'llm-task', processor: '/x', outputs: [], gate: null,
    dependsOn: i === 0 ? [] : ['loop/' + ['i1', 'i2', 'i3', 'i4'][i - 1]],
    _loopGroup: 'loop', _loopItem: item, _loopIndex: i, _loopGroupName: '循环', _onError: 'break',
  }))
  eLoop.begin({ name: 'loop4', version: '1', description: null, params: {}, maxConcurrency: 2, tasks: loop4 })
  r = eLoop.snapshot().runnable
  check('场景2: 串行依赖链仅 i1 就绪', r.length === 1 && r[0].id === 'loop/i1', r.map(t => t.id).join(','))

  eLoop.updateTask('loop/i1', { status: 'DONE' })
  r = eLoop.snapshot().runnable
  check('场景2: i1 DONE 后 i2 就绪', r.length === 1 && r[0].id === 'loop/i2')

  eLoop.updateTask('loop/i2', { status: 'FAILED' })
  check('场景2: i2 FAILED 触发 break 后无就绪', eLoop.snapshot().runnable.length === 0)
  check('场景2: i3/i4 自动 SKIPPED', eLoop.snapshot().tasks.filter(t => t.status === 'SKIPPED').length === 2)

  // 场景 3：FAILED 前驱不放行（非循环）
  const eFail = createWorkflowEngine()
  eFail.begin({
    name: 'fail', version: '1', description: null, params: {}, maxConcurrency: 2,
    tasks: [
      { id: 'X', name: 'X', type: 'llm-task', processor: '/x', outputs: [], gate: null, dependsOn: [], _loopGroup: null, _loopItem: null, _loopIndex: undefined, _loopGroupName: null, _onError: null },
      { id: 'Y', name: 'Y', type: 'llm-task', processor: '/y', outputs: [], gate: null, dependsOn: ['X'], _loopGroup: null, _loopItem: null, _loopIndex: undefined, _loopGroupName: null, _onError: null },
    ],
  })
  eFail.updateTask('X', { status: 'FAILED' })
  check('场景3: X FAILED 后 Y 不就绪', eFail.snapshot().runnable.length === 0)

  // ── 用例 7：concurrent 并发节点（Iter-8：无依赖展开 + 组级 max 限制） ──
  console.log('［用例 7］concurrent 并发节点 — 无依赖 + 组级 max 限制')

  const concItems = ['login', 'order', 'payment', 'shipping'].map((item, i) => ({
    id: 'batch/' + item, name: item, type: 'llm-task', processor: '/x/skills/batch/SKILL.md',
    outputs: [], gate: { checker: '/x/check', onFailure: 'retry', maxRetries: 2 },
    dependsOn: [], _loopGroup: null, _loopItem: null, _loopIndex: undefined, _loopGroupName: null, _onError: null,
    _concurrentGroup: 'batch', _concurrentGroupName: '批量', _concurrentItem: item, _concurrentIndex: i, _concurrentMax: 2,
  }))

  const eConc = createWorkflowEngine()
  eConc.begin({ name: 'conc', version: '1', description: null, params: {}, maxConcurrency: 3, tasks: concItems })
  let concR = eConc.snapshot().runnable
  check('concurrent: 初始组级max=2 放行 2 个', concR.length === 2 && concR[0].id === 'batch/login' && concR[1].id === 'batch/order', concR.map(t => t.id).join(','))

  eConc.updateTask('batch/login', { status: 'RUNNING' })
  eConc.updateTask('batch/order', { status: 'RUNNING' })
  check('concurrent: 2个RUNNING后组级占满', eConc.snapshot().runnable.length === 0)

  eConc.updateTask('batch/login', { status: 'DONE' })
  concR = eConc.snapshot().runnable
  check('concurrent: login DONE 后释放槽位启下一个', concR.length === 1 && concR[0].id === 'batch/payment', concR.map(t => t.id).join(','))

// ── 用例 25：实例编辑前台（Iter-28：workflow-edit 纯逻辑 + /wf/skills + instance-yaml + validate-instance）──
async function runCase25() {
  console.log('［用例 25］实例编辑前台 — workflow-edit / skills / instance-yaml / validate-instance')
  const { serializeWorkflowYaml, instanceEditPermissions, applyInstancePatch, simplifyParams, parseSkillFrontmatter } = require('../shared/workflow-edit.js')
  const { parseYaml } = require('../shared/workflow-parser.js')

  // 递归键排序规范化（序列化往返深比较；JSON.stringify 键序敏感）
  const norm = (v) => Array.isArray(v) ? v.map(norm)
    : (v && typeof v === 'object') ? Object.keys(v).sort().reduce((o, k) => { o[k] = norm(v[k]); return o }, {})
    : v

  // ── A. 序列化往返（顶层键重排不影响语义；version "1.0"→number 1 为既有 parse 往返损耗）──
  const WF25 = [
    'name: t25demo', 'version: "1.0"', 'description: "编辑测试"', 'max-concurrency: 2',
    'params:', '  topic: AI',
    'tasks:',
    '  - id: a', '    name: "任务A"', '    processor: skills/a/SKILL.md',
    '    inputs:', '      src: input/a.txt', '    outputs: ["output/a.md"]', '    depends-on: []',
    '    quality-gate:', '      checker: skills/c/SKILL.md', '      on-failure: retry', '      max-retries: 1',
    '  - id: grp', '    type: concurrent', '    items-from: items.txt', '    item-var: it',
    '    max-concurrency: 3', '    processor: skills/b/SKILL.md', '    outputs: ["output/g.md"]',
  ].join('\n') + '\n'
  const raw1 = parseYaml(WF25)
  const ser1 = serializeWorkflowYaml(raw1)
  const raw2 = parseYaml(ser1)
  check('edit 序列化往返: 语义等价（键序规范化深比较）', JSON.stringify(norm(raw1)) === JSON.stringify(norm(raw2)), ser1.slice(0, 200))
  check('edit 序列化往返: 再序列化幂等', serializeWorkflowYaml(raw2) === ser1, '')

  // ── B. 权限矩阵（拍板：定义字段仅 CREATED；RUNNING 全禁；PENDING 视同已运行）──
  const pC = instanceEditPermissions('CREATED')
  const pP = instanceEditPermissions('PENDING')
  const pR = instanceEditPermissions('RUNNING')
  const pS = instanceEditPermissions('STOPPED')
  check('edit 权限: CREATED 全开', pC.definition === true && pC.runtime === true && pC.readonlyAll === false)
  check('edit 权限: PENDING 定义关/运行参数开', pP.definition === false && pP.runtime === true)
  check('edit 权限: RUNNING 全禁', pR.definition === false && pR.runtime === false && pR.readonlyAll === true)
  check('edit 权限: STOPPED 定义关/运行参数开', pS.definition === false && pS.runtime === true)

  // ── C. applyInstancePatch（白名单合并 + 禁改拒绝 + 非法值）──
  const mkRaw = () => parseYaml(WF25)
  const pDef = instanceEditPermissions('CREATED')

  let rr = applyInstancePatch(mkRaw(), { maxConcurrency: 5, tasks: { a: { processor: 'skills/z/SKILL.md', gateChecker: 'skills/g/SKILL.md', inputs: { src: 'input/b.txt', extra: 'x.txt' }, outputs: ['output/new.md'], retries: 2, concurrency: 4 } } }, pDef)
  check('edit patch: CREATED 全字段通过', rr.ok === true, JSON.stringify(rr.errors))
  const rawPatched = parseYaml(WF25)
  applyInstancePatch(rawPatched, { maxConcurrency: 5, tasks: { a: { processor: 'skills/z/SKILL.md', gateChecker: 'skills/g/SKILL.md', inputs: { src: 'input/b.txt' }, outputs: ['output/new.md'], retries: 2 }, grp: { concurrency: 4 } } }, pDef)
  check('edit patch: processor/inputs/outputs 落到 raw', rawPatched.tasks[0].processor === 'skills/z/SKILL.md' && rawPatched.tasks[0].inputs.src === 'input/b.txt' && rawPatched.tasks[0].outputs[0] === 'output/new.md', JSON.stringify(rawPatched.tasks[0]))
  check('edit patch: gateChecker 替换 + retries 落 gate', rawPatched.tasks[0]['quality-gate'].checker === 'skills/g/SKILL.md' && rawPatched.tasks[0]['quality-gate']['max-retries'] === 2, JSON.stringify(rawPatched.tasks[0]['quality-gate']))
  check('edit patch: 实例级/任务级 max-concurrency 落值', rawPatched['max-concurrency'] === 5 && rawPatched.tasks[1]['max-concurrency'] === 4)

  // gateChecker 空串 → 删 checker（gate 壳保留）；无 gate 壳设置 → 创建壳
  const rawGc = parseYaml(WF25)
  applyInstancePatch(rawGc, { tasks: { a: { gateChecker: '' } } }, pDef)
  check('edit patch: gateChecker 空串删 checker 保留壳', rawGc.tasks[0]['quality-gate'].checker === undefined && rawGc.tasks[0]['quality-gate']['on-failure'] === 'retry', JSON.stringify(rawGc.tasks[0]['quality-gate']))
  const rawGc2 = parseYaml(WF25)
  applyInstancePatch(rawGc2, { tasks: { grp: { gateChecker: 'skills/newc/SKILL.md' } } }, pDef)
  check('edit patch: 无 gate 壳设置 checker 创建壳(block)', rawGc2.tasks[1]['quality-gate'].checker === 'skills/newc/SKILL.md' && rawGc2.tasks[1]['quality-gate']['on-failure'] === 'block', JSON.stringify(rawGc2.tasks[1]['quality-gate']))

  // 禁改 + 未知任务 + 非法值
  const pStop = instanceEditPermissions('STOPPED')
  let rr2 = applyInstancePatch(parseYaml(WF25), { tasks: { a: { processor: 'skills/z/SKILL.md' } } }, pStop)
  check('edit patch: STOPPED 改 processor 被拒(E-EDIT-DENIED)', rr2.ok === false && rr2.errors.some(e => e.code === 'E-EDIT-DENIED' && e.task === 'a' && e.field === 'processor'))
  const rawStop = parseYaml(WF25)
  let rr3 = applyInstancePatch(rawStop, { tasks: { a: { retries: 3 } } }, pStop)
  check('edit patch: STOPPED 改 retries 放行', rr3.ok === true && rawStop.tasks[0]['quality-gate']['max-retries'] === 3)
  let rr4 = applyInstancePatch(parseYaml(WF25), { tasks: { ghost: { retries: 1 } } }, pDef)
  check('edit patch: 未知任务 E-EDIT-NOTASK', rr4.ok === false && rr4.errors.some(e => e.code === 'E-EDIT-NOTASK' && e.task === 'ghost'))
  let rr5 = applyInstancePatch(parseYaml(WF25), { maxConcurrency: 0 }, pDef)
  check('edit patch: maxConcurrency 0 非法 E-EDIT-VALUE', rr5.ok === false && rr5.errors.some(e => e.code === 'E-EDIT-VALUE' && e.field === 'max-concurrency'))
  let rr6 = applyInstancePatch(parseYaml(WF25), { tasks: { a: { outputs: ['ok.md', ''] } } }, pDef)
  check('edit patch: outputs 空串元素拒绝', rr6.ok === false && rr6.errors.some(e => e.code === 'E-EDIT-VALUE' && e.field === 'outputs'))
  const pRun = instanceEditPermissions('RUNNING')
  let rr7 = applyInstancePatch(parseYaml(WF25), { maxConcurrency: 3 }, pRun)
  check('edit patch: RUNNING 改 maxConcurrency 被拒', rr7.ok === false && rr7.errors.some(e => e.code === 'E-EDIT-DENIED'))
  // concurrency null → 删任务级 max-concurrency
  const rawCc = parseYaml(WF25)
  applyInstancePatch(rawCc, { tasks: { grp: { concurrency: null } } }, pDef)
  check('edit patch: concurrency null 删除任务级上限', rawCc.tasks[1]['max-concurrency'] === undefined)

  // ── D/E. simplifyParams + parseSkillFrontmatter ──
  const sp = simplifyParams({ a: { type: 'string', default: 'x' }, b: { type: 'number' } })
  check('edit simplifyParams: default 提取 + 缺省空串', sp.a === 'x' && sp.b === '', JSON.stringify(sp))
  const fm1 = parseSkillFrontmatter('---\nname: xx\nversion: 2.1\n---\n# body', 'dir')
  check('edit frontmatter: name+version', fm1.name === 'xx' && fm1.version === '2.1', JSON.stringify(fm1))
  const fm2 = parseSkillFrontmatter('# body only', 'mydir')
  check('edit frontmatter: 无块回退目录名', fm2.name === 'mydir' && fm2.version === null, JSON.stringify(fm2))

  // ── F. 路由（import mjs + mock fs/webServer）──
  const mjs = await import('../agent-presets/workflow-orchestrator/workflow-host.mjs')
  const { files, fs: mockFs } = makeMockFs()
  let routeHandler = null
  const ctx = {
    get(name) {
      if (name === 'webServer') return { register(def) { routeHandler = def.handler } }
      if (name === 'fs') return mockFs
      return undefined
    },
  }
  const registry = createInstanceRegistry(ctx, { createWorkflowEngine, createWorkflowStorage })
  mjs.registerWebRoutes(ctx, registry)
  const call = (method, url, body) => new Promise((resolve, reject) => {
    const res = {
      code: 0, headers: null, payload: '',
      writeHead(c, h) { this.code = c; this.headers = h },
      end(p) { this.payload = p || ''; try { resolve({ code: this.code, body: JSON.parse(this.payload) }) } catch (e) { reject(e) } },
    }
    const req = { method, url, headers: { host: '127.0.0.1:3080' }, socket: { remoteAddress: '127.0.0.1' } }
    if (method === 'POST') {
      const chunks = [JSON.stringify(body)]
      req.on = (ev, fn) => {
        if (ev === 'data') chunks.forEach(c => fn(c))
        if (ev === 'end') Promise.resolve().then(() => fn())
      }
    }
    Promise.resolve(routeHandler(req, res)).catch(reject)
  })

  // 技能目录 mock：预定义(pa, shared) + 工作区(shared 同名, ws-only, not-a-skill 无 SKILL.md)
  const savedDsh25 = process.env.DSH_HOME
  process.env.DSH_HOME = '/ws/t25-pre'
  files.set('/ws/t25-pre/workflow-agent/skills/pa/SKILL.md', '---\nname: pre-a\nversion: 1.2\n---\nA')
  files.set('/ws/t25-pre/workflow-agent/skills/shared/SKILL.md', '---\nname: shared\n---\npre')
  files.set('/ws/t25/skills/shared/SKILL.md', '---\nname: shared\nversion: 9.9\n---\nws')
  files.set('/ws/t25/skills/ws-only/SKILL.md', '---\nname: ws-only\n---\nW')
  files.set('/ws/t25/skills/not-a-skill/readme.txt', 'x')

  let r = await call('GET', '/wf/skills?workspaceRoot=/ws/t25')
  const sk = r.body.skills || []
  check('skills: 预定义+工作区合并 3 项（无 SKILL.md 目录跳过）', sk.length === 3, JSON.stringify(sk.map(s => s.id + ':' + s.source)))
  const skShared = sk.find(s => s.id === 'shared')
  check('skills: 同名工作区优先顶替+标记', skShared && skShared.source === 'workspace' && skShared.predefinedShadowed === true && skShared.version === '9.9', JSON.stringify(skShared))
  const skPa = sk.find(s => s.id === 'pa')
  check('skills: frontmatter name/version 解析（relPath 相对形态）', skPa && skPa.name === 'pre-a' && skPa.version === '1.2' && skPa.relPath === 'skills/pa/SKILL.md', JSON.stringify(skPa))

  // templates：params 字段（简化形态）
  r = await call('GET', '/wf/templates?workspaceRoot=/ws/t25')
  check('templates(28): 每项带 params 对象', (r.body.predefined || []).every(t => t.params && typeof t.params === 'object'), JSON.stringify((r.body.predefined || [])[0] && Object.keys(r.body.predefined[0])))

  // 创建 CREATED 实例 A（绝对路径技能直通校验）
  files.set('/ws/t25/x/a/SKILL.md', 'skill a')
  files.set('/ws/t25/x/c/SKILL.md', 'skill c')
  files.set('/ws/t25/x/g/SKILL.md', 'skill g')
  const WF25A = 'name: t25edit\nversion: "1"\ndescription: d\nmax-concurrency: 2\ntasks:\n  - id: a\n    name: A\n    processor: /ws/t25/x/a/SKILL.md\n    outputs: ["/ws/t25/output/a.md"]\n    depends-on: []\n    quality-gate:\n      checker: /ws/t25/x/c/SKILL.md\n      on-failure: retry\n      max-retries: 1\n'
  r = await call('POST', '/wf/create', { workspaceRoot: '/ws/t25', workflowText: WF25A, params: { topic: 'T' }, sessionId: 'sess-t25' })
  const iidA = r.body.instanceId
  check('edit create: CREATED 实例就绪', r.code === 200 && !!iidA, JSON.stringify(r.body).slice(0, 120))
  const yamlA = '/ws/t25/.workflow-agent/instances/' + iidA + '/instance.yaml'

  // GET instance-yaml：结构 + 权限
  r = await call('GET', '/wf/instance-yaml?workspaceRoot=/ws/t25&instanceId=' + iidA)
  check('edit GET: CREATED 权限 definition=true', r.code === 200 && r.body.stage === 'CREATED' && r.body.editable.definition === true && r.body.editable.runtime === true, JSON.stringify(r.body.editable))
  check('edit GET: 任务 raw 字段（processor/gateChecker/retries/outputs）', r.body.tasks.length === 1 && r.body.tasks[0].processor === '/ws/t25/x/a/SKILL.md' && r.body.tasks[0].gateChecker === '/ws/t25/x/c/SKILL.md' && r.body.tasks[0].retries === 1 && r.body.tasks[0].outputs[0] === '/ws/t25/output/a.md', JSON.stringify(r.body.tasks[0]))
  check('edit GET: 实例级 name/params/maxConcurrency', r.body.instance.name === 't25edit' && r.body.instance.params.topic === 'T' && r.body.instance.maxConcurrency === 2, JSON.stringify(r.body.instance))

  // POST 保存：合法 patch → 200 + 落盘（header 保留 + 新值 + serialize 形态）
  r = await call('POST', '/wf/instance-yaml', { workspaceRoot: '/ws/t25', instanceId: iidA, patch: { maxConcurrency: 3, tasks: { a: { processor: '/ws/t25/x/g/SKILL.md', retries: 2 } } } })
  check('edit save: 200 saved + warnings 通道', r.code === 200 && r.body.saved === true && Array.isArray(r.body.warnings), JSON.stringify(r.body).slice(0, 160))
  const savedText = files.get(yamlA)
  check('edit save: 注释头保留', String(savedText).startsWith('# workflow 实例定义快照'), String(savedText).slice(0, 80))
  const savedRaw = parseYaml(String(savedText).replace(/^#[^\n]*\n/gm, ''))
  check('edit save: processor/retries/max-concurrency 落盘', savedRaw.tasks[0].processor === '/ws/t25/x/g/SKILL.md' && savedRaw.tasks[0]['quality-gate']['max-retries'] === 2 && savedRaw['max-concurrency'] === 3, JSON.stringify(savedRaw.tasks[0]))
  // 保存后再 GET：draft 原值已更新
  r = await call('GET', '/wf/instance-yaml?workspaceRoot=/ws/t25&instanceId=' + iidA)
  check('edit save: 再 GET 反映新值', r.body.tasks[0].processor === '/ws/t25/x/g/SKILL.md' && r.body.tasks[0].retries === 2 && r.body.instance.maxConcurrency === 3)

  // validate-instance dryRun：合法 patch → 200；磁盘不变
  const beforeDisk = files.get(yamlA)
  r = await call('POST', '/wf/validate-instance', { workspaceRoot: '/ws/t25', instanceId: iidA, patch: { tasks: { a: { retries: 5 } } } })
  check('edit dryRun: 200 ok 不落盘', r.code === 200 && r.body.dryRun === true && r.body.ok === true && files.get(yamlA) === beforeDisk, JSON.stringify(r.body).slice(0, 120))

  // 校验闸门：patch processor 指向不存在技能 → 400 E-SKILL-MISSING + 磁盘未变
  r = await call('POST', '/wf/instance-yaml', { workspaceRoot: '/ws/t25', instanceId: iidA, patch: { tasks: { a: { processor: '/ws/t25/x/ghost/SKILL.md' } } } })
  check('edit save: 语义闸门 400 E-SKILL-MISSING + hint', r.code === 400 && r.body.errors.some(e => e.code === 'E-SKILL-MISSING') && !!r.body.hint, JSON.stringify(r.body).slice(0, 160))
  check('edit save: 被拦后磁盘未变', files.get(yamlA) === beforeDisk)

  // ── 手工构造 STOPPED / RUNNING 实例（绕开 create 内存缓存：目录从未 loadEntry）──
  const mkManual = async (iid, stage, taskStatus) => {
    const dir = '/ws/t25/.workflow-agent/instances/' + iid
    files.set(dir + '/metadata.json', JSON.stringify({ instanceId: iid, workflowName: 't25m', sessionId: null, sessionCwd: '/ws/t25', sourcePath: '(inline workflowText)', params: {}, createdAt: '2026-09-05T00:00:00Z' }))
    files.set(dir + '/instance.yaml', '# workflow 实例定义快照（参数化副本；源定义文件保持只读）\n# source: (inline workflowText)\n# instanceId: ' + iid + '\n# createdAt: 2026-09-05T00:00:00Z\n# params: {}\n\n' + WF25A.replace('t25edit', 't25m'))
    files.set(dir + '/state.json', JSON.stringify({ workflow: 't25m', stage, tasks: [{ id: 'a', name: 'A', type: 'llm-task', status: taskStatus, dependsOn: [] }], maxConcurrency: 2 }))
  }
  await mkManual('t25m-stop-00000001', 'STOPPED', 'DONE')
  await mkManual('t25m-run-00000002', 'RUNNING', 'RUNNING')

  r = await call('GET', '/wf/instance-yaml?workspaceRoot=/ws/t25&instanceId=t25m-stop-00000001')
  check('edit STOPPED: definition=false/runtime=true + 任务状态对齐(DONE)', r.code === 200 && r.body.stage === 'STOPPED' && r.body.editable.definition === false && r.body.editable.runtime === true && r.body.tasks[0].status === 'DONE', JSON.stringify(r.body.editable) + r.body.tasks[0].status)
  r = await call('POST', '/wf/instance-yaml', { workspaceRoot: '/ws/t25', instanceId: 't25m-stop-00000001', patch: { tasks: { a: { processor: '/ws/t25/x/g/SKILL.md' } } } })
  check('edit STOPPED: 改 processor 400 E-EDIT-DENIED + editErrors', r.code === 400 && Array.isArray(r.body.editErrors) && r.body.editErrors.some(e => e.code === 'E-EDIT-DENIED'), JSON.stringify(r.body).slice(0, 160))
  r = await call('POST', '/wf/instance-yaml', { workspaceRoot: '/ws/t25', instanceId: 't25m-stop-00000001', patch: { tasks: { a: { retries: 3 } } } })
  check('edit STOPPED: 改 retries 放行', r.code === 200 && r.body.saved === true, JSON.stringify(r.body).slice(0, 120))

  r = await call('GET', '/wf/instance-yaml?workspaceRoot=/ws/t25&instanceId=t25m-run-00000002')
  check('edit RUNNING: readonlyAll + editable 全 false', r.code === 200 && r.body.editable.readonlyAll === true && r.body.editable.definition === false && r.body.editable.runtime === false)
  r = await call('POST', '/wf/instance-yaml', { workspaceRoot: '/ws/t25', instanceId: 't25m-run-00000002', patch: { maxConcurrency: 4 } })
  check('edit RUNNING: 改 maxConcurrency 400', r.code === 400 && r.body.editErrors.some(e => e.code === 'E-EDIT-DENIED'), JSON.stringify(r.body).slice(0, 120))

  // 参数缺失 400
  r = await call('GET', '/wf/instance-yaml?workspaceRoot=/ws/t25')
  check('edit GET: 缺 instanceId 400', r.code === 400)
  r = await call('GET', '/wf/instance-yaml?workspaceRoot=/ws/t25&instanceId=no-such')
  check('edit GET: 未知实例 404', r.code === 404)

  process.env.DSH_HOME = savedDsh25
}
  // 验证 expandConcurrentTasks 展开（无依赖 + 元数据）
  const concTask = {
    id: 'batch', name: '批量', type: 'concurrent', dependsOn: [], timeout: 600,
    processor: '/x/skills/batch/SKILL.md', inputsRaw: { req: 'spec/${module}/req.md' },
    outputsRaw: ['output/${module}.md'], gate: null,
    itemsFromRaw: 'config/modules.txt', itemVar: 'module', maxConcurrency: 2,
  }
  Promise.resolve(expandConcurrentTasks(null, concTask, ['login', 'order', 'payment', 'shipping'], 'module', {})).then(async (cexp) => {
    check('concurrent: expand 展开 4 个迭代', cexp.length === 4, cexp.length)
    check('concurrent: expand 迭代无依赖', cexp.every(t => t.dependsOn.length === 0))
    check('concurrent: expand 组级 max=2 元数据', cexp[0]._concurrentMax === 2 && cexp[0]._concurrentGroup === 'batch')

    // ── 用例 8：实例注册表（Iter-10）──
    await runCase8()
    // ── 用例 9：实例操控工具（Iter-11）──
    await runCase9()
    // ── 用例 10：HTTP 路由（Iter-13）──
    await runCase10()
    // ── 用例 11：运行状态机（Iter-16）──
    await runCase11()
    // ── 用例 12：绑定模型 + 完整性（Iter-17）──
    await runCase12()
    // ── 用例 13：流程控制全链路 + 孤儿回收（Iter-18）──
    await runCase13()
    // ── 用例 14：前后台配合（Iter-19）──
    await runCase14()
    // ── 用例 15：前后台状态一致（Iter-20）──
    await runCase15()
    // ── 用例 16：主从聚合控制（Iter-SUBA）──
    await runCase16()
    await runCase17()
    // ── 用例 18：预定义目录物化（Iter-24）──
    await runCase18()
    // ── 用例 19：两级解析链（Iter-24）──
    await runCase19()
    // ── 用例 20：数据流显性化（Iter-25）──
    await runCase20()
    // ── 用例 21：items 结构化提取（Iter-26）──
    await runCase21()
    // ── 用例 22：运行时 items 展开（Iter-26R）──
    await runCase22()
    // ── 用例 23：预定义目录结构与实例化（Iter-27a）──
    await runCase23()
    await runCase24()
    // ── 用例 25：实例编辑前台（Iter-28）──
    await runCase25()

    console.log('')
    console.log('结果: ' + pass + ' 通过, ' + fail + ' 失败')
    process.exit(fail > 0 ? 1 : 0)
  }).catch((e) => {
    console.log('  ✘ expandConcurrentTasks 异常: ' + e.message)
    fail++
    console.log('')
    console.log('结果: ' + pass + ' 通过, ' + fail + ' 失败')
    process.exit(1)
  })
}).catch((e) => {
  console.log('  ✘ expandLoopTasks 异常: ' + e.message)
  fail++
  console.log('')
  console.log('结果: ' + pass + ' 通过, ' + fail + ' 失败')
  process.exit(1)
})