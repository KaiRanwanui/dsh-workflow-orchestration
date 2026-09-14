# Iter-29 报告 — 实例管理子页签 + 归档/下载/删除

- **状态**：✅ 完成关闭（2026-09-05，用户 GUI 验收通过；少量展示/交互小问题用户判定不阻塞，留待后续规划）
- **版本**：host v0.20.0 / client v0.8.0
- **提交**：主体+收尾文档（本报告随收尾提交入库），已推 origin/master

## 设计决议（用户多轮拍板）

- **UI 形态**：子页签切换——工具栏「📋 管理」按钮（紫色高亮态）与 DAG 视图互斥显示，`!hasData` 空态分支同样支持管理视图
- **归档后原始目录清理**：**Host `node:fs` 直删**（用户否决 pendingCleanup 模式：「Session 定位为 wf 实例级的处理，删除 workspace 下其他 Session 的数据越权」）——Host 插件与 DSH fs 服务同为进程内文件操作者，目录级删除属 workspace 管理职责
- **归档按钮范围**：STOPPED / **COMPLETED** / FAILED（用户补充"已完成的运行实例"须可归档）；RUNNING 灰禁（须先停止）；CREATED/PENDING 灰禁（无执行内容）
- **删除范围收窄**：**仅归档段可删**（用户拍板保守路线：活动实例只能归档，归档本身含完整备份，减少误删面）
- **下载实现**：Host 纯 JS zip writer（STORE 模式零外部依赖），多选打一个 zip、一次性 token 取回

## 关键技术查证（node:fs 直删合法性三重证据链）

1. **DSH `ctx.get('fs')` 服务确无删除/移动 API**（用户提示后官方源码复核：`FileSystem` 抽象类方法面 resolve/stat/lstat/readText/streamText/readBytes/listDir/writeText/editText；官方文档 filesystem.md；社区 Discussion #2471 同证）——此前迭代"fs 无删除"结论**正确但仅限 DSH 服务面**
2. **npm 包形态经标准 CommonJS require 加载**：`cordis-plugin-loader/lib/index.js` L260-274 以标准 `import()` 加载 bundle 包（CJS 模块作用域含完整 require）；vm 沙箱 require 陷阱**仅作用于动态插件形态**（cordis-host-runner/src/sandbox.ts，动态包专用）
3. **实证旁证**：部署版 `detectPredefinedRoot` 以 `process.env.HOME` 物化成功（Iter-24 起）——`process` 全局在动态沙箱中为 undefined，能用即证 npm 包跑在真实 Node 进程

结论：`require('node:fs').promises.rm` 在生产 npm 包形态可用；操作范围严格限 `.workflow-agent/` 自有目录 + `sanitizeSegment` 段名白名单（`[A-Za-z0-9][A-Za-z0-9._-]*`，拒 `.`/`..`/穿越）。ESM 语境（`nodeFsPromises()` 返回 null）显式报错不静默降级。

## 交付

### Host（v0.20.0）

- `code/shared/zip-writer.js`（新增，第 12 同步 section，纯函数零依赖）：
  - `buildZip(entries)`：STORE 模式（method 0）+ 本地文件头/中央目录/EOCD；UTF-8 文件名（通用位标志 bit11 恒置，中文安全）；`zipCrc32` 查表法（IEEE 802.3）；条目路径规整与穿越拒绝；`bytes`/`text` 双形态输入
- `instance-store.js`（registry 三函数 + 两辅助）：
  - `nodeFsPromises()`（node:fs 可用性探针）/ `sanitizeSegment()`（段名白名单）；`deps.nodeFs` 注入口（单测 mock）
  - `listArchives(cwd)`：扫 `archive/<id>/<entry>/` 读 manifest.json+metadata.json，listDir 递归计文件数/字节（真实 dsh-fs-local listDir 对 file 带 size——fsio.ts listDirectory 逐子 probe 实证），entry 名倒序=最新在前
  - `archiveInstance(cwd, id)`：stage 判定（内存引擎快照→磁盘 state.json→CREATED）→ 门控（RUNNING 拒/CREATED·PENDING 拒）→ `writeArchiveBackup('archive', stage)`（复用 Iter-18 递归复制）→ 内存清理（engines.delete + activeBySession 解绑）→ `nodeFs.rm(instances/<id>)`；删除失败=备份已在+原实例留存，报错可重试不丢数据；绑定会话经 archiveDeclaresSession 读备份内 metadata → DONE（零新代码复用既有派生）
  - `deleteArchive(cwd, id, entry)`：段名白名单 → `nodeFs.stat` 存在性判定（缺失抛 404 语义）→ `nodeFs.rm` → 空父目录顺手 rmdir
