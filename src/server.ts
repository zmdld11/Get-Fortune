// server — 命理小馆独立站服务(node:http,打包后零 npm 运行时依赖)
// 一个进程同时托管两件事:
//   ① 静态站: / → web/dist/index.html,含 app.js/app.css/data/*(排盘 100% 在浏览器里跑)
//   ② AI 接口: POST /api/fortune → 校验/限流/拼 prompt → 转发 DeepSeek 流式(SSE)
//   另有 GET /healthz 探活。与 worker/index.ts 共用同一份校验/限流/CORS/SSE 实现。
// 环境变量: PORT(默认 8787) | DEEPSEEK_KEY(必填) | STATIC_DIR(默认 ../web/dist) | FORTUNE_UPSTREAM
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";
import { cors, rateLimited, sse, validate } from "../worker/index";
import { SYSTEM_PROMPT, buildUserPrompt } from "./prompts";

const PORT = Number(process.env.PORT ?? 8787);
const UPSTREAM = process.env.FORTUNE_UPSTREAM ?? "https://api.deepseek.com/chat/completions";
const KEY = process.env.DEEPSEEK_KEY ?? "";
const MAX_BODY = 256 * 1024;
const STATIC_DIR = path.resolve(process.env.STATIC_DIR ?? fileURLToPath(new URL("../web/dist", import.meta.url)));

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

/** 静态文件: 只读 STATIC_DIR 内的文件,拒绝路径穿越;HTML 不缓存(便于改文案),其余短缓存 */
function serveStatic(pathname: string, res: ServerResponse) {
  const rel = decodeURIComponent(pathname === "/" ? "/index.html" : pathname);
  const file = path.join(STATIC_DIR, rel);
  if (!file.startsWith(STATIC_DIR + path.sep) && file !== path.join(STATIC_DIR, "index.html")) {
    res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
    return res.end("403");
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      return res.end("404 Not Found");
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      "content-type": MIME[ext] ?? "application/octet-stream",
      "cache-control": ext === ".html" ? "no-cache" : "public, max-age=300",
    });
    res.end(data);
  });
}

function json(res: ServerResponse, status: number, obj: unknown, origin: string | null) {
  res.writeHead(status, { ...cors(origin), "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

/** 读取请求体,超过上限返回 null */
function readBody(req: IncomingMessage): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) { resolve(null); req.destroy(); }
      else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", () => resolve(null));
  });
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin ?? null;

  if (req.method === "OPTIONS") {
    res.writeHead(204, cors(origin));
    return res.end();
  }

  const url = req.url ?? "/";
  const pathname = url.split("?")[0];
  if (req.method === "GET" && pathname === "/healthz") {
    return json(res, 200, { ok: true, staticDir: STATIC_DIR }, origin);
  }
  if (!pathname.startsWith("/api/fortune")) {
    if (req.method === "GET" || req.method === "HEAD") return serveStatic(pathname, res);
    return json(res, 405, { error: "不支持的请求方法" }, origin);
  }
  if (req.method !== "POST") {
    return json(res, 405, { error: "仅支持 POST /api/fortune" }, origin);
  }

  // 反代(nginx)场景取 X-Forwarded-For 第一段,直连场景取 socket 地址
  const ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
  if (rateLimited(ip)) {
    return json(res, 429, { error: "请求太频繁,请 10 分钟后再试" }, origin);
  }
  if (!KEY) {
    return json(res, 503, { error: "服务端未配置 DEEPSEEK_KEY 环境变量" }, origin);
  }

  const raw = await readBody(req);
  if (!raw) return; // 超大体量,连接已销毁
  let body: unknown;
  try { body = JSON.parse(raw.toString("utf8")); }
  catch { return json(res, 400, { error: "请求体不是合法 JSON" }, origin); }
  const v = validate(body as Parameters<typeof validate>[0]);
  if (!v.ok) return json(res, 400, { error: v.msg }, origin);

  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
    ...cors(origin),
  });
  const send = (obj: unknown) => res.write(sse(obj));

  try {
    const names: Record<string, string> = {};
    for (const m of v.data.modules) names[m.id] = m.name;
    const userPrompt = buildUserPrompt({
      moduleIds: v.data.modules.map((m) => m.id),
      moduleNames: names,
      sections: v.data.sections,
      question: v.data.question || undefined,
      focus: v.data.focus || undefined,
    });

    const upstream = await fetch(UPSTREAM, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        stream: true,
        temperature: 0.8,
        max_tokens: 4096,
      }),
    });

    if (!upstream.ok || !upstream.body) {
      const detail = await upstream.text().catch(() => "");
      send({ t: "error", v: `DeepSeek 上游 ${upstream.status}${detail ? ": " + detail.slice(0, 200) : ""}` });
      return res.end("data: [DONE]\n\n");
    }

    const decoder = new TextDecoder();
    let buf = "";
    for await (const chunk of upstream.body) {
      buf += decoder.decode(chunk as Uint8Array, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith("data:")) continue;
        const payload = t.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const j = JSON.parse(payload);
          const delta = j.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta) send({ t: "chunk", v: delta });
        } catch { /* 忽略不完整行 */ }
      }
    }
    res.end("data: [DONE]\n\n");
  } catch (e) {
    try {
      send({ t: "error", v: `转发中断: ${(e as Error).message}` });
      res.end("data: [DONE]\n\n");
    } catch { /* 客户端已断开 */ }
  }
});

server.listen(PORT, () => {
  console.log(`命理小馆 listening on :${PORT}`);
  console.log(`  静态目录: ${STATIC_DIR}`);
  console.log(`  AI 上游:  ${UPSTREAM}${KEY ? "" : "  ⚠ 未配置 DEEPSEEK_KEY,AI 解读将返回 503"}`);
});
