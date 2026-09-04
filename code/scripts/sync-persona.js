#!/usr/bin/env node
// sync-persona.js — 把 system-prompt.md（persona 单一源）注入 agent.cordis.yml
// 的 persona 行 `text` literal block。
//
// 【系统限制（rc2）】@deepseek-ai/dsh-persona 的 Config 仅支持内联 text 字段
// （无 file/path 引用能力），persona 无法与 composition 天然解耦；构建期注入
// 是当前唯一的单源化手段。改 persona 一律改 system-prompt.md 后跑本脚本；
// agent.cordis.yml 的 text 区块为生成物，勿手编。DSH 版本升级后须复查
// dsh-persona 是否新增文件引用能力（若有则改为 file 引用并删除本脚本）。
// 详见 development-plan.md Iter-28「架构限制」节。
//
// 用法：node code/scripts/sync-persona.js [--check]
//   （缺省）生成：重写 agent.cordis.yml 的 persona text 区块（幂等）
//   --check     ：只比对不写入；不一致时 exit 1（供部署链/CI 校验）
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const MD = path.join(ROOT, 'agent-presets/workflow-orchestrator/system-prompt.md')
const YML = path.join(ROOT, 'agent-presets/workflow-orchestrator/agent.cordis.yml')
const INDENT = '      ' // literal block 基准缩进（6 空格；`text:` 行缩进 4）

function die(msg) { console.error('[sync-persona] ' + msg); process.exit(1) }

const md = fs.readFileSync(MD, 'utf8').replace(/\r\n/g, '\n').replace(/\n*$/, '\n')
if (md.includes('{{')) {
  die('persona 源含 "{{"——会被 dsh-persona 当 prompt 变量插值，请改写该处文本')
}

// literal block 内容行（空行保持完全空，YAML 解析无歧义）
const body = md.split('\n').map(l => (l.length ? INDENT + l : '')).join('\n')
// md 以 \n 结尾 → split 尾部出 '' → body 以单 \n 收尾，无多余空行
const generated = 'text: |\n' + body

const yml = fs.readFileSync(YML, 'utf8')
const rowAt = yml.indexOf('- id: persona')
if (rowAt < 0) die('agent.cordis.yml 找不到 persona row')
let textAt = yml.indexOf('text: |', rowAt)
if (textAt < 0) textAt = yml.indexOf('text: >-', rowAt) // 兼容旧折叠形态（bootstrap 一次性转换）
if (textAt < 0) die('persona row 内找不到 text 字段（text: | 或 text: >-）')
const nextRowAt = yml.indexOf('\n- id:', textAt)
const head = yml.slice(0, textAt)
const tail = nextRowAt < 0 ? '' : yml.slice(nextRowAt) // 以 '\n- id:' 开头（或文件尾）

const next = head + generated + tail
if (process.argv.includes('--check')) {
  if (next === yml) { console.log('[sync-persona] check OK：yml persona text 与 system-prompt.md 一致'); process.exit(0) }
  die('check FAIL：agent.cordis.yml 的 persona text 与 system-prompt.md 不一致——重跑 sync-persona.js 生成')
}
fs.writeFileSync(YML, next)
console.log('[sync-persona] 已注入：persona text ← system-prompt.md（' + md.split('\n').length + ' 行）')
