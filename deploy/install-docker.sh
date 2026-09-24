#!/usr/bin/env bash
# install-docker.sh — 在服务器上装 Docker(阿里云镜像源,大陆直连快)
# 用法: ssh admin@你的IP 'bash -s' < deploy/install-docker.sh
set -euo pipefail

if command -v docker >/dev/null 2>&1; then
  echo "✓ Docker 已安装: $(docker --version)"
else
  echo "① 配置 Docker CE 阿里云源"
  sudo apt-get update -qq
  sudo apt-get install -y -qq ca-certificates curl gnupg
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://mirrors.aliyun.com/docker-ce/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  sudo chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://mirrors.aliyun.com/docker-ce/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
  echo "② 安装 docker-ce + compose 插件"
  sudo apt-get update -qq
  sudo apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi

echo "③ 配置镜像加速(拉 node:22-alpine 用)"
sudo mkdir -p /etc/docker
if ! sudo grep -q "registry-mirrors" /etc/docker/daemon.json 2>/dev/null; then
  sudo tee /etc/docker/daemon.json >/dev/null <<'EOF'
{
  "registry-mirrors": [
    "https://docker.m.daocloud.io",
    "https://dockerproxy.com",
    "https://mirror.ccs.tencentyun.com"
  ]
}
EOF
  sudo systemctl restart docker
fi

echo "④ 权限: 让当前用户免 sudo 用 docker"
sudo usermod -aG docker "$USER" || true

echo "✓ 完成: $(sudo docker --version) / $(sudo docker compose version)"
echo "  注意: 用户组生效需要重新登录一次 SSH(或执行 newgrp docker);deploy.sh 里用的是 docker 命令,若仍提示权限不足,重新 ssh 登录即可"
