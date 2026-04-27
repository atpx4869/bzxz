#!/bin/bash
# 代码同步脚本：拉取远端 → 提交本地 → 推送
# 用法:
#   bash scripts/sync.sh                    # 用默认 commit message（时间戳）
#   bash scripts/sync.sh "fix: xxx"         # 自定义 commit message

set -e

cd "$(dirname "$0")/.."
MSG="${1:-auto sync $(date '+%m-%d %H:%M')}"

echo ">>> git pull..."
git pull

echo ""
echo ">>> git add..."
git add -A

echo ""
echo ">>> git status..."
git status

echo ""
echo ">>> git commit..."
git commit -m "$MSG" || echo "  (nothing to commit, skipping)"

echo ""
echo ">>> git push..."
git push

echo ""
echo ">>> done: $MSG"
