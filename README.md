# Get-Fortune · 命理小馆

一个自托管的算命/占卜独立站：**全部排盘在访客浏览器本地算**（星盘、八字、紫微、六爻、塔罗……28 个模块，纯离线可用），
DeepSeek 只负责把算好的盘面翻译成人话。前端「星夜玄机」暗色主题，28 个模块带悬浮解释浮窗。

线上地址：<http://101.133.134.164:8787>（阿里云 2C2G，Docker 单容器）

```
浏览器 ──http://IP:8787──▶ Docker 容器(单进程 node)
                            ├─ 静态站：/ · app.js · app.css · data/*
                            ├─ POST /api/fortune → DeepSeek 流式(SSE)   ← 只有 AI 解读走网络
                            └─ GET  /healthz
```

- 排盘零成本零依赖：`src/paipan/` 是纯 TypeScript 移植（含 102 项天象/历法锚点自测），不调任何 API
- key 只在服务器 `.env`（chmod 600），不进仓库、不进镜像、不进前端

## 目录

```
src/paipan/      排盘库(28 模块注册表 + 星历/历法/占卜/紫微/塔罗/五格 + selftest)
                  └ data/kangxi.json  康熙笔画全量表(233KB,前端懒加载)
src/prompts.ts   DeepSeek 系统规则/模块锚点/输出模板(与 worker 共用)
src/server.ts    node:http 服务:静态托管 + /api/fortune 转发 + /healthz
web/             独立站前端(无框架):index.html · app.ts · style.css · favicon.svg · data/config.json
worker/          Cloudflare Worker 备用目标(同一份校验/限流/CORS 代码,境外 HTTPS 可用)
test/            server 冒烟(23 项) · 端到端(37 项) · mock DeepSeek · 全模块冒烟
tools/           build-web.mjs(前端打包) · gen-kangxi.mjs(字表生成) · compare-paipan.ts
deploy/          Dockerfile · docker-compose · deploy.sh(一键发布) · install-docker.sh · systemd 兜底
```

## 开发

```bash
npm install
npm run build          # 前端 → web/dist,服务端 → dist/server.mjs
npm test               # 构建 + 排盘 102 锚点 + 服务端 23 项冒烟
npm run test:e2e       # 构建 + 起 mock 上游 + Edge 无头跑完整交互(37 项,含浮窗三通道)
npm start              # 起服务(默认 :8787;缺 DEEPSEEK_KEY 时仅 AI 解读不可用)
```

前端改动只碰 `web/`：`app.ts` 管逻辑、`style.css` 管「星夜玄机」主题、`index.html` 管骨架与文案。
模块文案（悬浮浮窗的白话解释）在 `src/paipan/descs.ts`，改完重新 build 即可。

## 服务器部署（Docker · 本地 SSH 上传）

**已在阿里云落地**：`root@101.133.134.164:/opt/get-fortune`（Docker 单容器，`0.0.0.0:8787->8787`）。
本机 `deploy/server.env`（gitignored）已填好该目标，改完代码只需跑 `bash deploy/deploy.sh`。

**准备（一次）**

```bash
# ① 服务器装 Docker（本机已有:29.8.1 + compose v5.5.1,含 daocloud/1ms.run 镜像加速）
ssh root@你的IP 'bash -s' < deploy/install-docker.sh

# ② 本地填部署目标（gitignored）
cp deploy/server.env.example deploy/server.env   # SSH_TARGET / REMOTE_DIR
#    服务器上的 .env 放 DEEPSEEK_KEY(首次部署已写入 /opt/get-fortune/.env,chmod 600)

# ③ 阿里云控制台放行端口：ECS → 安全组 → 入方向 → 8787（参考量化看板的 8000 规则）
```

**发布（每次改完代码）**

```bash
bash deploy/deploy.sh          # 构建 → 上传 → docker compose 重建 → 探活
bash deploy/deploy.sh --logs   # 看服务器日志
npm run test:prod              # 打真实地址验收(真浏览器 + 真 DeepSeek;需能访问到该地址)
```

浏览器打开 `http://你的IP:8787` 即可。站是 HTTP 明文（浏览器可能提示「不安全」），
但整站跑在 `IP:端口` 上、页面与接口同源，不存在混合内容问题；非 80/443 端口也不需要备案。

**不想用 Docker**：`deploy/get-fortune.service` 是同款 systemd 兜底（`sudo cp` 后 `systemctl enable --now get-fortune`）。

## 接口契约

```
POST /api/fortune   { modules:[{id,name}], sections, question?, focus? }
                    → SSE: {t:"chunk",v} … {t:"error",v} … data: [DONE]
GET  /healthz       {"ok":true,"staticDir":"…"}
```

安全：CORS 白名单（本站 + 本地 dev）；每 IP 10 分钟 5 次滑动窗口限流；入参结构与体量双重校验（防烧 token）；请求体上限 256KB；
静态服务拒绝路径穿越；同源部署下浏览器不跨域。

## 与 MyBlog 的关系

排盘库与前端原在博客仓库（issue #13）开发，2026-09 迁移为本独立站；博客首页只保留一张外链卡片指向本站。
Cloudflare Worker（`worker/`）作为境外 HTTPS 备用入口保留，`worker/` 与 `src/server.ts` 共用同一份校验/限流/CORS/SSE 实现与 prompt 规则。

## 免责声明

天文与历法计算真实可复核；但「星盘/八字 → 性格与命运」属于传统解释系统，没有科学证据支持。
本项目仅供娱乐参考，不提供医疗、投资、重大决策建议。
