// Cloudflare Worker — /api/fortune
// 职责单一: 校验入参 → 每 IP 限流 → 组装 prompt(复用仓库 prompts.ts) → 转发 DeepSeek 流式回复。
// 排盘数据已由前端本地算好,Worker 不做任何命理计算;DeepSeek 只解读。
// key 存 wrangler secret(DEEPSEEK_KEY),绝不入库、不进前端。
import { SYSTEM_PROMPT, buildUserPrompt, type SectionLike } from "../src/prompts";

export interface Env {
  DEEPSEEK_KEY?: string;
}

const ALLOWED_ORIGINS = new Set([
  "https://zmdld11.github.io",
  "http://localhost:4321",
  "http://127.0.0.1:4321",
]);

// 限流: 每 IP 每 10 分钟 5 次(单 isolate 内存级,够个人博客用;抗刷量请上 Turnstile/KV,见 README)
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 5;
const hits = new Map<string, number[]>();

export function rateLimited(ip: string): boolean {
  const now = Date.now();
  const arr = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (arr.length >= MAX_PER_WINDOW) return true;
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 5000) {  // 防Map无限涨
    for (const [k, v] of hits) {
      if (v.every((t) => now - t >= WINDOW_MS)) hits.delete(k);
    }
  }
  return false;
}

export function cors(origin: string | null): Record<string, string> {
  const h: Record<string, string> = {
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
  };
  if (origin && ALLOWED_ORIGINS.has(origin)) h["access-control-allow-origin"] = origin;
  return h;
}

export const sse = (obj: unknown) => `data: ${JSON.stringify(obj)}\n\n`;

export interface Payload {
  modules?: { id?: unknown; name?: unknown }[];
  sections?: unknown;
  question?: unknown;
  focus?: unknown;
}

/** 入参校验: 结构+体量上限,防止拼进超大 payload 烧 token */
export function validate(body: Payload): { ok: true; data: Required<Payload> } | { ok: false; msg: string } {
  const modules = body.modules;
  if (!Array.isArray(modules) || modules.length === 0 || modules.length > 30) {
    return { ok: false, msg: "modules 需为 1-30 个的数组" };
  }
  for (const m of modules) {
    if (typeof m?.id !== "string" || m.id.length > 40 || typeof m?.name !== "string" || m.name.length > 60) {
      return { ok: false, msg: "modules 元素需含 id/name 字符串" };
    }
  }
  const sections = body.sections;
  if (typeof sections !== "object" || sections === null) return { ok: false, msg: "sections 缺失" };
  // 浅校验: 每个 Section 的字段类型与长度
  const secList = Object.values(sections as Record<string, unknown[]>).flat();
  if (secList.length > 200) return { ok: false, msg: "sections 过多" };
  for (const s of secList) {
    const sec = s as SectionLike;
    if (typeof sec?.title !== "string" || sec.title.length > 100) return { ok: false, msg: "section.title 非法" };
    if (JSON.stringify(sec).length > 20000) return { ok: false, msg: "单个 section 超大" };
  }
  const question = typeof body.question === "string" ? body.question.slice(0, 200) : "";
  const focus = typeof body.focus === "string" ? body.focus.slice(0, 40) : "";
  return { ok: true, data: { modules: modules as { id: string; name: string }[], sections: sections as Record<string, SectionLike[]>, question, focus } };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("origin");
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
    const headers = { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache", ...cors(origin) };

    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "仅支持 POST /api/fortune" }), { status: 405, headers: { ...cors(origin), "content-type": "application/json" } });
    }
    const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
    if (rateLimited(ip)) {
      return new Response(JSON.stringify({ error: "请求太频繁,请 10 分钟后再试" }), { status: 429, headers: { ...cors(origin), "content-type": "application/json" } });
    }
    if (!env.DEEPSEEK_KEY) {
      return new Response(JSON.stringify({ error: "服务端未配置 DEEPSEEK_KEY(wrangler secret)" }), { status: 503, headers: { ...cors(origin), "content-type": "application/json" } });
    }

    let body: Payload;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: "请求体不是合法 JSON" }), { status: 400, headers: { ...cors(origin), "content-type": "application/json" } });
    }
    const v = validate(body);
    if (!v.ok) {
      return new Response(JSON.stringify({ error: v.msg }), { status: 400, headers: { ...cors(origin), "content-type": "application/json" } });
    }

    const names: Record<string, string> = {};
    for (const m of v.data.modules) names[m.id] = m.name;
    const userPrompt = buildUserPrompt({
      moduleIds: v.data.modules.map((m) => m.id),
      moduleNames: names,
      sections: v.data.sections,
      question: v.data.question || undefined,
      focus: v.data.focus || undefined,
    });

    // 转发 DeepSeek(OpenAI 兼容 SSE),转成我们的简单事件流
    const upstream = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${env.DEEPSEEK_KEY}` },
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
      const evt = sse({ t: "error", v: `DeepSeek 上游 ${upstream.status}${detail ? ": " + detail.slice(0, 200) : ""}` }) + "data: [DONE]\n\n";
      return new Response(evt, { status: 200, headers });
    }

    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const reader = upstream.body!.getReader();
        let buf = "";
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            const lines = buf.split("\n");
            buf = lines.pop() ?? "";
            for (const line of lines) {
              const t = line.trim();
              if (!t.startsWith("data:")) continue;
              const payload = t.slice(5).trim();
              if (payload === "[DONE]") continue;
              try {
                const json = JSON.parse(payload);
                const delta = json.choices?.[0]?.delta?.content;
                if (typeof delta === "string" && delta) controller.enqueue(encoder.encode(sse({ t: "chunk", v: delta })));
              } catch { /* 忽略不完整行 */ }
            }
          }
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        } catch (e) {
          controller.enqueue(encoder.encode(sse({ t: "error", v: `转发中断: ${(e as Error).message}` })) + "data: [DONE]\n\n");
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, { status: 200, headers });
  },
};
