// ============================================================================
// workflow-agent — 工作流实例状态引擎
// 文件：code/plugins/workflow-host/engine.js
// 说明：纯内存状态管理（N 节点状态表、阶段、Gate 结果、重试计数、执行日志）。
//       宿主内联时，schema 常量（STAGE/TASK_STATUS）由前置拼接的
//       workflow-schema.js 提供；Node 独立测试时，下方兜底常量生效。
// ============================================================================

// 兜底常量：宿主内联时同作用域已有同名 const，let 声明不冲突。
let E_STAGE = typeof STAGE !== 'undefined' ? STAGE : {
  PENDING: 'PENDING', RUNNING: 'RUNNING', COMPLETED: 'COMPLETED', FAILED: 'FAILED', PAUSED: 'PAUSED',
}
let E_TASK_STATUS = typeof TASK_STATUS !== 'undefined' ? TASK_STATUS : {
  PENDING: 'PENDING', RUNNING: 'RUNNING', DONE: 'DONE', FAILED: 'FAILED', SKIPPED: 'SKIPPED',
}

// Task 运行时快照（供 UI 消费的最小字段集）
function taskSnapshot(t) {
  return {
    id: t.id,
    name: t.name,
    type: t.type,
    dependsOn: t.dependsOn || [],
    status: t.status,
    processor: t.processor || null,       // 处理器技能绝对路径（Client 读取 skill 文本用）
    gateChecker: (t.gate && t.gate.checker) || null, // 门禁技能绝对路径
    gateResult: t.gateResult || null,
    gateOnFailure: t.gateOnFailure || null,
    retries: t.retries || 0,
    _loopGroup: t._loopGroup || null,
    _loopItem: t._loopItem || null,
    _loopIndex: t._loopIndex ?? 0,
    _loopGroupName: t._loopGroupName || null,
    _onError: t._onError || null,
    // Iter-8：并发组元数据（Client DAG 分组渲染）
    _concurrentGroup: t._concurrentGroup || null,
    _concurrentGroupName: t._concurrentGroupName || null,
    _concurrentItem: t._concurrentItem || null,
    _concurrentIndex: t._concurrentIndex ?? 0,
    _concurrentMax: t._concurrentMax || null,
  }
}

