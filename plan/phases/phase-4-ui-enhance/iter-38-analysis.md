# Iter-38 影响分析 — params 双轨现状与单轨化方案

- **阶段**：阶段 4
- **日期**：2026-09-17
- **状态**：**影响分析完成，待用户确认方案后编码**

---

## 1. params 全景（代码级盘点，2026-09-17 实查）

### 1.1 两个「params」到底是什么

| 轨 | 位置 | 内容 | 生命周期 |
|---|---|---|---|
| **声明轨** | instance.yaml 顶层 `params:` 节 | `{key: {type, description, default}}`——参数**声明 + 默认值**（来自模板/创建时定义） | 随 instance.yaml：创建复制、源码态可编辑、定义保存保留 |
| **实参轨** | `metadata.json` 的 `meta.params` | `{key: 实参值}`——创建时用户填写的**实际值**（创建弹窗 KvEditor → args.params） | 随 metadata.json：创建写入、patchMeta 可改、无 UI 入口（Iter-37 前） |

### 1.2 消费点全景（谁在读什么）

| 消费点 | 读哪轨 | 行为 |
|---|---|---|
| `${param}` 注入（begin/reset 展开） | **仅实参轨**（injectParams 的 params=meta.params） | 命中→替换；**未提供→保留 `${param}` 字面量**（声明 default **不参与**！） |
| workflow_status / workflow_begin 快照 `params` | 仅实参轨 | 编排 Agent 派发 prompt 的 params 上下文来源 |
| 创建弹窗 params 预填 | 声明轨（simplifyParams 取 default） | 仅创建时一次 |
| 编辑器 params 区（Iter-37） | 仅实参轨（instance.params 读 meta） | 只读→本迭代已改可编辑（写实参轨） |
| 语义校验 | 实参轨宽松形态校验 | 声明 default 不校验 |

### 1.3 双轨现状的问题清单

1. **声明 default 是「假默认」**：`${param}` 展开只认实参轨——声明里写了 default 但创建时未填的参数，展开后保留 `${param}` 字面量（语义校验 E-INPUT-MISSING 类可能提示，但用户看到的还是没替换的占位符）。
2. **params 编辑写实参轨**（Iter-37）→ 源码态看不到（用户已反馈「保存后的全局 params 不会出现在源码中」）——与「源码=实例定义全文」直觉冲突。
3. 两轨无同步机制：编辑器改实参 → yaml 声明 default 不动；源码态改 default → 实参不动。语义上「default」与「当前值」混在一个 `default` 字段里，职责不清。

## 2. 单轨化方案

### 2.1 目标语义（推荐）

**instance.yaml 的 params 节 = 单一事实源**：`params.default` 字段升级为「当前生效值」（创建时=用户实参；之后编辑器/源码态改它即改实参）；`type/description` 保留为元数据。`meta.params` **退役**（迁移期只读兼容）。

### 2.2 改动面

| # | 改动 | 位置 |
|---|---|---|
| 1 | 创建：实参写入 instance.yaml params.default（不再只写 meta.params；meta.params 退役为兼容读） | tools-preset 创建/begin 展开链 |
| 2 | ${param} 注入来源：expandDefinition 的 params 构造改为「声明 default（已含实参）」（injectParams 不变，来源 map 换成 yaml params 节展平） | tools-preset expandDefinition |
| 3 | 编辑器 params 区：读写 yaml params.default（definition 权限门控，经 instance-yaml patch 通道——**与定义保存同关口**，不再走 /wf/instance-params） | workflow-edit.js 白名单扩展 + client |
| 4 | GET /wf/instance-yaml instance.params 改读 yaml params 节（展平 default） | webserver-routes.js |
| 5 | 旧实例兼容：meta.params 存在且 yaml 未覆写 → 读参优先 meta.params（一次性读取；reset 重展开后自然落 yaml）；/wf/instance-params 保存时同步写 yaml default + 保留 meta.params（兼容期） | 迁移策略 |
| 6 | /wf/instance-params 路由退役（Iter-37 交付，存活一个版本后移除） | — |

### 2.3 决策点

| # | 决策点 | 选项 | 推荐 |
|---|---|---|---|
| 1 | 实参载体 | a) yaml params.default 承载实参（推荐） b) 维持双轨仅加文档 | **a** |
| 2 | 旧实例兼容 | a) 读参优先级 meta.params > yaml default，reset 时落 yaml b) 一次性迁移脚本扫存量实例 | **a**（读时优先 + reset 自然收敛，无脚本） |
| 3 | /wf/instance-params 路由 | a) 本迭代直接退役（编辑器 params 区改走 instance-yaml patch） b) 保留一个版本 | **a**（Iter-37 刚交付、尚无外部依赖） |

## 3. 影响面与风险

| 影响点 | 说明 | 风险 |
|---|---|---|
| serializeWorkflowYaml | params 节序列化需保留对象形态（default/type/description） | 现实现是否丢元数据需核实（实施第一步） |
| ${param} 未提供实参的实例 | 迁移后 default 参与注入——**行为变化**：以前保留字面量，现在填 default | 语义增强（更符合「默认值」直觉），真机回归确认 |
| 语义校验 params 形态 | W/E 规则不变 | — |
| Iter-37 刚交付的编辑器 params 区 | 读写来源切换（meta → yaml），UI 不变 | 低 |

## 4. 验证标准（编码阶段完成线）

- [ ] 单测：创建→yaml params.default=实参；${param} 注入取 default；编辑器 params 保存→yaml 落盘→begin/reset 注入新值；旧实例（meta.params）兼容读
- [ ] 真机：①创建填实参 → 源码态 params.default 可见 ②编辑器 params 改值 → reset 后 ${param} 用新值 ③源码态直接改 default → 生效（与源码所见一致）

## 5. 工作量估计

**约 0.75~1 人天**（读参来源切换 0.3 + 创建/编辑写入点 0.3 + 兼容读与测试 0.3）。
