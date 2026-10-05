#!/usr/bin/env bash
# Nexus Harness — lint + typecheck + test + build
# 依 .claude/CLAUDE.harness.md：任何 Task 完成前必跑
set -euo pipefail

cd "$(dirname "$0")/../.."

echo "==> lint"
npm run lint

echo "==> typecheck"
npm run typecheck

echo "==> test"
npm run test

echo "==> build"
npm run build

echo "✅ Harness 全數通過"
