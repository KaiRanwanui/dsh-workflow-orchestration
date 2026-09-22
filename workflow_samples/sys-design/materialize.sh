#!/usr/bin/env bash
# 物化脚本（Iter-44）：把 workflow_samples/sys-design/ 资产落位到运行环境。
#   ① 定义+示例 PRD → 预定义模板目录（面板「创建」下拉可见）
#   ② 12 份占位 skill → 运行工作空间 design-trial（processor 两级链第一优先）
# 幂等可重跑（覆盖式复制）。用法：bash workflow_samples/sys-design/materialize.sh
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PRE_TPL="${DSH_HOME:-$HOME/.dsh}/workflow-agent/templates/sys-design"
WS="${DESIGN_TRIAL_WS:-$HOME/Projects/design-trial}"

# ① 模板目录（Iter-27a 子目录布局：templates/sys-design/sys-design.yaml + input/）
mkdir -p "$PRE_TPL"
cp "$SRC/sys-design.yaml" "$PRE_TPL/"
rm -rf "$PRE_TPL/input"
cp -r "$SRC/input" "$PRE_TPL/input"

# ② 运行工作空间技能
mkdir -p "$WS/skills"
for d in "$SRC"/skills/*/; do
  id="$(basename "$d")"
  rm -rf "$WS/skills/$id"
  cp -r "$d" "$WS/skills/$id"
done

echo "OK 物化完成："
echo "  模板 → $PRE_TPL"
echo "  技能 → $WS/skills（$(ls "$WS/skills" | wc -l) 个）"
echo "下一步：在面板（design-trial 工作空间的编排会话）创建 sys-design 实例。"
