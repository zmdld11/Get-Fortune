// fortune-server — Cloudflare Worker 的自托管镜像(node:http,打包后零 npm 运行时依赖)
// 行为与 cloudflare-worker 完全一致: 校验/限流/CORS/SSE 复用 worker 同一份实现,排盘仍在前端。
// POST /api/fortune  校验入参 → 每 IP 限流 → 组装 prompt → 转发 DeepSeek 流式回复
// GET  /healthz      探活(不限流)
// 环境变量: PORT(默认 8787) | DEEPSEEK_KEY(必填) | FORTUNE_UPSTREAM(默认官方地址,测试可指向 mock)
import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { cors, rateLimited, sse, validate } from "../worker/index";
import { SYSTEM_PROMPT, buildUserPrompt } from "./prompts";

const PORT = Number(process.env.PORT ?? 8787);
const UPSTREAM = process.env.FORTUNE_UPSTREAM ?? "https://api.deepseek.com/chat/completions";
const KEY = process.env.DEEPSEEK_KEY ?? "";
const MAX_BODY = 256 * 1024;

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
  if (req.method === "GET" && url.startsWith("/healthz")) {
    return json(res, 200, { ok: true }, origin);
  }
  if (req.method !== "POST" || !url.startsWith("/api/fortune")) {
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
  console.log(`fortune-server listening on :${PORT} (upstream: ${UPSTREAM})`);
});
