# Iter-43 设计 — 主题适配（面板样式接入 DSH 皮肤 CSS 变量）

- **阶段**：阶段 4（现有功能修复/补全，队列末项）
- **日期**：2026-09-19
- **DSH 基线 / 项目版本**：DSH `0.1.5-rc.2`；host `v0.26.43` → 发行时阶段内第三格顺延
- **状态**：**待用户确认后编码**

---

## 1. 踏勘结论（代码级，2026-09-19）

| 项 | 现状 |
|---|---|
| 颜色字面量 | client.js 共 **~200 处**：灰阶文字（#9ca3af×52、#94a3b8×23、#e2e8f0×7…）、语义色（#3b82f6×15、#22c55e×13、#f59e0b×15、#ef4444×10…）、背景（#1e293b 系×10+）、rgba 透明叠加 ×84 |
| 皮肤系统 | DSH 提供 `--dsw-alias-*` CSS 变量约 30 个（bg-base / bg-layer-* / bg-mask-* / border-l* / label-primary/secondary/tertiary/caption/dimmed / brand-primary / button-primary-fill / link / interactive-bg-* 等），随皮肤中心主题切换 |
| 先例 | 面板 skillView/adoptOverlay 弹层已用 `var(--dsw-alias-bg-base, #1e293b)` 形式（带 fallback）✓ |

## 2. 方案（三档分层，token 常量对象）

client.js 顶部定义 **token 常量对象 `T`**（值 = `var(--dsw-alias-*, fallback)`），全面板引用 `T.xxx`：

| 档 | 色值类别 | 映射 | 处理 |
|---|---|---|---|
| **档1 主题敏感**（~110 处） | 文字（#e2e8f0/#94a3b8/#9ca3af/#64748b/#cbd5e1）、背景（#1e293b/#1a2439/#16203a/#131c30/#f8fafc）、遮罩（rgba(0,0,0,.45)）、边框底色（rgba(148,163,184,α)）、主色（#3b82f6/#60a5fa/#7dd3fc） | label-primary/secondary/tertiary/dimmed、bg-base/bg-layer-1、bg-mask-1、border-l1/l2、brand-primary/link | **token 化**（T 常量 + fallback） |
| **档2 状态语义色**（C 色板 + #f59e0b/#ef4444/#f87171/#22c55e/#a78bfa） | PENDING/RUNNING/DONE/FAILED/SKIPPED 五态 + 门禁结果色 | 皮肤系统无对应语义变量，且工作流状态色需跨主题稳定可辨 | **保留字面量**（领域色不随主题反转） |
| **档3 其余一次性色** | #fff 反白文字等 | 保留 | 不动 |

**预期效果**：皮肤中心切换深/浅主题 → 面板背景/文字/边框/主色随动；状态语义色保持恒定可辨。

## 3. 技术要点

- fallback 兜底：每个 token 带原色值 fallback（`var(--dsw-alias-label-primary, #e2e8f0)`），独立/异常环境渲染不劣化。
- rgba 透明叠加（84 处）：边框/底色类替换为 `color-mix()`？——**不引入**（兼容性），改为保留 rgba 但基色由字面改 T 常量拼接的少数场景；多数 rgba(148,163,184,α) 统一映射 `T.borderAlpha(α)` 辅助函数（返回 `rgba(var(--dsw-alias-border-l1-rgb), α)`？——DSW 变量为完整色值非 RGB 分量，**不拆分**；直接映射固定 alias：边框类用 `var(--dsw-alias-border-l1, rgba(148,163,184,α))` 按 α 分档（α 阈值归并为 2~3 档），避免逐 α 建 token。
- 范围：仅 client.js；服务端零改动。

## 4. 决策点

| # | 决策点 | 选项 | 推荐 |
|---|---|---|---|
| 1 | 状态语义色（C 色板/警告/危险） | a) 保留字面量（跨主题恒定可辨） b) 映射 interactive-bg-* 等近似 alias | **a**（工作流状态色是领域语义，主题反转可能降低辨识度） |
| 2 | rgba 边框/底色的 α 档位 | a) 归并 2~3 档映射 border-l1/l2 alias b) 逐 α 保留 | **a**（视觉差异 <5%，token 数可控） |
| 3 | 覆盖范围 | a) 本轮全面板（DagCanvas/编辑器/弹层/详情卡/列表） b) 先高频区（状态栏/DAG/列表） | **a**（机械替换一次到位，避免二次回归） |

## 5. 验证标准

- [ ] 单测全绿；bundle 求值 + verify-client-bundle
- [ ] 部署产物核验：字面色残留计数（档1 目标色清零，状态色保留）
- [ ] 真机：①默认皮肤下面板观感不劣化（fallback 与原色一致）②皮肤中心切换 2~3 个主题（深/浅）→ 面板背景/文字/边框随动、状态色恒定 ③DAG 可读性（任意主题下节点文字/边框可辨）

## 6. 工作量估计

**约 0.5 人天**（映射表 0.1 + 机械替换 0.15 + 特例修整 0.15 + 真机 0.1）。
