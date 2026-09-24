// e2e.mjs — 独立站端到端: 起 mock 上游 + 真服务,用本机 Edge 无头跑完整交互
// 覆盖: 页面渲染 / 28 芯片 / 浮窗三通道(hover · Tab · 触屏ⓘ) / 表单联动 / 本地排盘 / AI 流式 / 截图
import { spawn } from "node:child_process";
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const SHOTS = path.join(ROOT, ".shots");
const MOCK_PORT = 9991;
const SRV_PORT = 8795;
const BASE = `http://127.0.0.1:${SRV_PORT}`;
fs.mkdirSync(SHOTS, { recursive: true });

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  <- " + detail}`);
  cond ? pass++ : fail++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const mock = spawn(process.execPath, [path.join(ROOT, "test/mock-deepseek.mjs")], { env: { ...process.env, MOCK_PORT: String(MOCK_PORT) } });
const srv = spawn(process.execPath, [path.join(ROOT, "dist/server.mjs")], {
  env: { ...process.env, PORT: String(SRV_PORT), DEEPSEEK_KEY: "test-key", FORTUNE_UPSTREAM: `http://127.0.0.1:${MOCK_PORT}/v1/chat/completions` },
});
await sleep(1200);

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
// 等应用初始化完(cfg 拉取 + 28 芯片渲染)
const ready = async () => page.waitForFunction(() => document.querySelectorAll("#f-cats .f-chip").length === 28, { timeout: 15000 });

const shot = async (name, opts = {}) => {
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), captureBeyondViewport: true, ...opts });
};
/** 按元素绝对位置裁剪截图(避免浏览器 UI 合成层烙印,也便于逐块验收) */
const shotEl = async (page, selector, name, pad = 12) => {
  const box = await page.$eval(selector, (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x + window.scrollX, y: r.y + window.scrollY, w: r.width, h: r.height };
  });
  await page.screenshot({
    path: path.join(SHOTS, `${name}.png`),
    captureBeyondViewport: true,
    clip: { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: box.w + pad * 2, height: box.h + pad * 2 },
  });
};

