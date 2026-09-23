#!/usr/bin/env bash
# 物化/发布脚本（Iter-46 起：镜像发布模型）
#   ① 预置镜像 1:1 发布：workflow_samples/sys-design/ → ~/.dsh/workflow-agent/templates/sys-design/
#      （镜像目录=唯一发布源，整目录替换，结构与预置完全一致）
#   ② 技能双落位：24 份 SKILL.md → 运行工作空间 skills/（两级链第一优先）
#   ③ PRD 播种：sys-design-local/sample-prd/PRD.md → 运行工作空间 prd/PRD.md（仅当不存在，
#      PRD 是外部输入件，不随工作流发布、不覆盖用户文件）
# 幂等可重跑。用法：bash workflow_samples/sys-design-local/materialize.sh
set -euo pipefail

LOCAL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"          # .../workflow_samples/sys-design-local
MIRROR="$(dirname "$LOCAL_DIR")/sys-design"                        # 预置镜像（发布源）
PRE_TPL="${DSH_HOME:-$HOME/.dsh}/workflow-agent/templates/sys-design"
WS="${DESIGN_TRIAL_WS:-$HOME/Projects/design-trial}"

# ① 预置镜像 1:1（整目录替换）
rm -rf "$PRE_TPL"
mkdir -p "$(dirname "$PRE_TPL")"
cp -r "$MIRROR" "$PRE_TPL"

# ② 技能 → 运行工作空间
mkdir -p "$WS/skills"
for d in "$MIRROR"/skills/*/; do
  id="$(basename "$d")"
  rm -rf "$WS/skills/$id"
  cp -r "$d" "$WS/skills/$id"
done

# ③ PRD 播种（不覆盖）
mkdir -p "$WS/prd"
if [ ! -f "$WS/prd/PRD.md" ]; then
  cp "$LOCAL_DIR/sample-prd/PRD.md" "$WS/prd/PRD.md"
  echo "  PRD 播种 → $WS/prd/PRD.md（样例，可替换为真实 PRD）"
else
  echo "  PRD 已存在，跳过播种：$WS/prd/PRD.md"
fi

echo "OK 物化完成："
echo "  预置镜像 → $PRE_TPL（1:1，来自 $MIRROR）"
echo "  技能     → $WS/skills（$(ls "$WS/skills" | wc -l) 个）"
echo "下一步：在面板（design-trial 工作空间的编排会话）创建 sys-design 实例。"
