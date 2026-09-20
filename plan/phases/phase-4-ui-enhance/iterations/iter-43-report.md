# Iter-43 报告 — 主题适配（面板接入 DSH 皮肤 CSS 变量）

- **状态**：🚧 编码与单测完成，v0.26.44 已发行部署，**待用户真机验收**
- **阶段**：阶段 4（现有功能修复/补全，队列末项）
- **版本**：host `v0.26.44 ~ v0.26.45`（44 首发 T 缺失白屏；45 修复终版；单包；纯 Client 改动）
- **测试**：602 单测全绿（无回归）+ bundle 求值验证
- **提交**：见 git log

## 1. 方案（iter-43-design.md；三决策点均按推荐执行）

| 档 | 类别 | 处理 |
|---|---|---|
| 档1 主题敏感 | 文字（label-primary/secondary/tertiary/dimmed/caption）/背景（bg-base/bg-layer-1）/遮罩（bg-mask-1）/边框（border-l1/l2）/主色（brand-primary）/链接（link） | token 常量对象 `T`（var(--dsw-alias-*, 原色 fallback)），HTML 层全面接入 |
| 档2 状态语义色 | C 五态色板 + 警告/危险 | 保留字面量（拍板：跨主题恒定可辨；皮肤系统 state-* alias 作为后续可选映射已记录） |
| 档3 一次性色 | #fff 反白/#a78bfa 紫 | 保留 |

**技术边界（实现约束如实调整）**：DagCanvas 的 SVG fill/stroke 为 presentation attribute，**不支持 var()**——SVG 画布（深色设计）整体保留字面，本迭代 token 化范围=HTML 层（编辑器/详情卡/列表/按钮/弹层/状态栏）。若浅色主题下 DAG 深色画布观感需调整，后续可用 CSS 类方案（svg 内 `<style>` + class 选择器支持 var）单独迭代。

## 2. 实施与验证

| 步骤 | 验证 | 结果 |
|---|---|---|
| T 常量 + 三档机械替换（区间排除 SVG） | node --check + 构建 + bundle 求值 | ✅ |
| 残留审计 | 区间外字面=状态色/白/紫/fallback ✓；SVG 区间字面保留 ✓ | ✅ |
| 全量单测 | test-host | ✅ 602 全绿 |
| 发行部署 | 内容断言 + manifest 正则写正 + 部署产物核验 | ✅ v0.26.44 |
| 真机 | ⏳ §5（v0.26.45 修复版） | |

## 5. 真机验收清单（用户 GUI：重启后台 + 强刷浏览器）

| # | 操作 | 通过标准 |
|---|---|---|
| 1 | 默认皮肤下面板全览 | 观感不劣化（fallback=原色，理论一致） |
| 2 | 皮肤中心切换 2~3 个主题（深/浅各一） | 面板背景/文字/边框/按钮主色随动；详情卡/弹层/列表一致 |
| 3 | DAG 画布（SVG） | 深色画布保持（状态色恒定可辨）；节点文字/边框可读 |
| 4 | Iter-31~42 行为抽查 | 详情卡/预览/编辑器/页签门控不回归 |

## 6. 教训

- **SVG presentation attribute 不支持 var()**——主题适配的 SVG 需走 class+CSS 路径，第一版以「SVG 保留字面」折中并在报告注明边界与后续路径。
- alias 变量名提取需从 CSS 产物全文（截断 grep 会漏 number 后缀）。

## 7. 参考

- 设计：`iter-43-design.md`（三档分层 + 三决策点用户拍板）

## 8. 补记：T 常量缺失白屏事故与修复（v0.26.45）

| 项 | 说明 |
|---|---|
| 事故 | v0.26.44 的 lib/client.js 缺 T 定义（52 处引用无定义）→ apply 抛 "T is not defined" → 插件加载失败白屏 |
| 根因 | T 定义插入**静默未命中**（python replace 锚点含 Iter-39 注释尾巴，实际文本不符）——本迭代第 4 次同类事故，replace 无断言是共因 |
| 应急 | Hermes（并行的诊断代理）在部署产物上手工补 T（临时变量名），恢复服务 |
| 终修 | T 定义（dsw-alias 方案）补入 src；**verify-client-bundle 增 apply 冒烟门**（stub ctx 实际执行 apply + 断言 conversation.view 注册——构建链盲区补齐，此类事故今后被门拦截） |
| 部署 | 连环 manifest 断链（多轮 sed 基准错位）一并修正；0.26.45 全标记核验通过 |
| 遗留 | 诊断探针（/wf/debug-probe + wf42-probe）将于 Iter-44 首项移除 |

## 9. 参考

- 设计：`iter-43-design.md`（三档分层 + 三决策点用户拍板）
