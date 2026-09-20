#!/usr/bin/env node
// verify-deploy.mjs — 部署产物核验门（部署后必跑；失败 exit 1）
// 断言：① 部署版本 == repo 版本（杜绝 manifest 断链/旧 tgz）② 关键功能标记齐全
// ③ 诊断残留清零 ④ lib 语法可加载
// 用法：node scripts/verify-deploy.mjs [部署根目录]
//   默认部署根：~/.dsh/profiles/web/node_modules/@workflow-agent/workflow-host

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const deployRoot = process.argv[2] || path.join(os.homedir(), '.dsh/profiles/web/node_modules/@workflow-agent/workflow-host')
const fail = (m) => { console.error('FAIL:', m); process.exit(1) }

const repoPkg = JSON.parse(fs.readFileSync(path.join(repo, 'code/packages/workflow-host/package.json'), 'utf8'))
const depPkgPath = path.join(deployRoot, 'package.json')
if (!fs.existsSync(depPkgPath)) fail(`部署包不存在: ${depPkgPath}（tar 直解是否执行？）`)
const depPkg = JSON.parse(fs.readFileSync(depPkgPath, 'utf8'))
if (depPkg.version !== repoPkg.version) fail(`版本不一致: 部署 ${depPkg.version} != repo ${repoPkg.version}`)
console.log(`版本一致: v${depPkg.version}`)

const client = fs.readFileSync(path.join(deployRoot, 'lib/client.js'), 'utf8')
const index = fs.readFileSync(path.join(deployRoot, 'lib/index.js'), 'utf8')

// 标记清单：[说明, 目标, 模式, 最少次数]
const markers = [
  ['页签门控', client, 'sessionGateMap', 1],
  ['DAG 合并层', client, 'defTasks41', 1],
  ['CREATED 合成视图', client, 'stateDataView', 1],
  ['主题 token T', client, 'const T = {', 1],
  ['RUNNING 脉冲', client, 'wfdag-pulse', 1],
  ['自动跟随', client, 'lastUserScrollTs', 1],
  ['openSkillView 归一', client, "isSel ? '#3b82f6'", 1],
  ['技能两级链', index, 'candidates', 3],
]
for (const [name, target, pat, min] of markers) {
  const c = target.split(pat).length - 1
  if (c < min) fail(`标记缺失: ${name}（${pat} = ${c}，需 ≥${min}）`)
  console.log(`✓ ${name} = ${c}`)
}

// 诊断残留必须清零
for (const [name, target, pat] of [
  ['诊断探针 wf42-probe', client + index, 'wf42-probe'],
  ['诊断路由 debug-probe', client + index, 'debug-probe'],
  ['已退役路由 instance-params', index, "pathname === '/wf/instance-params'"],
]) {
  const c = target.split(pat).length - 1
  if (c !== 0) fail(`诊断残留未清零: ${name}（${pat} = ${c}）`)
  console.log(`✓ 清零: ${name}`)
}

// 语法可加载（求值 + ModuleLoader 注册）
let loadedDef = null
try {
  const fn = new Function('window', 'require', client)
  fn({ __ModuleLoader__: { load: (d) => { loadedDef = d } } }, () => undefined)
} catch (e) { fail(`bundle 求值失败: ${e.message}`) }
if (!loadedDef) fail('__ModuleLoader__.load 未被调用')

console.log('DEPLOY VERIFY PASS')
