// ============================================================================
// workflow-agent — 共享 Schema 常量与校验规则
// 文件：code/shared/workflow-schema.js
// 说明：纯逻辑模块（无 DSH/Cordis 依赖），可被 Node 直接 require 测试，
//       宿主插件内联打包时按模块源码拼接。
// ============================================================================

// ── Task 类型枚举 ──────────────────────────────────────────────────────────
const TASK_TYPES = {
  LLM_TASK: 'llm-task',
  LOOP: 'loop',
  CONCURRENT: 'concurrent', // Iter-8：并发执行（同 loop 结构，迭代无依赖可并行）
  HUMAN_DECISION: 'human-decision', // 预留（后续迭代）
  EXTERNAL_AGENT: 'external-agent', // 预留（后续迭代）
}

// ── 字段默认值 ─────────────────────────────────────────────────────────────
const DEFAULTS = {
  timeout: 600, // 秒
  dependsOn: [],
  taskType: TASK_TYPES.LLM_TASK,
  retries: 0, // quality-gate max-retries 默认
  onFailure: 'block', // quality-gate on-failure 默认
  maxConcurrency: 1, // 工作流级最大并发数（Iter-7，默认串行）
}

// ── 必填字段校验规则 ────────────────────────────────────────────────────────
const REQUIRED = {
  llmTask: ['id', 'processor'],
  loop: ['id', 'processor', 'items-from', 'item-var'],
  concurrent: ['id', 'processor', 'items-from', 'item-var'], // Iter-8
  humanDecision: ['id', 'prompt'],
  externalAgent: ['id', 'agent'],
}

// ── 循环错误处理策略 ──────────────────────────────────────────────────────────
const ON_ERROR_VALUES = ['break', 'continue']

// ─ 支持 uality-gate on-failure  的策略值 ──────────────────────────────────
const ON_FAILURE_VALUES = ['retry', 'block', 'skip']

// ── 参数模板正则（${param_name} / ${item}） ────────────────────────────────
const PARAM_PATTERN = /\$\{(\w+)\}/g

// ── Task 运行时状态枚举 ─────────────────────────────────────────────────────
const TASK_STATUS = {
  PENDING: 'PENDING', // 未开始
  RUNNING: 'RUNNING', // 执行中
  DONE: 'DONE', // 完成（含 Gate PASS）
  FAILED: 'FAILED', // 失败（Gate FAIL 且重试耗尽 / block）
  SKIPPED: 'SKIPPED', // 跳过
}

// ── 工作流全局阶段枚举 ──────────────────────────────────────────────────────
const STAGE = {
  PENDING: 'PENDING', // 待启动
  RUNNING: 'RUNNING', // 运行中
  COMPLETED: 'COMPLETED', // 全部完成
  FAILED: 'FAILED', // 阻断失败
  STOPPED: 'STOPPED', // 停止（保留进度，可 resume/reset/archive；Iter-16）
}

// ── 条件导出（Node 测试可用；宿主内联拼接时 module 未定义则跳过） ─────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    TASK_TYPES,
    DEFAULTS,
    REQUIRED,
    ON_FAILURE_VALUES,
    ON_ERROR_VALUES,
    PARAM_PATTERN,
    TASK_STATUS,
    STAGE,
  }
}