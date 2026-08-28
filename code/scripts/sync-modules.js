#!/usr/bin/env node
// 同步源模块到 workflow-host.mjs 的内联 section（只处理显式列出的 section）。
// 用法：node code/scripts/sync-modules.js [section ...]（缺省=全部已登记 section）
// 纪律：改任何源模块后必须先跑本脚本再跑 packages/workflow-host/build.js。
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..') // code/
const MJS = path.join(ROOT, 'agent-presets/workflow-orchestrator/workflow-host.mjs')
const SOURCES = {
  'instance-store': path.join(ROOT, 'plugins/workflow-host/instance-store.js'),
  'tools-preset': path.join(ROOT, 'plugins/workflow-host-preset/tools-preset.js'),
}

const targets = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SOURCES)
let text = fs.readFileSync(MJS, 'utf8')
let changed = 0

for (const name of targets) {
  const src = SOURCES[name]
  if (!src) {
    console.error('未知 section:', name, '（已登记:', Object.keys(SOURCES).join(', ') + '）')
    process.exit(1)
  }
  const startMark = '// ---- module: ' + name + ' ----'
  const start = text.indexOf(startMark)
  if (start < 0) {
    console.error('找不到 section 标记:', startMark)
    process.exit(1)
  }
  const bodyStart = start + startMark.length
  const next = text.indexOf('\n// ---- module: ', bodyStart)
  const bodyEnd = next < 0 ? text.length : next + 1
  const body = fs.readFileSync(src, 'utf8').replace(/\s+$/, '\n')
  text = text.slice(0, bodyStart) + '\n' + body + '\n' + text.slice(bodyEnd)
  changed++
  console.log('同步 section:', name, '<-', path.relative(ROOT, src))
}

fs.writeFileSync(MJS, text)
console.log('完成：', changed, '个 section 已写入', path.relative(ROOT, MJS))