// 全局快照（供 RPC / Tool 返回；指纹用于 Client 防抖）
function createWorkflowEngine() {
  const state = {
    workflow: null, // 工作流名称
    version: null,
    description: null,
    params: {},
    maxConcurrency: 1, // Iter-7：工作流级最大并发数
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
      maxConcurrency: state.maxConcurrency,
      active: state.active,
      stage: state.stage,
      tasks: state.tasks.map(taskSnapshot),
      gateResult: state.gateResult,
      retries: state.retries,
      error: state.error,
      updatedAt: state.updatedAt,
      logs: state.logs.slice(-200), // 最多保留最近 200 条
      persist: state.persist,
      runnable: getRunnableTasks(), // Iter-7：当前就绪可并发执行的任务
      fingerprint: fingerprint(),
    }
  }

  // 启动新工作流：清空旧状态，按解析结果初始化 N 个 Task
  function begin(parsed) {
    state.workflow = parsed.name
    state.version = parsed.version
    state.description = parsed.description
    state.params = parsed.params || {}
    state.maxConcurrency = parsed.maxConcurrency || 1 // Iter-7：工作流级最大并发数
    state.active = true
    state.stage = E_STAGE.PENDING
    state.gateResult = null
    state.retries = 0
    state.error = null
    state.logs = [] // Iter-6：重新 begin 时清除历史日志，避免跨实例残留
    state.tasks = parsed.tasks.map((t) => ({
      id: t.id,
      name: t.name,
      type: t.type,
      dependsOn: t.dependsOn || [], // Iter-7：前驱依赖，供 getRunnableTasks 计算就绪
      status: E_TASK_STATUS.PENDING,
      processor: t.processor || null, // 绝对路径（由 tools 层解析后写入）
      outputs: t.outputs || [],
      gate: t.gate || null, // {checker, onFailure, maxRetries}
      gateResult: null,
      retries: 0,
      _loopGroup: t._loopGroup || null,
      _loopItem: t._loopItem || null,
      _loopIndex: t._loopIndex ?? 0,
      _loopGroupName: t._loopGroupName || null,
      _onError: t._onError || null,
      // Iter-8：并发组元数据（engine 组级并发控制 + Client DAG 分组渲染）
      _concurrentGroup: t._concurrentGroup || null,
      _concurrentGroupName: t._concurrentGroupName || null,
      _concurrentItem: t._concurrentItem || null,
      _concurrentIndex: t._concurrentIndex ?? 0,
      _concurrentMax: t._concurrentMax || null,
    }))
    state.updatedAt = Date.now()
    log('BEGIN', '工作流 "' + state.workflow + '" 已初始化，tasks=' + state.tasks.length)
  }

  // 更新单个 Task 状态
  function updateTask(taskId, patch) {
    const t = state.tasks.find((x) => x.id === taskId)
    if (!t) return false
    if (patch.status !== undefined) t.status = patch.status
    if (patch.gateResult !== undefined) t.gateResult = patch.gateResult
    if (patch.retries !== undefined) t.retries = patch.retries
    if (patch.error !== undefined) t.error = patch.error
    state.updatedAt = Date.now()
    log('TASK', taskId + ' -> ' + t.status)
    // Iter-6：任务 FAILED 后按 _onError 处理循环中断
    //   break    → 同组后续 PENDING 迭代标记 SKIPPED（中断）
    //   continue → 不中断，后续迭代继续执行
    if (t.status === E_TASK_STATUS.FAILED && t._onError === 'break') {
      processBreak(taskId)
    }
    return true
  }

  // Iter-7：返回就绪任务列表（dependsOn 全部完成 + 受 max-concurrency 限制）。
  // 就绪 = 所有前驱均 DONE 或 SKIPPED（FAILED 前驱不放行）；
  // 可用并发槽位 = maxConcurrency - 当前 RUNNING 数。
  function getRunnableTasks() {
    const running = state.tasks.filter((t) => t.status === E_TASK_STATUS.RUNNING).length
    const slots = Math.max(0, state.maxConcurrency - running)
    if (slots === 0) return []
    const finished = new Set(
      state.tasks
        .filter((t) => t.status === E_TASK_STATUS.DONE || t.status === E_TASK_STATUS.SKIPPED)
        .map((t) => t.id)
    )
    // 预计算每个并发组：组内 RUNNING 数 + 组级 max（Iter-8）
    const gRun = new Map()
    const gMax = new Map()
    state.tasks.forEach((t) => {
      if (!t._concurrentGroup) return
      gRun.set(t._concurrentGroup, (gRun.get(t._concurrentGroup) || 0) + (t.status === E_TASK_STATUS.RUNNING ? 1 : 0))
      if (!gMax.has(t._concurrentGroup)) gMax.set(t._concurrentGroup, t._concurrentMax || 1)
    })
    const result = []
    for (const t of state.tasks) {
      if (result.length >= slots) break
      if (t.status !== E_TASK_STATUS.PENDING) continue
      const deps = t.dependsOn || []
      if (!deps.every((d) => finished.has(d))) continue
      // Iter-8：并发组组级槽位——组内 RUNNING + 该组已列入 result 的数量 >= 组级 max 则不放行
      if (t._concurrentGroup) {
        const gInResult = result.filter((x) => x._concurrentGroup === t._concurrentGroup).length
        if ((gRun.get(t._concurrentGroup) || 0) + gInResult >= (gMax.get(t._concurrentGroup) || 1)) continue
      }
      result.push(t)
    }
    return result
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

  // 当 task FAILED 且 _onError === 'break' 时，将同 _loopGroup 的 PENDING 任务标记为 SKIPPED
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

  // 从持久化 payload 恢复实例状态（storage.load 调用）
  function hydrate(j) {
    state.workflow = j.workflow
    state.version = j.version
    state.description = j.description
    state.params = j.params || {}
    state.maxConcurrency = j.maxConcurrency || 1 // Iter-7
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
      dependsOn: Array.isArray(t.dependsOn) ? t.dependsOn : [],
      status: t.status || E_TASK_STATUS.PENDING,
      processor: t.processor || null,
      outputs: Array.isArray(t.outputs) ? t.outputs : [],
      gate: t.gate || null,
      gateResult: t.gateResult || null,
      retries: t.retries || 0,
      // Iter-6：恢复循环元数据（processBreak 与 Client DAG 分组依赖）
      _loopGroup: t._loopGroup || null,
      _loopItem: t._loopItem || null,
      _loopIndex: t._loopIndex ?? 0,
      _loopGroupName: t._loopGroupName || null,
      _onError: t._onError || null,
      // Iter-8：并发组元数据（engine 组级并发控制 + Client DAG 分组渲染）
      _concurrentGroup: t._concurrentGroup || null,
      _concurrentGroupName: t._concurrentGroupName || null,
      _concurrentItem: t._concurrentItem || null,
      _concurrentIndex: t._concurrentIndex ?? 0,
      _concurrentMax: t._concurrentMax || null,
    })) : []
    state.updatedAt = Date.now()
  }

  return {
    begin,
    clear,
    hydrate,
    updateTask,
    processBreak,
    getRunnableTasks,
    setStage,
    setGateResult,
    setRetries,
    setError,
    setPersist,
    snapshot,
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createWorkflowEngine, taskSnapshot }
}