# 样例文件（samples）

本目录为**纯参考性质**：仅供人阅读的样例文件，不被任何预置工作流定义引用，
工作流实例也不会使用本目录文件（Iter-27a 起）。

items/ 子目录为 items 结构化提取参考样例（Iter-26 引入；Iter-27a 起工作副本
迁入 templates/items-demo/inputs/items/，此处保留作参考）：
- modules.md（markdown 列表，标量 item）
- modules-table.md（markdown 表格，对象 item，列名=字段名）
- components.json（JSON 数组，对象 item）
- features.yaml（YAML 并列 map，键=id、标量值=名称）

以下为 Iter-32 验证探针样例（配合阶段 4 补验，见 templates/verify-* 各模板头注释）：
- validation-probe.sample.yaml —— 语义校验探针（2 硬拦错误 + 1 警告）：粘贴到面板
  「创建」文本框，应见结构化错误清单（E-DEP-CYCLE / E-PROCESSOR-MISSING）且
  W-ITEMS-INPUT-DUP 警告同屏；**勿用于执行**。
- skill-shadow/data-prep/SKILL.md —— 技能影子副本：复制到 `<工作区>/skills/data-prep/SKILL.md`
  后跑 templates/verify-skill-shadow，输出含「SHADOW-COPY」即覆盖生效；验证后删除副本。
