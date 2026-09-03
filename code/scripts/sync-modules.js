#!/usr/bin/env node
// 同步源模块到 workflow-host.mjs 的内联 section（只处理显式列出的 section）。
// 用法：node code/scripts/sync-modules.js [section ...]（缺省=全部已登记 section）
// 纪律：改任何源模块后必须先跑本脚本再跑 packages/workflow-host/build.js。
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..') // code/
const MJS = path.join(ROOT, 'agent-presets/workflow-orchestrator/workflow-host.mjs')
// Iter-25：登记补全——此前只有 3 个 section，schema/parser/engine/storage 的内联副本
// 是手工维护盲区（源改了 mjs 没同步，Iter-24 曾因同步遗漏翻车）。webserver-routes
// 无外部源文件，本就在 mjs 直接编辑，故不登记。
const SOURCES = {
  'workflow-schema': path.join(ROOT, 'shared/workflow-schema.js'),
  'workflow-parser': path.join(ROOT, 'shared/workflow-parser.js'),
  'items-extract': path.join(ROOT, 'shared/items-extract.js'), // Iter-26：items 提取器（须位于 workflow-parser 之后：依赖同作用域 parseYaml）
  'workflow-paths': path.join(ROOT, 'shared/workflow-paths.js'), // Iter-27a：路径分类/解析锚点（isAbsoluteishPath 前移自此；须位于 tools-preset 之前）
  'engine': path.join(ROOT, 'plugins/workflow-host/engine.js'),
  'storage': path.join(ROOT, 'plugins/workflow-host/storage.js'),
  'instance-store': path.join(ROOT, 'plugins/workflow-host/instance-store.js'),
  'builtin-skills': path.join(ROOT, 'plugins/workflow-host/builtin-skills.js'),
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
