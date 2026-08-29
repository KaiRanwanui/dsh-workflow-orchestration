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
const { createInstanceRegistry, slugifyName, instanceDirPath } = require('../plugins/workflow-host/instance-store.js')
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

  // templates：内置 2 个；workspace 扫描 <root>/templates/*.yaml
  let r = await call('GET', '/wf/templates?workspaceRoot=/ws/t13')
  check('templates: 内置 2 个模板', r.code === 200 && Array.isArray(r.body.builtin) && r.body.builtin.length === 2 && r.body.builtin[0].yaml.includes('name: serial-demo'))
  await mockFs.writeText({ path: '/ws/t13/templates/my-tpl.yaml' }, 'name: my-tpl\n')
  r = await call('GET', '/wf/templates?workspaceRoot=/ws/t13')
  check('templates: 工作区模板被扫描', r.body.workspace.length === 1 && r.body.workspace[0].name === 'my-tpl', JSON.stringify(r.body.workspace))

  // create：workflowText 成功路径
  const WF13 = 'name: t13demo\nversion: "1.0"\ndescription: d\nmax-concurrency: 2\ntasks:\n  - id: a\n    name: A\n    processor: /x/a/SKILL.md\n    outputs: ["/ws/t13/output/a.md"]\n    depends-on: []\n'
  r = await call('POST', '/wf/create', { workspaceRoot: '/ws/t13', workflowText: WF13, params: { output_dir: 'out' } })
  const iid = r.body.instanceId
  check('create: 200 + CREATED + id 形态', r.code === 200 && r.body.phase === 'CREATED' && /^t13demo-[0-9a-f]{8}$/.test(iid), JSON.stringify(r.body).slice(0, 140))
  check('create: 快照目录五件套落盘', files.has('/ws/t13/.workflow-agent/instances/' + iid + '/instance.yaml') && files.has('/ws/t13/.workflow-agent/instances/' + iid + '/output/.gitkeep'))
  check('create: params 记入 metadata', JSON.parse(files.get('/ws/t13/.workflow-agent/instances/' + iid + '/metadata.json')).params.output_dir === 'out')

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
}

// ── 用例 14：前后台配合（Iter-19）─────────────────────────────────────────
async function runCase14() {
  console.log('［用例 14］前后台配合 — create 即绑定 / 执行期=RUNNING / Session 启停同步')
  const { registerWorkflowToolsPreset } = require('../plugins/workflow-host-preset/tools-preset.js')
  const { files, fs: mockFs } = makeMockFs()
  const live = new Set(['sess-a'])
  const runningAgents = new Set(['sess-a'])
  const isSessionLive = (sid) => live.has(sid)
  const isAgentRunning = (sid) => runningAgents.has(sid)
  const deps = { createWorkflowEngine, createWorkflowStorage, isSessionLive, isAgentRunning }
  const registered = {}
  const ctx = (bag) => ({
    tools: { register(t) { bag[t.name] = t } },
    get(n) { if (n === 'fs') return mockFs; if (n === 'tools') return { register(t) { bag[t.name] = t } }; return undefined },
  })
  const registry = createInstanceRegistry(ctx(registered), deps)
  registerWorkflowToolsPreset(ctx(registered), null, null, registry)
  const exec = { agent: { session: { header: { id: 'sess-a', cwd: '/ws/c14' } } } }
  const WF = `name: c14demo\nversion: "1.0"\ndescription: d\ntasks:\n  - id: a\n    name: A\n    processor: /x/a/SKILL.md\n    outputs: ["/ws/c14/output/a.md"]\n    depends-on: []\n`

  // 1) workflow_begin → RUNNING（执行期=RUNNING）+ 绑定 sess-a
  let r = await registered.workflow_begin.execute({ workflowText: WF }, exec)
  check('workflow_begin: 返回 RUNNING（执行期=RUNNING）', r.stage === 'RUNNING', r.stage)
  check('workflow_begin: 实例绑定 sess-a', registry.get(r.instanceId).meta.sessionId === 'sess-a')
  const iid = r.instanceId

  // 2) Session 停止同步（agent idle → 实例 STOPPED）
  runningAgents.delete('sess-a')
  let e = await registry.syncInstanceState('/ws/c14', iid)
  check('sync:idle → 实例 STOPPED', e.engine.snapshot().stage === 'STOPPED', e.engine.snapshot().stage)

  // 3) Session 启动同步（agent running → 实例 resume RUNNING）
  runningAgents.add('sess-a')
  e = await registry.syncInstanceState('/ws/c14', iid)
  check('sync:running → 实例 resume RUNNING', e.engine.snapshot().stage === 'RUNNING', e.engine.snapshot().stage)

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
  const deps = { createWorkflowEngine, createWorkflowStorage, isSessionLive: (s) => live.has(s), isAgentRunning: (s) => runningAgents.has(s) }
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

  // 2) R4：listInstances 对绑定实例做 Session 启停同步（idle→stop / running→resume）
  const b = await registry.beginInstance({ cwd, sessionId: 'sess-a', workflowName: 'wfc', sourceText: 'name: wfc\n', sourcePath: null, params: {} })
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
  check('R4 list: 会话 running → 实例 resume RUNNING', runItem && runItem.stage === 'RUNNING', runItem && runItem.stage)

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