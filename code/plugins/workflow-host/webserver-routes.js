// ============================================================================
// workflow-agent — Host webServer HTTP 路由（源模块）
// 文件：code/plugins/workflow-host/webserver-routes.js
// 构建：由 packages/workflow-host/build.js 按 code/scripts/module-manifest.js 顺序拼入产物
//       （本文件是源，直接编辑此处；不要编辑生成的 lib/index.js 或 dist/*.mjs）。
// 导出：registerWebRoutes / loadStateFromFile（生成物 module.exports 供单测直调）。
// ============================================================================

// ============================================================================
// workflow-agent — Host webServer HTTP 路由（Iter-5，替代 harness RPC）
// 文件：code/plugins/workflow-host/webserver-routes.js
// 说明：注册 /wf/* 前缀路由，供 Client 面板轮询状态/读取技能/验证工作区。
//       参考先例：@linxin666/dsh-tool-describe-image（npm 包 + webServer + fetch）。
// 依赖：ctx.get('webServer')、ctx.get('fs')。webServer 不存在时静默跳过
//       （路由注册是可选能力，不影响工具注册）。
// ============================================================================

// ── loopback 信任围栏（仿 describe-image 的 shared/host/loopback）──────────
// IPv4 127/8、::1、IPv4-mapped ::ffff:127/8，加上浏览器 same-origin 标记
function isLoopbackAddress(address) {
  if (address === undefined || address === null) return false
  const normalized = String(address).toLowerCase()
  if (normalized === '::1') return true
  if (normalized.startsWith('::ffff:')) {
    return isIPv4Loopback(normalized.slice('::ffff:'.length))
  }
  return isIPv4Loopback(normalized)
}

function isIPv4Loopback(v4) {
  const parts = v4.split('.')
  return parts.length === 4
    && parts[0] === '127'
    && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

function isLoopbackHostname(hostname) {
  if (hostname === 'localhost' || hostname === '[::1]') return true
  return isIPv4Loopback(hostname)
}

function isLoopbackRequest(request) {
  if (!isLoopbackAddress(request.socket && request.socket.remoteAddress)) return false
  const host = request.headers && request.headers.host
  if (typeof host !== 'string') return false
  let hostUrl
  try {
    hostUrl = new URL('http://' + host)
  } catch (e) {
    return false
  }
  if (!isLoopbackHostname(hostUrl.hostname)) return false
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = request.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch (e) {
    return false
  }
}

// ── JSON 响应辅助 ──────────────────────────────────────────────────────────
function writeJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(payload)
}

// ── 从指定工作区读取 state.json（与 workflow-rpc.mjs 的 loadState 同构）────
// Iter-10：支持实例布局。优先级：instances/<instanceId>（精确）→
// instances/ 下 metadata.createdAt 最新的实例 → 旧单实例布局回退。
async function loadStateFromFile(fs, workspaceRoot, instanceId) {
  if (!fs) return { state: null, error: 'fs service unavailable' }
  try {
    const root = (workspaceRoot || '').replace(/\\/g, '/').replace(/\/+$/, '')
    if (!root) return { state: null, error: 'workspaceRoot not specified' }
    const instancesRoot = root + '/.workflow-agent/instances'
    if (instanceId) {
      const instanceDir = instancesRoot + '/' + instanceId
      // 尝试读取 state.json（RUNNING/COMPLETED/FAILED 状态）
      try {
        const resolved = await fs.resolve(instanceDir + '/state.json')
        const state = JSON.parse(await fs.readText(resolved))
        return { state, error: null, instanceId }
      } catch (e) {
        // state.json 不存在 → CREATED 状态，从 instance.yaml 构建默认状态
        try {
          const yamlPath = await fs.resolve(instanceDir + '/instance.yaml')
          const yamlText = await fs.readText(yamlPath)
          const parsed = parseWorkflow(yamlText)
          if (parsed.errors && parsed.errors.length > 0) {
            return { state: null, error: 'invalid instance.yaml: ' + parsed.errors.join(', '), instanceId }
          }
          return {
            state: {
              workflow: parsed.name,
              stage: 'CREATED',
              // Iter-21(R1)：CREATED 预览——从 instance.yaml 生成 PENDING 任务快照，使 DAG 在启动前即显示步骤节点
              tasks: parsed.tasks.map((t) => ({
                id: t.id,
                name: t.name,
                type: t.type || 'llmTask',
                dependsOn: t.dependsOn || [],
                status: 'PENDING',
                processor: t.processorRaw || null,
                outputs: t.outputsRaw || [],
                gate: t.gateRaw ? { checker: t.gateRaw, onFailure: t.gateOnFailure, maxRetries: t.gateMaxRetries } : null,
                gateResult: null,
                retries: 0,
                _loopGroup: t._loopGroup || null,
                _loopItem: t._loopItem || null,
                _loopIndex: t._loopIndex ?? 0,
                _loopGroupName: t._loopGroupName || null,
                _onError: t._onError || null,
                _concurrentGroup: t._concurrentGroup || null,
                _concurrentGroupName: t._concurrentGroupName || null,
                _concurrentItem: t._concurrentItem || null,
                _concurrentIndex: t._concurrentIndex ?? 0,
                _concurrentMax: t._concurrentMax || null,
              })),
              runnable: [],
              maxConcurrency: parsed.maxConcurrency || 1,
            },
            error: null,
            instanceId,
          }
        } catch (e2) {
          return { state: null, error: 'cannot read instance.yaml: ' + (e2 && e2.message ? e2.message : String(e2)), instanceId }
        }
      }
    }
    // Iter-20：未指定 instanceId（会话未绑定/无选中）→ 返回空状态；绝不取"工作区最新实例"或旧布局，
    // 避免跨会话归属污染 / 空态误显示其他会话的 DAG。
    return { state: null, error: null, instanceId: '' }
  } catch (e) {
    return { state: null, error: e && e.message ? e.message : String(e) }
  }
}

// ── 注册 /wf/* 路由 ────────────────────────────────────────────────────────
// GET /wf/status?workspaceRoot=...   → 工作流状态快照 {state, error}
// GET /wf/skill?path=...             → 技能文件全文 {text, error}
// GET /wf/config?workspaceRoot=...   → 验证工作区 {valid, workspaceRoot, error}
// Iter-13：
// GET /wf/templates?workspaceRoot=.. → 模板列表 {builtin[], workspace[]}
// POST /wf/create {workspaceRoot, workflowPath|workflowText, params}
//                                    → 建实例目录（只 create 不 start）
// Iter-28：
// GET /wf/skills?workspaceRoot=...   → 技能下拉源（预定义+工作区合并，同名工作区优先）
// GET /wf/instance-yaml?workspaceRoot&instanceId → 编辑数据源（raw 定义+权限矩阵+任务状态）
// POST /wf/validate-instance {workspaceRoot, instanceId, patch} → 编辑校验（dryRun 不落盘）
// POST /wf/instance-yaml {workspaceRoot, instanceId, patch}     → 编辑保存（同一闸门，通过才写回）
// GET /wf/archives?workspaceRoot=... → 归档列表（Iter-29：manifest+文件数/字节）
// POST /wf/archive {workspaceRoot, instanceId}                  → 显式归档（Iter-29：备份+内存清理+node:fs 删原目录）
// POST /wf/delete-archive {workspaceRoot, instanceId, entry}    → 删除归档（Iter-29：不可恢复）
// POST /wf/download {workspaceRoot, targets:[{kind,instanceId,entry?}]} → 打包 zip（Iter-29）→ {downloadUrl}
// GET /wf/download-artifact?token=...  → zip 字节流下载（Iter-29：一次性 token）
// ── Iter-13：内置基础流程模板（随包分发；实例=模板+配置，模板保持只读）────
// Iter-20/S5：内置模板改为**可执行默认模板**——无需修改、无需填参数即可创建并运行。
// 处理器/检查器/输入/输出全部引用工作区 skills/（相对路径，按会话 cwd=工作区解析），
// 依赖工作区存在以下技能：skills/spec-writer|data-prep|integrator|integrator-checker。
// 内建模板已文件化：builtin-assets/templates/（阶段 3f）；/wf/templates 扫描预定义目录为主。


