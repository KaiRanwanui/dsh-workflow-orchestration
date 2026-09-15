// ============================================================================
// workflow-agent — persona 文件化插件（阶段 3g）
// 文件：code/agent-presets/workflow-orchestrator/persona-file.mjs
//
// 运行时读取同目录 system-prompt.md（persona 单一源）并注册 persona 段，
// 取代构建期把提示词内联进 agent.cordis.yml 的旧方案（sync-persona.js 已退役）。
//
// 机制（对齐官方 @deepseek-ai/dsh-persona）：
//   - 注入 systemPrompt 服务；section 名 `deployment:persona-prefix` 在 preset
//     作用域遮蔽全局部署 persona。
//   - order 对齐官方 DEPLOYMENT_PERSONA_PREFIX 槽位。
//   - 未设 complete（保留运行时上下文注入）；未设 suffix。
//
// 注意：system-prompt.md 若包含 `{{...}}` 会被提示词变量插值——当前单一源已保证不含。
// ============================================================================

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'workflow-orchestrator-persona'
export const inject = ['systemPrompt']

const here = dirname(fileURLToPath(import.meta.url))
const text = readFileSync(join(here, 'system-prompt.md'), 'utf8')

export function apply(ctx) {
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'deployment:persona-prefix',
    order: ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX'),
    text,
  }), 'persona-file.section()')
}