- mjs 路由区 5 条新路由：`GET /wf/archives`、`POST /wf/archive`、`POST /wf/delete-archive`（404/400 语义分档）、`POST /wf/download`（递归 collectZipEntries 仅文本、逐目标失败不阻塞、artifact 暂存上限 16 份/128MB FIFO 淘汰）、`GET /wf/download-artifact`（一次性 token 取走即焚 + RFC 5987 `filename*=UTF-8''`）

### Client（v0.8.0）

- `getManagerComponent()`（模块级防 remount 缓存，EditorPanel 同款纪律）：活动/归档两段表格（状态色点/进度 done/total·✗failed/绑定会话尾 6 位+离线标注/文件数·字节人性化）；📦 归档（stage 门控灰禁+确认框）、🗑 删除（二次确认+不可恢复警告）；两段复选框统一 key（`i:<id>`/`a:<id>/<entry>`）→ 已选 N 项 + ⬇ 下载（`<a download>` 触发）；操作后绿/红提示条 + 自动重拉
- 工具栏「📋 管理」按钮（activeRoot 存在即显示，UNBOUND 会话也可查看/下载/删除）；`mgmtOpen` state 声明于条件 return 前 hooks 区（Iter-28 修正 3 纪律延续）；两个视图分支均挂载（`!hasData` 时空态占位与管理视图互斥）

## 单测抓出的真实产品 bug（已修）

- **DSH fs `stat` 对不存在目标返回 `undefined` 而非抛错**（mock 注释早已写明"对齐真实契约"，但 deleteArchive 首版守卫仅 try/catch → mock/真实均静默穿透，删除不存在归档返回 ok）→ 改 `nodeFs.stat`（与执行 rm 同一文件系统视图，目录级判定，缺失抛 ENOENT）+ 显式报错。**教训：对"返回 undefined 表示不存在"的服务，存在性守卫必须判空而非仅捕获异常。**

## 验证结论

- **单测**：529 → 563 全绿。用例 26 新增 34 项：CRC32 已知向量（"123456789"→0xCBF43926）/UTF-8 编码回读/条目穿越与缺字段拒绝/zip 结构手工解析（PK 头、EOCD 计数=3、中央目录偏移+大小自洽、逐条目 STORE+bit11+CRC 与内容一致）/归档空列表/RUNNING·PENDING·穿越·缺参 400 门控矩阵/STOPPED 归档全链（backupDir 命名+原目录 node:fs 删除+引擎内存清理+会话派生 DONE）/已归档再归档 400/删除归档 404·穿越·成功·列表消隐/COMPLETED 归档/下载多选（穿越过滤、downloadUrl+filename+fileCount、zip 字节 PK 头+content-disposition、token 一次性 404）
- **zip 兼容性**：`unzip -t` 结构校验通过；Python zipfile 按 bit11 完美解码中文文件名（浏览器/macOS/Windows 解码器同）；Info-ZIP unzip 6.0 显示 mojibake 为其已知局限（非本实现问题，GUI 验收实测正常）
- **部署**：sync 12 section → host bump 0.20.0/client 0.8.0 → build×2 → verify-client-bundle OK → cp preset 三件套（profile 为 link: 直连免 cp，diff 一致）→ 用户重启 dsh.service → journalctl materialize ok + 构建时间早于重启时间戳
- **GUI 验收（用户执行）**：管理子页签开合互斥 ✓ 活动实例段全列 ✓ 归档门控（可归/灰禁分档）✓ 归档后原目录消失+会话 DONE ✓ 多选下载 zip 内容完整（中文文件名正常）✓ 删除归档二次确认 ✓；少量展示/交互小问题不阻塞，留待后续规划

## 边界与遗留

| 项 | 归属 | 说明 |
|---|---|---|
| 管理视图展示/交互小问题（用户验收反馈，具体项待用户后续开单） | 后续迭代规划 | 不阻塞关闭；Iter-30 或独立修复轮处理 |
| 活动实例不可直接删除（仅归档） | 设计如此 | 用户拍板保守路线；归档含完整备份 |
| node:fs 绕过 DSH fs 策略层（无 observation/write-intent/沙箱 fence） | 已接受风险 | 操作范围限 `.workflow-agent/` 自有目录+段名白名单；ESM 语境显式报错 |
| STORE 模式不压缩 | 设计取舍 | 工作流产物以文本为主体积可控；正确性优先，DEFLATE 可后续增强 |
| 下载 artifact 暂存在内存（上限 16 份/128MB FIFO） | 设计取舍 | 一次性 token 取走即焚；超限淘汰最旧 |
| Iter-30 DAG 美化与交互 | **下一迭代** | 节点详情面板（数据依赖 Iter-25 已就绪）+视觉布局+交互增强 |
