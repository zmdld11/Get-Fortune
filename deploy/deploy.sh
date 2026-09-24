#!/usr/bin/env bash
# deploy.sh — 本地构建 → ssh 上传 → 服务器 docker compose 重建(一条命令的发布流程)
#
#   准备(只做一次):
#     1. cp deploy/server.env.example deploy/server.env 并填 SSH_TARGET
#     2. cp .env.example .env 并填 DEEPSEEK_KEY
#     3. 服务器装好 Docker(见 README「服务器准备」)
#   发布:
#     bash deploy/deploy.sh          # 构建 + 上传 + 重建 + 探活
#     bash deploy/deploy.sh --logs   # 只看服务器日志
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -f deploy/server.env ]]; then set -a; source deploy/server.env; set +a; fi
: "${SSH_TARGET:?请先 cp deploy/server.env.example deploy/server.env 并填 SSH_TARGET}"
REMOTE_DIR=${REMOTE_DIR:-/home/admin/Get-Fortune}
SSH_ARGS=()
[[ -n "${SSH_PORT:-}" ]] && SSH_ARGS+=(-p "$SSH_PORT")

if [[ "${1:-}" == "--logs" ]]; then
  exec ssh "${SSH_ARGS[@]}" "$SSH_TARGET" "cd $REMOTE_DIR && docker compose logs -f --tail=100 fortune"
fi

echo "① 探服务器(Docker 是否就绪 / 目录是否可写)"
ssh "${SSH_ARGS[@]}" "$SSH_TARGET" "command -v docker >/dev/null 2>&1 || { echo '✗ 服务器未安装 Docker:先执行 deploy/install-docker.sh(见 README)'; exit 1; }; docker compose version >/dev/null 2>&1 || { echo '✗ 缺少 docker compose 插件'; exit 1; }; mkdir -p '$REMOTE_DIR/dist' '$REMOTE_DIR/web/dist' '$REMOTE_DIR/deploy' && echo '✓ Docker 就绪'"

echo "② 本地构建(前端 app.js/app.css + 服务端 server.mjs)"
npm run build

echo "③ 上传构建产物"
ssh "${SSH_ARGS[@]}" "$SSH_TARGET" "rm -rf '$REMOTE_DIR/web/dist'"
scp "${SSH_ARGS[@]}" dist/server.mjs "$SSH_TARGET:$REMOTE_DIR/dist/server.mjs"
scp "${SSH_ARGS[@]}" -r web/dist "$SSH_TARGET:$REMOTE_DIR/web/"
scp "${SSH_ARGS[@]}" deploy/Dockerfile "$SSH_TARGET:$REMOTE_DIR/deploy/Dockerfile"
scp "${SSH_ARGS[@]}" docker-compose.yml "$SSH_TARGET:$REMOTE_DIR/"
if [[ -f .env ]]; then
  echo "   (.env 一并上传:含 DEEPSEEK_KEY,服务器上会 chmod 600)"
  scp "${SSH_ARGS[@]}" .env "$SSH_TARGET:$REMOTE_DIR/.env"
  ssh "${SSH_ARGS[@]}" "$SSH_TARGET" "chmod 600 '$REMOTE_DIR/.env'"
else
  echo "   ⚠ 本地没有 .env —— 服务器上必须有 $REMOTE_DIR/.env(里面写 DEEPSEEK_KEY=...)才能用 AI 解读"
fi

echo "④ 服务器重建容器"
ssh "${SSH_ARGS[@]}" "$SSH_TARGET" "cd '$REMOTE_DIR' && docker compose up -d --build"

echo "⑤ 探活"
ssh "${SSH_ARGS[@]}" "$SSH_TARGET" "sleep 2; curl -fsS http://127.0.0.1:\${FORTUNE_PORT:-8787}/healthz && echo"
echo "✓ 发布完成 —— 浏览器打开 http://${SSH_TARGET#*@}:8787 验证(记得阿里云安全组放行端口)"
