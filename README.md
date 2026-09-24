# My-Fortune — 算命 AI 解读转发服务

[MyBlog 命理小馆](https://github.com/zmdld11/zmdld11.github.io)的后端：排盘 100% 在访客浏览器本地完成，本服务只做「校验入参 → 每 IP 限流 → 拼 prompt → 流式转发 DeepSeek」，**不做任何命理计算、不存储任何数据**。DeepSeek key 只存服务端环境变量，绝不入库、不进前端。

同一份代码、两个部署目标：

| 目标 | 代码 | 大陆可达性 | 状态 |
|---|---|---|---|
| **Node 自托管**（阿里云，本仓库主目标） | `src/server.ts` → 打包 `dist/server.mjs` | ✓ | 待部署 |
| **Cloudflare Worker**（备用） | `worker/index.ts` | ✗（workers.dev 被 DNS 污染） | 已上线 `https://zmdld11-fortune.zmdld11.workers.dev/api/fortune` |

两边行为逐字一致：`src/server.ts` 复用 `worker/index.ts` 导出的校验/CORS/限流/SSE 实现，prompt 规则共用 `src/prompts.ts`。

## 开发

```bash
npm install        # 仅 esbuild 一个 devDep
npm test           # 打包 + 14 项全路径冒烟(自动起 mock DeepSeek 上游)
npm run build      # 产物 dist/server.mjs(单文件,入库——服务器 git pull 即用,无需 npm)
```

接口契约（前端 `fetch(cfg.api)` 直连）：

```
POST /api/fortune   body: {modules:[{id,name}], sections, question?, focus?}
                    返回 SSE 事件流: {t:"chunk",v} | {t:"error",v} | data: [DONE]
GET  /healthz       {"ok":true}（不限流，探活用）
```

环境变量：`PORT`（默认 8787）、`DEEPSEEK_KEY`（必填）、`FORTUNE_UPSTREAM`（默认官方地址，测试可指向 mock）。

安全设计：CORS 白名单（仅博客域名 + localhost）；每 IP 10 分钟 5 次滑动窗口限流；入参结构与体量双重校验（防烧 token）；请求体上限 256KB。

## 服务器部署（阿里云 2C2G Ubuntu，沿用量化项目模式）

```bash
# ① 服务器装 Node(一次)：Ubuntu 22.04 自带 node 太老,用 NodeSource
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs

# ② 拉代码
cd /home/admin && git clone https://github.com/zmdld11/My-Fortune.git

# ③ 配 key（不进 git）
cd My-Fortune
echo 'DEEPSEEK_KEY=sk-你的key' > .env && chmod 600 .env

# ④ systemd 常驻（unit 文件在 deploy/fortune.service，已按 quant.service 模式写好）
sudo cp deploy/fortune.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now fortune-server
curl -s http://127.0.0.1:8787/healthz    # {"ok":true}

# 以后升级 = 拉代码 + 重启
git pull && sudo systemctl restart fortune-server
```

### HTTPS（硬约束）

博客页面是 HTTPS，浏览器禁止 HTTPS 页面调 HTTP 接口（mixed content），所以对外**必须 HTTPS**。三选一（按是否买域名）：

- **A. 有域名**：nginx 反代 `dist/server.mjs`（127.0.0.1:8787），大陆已备案域名走 443；未备案走 DNS-01 证书 + 非标端口（如 8443）。nginx 配置两个 SSE 关键点：`proxy_buffering off;`（否则不逐字）+ `proxy_read_timeout 300s;`
- **B. 没域名**：Let's Encrypt 已支持给裸 IP 签短期证书（6 天有效，acme.sh 自动续期），可行但多一套续期机制要维护
- **C. 都不动**：继续用 Cloudflare Worker 作 HTTPS 入口（境内无代理访客不可用），自托管版仅作内网/直连用

### nginx 反代参考（情形 A）

```nginx
location /api/fortune {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;  # 限流按真实 IP
    proxy_buffering off;
    proxy_read_timeout 300s;
}
```

## Cloudflare Worker 备用目标

```bash
cd worker
npx wrangler login
npx wrangler secret put DEEPSEEK_KEY
npx wrangler deploy        # wrangler.toml 已就位
```

## 相关

- 前端（排盘 TS 库 + 交互页）在博客仓库 `src/scripts/fortune/` 与 `src/pages/fortune.astro`，开发记录见博客仓库 issue #13
- 算命方法论 skill：`~/.agents/skills/fortune-calc`
