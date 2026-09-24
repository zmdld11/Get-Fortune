// mock-deepseek.mjs — 假 DeepSeek SSE 上游,联调 server 用
// 收到的 authorization/model/prompt 写入 .tmp/mock-capture.json 供断言
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.MOCK_PORT ?? 9990);
const tmpDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".tmp");
const capturePath = path.join(tmpDir, "mock-capture.json");

http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(capturePath, JSON.stringify({ auth: req.headers.authorization, body: JSON.parse(body || "{}") }));

    res.writeHead(200, { "content-type": "text/event-stream" });
    // 按真实 DeepSeek 输出的形态分片(Markdown: 标题/粗体/列表/表格/引用)
    const chunks = [
      "# 解读报告",
      "\n\n## 一、开场口径声明",
      "\n\n本次排盘已按 **真太阳时** 处理。",
      "\n\n- 太阳在双子 23°45′",
      "\n- 月亮在双鱼 10°05′",
      "\n\n| 项 | 值 |\n| --- | --- |\n| 日柱 | 辛亥 |\n",
      "\n> 传统解释系统,仅供参考。",
      "\n\n这是 mock 流式回复。",
    ];
    let i = 0;
    const timer = setInterval(() => {
      if (i < chunks.length) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: chunks[i++] } }] })}\n\n`);
      } else {
        res.write("data: [DONE]\n\n");
        clearInterval(timer);
        res.end();
      }
    }, 30);
  });
}).listen(PORT, () => console.log(`mock-deepseek on :${PORT}`));
