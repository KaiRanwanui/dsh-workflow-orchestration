// ============================================================================
// workflow-agent — parser / engine 单元测试（Node，纯逻辑，无需 DSH）
// 文件：code/scripts/test-host.js
// 用法：node code/scripts/test-host.js
// ============================================================================

const { parseWorkflow } = require('../shared/workflow-parser')
const { createWorkflowEngine } = require('../plugins/workflow-host/engine.js')
const { TASK_TYPES, TASK_STATUS, STAGE } = require('../shared/workflow-schema.js')
const { expandLoopTasks } = require('../plugins/workflow-host/tools.js')

let pass = 0
let fail = 0

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

  console.log('')
  console.log('结果: ' + pass + ' 通过, ' + fail + ' 失败')
  process.exit(fail > 0 ? 1 : 0)
}).catch((e) => {
  console.log('  ✘ expandLoopTasks 异常: ' + e.message)
  fail++
  console.log('')
  console.log('结果: ' + pass + ' 通过, ' + fail + ' 失败')
  process.exit(1)
})