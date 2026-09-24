// md.ts — 极简 Markdown 渲染器(只覆盖 AI 解读用到的子集,零依赖)
// 安全模型: 先把整段文本做 HTML 转义,再套我们自己生成的标签。
// 因此 LLM 输出里的 <script>、<img onerror=…> 只会以纯文本形式出现;
// 链接只放行 http/https,其余一律按纯文本保留。不做 innerHTML 之外的任何注入面。
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** 行内元素: 先摘出行内代码(免得里面的 * 被当强调),再处理粗体/斜体/链接,最后还原代码 */
function inline(s: string): string {
  const codes: string[] = [];
  let t = s.replace(/`([^`]+)`/g, (_m, c) => `\u0000${codes.push(`<code>${c}</code>`) - 1}\u0000`);
  t = t.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  t = t.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (m, text, url) =>
    /^https?:\/\//i.test(url) ? `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>` : m);
  return t.replace(/\u0000(\d+)\u0000/g, (_m, i) => codes[Number(i)]);
}

const isTableSep = (line: string) => /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(line) && line.includes("-");
const splitRow = (line: string) =>
  line.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());
// 注意: 文本已整体转义,所以引用标记在源码里是 "&gt;" 而不是 ">"
const QUOTE = /^\s*(?:>|&gt;)\s?/;

/** 渲染 Markdown → HTML 字符串(内容已转义,标签全部由本函数生成) */
export function renderMarkdown(src: string): string {
  const lines = esc(src).split(/\r?\n/);
  const out: string[] = [];
  let i = 0;

  let list: { tag: "ul" | "ol"; items: string[] } | null = null;
  const endList = () => {
    if (list) {
      out.push(`<${list.tag}>${list.items.map((x) => `<li>${inline(x)}</li>`).join("")}</${list.tag}>`);
      list = null;
    }
  };
  let para: string[] = [];
  const endPara = () => {
    if (para.length) {
      // 用 <br> 而非空格连接: 中文软换行加空格反而更乱,而模型输出的换行多在分句处
      out.push(`<p>${para.map(inline).join("<br>")}</p>`);
      para = [];
    }
  };
  const closeBlocks = () => { endList(); endPara(); };

  while (i < lines.length) {
    const line = lines[i];

    // 代码块 ```
    if (/^\s*```/.test(line)) {
      closeBlocks();
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++]);
      i++; // 跳过收尾 ```
      out.push(`<pre><code>${body.join("\n")}</code></pre>`);
      continue;
    }

    // 标题
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      closeBlocks();
      const level = Math.min(h[1].length, 4);
      out.push(`<h${level}>${inline(h[2].trim())}</h${level}>`);
      i++;
      continue;
    }

    // 分隔线
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      closeBlocks();
      out.push("<hr>");
      i++;
      continue;
    }

    // 表格: 当前行含 | 且下一行是分隔行
    if (line.includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      closeBlocks();
      const head = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") rows.push(splitRow(lines[i++]));
      const th = head.map((c) => `<th>${inline(c)}</th>`).join("");
      const tb = rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("");
      out.push(`<div class="md-table-wrap"><table><thead><tr>${th}</tr></thead><tbody>${tb}</tbody></table></div>`);
      continue;
    }

    // 引用
    if (QUOTE.test(line)) {
      closeBlocks();
      const body: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) body.push(lines[i++].replace(QUOTE, ""));
      out.push(`<blockquote>${body.map((b) => `<p>${inline(b)}</p>`).join("")}</blockquote>`);
      continue;
    }

    // 无序列表
    const ul = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (ul) {
      endPara();
      if (list && list.tag !== "ul") endList();
      list ??= { tag: "ul", items: [] };
      list.items.push(ul[1]);
      i++;
      continue;
    }

    // 有序列表
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (ol) {
      endPara();
      if (list && list.tag !== "ol") endList();
      list ??= { tag: "ol", items: [] };
      list.items.push(ol[1]);
      i++;
      continue;
    }

    // 空行
    if (line.trim() === "") {
      closeBlocks();
      i++;
      continue;
    }

    // 普通段落
    endList();
    para.push(line);
    i++;
  }
  closeBlocks();
  return out.join("\n");
}

/** 纯文本化(给“复制全文”之类的场景用;不做渲染) */
export function markdownToText(src: string): string {
  return src
    .replace(/^\s*```.*$/gm, "")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s*[-*+]\s+/gm, "· ");
}
