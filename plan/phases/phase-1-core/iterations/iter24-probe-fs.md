# Iter-24 步骤 0 探针存档：Host fs 服务写 ~/.dsh 能力验证

- **执行日期**：2026-09-02
- **形态**：动态 Cordis 插件（`cordis_define` + `cordis_run`，用后即弃，进程本地不落盘）
- **结论**：✅ **Host fs 服务可以写 `~/.dsh/`**
  - `sandboxPolicy`：defaultMode=`workspace-write`，workspaceRoot=`/home/zhaokai`（=HOME，非会话工作区）
  - `writeText` → `~/.dsh/workflow-agent-probe/probe.txt` 成功；readBack/stat 全过
  - 插件 `console.log` 可进 journalctl（`[cordis:probe-1]` 前缀）
- **注意**：动态插件随 DSH 重启消失，结论取证靠"结果落工作区 JSON + journal"双通道。

## 探针 2（同日追加）：fs 作用域边界实证

结论修正并扩大：**Host fs 服务（不显式传 sandboxPolicy 参数时）对整个文件系统读写无硬限制**：

| 目标 | 写 | 读 |
|---|---|---|
| `/home/zhaokai/` 根级 | ✅ | ✅ |
| `~/.dsh/` 深层子目录 | ✅ | ✅ |
| HOME 子目录（如 wf-blank-e2e） | ✅ | ✅ |
| `/tmp/` | ✅ | — |
| `/etc/hostname` | — | ✅ |

- `sandboxPolicy` 服务虽报 `workspaceRoot=HOME / workspace-write`，但**并不拦截**未传 policy 参数的裸 `fs.writeText/readText`——该策略是按调用显式生效（opt-in），不是 fs 服务内置强制。
- **勘误**：早前"/tmp 写入被拒"的判断是错的——实例文件实际写进了真实 `/tmp`，只是 agent bash 沙箱（bwrap `--tmpfs /tmp`）私有挂载看不见，属观测假象。
- **对后续迭代的意义**：归档下载（Iter-29）、实例导出等直接可行，无需扩权配置；但工程纪律上仍约定插件写盘只落在 `~/.dsh/workflow-agent/`、工作区 `.workflow-agent/` 与用户明示目录。
- **Client 侧无文件能力**：浏览器端从不直接触盘，一切经 Host 路由/RPC（`/wf/*`、`harness.handle`）间接访问。

## 复现步骤

1. `cordis_define`（idPrefix 3-6 个小写字母，如 `probe`），code.host 用下文；
2. `cordis_run pluginId packageId mode=run`；
3. 读工作区 `wf-probe-result.json` + `journalctl --user -u dsh.service | grep wf-probe`；
4. `cordis_undefine` + 删除 `~/.dsh/workflow-agent-probe/` 与结果文件。

## code.host 全文

```js
return {
  inject: ['fs'],
  apply(ctx) {
    const fs = ctx.get('fs')
    if (!fs) return
    const result = { steps: [] }
    function log(step, data) { result.steps.push(Object.assign({ step: step }, data)) }
    ;(async () => {
      try {
        // 1) sandboxPolicy 服务现状（defaultMode / workspaceRoot）
        try {
          const sp = ctx.get('sandboxPolicy')
          if (sp) log('sandboxPolicy', { defaultMode: String(sp.defaultMode), workspaceRoot: String(sp.workspaceRoot) })
          else log('sandboxPolicy', { absent: true })
        } catch (e) { log('sandboxPolicy', { error: e && e.message ? e.message : String(e) }) }
        // 2) 写 ~/.dsh/workflow-agent-probe/probe.txt（探针核心问题）
        const probePath = '/home/zhaokai/.dsh/workflow-agent-probe/probe.txt'
        try {
          const t = await fs.resolve(probePath)
          const out = await fs.writeText(t, 'probe ' + new Date().toISOString())
          log('writeHome', { ok: true, outcomeKind: out ? typeof out : 'undefined' })
        } catch (e) { log('writeHome', { ok: false, error: e && e.message ? e.message : String(e) }) }
        // 3) 读回验证
        try {
          const t2 = await fs.resolve(probePath)
          const txt = await fs.readText(t2)
          log('readBack', { ok: true, length: txt.length })
        } catch (e) { log('readBack', { ok: false, error: e && e.message ? e.message : String(e) }) }
        // 4) stat 已写入文件
        try {
          const t4 = await fs.resolve(probePath)
          const info = await fs.stat(t4)
          log('stat', { found: !!info })
        } catch (e) { log('stat', { found: false, error: e && e.message ? e.message : String(e) }) }
      } catch (e) {
        log('fatal', { error: e && e.message ? e.message : String(e) })
      }
      // 5) 结果落工作区（不经 journal 也能取证）
      try {
        const t3 = await fs.resolve('/home/zhaokai/Projects/dsh_projects/wf-probe-result.json')
        await fs.writeText(t3, JSON.stringify(result, null, 2))
      } catch (e) { /* 失败时靠 console */ }
      if (typeof console !== 'undefined') console.log('[wf-probe] done: ' + JSON.stringify(result))
    })()
    ctx.effect(() => () => {})
  },
}
```

## 实测输出（journal 摘录）

```
[cordis:probe-1] [wf-probe] done: {"steps":[
  {"step":"sandboxPolicy","defaultMode":"workspace-write","workspaceRoot":"/home/zhaokai"},
  {"step":"writeHome","ok":true,"outcomeKind":"object"},
  {"step":"readBack","ok":true,"length":30},
  {"step":"stat","found":true}]}
```

## 关联教训

- 同期定位"物化未生效"时，本探针排除法起了决定作用：fs 能写（排除权限）、console 进 journal（排除日志丢失）→ 只剩"调用点没部署"（sync 单 section 遗漏，详见 c9d89e5/c2fad87 提交信息）。