function registerWebRoutes(ctx, registry) {
  const webserver = ctx.get('webServer')
  if (!webserver) return // 可选能力：webServer 不存在时静默跳过
  const fs = ctx.get('fs')
  // Iter-29：下载产物暂存（token → {bytes, filename, at}；一次性取走即焚 + 数量/总量上限）
  const downloadArtifacts = new Map()

  webserver.register({
    kind: 'prefix',
    path: '/wf',
    handler: async (req, res) => {
      // loopback 围栏优先：LAN/跨站调用一律 403
      if (!isLoopbackRequest(req)) {
        writeJson(res, 403, { error: 'forbidden: loopback-only' })
        return
      }
      let pathname = '/'
      let search = ''
      try {
        const url = new URL(req.url || '/', 'http://x')
        pathname = url.pathname
        search = url.search
      } catch (e) {
        writeJson(res, 400, { error: 'malformed url' })
        return
      }
      const query = new URLSearchParams(search)

      if (pathname === '/wf/status') {
        const result = await loadStateFromFile(fs, query.get('workspaceRoot') || '', query.get('instanceId') || '')
        writeJson(res, 200, result)
        return
      }
      // Iter-12：实例列表（只读）——Client 面板实例切换条数据源
      if (pathname === '/wf/list') {
        const root = query.get('workspaceRoot') || ''
        const sessionId = query.get('sessionId') || '' // Iter-20：Client 传当前会话用于 gating
        let instances = []
        let sessionState = null
        const recoveredOrphans = []
        if (registry && root) {
          try {
            // Iter-22(S3)：自动回收孤儿进采用池（用户拍板 D4：仅 /wf/list 触发，不做 adopt 兜底）。
            // 死会话孤儿解绑 sessionId→null 回 UNBOUND 池；RUNNING 先 stop（保 DONE 进度）。
            // 单个回收失败不阻塞列表（下一轮轮询重试）。
            let orphans = []
            try { orphans = await registry.scanOrphans(root) } catch (e) { orphans = [] }
            for (const o of orphans) {
              try {
                await registry.recoverOrphan(root, o.id)
                recoveredOrphans.push(o.id)
              } catch (e) { /* skip */ }
            }
            instances = await registry.listInstances(root)
            sessionState = await registry.deriveSessionState(root, sessionId || null) // Iter-20/S5：完整派生（含 BROKEN/DONE），供面板门控与告警
          } catch (e) {
            instances = []
          }
        }
        // Iter-22(S3)：采用池状态标注——sessionId==null（UNBOUND 池，含刚回收的孤儿）标注可采用的
        // 运行态，避免"莫名 RUNNING/STOPPED"误导：未启动（CREATED/PENDING）/已停止·含进度（STOPPED）。
        // Iter-22(D4 修复)：listInstances 已对池内 RUNNING 残留自愈（stop+落盘→STOPPED）；
        // 此处 RUNNING 仅在自愈失败时出现，标注为异常残留（adopt 本就拒绝 RUNNING）。
        for (const it of instances) {
          if ((it.sessionId === null || it.sessionId === undefined) && it.phase === 'READY') {
            it.adoptable = true
            if (it.stage === 'STOPPED') it.poolNote = '已停止·含进度，可采用后 resume 续跑'
            else if (it.stage === 'PENDING') it.poolNote = '未启动'
            else if (it.stage === 'COMPLETED' || it.stage === 'FAILED') it.poolNote = '已结束，可采用后 reset 重跑'
            else if (it.stage === 'RUNNING') it.poolNote = '运行中（异常残留，不可采用）'
          } else if (it.sessionId === null || it.sessionId === undefined) {
            it.adoptable = true
            // Iter-33：CREATED（有目录无 state.json）池内轻量标注；完整校验在 adopt 点击时执行
            it.poolNote = it.phase === 'CREATED' ? '已创建未启动（采纳时校验完整性）' : '未启动'
          }
        }
        // Iter-31（用户 D3 拍板）：stopHint 提示移除——Stop v4 后会话 UI 停止与面板 Stop 已等效
        // （用户两时序真机验证通过），原 Iter-23(A3) Case I 提示失去存在前提；
        // /wf/list 不再返回 stopHint 字段（旧客户端字段缺失时按 null 处理，兼容无害）。
        writeJson(res, 200, { workspaceRoot: root, instances, sessionState: sessionState && sessionState.state ? sessionState : null, recoveredOrphans })
        return
      }

      // Iter-13：模板列表（内置 + <workspaceRoot>/templates/*.yaml，只读）
      if (pathname === '/wf/templates') {
        // Iter-24：模板下拉切源——扫描预定义目录为主；工作区 templates/ 不再列入（迁移：手工移入预定义目录）。
        // 合并内嵌常量兜底（物化失败不至无模板可用；同名去重，磁盘版优先）。
        // Iter-27a：子目录布局下钻——templates/<名>/<名>.yaml 优先（否则子目录根第一个
        // *.yaml，按名排序）；平铺 legacy templates/<名>.yaml 继续列出；同名去重**子目录赢**
        // （旧平铺残留因 fs 无删除 API 不自动清理，见 templates/README.md 迁移说明）。
        const predefined = []
        if (fs) {
          try {
            const preRoot = typeof detectPredefinedRoot === 'function' ? detectPredefinedRoot() : null
            if (preRoot) {
              const tplRoot = preRoot + '/templates'
              const seen = new Set()
              const pushTpl = (name, p, yaml) => {
                if (seen.has(name)) return
                seen.add(name)
                predefined.push({ name, path: p, yaml })
              }
              const pickDirYaml = async (dirPath, dirName) => {
                let sub = []
                try { sub = await fs.listDir(await fs.resolve(dirPath)) } catch (e) { return null }
                const files = (sub || []).filter((x) => x && x.type === 'file' && /\.ya?ml$/i.test(x.name)).map((x) => x.name).sort()
                if (!files.length) return null
                const pick = files.indexOf(dirName + '.yaml') >= 0 ? dirName + '.yaml' : files[0]
                return dirPath + '/' + pick
              }
              const entries = await fs.listDir(await fs.resolve(tplRoot))
              // 先子目录（占名），后平铺（同名让位）
              const dirs = (entries || []).filter((x) => x && x.type !== 'file')
              const files = (entries || []).filter((x) => x && x.type === 'file' && /\.ya?ml$/i.test(x.name))
              for (const d of dirs) {
                const picked = await pickDirYaml(tplRoot + '/' + d.name, d.name)
                if (!picked) continue
                let yaml = ''
                try { yaml = await fs.readText(await fs.resolve(picked)) } catch (e) { yaml = '' }
                pushTpl(d.name, picked, yaml)
              }
              for (const en of files) {
                const p = tplRoot + '/' + en.name
                let yaml = ''
                try { yaml = await fs.readText(await fs.resolve(p)) } catch (e) { yaml = '' }
                pushTpl(en.name.replace(/\.ya?ml$/i, ''), p, yaml)
              }
            }
          } catch (e) { /* 预定义目录不可用 → 内嵌兜底 */ }
        }
        const merged = predefined
        // Iter-28：每项补 params 简化形态（创建弹窗 key-value 编辑器预填默认值；
        // parsed.params={key:{type,description,default}} → {key: default 原值}，无 default → ''）
        const mergedWithParams = merged.map((t) => {
          try {
            const pp = parseWorkflow(String(t.yaml || '')).params
            return Object.assign({}, t, { params: simplifyParams(pp) })
          } catch (e) { return Object.assign({}, t, { params: {} }) }
        })
        writeJson(res, 200, { predefined: mergedWithParams })
        return
      }

      // Iter-13：面板创建实例（只 create 不 start；写操作 POST）
      if (req.method === 'POST' && pathname === '/wf/create') {
        let body = ''
        let oversized = false
        req.on('data', (chunk) => {
          body += chunk
          if (body.length > 1048576) { oversized = true; req.destroy() }
        })
        req.on('end', async () => {
          try {
            if (oversized) return
            let args = {}
            try { args = JSON.parse(body || '{}') } catch (e) {
              writeJson(res, 400, { error: 'invalid json body' })
              return
            }
            const root = String(args.workspaceRoot || '').replace(/\\/g, '/').replace(/\/+$/, '')
            if (!root) { writeJson(res, 400, { error: 'workspaceRoot required' }); return }
            if (!registry) { writeJson(res, 500, { error: 'registry unavailable' }); return }
            const srcText = args.workflowText ? String(args.workflowText) : null
            const srcPath = args.workflowPath ? String(args.workflowPath) : null
            if (!srcText && !srcPath) { writeJson(res, 400, { error: 'workflowPath or workflowText required' }); return }
            let text = srcText
            if (!text && srcPath) {
              try {
                text = await fs.readText(await fs.resolve(srcPath))
              } catch (e) {
                writeJson(res, 400, { error: 'cannot read workflowPath: ' + (e && e.message ? e.message : String(e)) })
                return
              }
            }
            const parsed = parseWorkflow(text)
            if (parsed.errors && parsed.errors.length > 0) {
              writeJson(res, 400, { error: 'invalid workflow definition', workflowBeginErrors: parsed.errors })
              return
            }
            // Iter-27b（拍板①=B）：/wf/create 同款语义硬拦——errors 非空 400 结构化拒
            //（不建实例；GUI 前台清单展示归 Iter-28，本版先通数据通道）。preset 子目录
            // 来源=definition-preset 语境（defDir 锚点+禁字面绝对），其余=definition。
            const tplDirPre = srcPath ? (presetTemplateDirOf(srcPath, detectPredefinedRoot()) || null) : null
            const vRes = await validateWorkflow({
              parsed,
              params: args.params || {},
              workspaceRoot: root,
              predefinedRoot: detectPredefinedRoot(),
              defDir: tplDirPre || undefined,
              context: tplDirPre ? 'definition-preset' : 'definition',
              fs,
            })
            if (!vRes.ok) {
              writeJson(res, 400, {
                error: 'invalid workflow definition',
                workflowBeginErrors: vRes.errors.map(formatValidationItem),
                errors: vRes.errors,
                hint: GATE_HINT, // Iter-27b 验收修正：面板/调用方同款"只转告+停止"约束
              })
              return
            }
            let entry
            if (args.sessionId) {
              // Iter-19：走 createBind（1:1 守卫 + CONFLICT 自愈：解绑冲突旧实例→新建当前绑定）
              entry = await registry.createBind(root, args.sessionId, {
                workflowName: parsed.name,
                sourceText: text,
                sourcePath: srcPath || null,
                params: {}, // Iter-38：meta.params 退役——创建实参经 mergeParamsIntoYamlText 落 instance.yaml params 节
              })
            } else {
              entry = await registry.beginInstance({ cwd: root, sessionId: null, workflowName: parsed.name, sourceText: text, sourcePath: srcPath || null, params: {} })
            }
            // Iter-38（params 单轨化）：创建实参落 instance.yaml params 节（单一事实源；
            // ${param} 注入/快照/编辑器/源码态全部读这一处；meta.params 不再写入）
            if (args.params && Object.keys(args.params).length) {
              try {
                const yPathC = await fs.resolve(entry.dir + '/instance.yaml')
                const yTextC = await fs.readText(yPathC)
                await fs.writeText(yPathC, mergeParamsIntoYamlText(yTextC, args.params))
              } catch (e38) { /* params 落盘失败不阻断创建 */ }
            }
            // Iter-27a（四点②③）：预置工作流子目录 1:1 复制（模板子目录与实例目录同构；
            // 静态文件原样复制、相对引用零调整；定义本身已写 instance.yaml；文本 only；
            // 单文件失败不阻断，失败清单随响应回传）
            let presetCopy = null
            const tplDir = tplDirPre
            if (tplDir) presetCopy = await copyTemplateStaticTree(fs, tplDir, entry.dir, srcPath)
            // Iter-27b：校验快照落盘 + 200 响应补 validation/warnings（W 级，validate 出口；
            // parser warnings 已下线）；warnings 字符串化保持旧形状兼容。
            const validationSnapshot = { ok: true, errors: [], warnings: vRes.warnings, validatedAt: new Date().toISOString() }
            try {
              await registry.patchMeta(root, entry.instanceId, { validation: validationSnapshot })
            } catch (e2) { /* 快照失败不阻断创建 */ }
            writeJson(res, 200, { instanceId: entry.instanceId, dir: entry.dir, workflowName: parsed.name, phase: 'CREATED', workspaceRoot: root, sessionId: args.sessionId || null, recoveredConflict: entry._recoveredConflict || [], warnings: vRes.warnings.map(formatValidationItem), validation: { ok: true, warnings: vRes.warnings.map(formatValidationItem), validatedAt: validationSnapshot.validatedAt }, presetCopy })
          } catch (e) {
            writeJson(res, 500, { error: e && e.message ? e.message : String(e) })
          }
        })
        return
      }

      if (pathname === '/wf/skill') {
        if (!fs) {
          writeJson(res, 200, { text: null, error: 'fs service unavailable' })
          return
        }
        try {
          const path = query.get('path') || ''
          if (!path) {
            writeJson(res, 200, { text: null, error: 'no file path provided' })
            return
          }
          // Iter-41 修复（用户反馈）：相对路径按两级链解析——工作空间优先，未命中则
          // .dsh 预定义目录（与 /wf/skills 技能扫描同源 detectPredefinedRoot）；
          // 绝对路径直读（现状不变）。
          const isAbs = path.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(path)
          const rel = path.replace(/^\.\//, '')
          const wsRoot36 = (query.get('workspaceRoot') || '').replace(/\\/g, '/').replace(/\/+$/, '')
          const pre36 = detectPredefinedRoot()
          const candidates = isAbs ? [path] : [].concat(
            wsRoot36 ? [wsRoot36 + '/' + rel] : [],
            pre36 ? [pre36.replace(/\/+$/, '') + '/' + rel] : [],
            [path]
          )
          let text = null
          let lastErr36 = null
          for (const c of candidates) {
            try {
              const r36 = await fs.resolve(c)
              text = await fs.readText(r36)
              break
            } catch (e36) { lastErr36 = e36 }
          }
          if (text === null) throw (lastErr36 || new Error('not found: ' + path))
          writeJson(res, 200, { text, error: null })
        } catch (e) {
          writeJson(res, 200, { text: null, error: e && e.message ? e.message : String(e) })
        }
        return
      }

      // ── Iter-28：技能下拉数据源（预定义 + 工作区合并，同名工作区优先）────────
      // 查找次序与 Iter-27b 两级链一致：工作区根 → 预定义目录；同名（目录名）时
      // 工作区顶替预定义版。下拉 value=相对形态 skills/<dir>/SKILL.md（两级链自动
      // 命中工作区优先版）；label 数据=name+version（frontmatter）+source。
      if (pathname === '/wf/skills') {
        const out = []
        if (fs) {
          const scanSkillDir = async (dirPath, source) => {
            let entries = []
            try { entries = await fs.listDir(await fs.resolve(dirPath)) } catch (e) { return }
            for (const en of (entries || []).filter((x) => x && x.type === 'directory')) {
              const id = en.name
              const abs = dirPath + '/' + id + '/SKILL.md'
              let fm = null
              try { fm = parseSkillFrontmatter(await fs.readText(await fs.resolve(abs)), id) } catch (e2) { continue } // 无 SKILL.md 非有效技能
              const hit = out.find((s) => s.id === id)
              if (hit) {
                // 同名：工作区优先顶替（保持预定义占位顺序），记录双来源
                if (source === 'workspace') { hit.name = fm.name; hit.version = fm.version; hit.source = 'workspace'; hit.path = abs; hit.predefinedShadowed = true }
                continue
              }
              out.push({ id, name: fm.name || id, version: fm.version, relPath: 'skills/' + id + '/SKILL.md', path: abs, source })
            }
          }
          try {
            const preRoot = typeof detectPredefinedRoot === 'function' ? detectPredefinedRoot() : null
            if (preRoot) await scanSkillDir(preRoot + '/skills', 'predefined')
            const wsRoot = (query.get('workspaceRoot') || '').replace(/\\/g, '/').replace(/\/+$/, '')
            if (wsRoot) await scanSkillDir(wsRoot + '/skills', 'workspace')
          } catch (e) { /* 扫描异常 → 返回已收集部分 */ }
        }
        writeJson(res, 200, { skills: out })
        return
      }

      // ── Iter-28：实例编辑前台数据源（读定义 raw + 权限矩阵 + 任务状态对齐）──
      if (req.method === 'GET' && pathname === '/wf/instance-yaml') {
        const root = (query.get('workspaceRoot') || '').replace(/\\/g, '/').replace(/\/+$/, '')
        const instanceId = query.get('instanceId') || ''
        if (!root || !instanceId) { writeJson(res, 400, { error: 'workspaceRoot and instanceId required' }); return }
        if (!registry) { writeJson(res, 500, { error: 'registry unavailable' }); return }
        if (!fs) { writeJson(res, 500, { error: 'fs service unavailable' }); return }
        try {
          const entry = await registry.loadEntry(root, instanceId)
          if (!entry) { writeJson(res, 404, { error: 'instance not found: ' + instanceId }); return }
          const stage = entry.hasState ? entry.engine.snapshot().stage : 'CREATED'
          const perms = instanceEditPermissions(stage)
          const rawFile = await fs.readText(await fs.resolve(entry.dir + '/instance.yaml'))
          const text = stripInstanceHeader(rawFile)
          const rawYaml = parseYaml(text)
          const parsed = parseWorkflow(text)
          // 任务状态对齐：state 同 id 直取；loop/concurrent 展开后按组聚合（DagCanvas 同规则）
          const stateTasks = entry.hasState ? ((entry.engine.snapshot().tasks) || []) : []
          const statusOf = (rawTask) => {
            const id = String(rawTask && rawTask.id)
            const same = stateTasks.find((st) => st.id === id)
            if (same) return same.status || 'PENDING'
            const group = stateTasks.filter((st) => st._loopGroup === id || st._concurrentGroup === id)
            if (!group.length) return 'PENDING'
            const cnt = { RUNNING: 0, DONE: 0, FAILED: 0, SKIPPED: 0 }
            group.forEach((st) => { cnt[st.status] = (cnt[st.status] || 0) + 1 })
            if (cnt.RUNNING) return 'RUNNING'
            if (cnt.FAILED) return 'FAILED'
            if (cnt.SKIPPED && !cnt.DONE) return 'SKIPPED'
            if (cnt.DONE === group.length) return 'DONE'
            return 'PENDING'
          }
          const g = (t) => (t['quality-gate'] && typeof t['quality-gate'] === 'object' && !Array.isArray(t['quality-gate'])) ? t['quality-gate'] : {}
          const tasks = (Array.isArray(rawYaml.tasks) ? rawYaml.tasks : []).map((t) => ({
            id: t && t.id != null ? String(t.id) : null,
            name: t && t.name != null ? String(t.name) : null,
            type: (t && t.type) || 'llm-task',
            status: statusOf(t),
            processor: t && t.processor != null ? String(t.processor) : null,
            dependsOn: t && Array.isArray(t['depends-on']) ? t['depends-on'].map(String) : [],
            timeout: t && t.timeout != null ? Number(t.timeout) : null,
            gateChecker: g(t).checker != null ? String(g(t).checker) : null,
            gateOnFailure: g(t)['on-failure'] || null,
            retries: g(t)['max-retries'] != null ? Number(g(t)['max-retries']) : 0,
            inputs: t && t.inputs && typeof t.inputs === 'object' && !Array.isArray(t.inputs) ? t.inputs : {},
            outputs: t && Array.isArray(t.outputs) ? t.outputs : [],
            concurrency: t && t['max-concurrency'] != null ? Number(t['max-concurrency']) : null,
            itemsFrom: t && t['items-from'] != null ? String(t['items-from']) : null,
            // Iter-36：表单补全——循环组字段与错误策略映射
            itemVar: t && t['item-var'] != null ? String(t['item-var']) : null,
            itemsFormat: t && t['items-format'] != null ? String(t['items-format']) : null,
            onError: t && t['on-error'] != null ? String(t['on-error']) : null,
          }))
          writeJson(res, 200, {
            instanceId, dir: entry.dir, stage, editable: perms,
            text, // Iter-35：strip 后的 instance.yaml 原文（编辑器源码模式数据源）
            parseErrors: parsed.errors || [],
            instance: {
              name: parsed.name,
              version: rawYaml.version != null ? String(rawYaml.version) : null,
              description: rawYaml.description != null ? String(rawYaml.description) : null,
              maxConcurrency: rawYaml['max-concurrency'] != null ? Number(rawYaml['max-concurrency']) : 1,
              params: rawYaml.params || {}, // Iter-38：params 单轨化——读 instance.yaml params 节（当前值），meta.params 退役
            },
            tasks,
            validation: (entry.meta && entry.meta.validation) || null,
          })
        } catch (e) {
          writeJson(res, 500, { error: e && e.message ? e.message : String(e) })
        }
        return
      }

      // ── Iter-28：编辑保存/校验共用管道 ─────────────────────────────────────
      // patch 白名单合并（applyInstancePatch 按 stage 权限拒绝禁改字段）→ 合并后
      // 定义经 Iter-27b 实时校验（instance 语境）→ errors 非空一律不落盘。
      // save=true 才写回（header 原样保留 + serializeWorkflowYaml 重建定义文本）。
      async function editInstancePipeline(args, save) {
        const root = String(args.workspaceRoot || '').replace(/\\/g, '/').replace(/\/+$/, '')
        const instanceId = args.instanceId
        if (!root || !instanceId) return { code: 400, body: { error: 'workspaceRoot and instanceId required' } }
        if (!registry) return { code: 500, body: { error: 'registry unavailable' } }
        if (!fs) return { code: 500, body: { error: 'fs service unavailable' } }
        const entry = await registry.loadEntry(root, instanceId)
        if (!entry) return { code: 404, body: { error: 'instance not found: ' + instanceId } }
        const stage = entry.hasState ? entry.engine.snapshot().stage : 'CREATED'
        const perms = instanceEditPermissions(stage)
        const rawFile = await fs.readText(await fs.resolve(entry.dir + '/instance.yaml'))
        const text = stripInstanceHeader(rawFile)
        const rawYaml = parseYaml(text)
        const applied = applyInstancePatch(rawYaml, args.patch || {}, perms)
        // 注释头原样保留（# 开头行 + 其后空行；创建时写入的快照元信息不动）
        const lines = rawFile.split(/\r?\n/)
        let hi = 0
        while (hi < lines.length && (lines[hi].trim() === '' || lines[hi].trim().startsWith('#'))) hi++
        const header = lines.slice(0, hi).join('\n')
        if (!applied.ok) {
          return { code: 400, body: { error: 'patch 含禁改字段或非法值', stage, editable: perms, editErrors: applied.errors, hint: GATE_HINT } }
        }
        const newText = serializeWorkflowYaml(rawYaml)
        const parsedAfter = parseWorkflow(newText)
        let vErrors = []
        let vWarnings = []
        if (parsedAfter.errors && parsedAfter.errors.length > 0) {
          vErrors = parsedAfter.errors.map((msg) => ({ code: 'E-PARSE', task: null, field: null, message: msg }))
        } else {
          const meta = entry.meta || {}
          const defDir = presetTemplateDirOf(meta.sourcePath, detectPredefinedRoot()) || undefined
          const vRes = await validateWorkflow({
            parsed: parsedAfter,
            params: meta.params || {},
            workspaceRoot: meta.sessionCwd || undefined,
            predefinedRoot: detectPredefinedRoot(),
            defDir,
            wfDir: entry.dir,
            context: 'instance',
            fs,
          })
          vErrors = vRes.errors || []
          vWarnings = (vRes.warnings || []).map(formatValidationItem)
        }
        if (vErrors.length > 0) {
          return { code: 400, body: { error: '语义校验未通过（' + vErrors.length + ' 项错误），未保存', stage, editable: perms, errors: vErrors, warnings: vWarnings, workflowBeginErrors: vErrors.map(formatValidationItem), hint: GATE_HINT } }
        }
        if (!save) {
          return { code: 200, body: { ok: true, dryRun: true, stage, editable: perms, warnings: vWarnings, validation: { ok: true, errors: [], warnings: vWarnings, validatedAt: new Date().toISOString() } } }
        }
        const outText = (header ? header + '\n' : '') + newText
        await fs.writeText(await fs.resolve(entry.dir + '/instance.yaml'), outText)
        // 校验快照同步 metadata（供 /wf/list 与后续 GET 展示）
        const validationSnapshot = { ok: true, errors: [], warnings: vWarnings, validatedAt: new Date().toISOString() }
        try { await registry.patchMeta(root, instanceId, { validation: validationSnapshot }) } catch (e2) { /* 快照失败不阻断保存 */ }
        return { code: 200, body: { ok: true, saved: true, stage, editable: instanceEditPermissions(stage), warnings: vWarnings, validation: validationSnapshot } }
      }

      // Iter-28：编辑校验（dryRun；不落盘）
      if (req.method === 'POST' && pathname === '/wf/validate-instance') {
        let body = ''
        let oversized = false
        req.on('data', (chunk) => { body += chunk; if (body.length > 1048576) { oversized = true; req.destroy() } })
        req.on('end', async () => {
          try {
            if (oversized) return
            let args = {}
            try { args = JSON.parse(body || '{}') } catch (e) { writeJson(res, 400, { error: 'invalid json body' }); return }
            const r = await editInstancePipeline(args, false)
            writeJson(res, r.code, r.body)
          } catch (e) {
            writeJson(res, 500, { error: e && e.message ? e.message : String(e) })
          }
        })
        return
      }

      // Iter-35：源码模式保存（定义全文替换）。同一语义校验关口（parse + instance 语境校验，
      // errors 非空不落盘）；instance.yaml 注释头原样保留（同 patch 管道规则）；权限矩阵
      // （editable.definition / readonlyAll）服务端兜底。与 patch 管道互斥：body 带 text 即全文。
      if (req.method === 'POST' && pathname === '/wf/instance-yaml-raw') {
        let body = ''
        let oversized = false
        req.on('data', (chunk) => { body += chunk; if (body.length > 2097152) { oversized = true; req.destroy() } })
        req.on('end', async () => {
          try {
            if (oversized) { writeJson(res, 400, { error: 'body 超限' }); return }
            let args = {}
            try { args = JSON.parse(body || '{}') } catch (e) { writeJson(res, 400, { error: 'invalid json body' }); return }
            const root = String(args.workspaceRoot || '').replace(/\\/g, '/').replace(/\/+$/, '')
            const instanceId = args.instanceId
            const newText = String(args.text || '')
            if (!root || !instanceId) { writeJson(res, 400, { error: 'workspaceRoot and instanceId required' }); return }
            if (!newText.trim()) { writeJson(res, 400, { error: 'text 为空，拒绝保存' }); return }
            if (!registry) { writeJson(res, 500, { error: 'registry unavailable' }); return }
            if (!fs) { writeJson(res, 500, { error: 'fs service unavailable' }); return }
            const entry = await registry.loadEntry(root, instanceId)
            if (!entry) { writeJson(res, 404, { error: 'instance not found: ' + instanceId }); return }
            const stage = entry.hasState ? entry.engine.snapshot().stage : 'CREATED'
            const perms = instanceEditPermissions(stage)
            if (!perms.definition || perms.readonlyAll) {
              writeJson(res, 403, { error: '当前阶段（' + stage + '）不允许编辑定义', stage, editable: perms })
              return
            }
            const rawFile = await fs.readText(await fs.resolve(entry.dir + '/instance.yaml'))
            // 注释头原样保留（同 patch 管道规则：创建时写入的快照元信息不动）
            const lines = rawFile.split(/\r?\n/)
            let hi = 0
            while (hi < lines.length && (lines[hi].trim() === '' || lines[hi].trim().startsWith('#'))) hi++
            const header = lines.slice(0, hi).join('\n')
            const parsed = parseWorkflow(newText)
            // Iter-35 修正（用户验证反馈）：解析错误不再屏蔽语义校验——原实现解析层有错
            // （如 depends-on 引用未定义任务）即跳过语义层，「修一条露一条」。现两层并报：
            // 解析错误（E-PARSE）+ 语义错误（环依赖/缺 processor/技能缺失等）全量合并呈现。
            let vErrors = (parsed.errors || []).map((msg) => ({ code: 'E-PARSE', task: null, field: null, message: String(msg) }))
            let vWarnings = []
            try {
              const meta = entry.meta || {}
              const defDir = presetTemplateDirOf(meta.sourcePath, detectPredefinedRoot()) || undefined
              const vRes = await validateWorkflow({
                parsed,
                params: meta.params || {},
                workspaceRoot: meta.sessionCwd || undefined,
                predefinedRoot: detectPredefinedRoot(),
                defDir,
                wfDir: entry.dir,
                context: 'instance',
                fs,
              })
              vErrors = vErrors.concat(vRes.errors || [])
              vWarnings = (vRes.warnings || []).map(formatValidationItem)
            } catch (e2) { /* 语义校验异常（如解析残缺导致）→ 保留解析错误，不叠加 */ }
            if (vErrors.length > 0) {
              writeJson(res, 400, { error: '语义校验未通过（' + vErrors.length + ' 项错误），未保存', stage, editable: perms, errors: vErrors, warnings: vWarnings, workflowBeginErrors: vErrors.map(formatValidationItem), hint: GATE_HINT })
              return
            }
            const outText = (header ? header + '\n' : '') + newText
            await fs.writeText(await fs.resolve(entry.dir + '/instance.yaml'), outText)
            const validationSnapshot = { ok: true, errors: [], warnings: vWarnings, validatedAt: new Date().toISOString() }
            try { await registry.patchMeta(root, instanceId, { validation: validationSnapshot }) } catch (e2) { /* 快照失败不阻断保存 */ }
            writeJson(res, 200, { ok: true, saved: true, stage, editable: instanceEditPermissions(stage), warnings: vWarnings, validation: validationSnapshot })
          } catch (e) {
            writeJson(res, 500, { error: e && e.message ? e.message : String(e) })
          }
        })
        return
      }

      // Iter-38（用户拍板）：/wf/instance-params 路由退役——params 单轨化后由
      // /wf/instance-yaml patch.params 承载（见 applyInstancePatch params 分支）。

      // Iter-42 临时诊断：客户端探针回传（写服务日志；诊断结束即删）
      if (req.method === 'POST' && pathname === '/wf/debug-probe') {
        let b41 = ''
        req.on('data', (c) => { b41 += c })
        req.on('end', () => {
          try { console.log('[wf42-probe] ' + String(b41).slice(0, 400)) } catch (e41) {}
          writeJson(res, 200, { ok: true })
        })
        return
      }


      // Iter-28：编辑保存（同一闸门；通过才写回 instance.yaml）
      if (req.method === 'POST' && pathname === '/wf/instance-yaml') {
        let body = ''
        let oversized = false
        req.on('data', (chunk) => { body += chunk; if (body.length > 1048576) { oversized = true; req.destroy() } })
        req.on('end', async () => {
          try {
            if (oversized) return
            let args = {}
            try { args = JSON.parse(body || '{}') } catch (e) { writeJson(res, 400, { error: 'invalid json body' }); return }
            const r = await editInstancePipeline(args, true)
            writeJson(res, r.code, r.body)
          } catch (e) {
            writeJson(res, 500, { error: e && e.message ? e.message : String(e) })
          }
        })
        return
      }

      if (pathname === '/wf/config') {
        const root = (query.get('workspaceRoot') || '').replace(/\\/g, '/').replace(/\/+$/, '')
        if (root && fs) {
          try {
            let valid = false
            let error = null
            try {
              await fs.resolve(root + '/.workflow-agent/state.json')
              valid = true
            } catch (eLegacy) {
              // Iter-10：实例布局也算有效工作区（存在实例目录即可）
              try {
                const entries = await fs.listDir(await fs.resolve(root + '/.workflow-agent/instances'))
                valid = entries.some(en => en.type === 'directory')
                if (!valid) error = 'no instance directories under ' + root + '/.workflow-agent/instances'
              } catch (eInst) {
                error = 'state.json not found at ' + root + '/.workflow-agent/state.json'
              }
            }
            if (valid) writeJson(res, 200, { valid: true, workspaceRoot: root })
            else writeJson(res, 200, { valid: false, workspaceRoot: root, error })
          } catch (e) {
            writeJson(res, 200, { valid: false, workspaceRoot: root, error: e && e.message ? e.message : String(e) })
          }
        } else {
          writeJson(res, 200, { valid: false, workspaceRoot: root, error: 'workspaceRoot not provided' })
        }
        return
      }

      // Iter-14：消息注入探针（0.1.5 迁移：subagents.followup 服务级 API 已移除 → subagents.sendMessage
      // (parentAgent, targetId, content, {signal})，steer 语义；返回 messageId）
      if (req.method === 'POST' && pathname === '/wf/probe-inject') {
        let body = ''
        req.on('data', (chunk) => { body += chunk })
        req.on('end', async () => {
          try {
            const args = JSON.parse(body || '{}')
            const targetSessionId = args.targetSessionId
            const message = args.message || 'test message from iter-14 probe'
            const parentSessionId = args.parentSessionId // 可选：指定 parent session
            
            if (!targetSessionId) {
              writeJson(res, 400, { error: 'targetSessionId required' })
              return
            }
            
            const subagents = ctx.get('subagents')
            const agents = ctx.get('agents')
            
            if (!subagents) {
              writeJson(res, 500, { error: 'subagents service unavailable' })
              return
            }
            
            if (!agents) {
              writeJson(res, 500, { error: 'agents service unavailable' })
              return
            }
            
            // 尝试获取 parent agent
            let parentAgent = agents.currentInitiator ? agents.currentInitiator() : null
            
            // 如果没有 current initiator，尝试从列表获取
            if (!parentAgent && parentSessionId) {
              const allAgents = agents.list ? agents.list() : []
              parentAgent = allAgents.find(a => a.session && a.session.id === parentSessionId)
            }
            
            // 如果还是没有，尝试获取 roots
            if (!parentAgent) {
              const rootAgents = agents.roots ? agents.roots() : []
              if (rootAgents.length > 0) {
                parentAgent = rootAgents[0]
              }
            }
            
            if (!parentAgent) {
              // 诊断信息
              const allAgents = agents.list ? agents.list() : []
              const rootAgents = agents.roots ? agents.roots() : []
              writeJson(res, 500, { 
                error: 'no parent agent available',
                diagnostic: {
                  currentInitiator: agents.currentInitiator ? !!agents.currentInitiator() : false,
                  totalAgents: allAgents.length,
                  rootAgents: rootAgents.length,
                  agentIds: allAgents.map(a => a.session ? a.session.id : 'no-session').slice(0, 5)
                }
              })
              return
            }
            
            // 调用 subagents.sendMessage 注入消息（steer 语义；0.1.5 后 followup 服务级 API 不存在）
            const content = [{ type: 'text', text: message }]
            const abortController = new AbortController()
            const messageId = await subagents.sendMessage(
              parentAgent,
              targetSessionId,
              content,
              { signal: abortController.signal }
            )
            
            writeJson(res, 200, { 
              success: true, 
              messageId, 
              targetSessionId,
              parentSessionId: parentAgent.session ? parentAgent.session.id : 'unknown',
              message 
            })
          } catch (e) {
            writeJson(res, 500, { 
              error: e && e.message ? e.message : String(e),
              stack: e && e.stack ? e.stack : undefined
            })
          }
        })
        return
      }

      // Iter-15/18：面板控制路由（start/stop/reset/resume/adopt，驱动实例状态机）
      if (req.method === 'POST' && (pathname === '/wf/start' || pathname === '/wf/stop' || pathname === '/wf/reset' || pathname === '/wf/resume' || pathname === '/wf/adopt')) {
        let body = ''
        req.on('data', (chunk) => { body += chunk })
        req.on('end', async () => {
          try {
            const args = JSON.parse(body || '{}')
            const root = String(args.workspaceRoot || '').replace(/\\/g, '/').replace(/\/+$/, '')
            const instanceId = args.instanceId
            
            if (!root) { writeJson(res, 400, { error: 'workspaceRoot required' }); return }
            if (!instanceId) { writeJson(res, 400, { error: 'instanceId required' }); return }
            if (!registry) { writeJson(res, 500, { error: 'registry unavailable' }); return }
            if (!fs) { writeJson(res, 500, { error: 'fs service unavailable' }); return }
            
            const action = pathname.replace('/wf/', '')
            
            // Iter-18：BROKEN 拦截（create/adopt/run 前校验整树完整性）
            const integ = await registry.checkWorkspaceTreeIntegrity(root)
            if (!integ.ok) { writeJson(res, 500, { error: 'workspace BROKEN: ' + integ.reason }); return }
            
            const entry = await registry.loadEntry(root, instanceId)
            if (!entry) { writeJson(res, 404, { error: 'instance not found: ' + instanceId }); return }
            
            // 辅助函数：展开实例定义（从 instance.yaml 读取并解析）
            // Iter-33（缺陷 #11）：原简化版 expandInstanceDef（仅 text+base+params）缺 wfDir/defDir/
            // workspaceRoot 上下文，静态引用（items-from/inputs）解析退化到预定义根 → 面板 reset 对
            // 引用模板静态文件的实例必失败（verify-empty-items 实证）。此处按编排侧 reset 工具同源
            // 语义做完整展开（expandInstanceDefinition 嵌套于 tools-preset 子作用域不可跨段引用，
            // 故用段级原语等价实现；所需符号均为 0 缩进段级定义，可见性经核实）：
            // wfDir（实例目录）+ defDir（模板子目录锚点）+ workspaceRoot 全量 + finalizeDataflow
            // （阶段 2 数据流注入）+ inputs 物化。简化版删除（唯一使用点已替换）。
            async function expandInstanceDef(entry) {
              const raw = await fs.readText(await fs.resolve(entry.dir + '/instance.yaml'))
              const text = stripInstanceHeader(raw)
              const params = (entry.meta && entry.meta.params) || {}
              const wsRoot = (entry.meta && entry.meta.sessionCwd) || undefined
              const defDir = E_presetTemplateDirOf(entry.meta && entry.meta.sourcePath, detectPredefinedRootSafe()) || undefined
              const parsed = await expandDefinition(fs, { text, workspaceRoot: wsRoot }, params, { wfDir: entry.dir, defDir })
              parsed.tasks = finalizeDataflow(parsed.tasks, { wfDir: entry.dir })
              parsed.tasks = await materializeInputsIntoInstance(fs, parsed.tasks, entry.dir, wsRoot)
              return parsed
            }
            
            // Iter-21：面板控制统一经 session 注入指令（与 Start 一致——此前 Stop/Resume 只改实例态而 session 不感知，导致按钮"无效"）
            // 0.1.5 迁移：apiProxy 退役 → sessionController.prompt（普通会话）/ subagents.prompt（continuable 子代理，
            // queue/steer 语义由 delivery 字段承担）；requestId 拍平进请求体，返回直接量 {accepted:true} / {messageId}。
            async function injectSessionCmd(args, root, instanceId, verb, extraText) {
              const sessionId = args.sessionId
              if (!sessionId) return { messageInjected: false, reason: 'no sessionId' }
              const sessionController = ctx.get('sessionController')
              if (!sessionController) return { messageInjected: false, reason: 'sessionController unavailable' }
              const subagents = ctx.get('subagents')
              const text = verb === 'start' ? `请启动工作流实例 ${instanceId}，工作区：${root}`
                : verb === 'stop' ? `请停止工作流实例 ${instanceId}，工作区：${root}`
                // Iter-31（用户 D2 拍板）：reset 后停留 PENDING 等用户手动 Start——通知不得指示续跑；
                // extraText（清理契约）仍需会话执行清理命令，清理完毕即待命。
                : verb === 'reset' ? `工作流实例 ${instanceId} 已重置至 PENDING（工作区：${root}）。此前对话中的阶段与任务状态已作废，请忽略旧进度，勿回溯对比；以 workflow_status / workflow_list 返回为准。请勿自行 begin 或启动工作流；清理契约（如有）执行完毕后即待命，等待用户发出启动指令。${extraText ? '\n\n' + extraText : ''}`
                : `请继续工作流实例 ${instanceId}，工作区：${root}`
              // 停止是紧急指令：agent 正在执行任务，队列消息会等本轮结束——用 steer 打断当前轮让 LLM 尽快响应；
              // start/resume 在 agent 空闲/暂停时投递，用 queue。
              const mode = verb === 'stop' ? 'steer' : 'queue'
              try {
                const parentSessionId = args.parentSessionId
                if (parentSessionId) {
                  if (!subagents || typeof subagents.prompt !== 'function') return { messageInjected: false, reason: 'subagents unavailable' }
                  const promptResult = await subagents.prompt({
                    requestId: `wf-${verb}-subagent-${Date.now()}`,
                    parentSessionId,
                    childSessionId: sessionId,
                    mode: 'continuable',
                    delivery: mode,
                    content: [{ type: 'text', text }],
                  }, new AbortController().signal)
                  return { messageInjected: true, promptResult }
                }
                const promptResult = await sessionController.prompt({
                  requestId: `wf-${verb}-${Date.now()}`,
                  sessionId,
                  mode,
                  content: [{ type: 'text', text }],
                }, new AbortController().signal)
                return { messageInjected: true, promptResult }
              } catch (e) {
                return { messageInjected: false, error: e && e.message ? e.message : String(e) }
              }
            }

            if (action === 'start') {
              const stage = entry.hasState ? entry.engine.snapshot().stage : 'CREATED'
              if (stage === 'RUNNING') { writeJson(res, 400, { error: 'instance is already running' }); return }
              if (stage === 'STOPPED') { writeJson(res, 400, { error: 'instance is STOPPED; use resume' }); return }
              if (stage === 'COMPLETED' || stage === 'FAILED') { writeJson(res, 400, { error: 'instance is ' + stage + '; use reset' }); return }
              // Iter-20(R2)：面板 Start 不置 RUNNING，状态由编排侧 workflow_start 统一维护；
              // 路由只校验 + 注入"请启动实例"消息，不改引擎状态（避免双写冲突 B4）。
              const snap = entry.engine.snapshot()
              snap.instanceId = entry.instanceId
              
              // Iter-15：向当前 session 发送启动消息（0.1.5 迁移：sessionController/subagents 新签名）
              const sessionId = args.sessionId
              if (sessionId) {
                const sessionController = ctx.get('sessionController')
                const subagents = ctx.get('subagents')
                if (sessionController) {
                  try {
                    const parentSessionId = args.parentSessionId
                    if (parentSessionId) {
                      if (!subagents || typeof subagents.prompt !== 'function') throw new Error('subagents unavailable')
                      const promptResult = await subagents.prompt({
                        requestId: `wf-start-subagent-${Date.now()}`,
                        parentSessionId: parentSessionId,
                        childSessionId: sessionId,
                        mode: 'continuable',
                        delivery: 'queue',
                        content: [{ type: 'text', text: `请启动工作流实例 ${instanceId}，工作区：${root}` }]
                      }, new AbortController().signal)
                      snap.messageInjected = true
                      snap.promptResult = promptResult
                    } else {
                      const promptResult = await sessionController.prompt({
                        requestId: `wf-start-${Date.now()}`,
                        sessionId: sessionId,
                        mode: 'queue',
                        content: [{ type: 'text', text: `请启动工作流实例 ${instanceId}，工作区：${root}` }]
                      }, new AbortController().signal)
                      snap.messageInjected = true
                      snap.promptResult = promptResult
                    }
                  } catch (e) {
                    snap.messageInjectionError = e && e.message ? e.message : String(e)
                    snap.messageInjectionStack = e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n') : null
                  }
                } else {
                  snap.sessionControllerUnavailable = true
                }
              }
              writeJson(res, 200, snap)
              return
            }
            
            if (action === 'stop') {
              // 前置：重启后缓存 entry 可能 hasState=false（state.json 在磁盘上）——先按磁盘水合，
              // 与 instance-store.recoverOrphan 同款模式；无 state.json（CREATED）维持 400。
              if (!entry.hasState) {
                try {
                  const fsSvc = ctx.get('fs')
                  const state = JSON.parse(await fsSvc.readText(await fsSvc.resolve(entry.dir + '/state.json')))
                  if (state && state.workflow) { entry.engine.hydrate(state); entry.hasState = true }
                } catch (e0) { /* 无 state.json（CREATED）→ 保持 hasState=false */ }
              }
              if (!entry.hasState) { writeJson(res, 400, { error: 'instance not started (CREATED)' }); return }
              // 0.1.5 Phase 3 修订（路由层权威直停）：Iter-21 的「steer 注入→agent 调 workflow_stop」链路在
              // 0.1.5 下不可靠——实测注入消息会被 inbox 移除/排到回合尾（不再即时打断），子会话因此迟迟不停。
              // 新语义：面板 Stop 即权威直停——路由内同步完成 ①engine.stop（RUNNING→STOPPED，保 DONE）
              // ②落盘+stopReason=user-stop ③对全部子会话条目直接下发 interruptByParent（活着的被打断，
              // idle/absent 为服务端 no-op；不依赖任何判活）。④注入"请停止"消息仅作事后通知（best-effort，
              // agent 收到后 workflow_status 会看到 STOPPED，避免其继续派发）。
              const stageNow = entry.engine.snapshot().stage
              let stoppedChildren = 0
              const childIds = []
              if (stageNow === 'RUNNING') {
                entry.engine.stop()
                await entry.storage.save()
                entry.engine.setPersist('ok (user-stop)')
                await registry.patchMeta(root, instanceId, { stopReason: 'user-stop' })
                const sid = args.sessionId
                const subagents = ctx.get('subagents')
                const agents = ctx.get('agents')
                // ① 中止主会话当前回合（0.1.5 原生级联：活子会话收 aborted(parent) 并终止）。
                //    注意：主会话「空闲」（派发回合已结束、子会话后台执行）时 cancel 为空转成功
                //    ——这正是阶段 3 实证「子会话未停」的根因，因此后续通道**叠加执行**而非互斥。
                let cancelled = false
                const sessionController = ctx.get('sessionController')
                if (sid && sessionController && typeof sessionController.cancel === 'function') {
                  try { await sessionController.cancel({ sessionId: sid }); cancelled = true } catch (e2) { /* 主会话未挂载等 → 走 ②③ */ }
                }
                // ② 枚举全部子会话（durable 条目，含已结束者——对结束目标 interrupt/drain 均为 no-op）
                let childIds = []
                if (sid && subagents && typeof subagents.listChildren === 'function') {
                  try {
                    const entries = await subagents.listChildren(sid)
                    childIds = (Array.isArray(entries) ? entries : [])
                      .filter(c => c && c.kind === 'child' && c.id).map(c => c.id)
                  } catch (e2) { /* 枚举失败不阻断 */ }
                }
                // ③ 硬释放：drain 主会话名下的 resident continuable 激活（不依赖判活；
                //    absent 目标 no-op）——这是对「后台执行中子会话」的决定性停止手段
                const parentAgent = sid && agents && typeof agents.get === 'function' ? agents.get(sid) : undefined
                let drained = false
                if (parentAgent && subagents && typeof subagents.drainContinuableChildren === 'function') {
                  try { await subagents.drainContinuableChildren(parentAgent, childIds); drained = true } catch (e2) { /* 失败走 ④ */ }
                }
                // ④ 兜底：drain 不可用/失败 → 逐子 interruptByParent（对活子下发 cancel 信号；
                //    官方契约：absent/idle/completed 目标为 accepted no-op；父会话离线亦可寻址）
                if (!drained && subagents && typeof subagents.interruptByParent === 'function') {
                  for (const cid of childIds) {
                    try { await subagents.interruptByParent(cid, sid, 'continuable') } catch (e3) { /* 单子失败不阻断 */ }
                  }
                }
                stoppedChildren = childIds.length
                // 实例级留痕（运维诊断；logs/ 由 reset 归档清理）
                try {
                  const nfz = require('node:fs')
                  nfz.mkdirSync(entry.dir + '/logs', { recursive: true })
                  nfz.appendFileSync(entry.dir + '/logs/stop-trace.log',
                    new Date().toISOString() + ' panel-stop sid=' + sid +
                    ' cancelled=' + cancelled + ' drained=' + drained +
                    ' children=' + childIds.length + ' (' + childIds.slice(-3).join(',') + ')' + '\n')
                } catch (e4) { /* 留痕失败不阻断 */ }
              }
              const inj = await injectSessionCmd(args, root, instanceId, 'stop')
              const snap = entry.engine.snapshot()
              snap.instanceId = entry.instanceId
              snap.messageInjected = inj.messageInjected
              snap.stoppedChildren = stoppedChildren
              if (inj.error) snap.messageInjectionError = inj.error
              writeJson(res, 200, snap)
              return
            }
            
            if (action === 'reset') {
              const stage = entry.hasState ? entry.engine.snapshot().stage : 'CREATED'
              if (stage === 'RUNNING') { writeJson(res, 400, { error: 'RUNNING 先 stop' }); return }
              if (stage === 'CREATED' || stage === 'PENDING') { writeJson(res, 400, { error: 'reset 仅 STOPPED/COMPLETED/FAILED' }); return }
              const backupDir = await registry.writeArchiveBackup(root, instanceId, 'reset', (stage || 'UNKNOWN'))
              // Iter-22：reset 不依赖内存 state.def（hydrate 不恢复 def）——从 instance.yaml 重解析展开
              const parsedDef = await expandInstanceDef(entry)
              entry.engine.resetWithDefinition(parsedDef) // → 全新 PENDING
              entry.engine.setError(null)
              const r = await entry.storage.save()
              entry.engine.setPersist(r)
              await registry.patchMeta(root, instanceId, { lastResetAt: new Date().toISOString(), stopReason: null }) // Iter-SUBA(P2)：重置即全新运行
              const snap = entry.engine.snapshot()
              snap.instanceId = entry.instanceId
              snap.resetBackup = backupDir
              // Iter-26（重置重来拍板）：备份后清空 output/logs。fs 服务无删除 API →
              // 返回 pendingCleanup 命令，由编排会话按 persona 契约立即用 bash 执行。
              // Iter-33（用户拍板「reset 语义=从模板全新建立」）：清空范围扩展到 inputs/——
              // 运行期物化残留（上游产物副本）一并清除；有模板来源（defDir 锚点 + 模板子目录
              // 存在 inputs/）时用 cp -r 恢复模板初始 inputs；inline/手工实例退化为仅清 output/logs。
              const q21 = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'"
              const nfz33 = require('node:fs')
              const defDir33 = E_presetTemplateDirOf(entry.meta && entry.meta.sourcePath, detectPredefinedRootSafe())
              const tplInputs33 = defDir33 ? defDir33 + '/inputs' : null
              const hasTplInputs33 = !!(tplInputs33 && nfz33.existsSync(tplInputs33))
              let cmd33 = 'rm -rf ' + q21(entry.dir + '/output') + ' ' + q21(entry.dir + '/logs') + ' ' + q21(entry.dir + '/inputs')
                + ' && mkdir -p ' + q21(entry.dir + '/output') + ' ' + q21(entry.dir + '/logs') + ' ' + q21(entry.dir + '/inputs')
              if (hasTplInputs33) cmd33 += ' && cp -R ' + q21(tplInputs33 + '/.') + ' ' + q21(entry.dir + '/inputs/')
              snap.pendingCleanup = {
                outputDir: entry.dir + '/output',
                logsDir: entry.dir + '/logs',
                inputsDir: entry.dir + '/inputs',
                inputsRestoredFrom: hasTplInputs33 ? tplInputs33 : null,
                cmd: cmd33,
              }
              snap.resetNote = 'state reset; instance dir (output/logs/inputs) backed up to ' + backupDir + ', run pendingCleanup.cmd now'
              // Iter-22(S4)：面板 reset 后向 session 注入"已重置"通知（queue 投递，reset 时 agent 通常空闲）。
              // Iter-31（用户 D2 拍板）：通知改纯告知——reset 停留 PENDING 等用户手动 Start，不再指示
              // "按全新工作流继续执行"；pendingCleanup 清理契约仍随行（Iter-26：fs 无删除 API，清空由
              // 会话 bash 执行），但明确"仅清理、不含启动指令"。
              const injReset = await injectSessionCmd(args, root, instanceId, 'reset',
                '[清理契约] 实例 output/logs/inputs 已归档备份至 ' + backupDir + (hasTplInputs33 ? '，inputs 将从模板初始内容恢复' : '') + '，请立即用 bash 执行以下命令（仅清理与恢复，不含启动指令）：\n' + snap.pendingCleanup.cmd)
              snap.messageInjected = injReset.messageInjected
              if (injReset.error) snap.messageInjectionError = injReset.error
              writeJson(res, 200, snap)
              return
            }
            
            if (action === 'resume') {
              if (!entry.hasState) { writeJson(res, 400, { error: 'instance not started (CREATED)' }); return }
              const st = entry.engine.snapshot().stage
              if (st !== 'STOPPED') { writeJson(res, 400, { error: 'resume 仅 STOPPED（当前 ' + st + '）' }); return }
              // Iter-21：继续只经 session 注入指令，由 agent 调 workflow_resume 置 RUNNING（避免双写导致的 UI 提前回弹/状态冲突）
              const inj = await injectSessionCmd(args, root, instanceId, 'resume')
              const snap = entry.engine.snapshot()
              snap.instanceId = entry.instanceId
              snap.messageInjected = inj.messageInjected
              if (inj.error) snap.messageInjectionError = inj.error
              writeJson(res, 200, snap)
              return
            }
            
            if (action === 'adopt') {
              if (!args.sessionId) { writeJson(res, 400, { error: 'adopt 须带 sessionId' }); return }
              // Iter-33（用户 D4 拍板）：采纳关口——可用性校验。「缺失文件/定义不完整导致采纳后
              // 无法使用」的实例不允许正常采纳（400 + 结构化原因）；RUNNING 沿用 adoptInstance 内部拒绝。
              // validateInstanceEntry 嵌套于 tools-preset 子作用域不可跨段引用 → 段级原语等价实现。
              const gateRaw33 = await fs.readText(await fs.resolve(entry.dir + '/instance.yaml'))
              const gateParsed33 = E_parseWorkflow(stripInstanceHeader(gateRaw33))
              const gateMeta33 = entry.meta || {}
              let gateErrs33 = gateParsed33.errors || []
              if (gateErrs33.length === 0) {
                const gateDefDir33 = E_presetTemplateDirOf(gateMeta33.sourcePath, detectPredefinedRootSafe()) || undefined
                const gateVRes33 = await E_validateWorkflow({
                  parsed: gateParsed33,
                  params: gateMeta33.params || {},
                  workspaceRoot: gateMeta33.sessionCwd || undefined,
                  predefinedRoot: detectPredefinedRootSafe(),
                  defDir: gateDefDir33,
                  wfDir: entry.dir,
                  context: 'instance',
                  fs,
                })
                gateErrs33 = gateVRes33.errors || []
              }
              if (gateErrs33.length > 0) {
                writeJson(res, 400, {
                  error: '实例不完整，拒绝采纳（' + gateErrs33.length + ' 项）: ' + gateErrs33.map(E_formatValidationItem).join('；'),
                  errors: gateErrs33,
                })
                return
              }
              const adopted = await registry.adoptInstance(root, args.sessionId, instanceId)
              const snap = adopted.engine.snapshot()
              snap.instanceId = adopted.instanceId
              snap.adopted = true
              snap.meta = adopted.meta
              writeJson(res, 200, snap)
              return
            }
            
            writeJson(res, 400, { error: 'unknown action: ' + action })
          } catch (e) {
            writeJson(res, 500, { error: e && e.message ? e.message : String(e) })
          }
        })
        return
      }

      // ── Iter-29：实例管理（归档列表 / 归档 / 删除归档 / 打包下载）────────────
      // 归档列表：archive/<id>/<entry>/ 清单（manifest+metadata+文件数/字节）
      if (pathname === '/wf/archives') {
        const root = query.get('workspaceRoot') || ''
        if (!root) { writeJson(res, 400, { error: 'workspaceRoot required' }); return }
        if (!registry) { writeJson(res, 500, { error: 'registry unavailable' }); return }
        try {
          const archives = await registry.listArchives(root)
          writeJson(res, 200, { workspaceRoot: root, archives })
        } catch (e) {
          writeJson(res, 500, { error: e && e.message ? e.message : String(e) })
        }
        return
      }

      // 显式归档：非 RUNNING 才可（门控在 registry.archiveInstance 内）；备份→内存清理→node:fs 删原目录
      if (req.method === 'POST' && pathname === '/wf/archive') {
        let body = ''
        req.on('data', (chunk) => { body += chunk })
        req.on('end', async () => {
          try {
            const args = JSON.parse(body || '{}')
            const root = String(args.workspaceRoot || '').replace(/\\/g, '/').replace(/\/+$/, '')
            const instanceId = args.instanceId
            if (!root) { writeJson(res, 400, { error: 'workspaceRoot required' }); return }
            if (!instanceId) { writeJson(res, 400, { error: 'instanceId required' }); return }
            if (!registry) { writeJson(res, 500, { error: 'registry unavailable' }); return }
            const r = await registry.archiveInstance(root, instanceId)
            writeJson(res, 200, { ok: true, archived: true, instanceId: r.instanceId, stage: r.stage, backupDir: r.backupDir, unboundFrom: r.unboundFrom })
          } catch (e) {
            writeJson(res, 400, { error: e && e.message ? e.message : String(e) })
          }
        })
        return
      }

      // 删除归档（不可恢复；UI 层二次确认后调用）
      if (req.method === 'POST' && pathname === '/wf/delete-archive') {
        let body = ''
        req.on('data', (chunk) => { body += chunk })
        req.on('end', async () => {
          try {
            const args = JSON.parse(body || '{}')
            const root = String(args.workspaceRoot || '').replace(/\\/g, '/').replace(/\/+$/, '')
            if (!root) { writeJson(res, 400, { error: 'workspaceRoot required' }); return }
            if (!registry) { writeJson(res, 500, { error: 'registry unavailable' }); return }
            const r = await registry.deleteArchive(root, args.instanceId, args.entry)
            writeJson(res, 200, { ok: true, deleted: true, instanceId: r.instanceId, entry: r.entry })
          } catch (e) {
            const msg = e && e.message ? e.message : String(e)
            writeJson(res, msg.indexOf('不存在') >= 0 ? 404 : 400, { error: msg })
          }
        })
        return
      }

      // 打包下载：多选活动实例 + 归档条目 → 单个 zip（STORE）；内存 artifact 暂存 → 下载路由取
      if (req.method === 'POST' && pathname === '/wf/download') {
        let body = ''
        req.on('data', (chunk) => { body += chunk })
        req.on('end', async () => {
          try {
            const args = JSON.parse(body || '{}')
            const root = String(args.workspaceRoot || '').replace(/\\/g, '/').replace(/\/+$/, '')
            const targets = Array.isArray(args.targets) ? args.targets : []
            if (!root) { writeJson(res, 400, { error: 'workspaceRoot required' }); return }
            if (!targets.length) { writeJson(res, 400, { error: 'targets required' }); return }
            if (!registry) { writeJson(res, 500, { error: 'registry unavailable' }); return }
            if (!fs) { writeJson(res, 500, { error: 'fs service unavailable' }); return }
            // 递归收集文本文件为 zip 条目（DSH fs 只读文本——二进制跳过，与 writeArchiveBackup 同语义）
            async function collectZipEntries(baseDir, zipPrefix, entries) {
              let items = []
              try { items = await fs.listDir(await fs.resolve(baseDir)) } catch (e) { return }
              for (const it of items) {
                const p = baseDir + '/' + it.name
                if (it.type === 'directory') {
                  await collectZipEntries(p, zipPrefix + '/' + it.name, entries)
                } else if (it.type === 'file') {
                  try {
                    const text = await fs.readText(await fs.resolve(p))
                    entries.push({ path: zipPrefix + '/' + it.name, text })
                  } catch (e) { /* 不可读（二进制）跳过 */ }
                }
              }
            }
            const entries = []
            const included = []
            for (const t of targets) {
              try {
                if (t && t.kind === 'instance') {
                  const safeId = sanitizeSegment(t.instanceId)
                  if (!safeId) continue
                  const dir = instancesRootPath(root) + '/' + safeId
                  await collectZipEntries(dir, String(t.instanceId), entries)
                  included.push({ kind: 'instance', instanceId: t.instanceId })
                } else if (t && t.kind === 'archive') {
                  const safeId = sanitizeSegment(t.instanceId)
                  const safeEntry = sanitizeSegment(t.entry)
                  if (!safeId || !safeEntry) continue
                  const dir = archiveRootPath(root) + '/' + safeId + '/' + safeEntry
                  await collectZipEntries(dir, safeId + '/' + safeEntry, entries)
                  included.push({ kind: 'archive', instanceId: t.instanceId, entry: t.entry })
                }
              } catch (e) { /* 单目标失败不阻塞其余 */ }
            }
            if (!entries.length) { writeJson(res, 400, { error: 'no downloadable files found for targets' }); return }
            const bytes = buildZip(entries)
            const token = makeUuid8() + makeUuid8()
            const stamp = new Date().toISOString().slice(0, 10)
            const filename = 'workflow-agent-' + stamp + '-' + token.slice(0, 8) + '.zip'
            downloadArtifacts.set(token, { bytes, filename, at: Date.now() })
            // 上限治理：>16 份或总量 >128MB 时丢弃最旧
            let total = 0
            for (const v of downloadArtifacts.values()) total += v.bytes.length
            while (downloadArtifacts.size > 16 || total > 128 * 1024 * 1024) {
              const oldest = [...downloadArtifacts.entries()].sort((a, b) => a[1].at - b[1].at)[0]
              if (!oldest) break
              total -= oldest[1].bytes.length
              downloadArtifacts.delete(oldest[0])
            }
            writeJson(res, 200, { ok: true, downloadUrl: '/wf/download-artifact?token=' + encodeURIComponent(token), filename, fileCount: entries.length, included })
          } catch (e) {
            writeJson(res, 500, { error: e && e.message ? e.message : String(e) })
          }
        })
        return
      }

      // 下载产物（一次性 token → zip 字节；浏览器 <a download> 触发）
      if (pathname === '/wf/download-artifact') {
        const token = query.get('token') || ''
        const art = downloadArtifacts.get(token)
        if (!art) { writeJson(res, 404, { error: 'artifact not found or expired' }); return }
        downloadArtifacts.delete(token) // 一次性：取走即焚
        const asciiName = art.filename.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '')
        const encodedName = encodeURIComponent(art.filename)
        res.writeHead(200, {
          'content-type': 'application/zip',
          'content-length': String(art.bytes.length),
          'content-disposition': 'attachment; filename="' + asciiName + '"; filename*=UTF-8\'\'' + encodedName,
          'cache-control': 'no-store',
        })
        res.end(Buffer.from(art.bytes))
        return
      }

      writeJson(res, 404, { error: 'not found: ' + pathname })
    },
  })
}