try {
  await page.goto(BASE, { waitUntil: "networkidle2" });
  await ready();

  // ---------- 1. 渲染 ----------
  const pageTitle = await page.title();
  ok("页面标题", pageTitle.includes("命理小馆"), pageTitle);
  const chipCount = await page.$$eval("#f-cats .f-chip", (els) => els.length);
  ok("28 个模块芯片", chipCount === 28, String(chipCount));
  const catCount = await page.$$eval("#f-cats .f-cat", (els) => els.length);
  ok("5 个分类", catCount === 5, String(catCount));
  const allHaveDesc = await page.evaluate(async () => {
    const r = await fetch("app.js");
    return r.ok;
  });
  ok("app.js 可访问", allHaveDesc);
  const cityOpts = await page.$$eval("#f-city option", (els) => els.length);
  ok("未出生地前下拉为空(懒加载省市表)", cityOpts === 0, String(cityOpts));
  await shot("01-home");

  // ---------- 2. 浮窗: hover ----------
  const ziweiChip = "#f-cats .f-chip[data-id='ziwei']";
  await page.hover(ziweiChip);
  await sleep(150);
  let tipState = await page.evaluate(() => {
    const t = document.getElementById("tip");
    return { hidden: t.hidden, text: t.innerText, pos: t.dataset.pos };
  });
  ok("hover 显示浮窗", !tipState.hidden && tipState.text.includes("紫微"), JSON.stringify(tipState).slice(0, 80));
  ok("浮窗含白话解释", tipState.text.includes("十二宫"), tipState.text.slice(0, 60));
  ok("浮窗含口径副行", tipState.text.includes("口径"), tipState.text.slice(-60));
  await shot("02-tooltip-hover");

  // 浮窗不遮挡点击: 浮窗覆盖区域仍能点中下面的芯片
  const overlapClickable = await page.evaluate(() => {
    const t = document.getElementById("tip");
    return getComputedStyle(t).pointerEvents === "none";
  });
  ok("浮窗不拦截点击(pointer-events:none)", overlapClickable);

  // Esc 关闭
  await page.keyboard.press("Escape");
  await sleep(80);
  ok("Esc 关闭浮窗", await page.evaluate(() => document.getElementById("tip").hidden));

  // ---------- 3. 浮窗: 键盘 Tab ----------
  await page.evaluate(() => document.querySelector("#f-cats .f-chip[data-id='liuyao'] input").focus());
  await sleep(120);
  const kbdTip = await page.evaluate(() => ({
    hidden: document.getElementById("tip").hidden,
    text: document.getElementById("tip").innerText,
    described: document.querySelector("#f-cats .f-chip[data-id='liuyao']").getAttribute("aria-describedby"),
  }));
  ok("Tab 聚焦显示浮窗", !kbdTip.hidden && kbdTip.text.includes("六爻"), JSON.stringify(kbdTip).slice(0, 80));
  ok("aria-describedby 已挂", kbdTip.described === "tip", String(kbdTip.described));

  // ---------- 4. 表单联动 ----------
  const formState0 = await page.evaluate(() => document.getElementById("fs-birth").hidden);
  ok("未勾选时不出生信息区", formState0 === true);
  await page.evaluate(() => {
    for (const id of ["bazi", "western", "tarot"]) {
      const input = document.querySelector(`#f-cats .f-chip[data-id='${id}'] input`);
      input.checked = true;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
  const formState1 = await page.evaluate(() => ({
    birth: document.getElementById("fs-birth").hidden,
    ask: document.getElementById("fs-ask").hidden,
    divination: document.getElementById("fs-divination").hidden,
    spread: document.getElementById("f-spread-box").hidden,
    toss: document.getElementById("f-toss-box").hidden,
    on: document.querySelectorAll("#f-cats .f-chip.is-on").length,
    // hidden 属性必须真的不可见(曾被 .f-dates{display:inline-flex} 顶掉过)
    lunarRowVisible: getComputedStyle(document.getElementById("f-dates-lunar")).display !== "none",
    tossVisible: getComputedStyle(document.getElementById("f-toss-box")).display !== "none",
  }));
  ok("勾选后出现出生信息区", formState1.birth === false);
  ok("提问框对任何模块都出现", formState1.ask === false);
  ok("塔罗牌阵选择出现", formState1.spread === false);
  ok("未选六爻则不显示摇钱", formState1.toss === true);
  ok("未选六爻时摇钱区真的不可见", formState1.tossVisible === false);
  ok("阳历模式下农历输入行不可见", formState1.lunarRowVisible === false);
  ok("选中态高亮 3 个", formState1.on === 3, String(formState1.on));

  // 只有八字时:提问框仍在(用户要的"任意模块都能问"),占卜方式区不该出现
  await page.evaluate(() => {
    for (const id of ["western", "tarot"]) {
      const i = document.querySelector(`#f-cats .f-chip[data-id='${id}'] input`);
      i.checked = false; i.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
  const onlyBazi = await page.evaluate(() => ({
    ask: document.getElementById("fs-ask").hidden,
    div: document.getElementById("fs-divination").hidden,
  }));
  ok("只选八字时提问框仍可用", onlyBazi.ask === false);
  ok("无占卜模块时不显示占卜方式区", onlyBazi.div === true);
  await page.evaluate(() => {
    for (const id of ["western", "tarot"]) {
      const i = document.querySelector(`#f-cats .f-chip[data-id='${id}'] input`);
      i.checked = true; i.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });

  // 出生地级联:全国省市表懒加载完成
  await page.waitForFunction(() => document.querySelectorAll("#f-prov option").length > 30, { timeout: 10000 });
  const cascade = await page.evaluate(() => ({
    provs: document.querySelectorAll("#f-prov option").length,
    city0: document.querySelector("#f-city option")?.textContent,
    pProvs: document.querySelectorAll("#p-prov option").length,
  }));
  ok("省级下拉 34 个(懒加载完成)", cascade.provs === 34, String(cascade.provs));
  ok("默认落上海市", cascade.city0 === "上海市", String(cascade.city0));
  ok("对方出生地同样有省级", cascade.pProvs === 34, String(cascade.pProvs));

  // 选广东 → 市级联动出 21 个
  await page.select("#f-prov", "广东省");
  const gd = await page.evaluate(() => ({
    n: document.querySelectorAll("#f-city option").length,
    first: document.querySelector("#f-city option")?.textContent,
  }));
  ok("广东省下辖 21 市", gd.n === 21, `${gd.n} 个; 首个=${gd.first}`);
  await page.select("#f-prov", "新疆维吾尔自治区");
  const xj = await page.evaluate(() => {
    const opts = [...document.querySelectorAll("#f-city option")];
    const kashi = opts.find((o) => o.textContent.includes("喀什"));
    return { n: opts.length, kashi: kashi?.dataset.lon + "," + kashi?.dataset.lat };
  });
  ok("新疆 24 个地州市且喀什坐标正确", xj.n === 24 && xj.kashi?.startsWith("75.9"), JSON.stringify(xj));

  // 手动经纬度:勾选后出现输入行且省市被禁用
  await page.click("#f-geo-manual");
  const manual = await page.evaluate(() => ({
    row: getComputedStyle(document.getElementById("f-geo-row")).display !== "none",
    disabled: document.getElementById("f-prov").disabled && document.getElementById("f-city").disabled,
  }));
  ok("勾选手动经纬度后出现输入行且省市禁用", manual.row === true && manual.disabled === true, JSON.stringify(manual));
  await page.click("#f-geo-manual");
  await page.select("#f-prov", "上海市");

  // 切到农历 → 农历行出现(反向验证)
  await page.select("#f-cal", "lunar");
  const lunarShown = await page.evaluate(() => ({
    lunar: getComputedStyle(document.getElementById("f-dates-lunar")).display !== "none",
    solar: getComputedStyle(document.getElementById("f-dates-solar")).display === "none",
  }));
  ok("切农历后农历行出现/阳历行隐藏", lunarShown.lunar === true && lunarShown.solar === true, JSON.stringify(lunarShown));
  await page.select("#f-cal", "solar");
  await page.evaluate(() => {
    document.querySelector("#f-date").value = "1990-06-15";
    document.querySelector("#f-date").dispatchEvent(new Event("change"));
    document.querySelector("#f-time").value = "11:30";
    const q = document.querySelector("#f-question");
    q.value = "我这辈子结过婚吗？10–20 岁之间谈过恋爱吗？";
    q.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await shotEl(page, "#f-form", "03b-form");

  // ---------- 5. 本地排盘 ----------
  await page.evaluate(() => {
    document.querySelector("#f-date").value = "1990-06-15";
    document.querySelector("#f-date").dispatchEvent(new Event("change"));
    document.querySelector("#f-time").value = "11:30";
    document.querySelector("#f-question").value = "我这辈子结过婚吗？10–20 岁之间谈过恋爱吗？";
    document.getElementById("f-run").click();
  });
  await page.waitForFunction(() => document.getElementById("f-result").innerText.length > 150, { timeout: 20000 });
  const chart = await page.evaluate(() => ({
    dst: document.getElementById("f-dst").checked,
    text: document.getElementById("f-result").innerText,
    cards: document.querySelectorAll("#f-result .f-mod").length,
  }));
  ok("本地排盘出 3 个模块卡片", chart.cards === 3, String(chart.cards));
  ok("1990-06-15 自动勾夏令时", chart.dst === true);
  ok("四柱正确(庚午/壬午/辛亥)", ["庚午", "壬午", "辛亥"].every((p) => chart.text.includes(p)), chart.text.slice(0, 120).replace(/\n/g, " "));
  ok("塔罗三张牌阵已出牌", /塔罗|权杖|圣杯|宝剑|星币|大阿|愚者/.test(chart.text));
  await page.evaluate(() => document.getElementById("f-result").scrollIntoView({ block: "start" }));
  await sleep(400);
  await shot("03-chart-result");

  // ---------- 6. AI 流式 ----------
  const aiVisible = await page.evaluate(() => !document.getElementById("f-ai").hidden);
  ok("AI 按钮可见(cfg.api 已配)", aiVisible);
  await page.evaluate(() => document.getElementById("f-ai").click());
  await page.waitForFunction(() => {
    const n = document.querySelector("#f-ai-card .f-ai-note");
    return n && (n.textContent.includes("完成") || n.textContent.includes("失败"));
  }, { timeout: 30000, polling: 300 });
  const ai = await page.evaluate(() => {
    const box = document.getElementById("f-ai-text");
    return {
      note: document.querySelector("#f-ai-card .f-ai-note").textContent,
      text: box.innerText,
      html: box.innerHTML,
      h1: box.querySelectorAll("h1").length,
      h2: box.querySelectorAll("h2").length,
      strong: box.querySelectorAll("strong").length,
      li: box.querySelectorAll("li").length,
      td: [...box.querySelectorAll("td")].map((x) => x.textContent).join(","),
      quote: box.querySelectorAll("blockquote").length,
      rawMarkers: /(^|\n)#{1,6}\s|\*\*/.test(box.innerText),
      caretGone: box.querySelectorAll(".md-caret").length === 0,
    };
  });
  ok("AI 流式完成", ai.note.includes("完成"), ai.note);
  ok("AI 正文渲染", ai.text.includes("mock 流式回复"), ai.text.slice(0, 60));
  ok("Markdown 标题渲染成 h1/h2", ai.h1 === 1 && ai.h2 === 1, `h1=${ai.h1} h2=${ai.h2}`);
  ok("粗体渲染成 strong", ai.strong >= 1, String(ai.strong));
  ok("列表渲染成 li ×2", ai.li === 2, String(ai.li));
  ok("表格渲染成 td(日柱/辛亥)", ai.td.includes("辛亥") && ai.td.includes("日柱"), ai.td);
  ok("引用渲染成 blockquote", ai.quote === 1, String(ai.quote));
  ok("正文里不残留 markdown 记号", ai.rawMarkers === false, ai.text.slice(0, 60));
  ok("完成后光标消失", ai.caretGone === true);
  await shotEl(page, "#f-ai-card", "04-ai-done");
  const captured = JSON.parse(fs.readFileSync(path.join(ROOT, ".tmp/mock-capture.json"), "utf8"));
  const prompt = captured.body.messages[1].content;
  ok("上游 prompt 含三个模块盘面", ["八字四柱", "西方占星本命盘", "塔罗"].every((n) => prompt.includes(n)), prompt.slice(0, 80));
  ok("上游 prompt 含实际盘面数据", prompt.includes("庚午") && prompt.includes("辛亥"));
  ok("上游 prompt 含出生地(上海市)", prompt.includes("上海市"), prompt.slice(0, 60));
  ok("上游 prompt 带上用户的原问题", prompt.includes("结过婚"), prompt.slice(0, 60));
  ok("上游 prompt 挂系统规则", captured.body.messages[0].content.length > 500);
  ok("系统规则含事实类问题纪律", captured.body.messages[0].content.includes("具体事实类问题"), captured.body.messages[0].content.slice(0, 40));

  // ---------- 7. 移动端(触屏): ⓘ 点按浮窗且不误勾选 ----------
  const mp = await browser.newPage();
  await mp.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await mp.goto(BASE, { waitUntil: "networkidle2" });
  await mp.waitForFunction(() => document.querySelectorAll("#f-cats .f-chip").length === 28, { timeout: 15000 });
  const hoverMedia = await mp.evaluate(() => window.matchMedia("(hover: hover)").matches);
  ok("移动端 hover 媒体查询为假(只走 ⓘ)", hoverMedia === false);
  const infoBox = await mp.$eval("#f-cats .f-chip[data-id='bazi'] .chip-info", (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await mp.touchscreen.tap(infoBox.x, infoBox.y);
  await sleep(200);
  const mobileTip = await mp.evaluate(() => ({
    hidden: document.getElementById("tip").hidden,
    text: document.getElementById("tip").innerText,
    checked: document.querySelector("#f-cats .f-chip[data-id='bazi'] input").checked,
    tipLeft: document.getElementById("tip").getBoundingClientRect().left,
    tipRight: document.getElementById("tip").getBoundingClientRect().right,
  }));
  ok("触屏点 ⓘ 显示浮窗", !mobileTip.hidden && mobileTip.text.includes("八字"), JSON.stringify(mobileTip).slice(0, 90));
  ok("点 ⓘ 不误勾选芯片", mobileTip.checked === false);
  ok("浮窗不超出屏幕", mobileTip.tipLeft >= 0 && mobileTip.tipRight <= 390 + 1, `${mobileTip.tipLeft}~${mobileTip.tipRight}`);
  await mp.screenshot({ path: path.join(SHOTS, "05-mobile-tooltip.png"), captureBeyondViewport: true });
  await mp.evaluate(() => document.getElementById("tip").hidden = true);
  await mp.screenshot({ path: path.join(SHOTS, "06-mobile-top.png"), captureBeyondViewport: true });

  // 移动端排盘一次(确认小块屏表单可用)
  await mp.evaluate(() => {
    const i = document.querySelector("#f-cats .f-chip[data-id='numerology'] input");
    i.checked = true; i.dispatchEvent(new Event("change", { bubbles: true }));
    document.querySelector("#f-date").value = "1995-03-08";
    document.querySelector("#f-date").dispatchEvent(new Event("change"));
    document.getElementById("f-run").click();
  });
  await mp.waitForFunction(() => document.getElementById("f-result").innerText.length > 40, { timeout: 20000 });
  await mp.evaluate(() => document.getElementById("f-result").scrollIntoView({ block: "start" }));
  await sleep(300);
  await mp.screenshot({ path: path.join(SHOTS, "07-mobile-result.png"), captureBeyondViewport: true });
  ok("移动端排盘可用", true);

  // ---------- 8. 控制台干净 ----------
  ok("浏览器无控制台错误", errors.length === 0, errors.join(" | ").slice(0, 200));
} catch (e) {
  fail++;
  console.log("FAIL  异常中断  <- " + e.message);
}

await browser.close();
mock.kill();
srv.kill();
console.log(`\n${pass} pass, ${fail} fail  截图见 .shots/`);
process.exit(fail ? 1 : 0);
