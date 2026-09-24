# worker — Cloudflare Worker 部署目标（备用）

`POST /api/fortune`:校验入参 → 每 IP 限流(10 分钟 5 次) → 复用 `../src/prompts.ts` 组装 prompt → 转发 DeepSeek 流式回复。

**排盘 100% 在用户浏览器本地完成**,Worker 不做任何命理计算,只持有 key 和转发文本。
与 `src/server.ts`(Node 自托管)行为逐字一致,详见仓库根 README。

> 已知限制:`workers.dev` 在大陆被 DNS 污染,境内无代理访客不可达——所以本目标是备用,主目标是服务器自托管。

## 部署 / 更新

```bash
cd worker
npx wrangler login            # 浏览器登录你的 Cloudflare 账号(免费套餐即可)
npx wrangler secret put DEEPSEEK_KEY   # 粘贴 DeepSeek 平台 https://platform.deepseek.com 的 key,只存 Cloudflare
npx wrangler deploy           # 输出 https://zmdld11-fortune.<子域>.workers.dev
```

首次后 `secret put` 只需做一次;以后改代码只跑 `npx wrangler deploy`。

## 接入博客

把完整接口地址填进**博客仓库** `src/content/settings/fortune.json`(**必须含路径**):

```json
{ "api": "https://zmdld11-fortune.<你的子域>.workers.dev/api/fortune" }
```

重新构建博客(push 自动构建)后,`/fortune` 页的「✨ 排盘 + AI 解读」按钮自动点亮。
`api` 留空时页面只提供本地排盘,不发任何请求。

## CORS / 安全

- 允许来源白名单:`https://zmdld11.github.io` 与本地 dev(`localhost:4321`),在 `index.ts` 的 `ALLOWED_ORIGINS` 调整。
- 限流是**单 isolate 内存级**(每个边缘节点独立计数),够个人博客流量用;若被恶意刷量,再加 Cloudflare Turnstile 或 KV 计数。
- 入参有结构与体量校验(sections 条数/单节大小),防超大 payload 烧 token。

## 本地调试

```bash
cd worker
npx wrangler dev              # 默认 :8787
# 临时把博客 fortune.json 的 api 指到 http://127.0.0.1:8787/api/fortune 即可联调
```
