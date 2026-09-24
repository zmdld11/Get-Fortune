// md.test.ts — Markdown 渲染器单元测试(tsx 跑)
// 重点: ①AI 实际会用到的语法都渲染对;②任何来自 LLM 的 HTML 都不得变成可执行标签
import { renderMarkdown, markdownToText } from "../web/md";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  <- " + detail}`);
  cond ? pass++ : fail++;
};
const has = (html: string, frag: string) => html.includes(frag);

// ① 基本块级
ok("h1/h2 渲染", has(renderMarkdown("# 解读报告"), "<h1>解读报告</h1>") && has(renderMarkdown("## 一、口径"), "<h2>一、口径</h2>"));
ok("h5+ 收敛到 h4", has(renderMarkdown("##### 深标题"), "<h4>"));
ok("粗体", has(renderMarkdown("**太阳**在双子"), "<strong>太阳</strong>"));
ok("斜体", has(renderMarkdown("*斜*"), "<em>斜</em>"));
ok("行内代码", has(renderMarkdown("用 `Placidus` 宫位"), "<code>Placidus</code>"));
ok("行内代码里的星号不当强调", has(renderMarkdown("`a*b*c`"), "<code>a*b*c</code>"));
ok("无序列表", has(renderMarkdown("- 甲\n- 乙"), "<ul><li>甲</li><li>乙</li></ul>"));
ok("有序列表", has(renderMarkdown("1. 甲\n2. 乙"), "<ol><li>甲</li><li>乙</li></ol>"));
ok("列表切换闭合正确", (() => {
  const h = renderMarkdown("- 甲\n1. 乙");
  return h.includes("</ul>") && h.includes("<ol>") && h.indexOf("</ul>") < h.indexOf("<ol>");
})());
ok("分隔线", has(renderMarkdown("a\n\n---\n\nb"), "<hr>"));
ok("引用", has(renderMarkdown("> 引用一句"), "<blockquote><p>引用一句</p></blockquote>"));
ok("段落用 br 连接中文软换行", has(renderMarkdown("第一句\n第二句"), "<p>第一句<br>第二句</p>"));
ok("代码块", has(renderMarkdown("```\nconst a = 1;\n```"), "<pre><code>const a = 1;</code></pre>"));
ok("表格", (() => {
  const h = renderMarkdown("| 项 | 值 |\n| --- | --- |\n| 日柱 | 辛亥 |");
  return has(h, "<th>项</th>") && has(h, "<td>日柱</td>") && has(h, "<td>辛亥</td>") && has(h, 'class="md-table-wrap"');
})());

// ② 安全: LLM 输出里的 HTML 必须是文本
ok("script 标签被转义", (() => {
  const h = renderMarkdown('<script>alert(1)</script>');
  return !has(h, "<script") && has(h, "&lt;script&gt;");
})());
ok("img onerror 被转义", (() => {
  const h = renderMarkdown('<img src=x onerror="alert(1)">');
  return !has(h, "<img") && has(h, "&lt;img");
})());
ok("javascript: 链接不放行", (() => {
  const h = renderMarkdown("[点我](javascript:alert(1))");
  return !has(h, "<a ") && has(h, "javascript:alert(1)");
})());
ok("http 链接正常且加 noopener", (() => {
  const h = renderMarkdown("[站点](https://example.com)");
  return has(h, 'href="https://example.com"') && has(h, 'rel="noopener noreferrer"');
})());
ok("属性里的引号被转义", !has(renderMarkdown('a " b'), '"b"'));

// ③ 流式半成品不应炸
ok("半截表格不报错", typeof renderMarkdown("| 项 | 值 |\n| --- ") === "string");
ok("未闭合代码块不报错", typeof renderMarkdown("正文\n```\n还没写完") === "string");
ok("未闭合粗体原样保留星号", has(renderMarkdown("**还没写完"), "**还没写完"));

// ④ 纯文本化(备用)
ok("markdownToText 去标记", !markdownToText("## 标题\n- **粗**项").includes("#") && markdownToText("- 项").includes("·"));

console.log(`\n${pass} 通过 / ${fail} 失败${fail ? "  ✗" : " — 全部通过 ✓"}`);
process.exit(fail ? 1 : 0);
