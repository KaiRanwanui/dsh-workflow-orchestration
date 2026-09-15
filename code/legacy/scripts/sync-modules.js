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
  'workflow-validate': path.join(ROOT, 'shared/workflow-validate.js'), // Iter-27b：语义校验引擎（排 workflow-paths 后：E_ 别名同作用域直呼；其内部再引用 items-extract/schema，均在前置 section）
  'workflow-edit': path.join(ROOT, 'shared/workflow-edit.js'), // Iter-28：实例编辑前台（序列化器/权限矩阵/patch 合并；排 workflow-validate 后：仅依赖 parser 的 parseYaml 同作用域可见）
  'zip-writer': path.join(ROOT, 'shared/zip-writer.js'), // Iter-29：纯 JS STORE zip writer（零依赖；归档/实例打包下载用）
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
