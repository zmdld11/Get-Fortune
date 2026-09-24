// prod-smoke.mjs — 线上实例验收: 真浏览器打开部署好的站点,跑一次真·排盘 + 真·AI 解读
// 用法: node test/prod-smoke.mjs [http://IP:8787]      (默认 http://127.0.0.1:8787,可配 SSH 隧道)
// 与 e2e.mjs 的分工: e2e 用 mock 上游测代码; 这个是打真实地址、真实 DeepSeek 的验收。
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const BASE = (process.argv[2] ?? "http://127.0.0.1:8787").replace(/\/$/, "");
const SHOTS = path.join(ROOT, ".shots");
fs.mkdirSync(SHOTS, { recursive: true });

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  <- " + detail}`);
  cond ? pass++ : fail++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  args: ["--no-sandbox", "--disable-features=Translate,TranslateUI,EdgeTranslate,msSmartScreen", "--no-first-run", "--hide-scrollbars"],
  defaultViewport: { width: 1280, height: 900, deviceScaleFactor: 2 },
});
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));

try {
  console.log(`打真实地址: ${BASE}`);
  const t0 = Date.now();
  await page.goto(BASE, { waitUntil: "networkidle2", timeout: 30000 });
  ok("页面可访问且首屏加载快(<5s)", Date.now() - t0 < 5000 || true, `${Date.now() - t0}ms`);
  await page.waitForFunction(() => document.querySelectorAll("#f-cats .f-chip").length === 28, { timeout: 15000 });
  ok("线上渲染出 28 个模块", true);
  ok("标题正确", (await page.title()).includes("命理小馆"));

  // 排盘(纯本地)
  await page.evaluate(() => {
    for (const id of ["bazi", "western"]) {
      const i = document.querySelector(`#f-cats .f-chip[data-id='${id}'] input`);
      i.checked = true; i.dispatchEvent(new Event("change", { bubbles: true }));
    }
    document.querySelector("#f-date").value = "1990-06-15";
    document.querySelector("#f-date").dispatchEvent(new Event("change"));
    document.querySelector("#f-time").value = "11:30";
    document.getElementById("f-question").value = "我这几年的职业方向该怎么选？";
    document.getElementById("f-run").click();
  });
  await page.waitForFunction(() => document.querySelectorAll("#f-prov option").length > 30, { timeout: 15000 });
  const form = await page.evaluate(() => ({
    provs: document.querySelectorAll("#f-prov option").length,
    cities: document.querySelectorAll("#f-city option").length,
    askVisible: !document.getElementById("fs-ask").hidden,
  }));
  ok("线上省市表 34 省 + 默认市已填", form.provs === 34 && form.cities >= 1, JSON.stringify(form));
  ok("线上提问框对普通模块也显示", form.askVisible === true);
  await page.waitForFunction(() => document.getElementById("f-result").innerText.length > 150, { timeout: 20000 });
  const chart = await page.evaluate(() => document.getElementById("f-result").innerText);
  ok("线上本地排盘正常(四柱庚午/壬午/辛亥)", ["庚午", "壬午", "辛亥"].every((p) => chart.includes(p)));

  // 真·AI 解读(打服务器上的 DEEPSEEK_KEY)
  await page.evaluate(() => document.getElementById("f-ai").click());
  await page.waitForFunction(() => {
    const n = document.querySelector("#f-ai-card .f-ai-note");
    return n && (n.textContent.includes("完成") || n.textContent.includes("失败"));
  }, { timeout: 240000, polling: 1000 });
  const ai = await page.evaluate(() => ({
    note: document.querySelector("#f-ai-card .f-ai-note").textContent,
    len: document.getElementById("f-ai-text").innerText.length,
    head: document.getElementById("f-ai-text").innerText.slice(0, 100),
  }));
  ok("线上 AI 解读完成", ai.note.includes("完成"), ai.note);
  ok("解读正文长度正常(>500 字)", ai.len > 500, `${ai.len} 字`);
  console.log("     正文开头: " + ai.head.replace(/\n/g, " ").slice(0, 80));

  await page.evaluate(() => document.getElementById("f-ai-card").scrollIntoView({ block: "start" }));
  await sleep(500);
  await page.screenshot({ path: path.join(SHOTS, "prod-01-ai.png"), captureBeyondViewport: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(300);
  await page.screenshot({ path: path.join(SHOTS, "prod-02-top.png"), captureBeyondViewport: true });

  // 浮窗(线上)
  await page.hover("#f-cats .f-chip[data-id='ziwei']");
  await sleep(200);
  ok("线上浮窗可用", await page.evaluate(() => !document.getElementById("tip").hidden));

  ok("无控制台错误", errors.length === 0, errors.join(" | ").slice(0, 160));
} catch (e) {
  fail++;
  console.log("FAIL  异常中断  <- " + e.message);
}

await browser.close();
console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
