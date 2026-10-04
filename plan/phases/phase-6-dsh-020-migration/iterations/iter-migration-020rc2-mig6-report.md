# Iter-MIG6 · Host 热生效机制实证与开发流程定型报告（阶段 6 收尾轮）

> **状态**：✅ 完成并验收（2026-10-03；Host 实验法：实体注入探测字段，已还原）
> **交付**：GUIDE §5「改哪里 → 生效方式」表全面实证标注 + 完整开发循环定型

## 1. 实验与结论

| 实验 | 方法 | 结论 |
|---|---|---|
| A · Host（node 侧）热生效 | 向已安装实体 `lib/index.js` 注入 `_hmrProbe` 响应字段 → 不重启 curl `/wf/list` | **响应无标记 → Host 模块进程启动时一次性 require，无热重载**。0.2.0 `client-hmr` 仅覆盖 client bundle 且需 rebuild watcher。**Host 改动必须重启 dsh web** |
| B · Client 生效链 | 用户装 v0.29.0 后**仅强刷浏览器**（未重启 web）→ MIG5 新门控行为生效 | **client bundle 按请求读盘：改后强刷即生效，无需重启 web** |
| C · persona | 3g 机制延续（运行时读取，随包分发后经 build 复制） | 新建/重载 preset 会话生效 |

实验痕迹清理：实体注入均已还原（响应与 bundle 确认无残留标记）。

## 2. 定型的开发循环（已写入 GUIDE §5）

```
改源码 → node build.js / build-client.mjs（+ test-host.js）
      → node code/scripts/build-release.js
      → node code/scripts/install.js --tgz release
      → Host 改动：重启 dsh web ／ Client 改动：强刷浏览器
```

## 3. 关联文档

- 页签门控机制技术报告（MIG5 交付）：[`plan/design/client-tab-gating-design.md`](../../design/client-tab-gating-design.md)——独立成文，详述 slots API、`retainedBy.mainView`、三层驱动链与设计决策。
