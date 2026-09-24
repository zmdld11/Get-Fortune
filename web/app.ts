// app.ts — 命理小馆独立站前端
// 流程: 勾选模块 → 填信息 → 本地排盘(纯浏览器计算,零网络) → 可选 AI 解读(经本站 /api/fortune 转发)
// 排盘逻辑全部来自 src/paipan(与博客版同一份代码);本文件只管 DOM 与交互。
import {
  CATS, MODULES, computeFortune,
  type BirthInput, type FortuneInput, type ModuleDef, type Section,
} from "../src/paipan/index";
import { inDstWindow } from "../src/paipan/bazi";
import { tossCoins } from "../src/paipan/divination";
import { renderMarkdown } from "./md";
import "./style.css";

interface Cfg { api: string; cities?: { name: string; lon: number; lat: number }[] }
interface City { name: string; lon: number; lat: number }
interface Province { name: string; lon: number; lat: number; cities: City[] }
interface CitiesDoc { source: string; provinces: Province[] }

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const TOSS_LABEL: Record<number, string> = { 6: "老阴 ×", 7: "少阳 ▀", 8: "少阴 ▀▀", 9: "老阳 ○" };

let cfg: Cfg = { api: "" };
let citiesDoc: CitiesDoc | null = null;
let tosses: number[] = [];

// ---------------- 模块勾选区渲染 ----------------

function buildCats() {
  const box = $("f-cats");
  for (const cat of CATS) {
    const fs = document.createElement("fieldset");
    fs.className = "f-cat";
    const lg = document.createElement("legend");
    lg.className = "f-cat-name";
    lg.append(cat.name);
    const small = document.createElement("small");
    small.textContent = cat.hint;
    lg.append(small);
    const chips = document.createElement("div");
    chips.className = "f-chips";
    for (const m of MODULES.filter((x) => x.cat === cat.id)) {
      const label = document.createElement("label");
      label.className = "f-chip";
      label.dataset.id = m.id;
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = m.id;
      const name = document.createElement("span");
      name.textContent = m.name;
      const info = document.createElement("button");
      info.type = "button";
      info.className = "chip-info";
      info.textContent = "?";
      info.setAttribute("aria-label", `${m.name}：这是什么？`);
      label.append(input, name, info);
      chips.append(label);
      bindTip(label, m, input, info);
    }
    fs.append(lg, chips);
    box.append(fs);
  }
}

// ---------------- 悬浮解释浮窗(28 个模块共用一个节点) ----------------

const tip = () => $("tip");
let tipAnchor: HTMLElement | null = null;

function showTip(mod: ModuleDef, anchor: HTMLElement) {
  const t = tip();
  t.textContent = "";
  const h = document.createElement("strong");
  h.textContent = mod.name;
  const p = document.createElement("p");
  p.textContent = mod.desc ?? mod.note ?? "";
  t.append(h, p);
  if (mod.desc && mod.note) {
    const s = document.createElement("small");
    s.textContent = `口径：${mod.note}`;
    t.append(s);
  }
  t.hidden = false;
  tipAnchor = anchor;
  anchor.setAttribute("aria-describedby", "tip");
  placeTip();
}

function hideTip() {
  const t = tip();
  if (t.hidden) return;
  t.hidden = true;
  tipAnchor?.removeAttribute("aria-describedby");
  tipAnchor = null;
}

/** 定位: 默认在锚点下方,空间不足翻到上方;水平方向夹在视口内 */
function placeTip() {
  const t = tip();
  if (t.hidden || !tipAnchor) return;
  const a = tipAnchor.getBoundingClientRect();
  const th = t.offsetHeight;
  const tw = t.offsetWidth;
  const M = 10;
  let top = a.bottom + 10;
  let pos: "below" | "above" = "below";
  if (top + th > window.innerHeight - M && a.top - th - 10 >= M) {
    top = a.top - th - 10;
    pos = "above";
  }
  let left = a.left + a.width / 2 - tw / 2;
  left = Math.max(M, Math.min(left, window.innerWidth - tw - M));
  t.style.left = `${Math.round(left)}px`;
  t.style.top = `${Math.round(Math.max(M, top))}px`;
  t.dataset.pos = pos;
  // 箭头跟随锚点中心
  const arrowX = Math.round(Math.max(16, Math.min(a.left + a.width / 2 - left, tw - 16)));
  t.style.setProperty("--arrow-x", `${arrowX}px`);
}

function bindTip(label: HTMLElement, mod: ModuleDef, input: HTMLInputElement, info: HTMLButtonElement) {
  // ① 鼠标悬停: 用 pointerenter+pointerType 过滤,触屏的合成鼠标事件不会误触发
  label.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") showTip(mod, label); });
  label.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") hideTip(); });
  // ② 键盘 Tab 聚焦
  input.addEventListener("focus", () => showTip(mod, label));
  input.addEventListener("blur", hideTip);
  // ③ 触屏 / 点按 ⓘ(preventDefault 阻止 label 连带勾选;再点一次关闭)
  info.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (tipAnchor === label && !tip().hidden) hideTip();
    else showTip(mod, label);
  });
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") hideTip();
});
window.addEventListener("scroll", () => { if (!tip().hidden) placeTip(); }, { passive: true });
window.addEventListener("resize", () => { if (!tip().hidden) placeTip(); });

// ---------------- 模块勾选 → 表单联动 ----------------

const requiresOf = (ids: string[]) => {
  const set = new Set<string>();
  for (const id of ids) MODULES.find((m) => m.id === id)?.requires.forEach((r) => set.add(r));
  return set;
};
const checkedIds = () =>
  [...document.querySelectorAll<HTMLInputElement>("#f-cats input:checked")].map((el) => el.value);

function refreshForm() {
  const req = requiresOf(checkedIds());
  const ids = checkedIds();
  const any = req.size > 0;
  // 选中态高亮(不依赖 :has(),老浏览器同样有反馈)
  document.querySelectorAll<HTMLElement>("#f-cats .f-chip").forEach((chip) => {
    chip.classList.toggle("is-on", chip.querySelector<HTMLInputElement>("input")!.checked);
  });
  $("fs-birth").hidden = !req.has("birth") && !req.has("time");
  $("fs-partner").hidden = !req.has("partner");
  $("fs-period").hidden = !req.has("period");
  // 提问框: 只要选了模块就给——不问具体事也能让 AI 结合盘面聊
  $("fs-ask").hidden = !any;
  $("fs-divination").hidden = !(ids.includes("liuyao") || ids.includes("tarot"));
  $("fs-name").hidden = !req.has("name");
  $("fs-zeday").hidden = !req.has("zeday");
  $("f-toss-box").hidden = !ids.includes("liuyao");
  $("f-spread-box").hidden = !ids.includes("tarot");
  ($("f-run") as HTMLButtonElement).disabled = !any;

  // 需要出生信息时才懒加载省市表(32KB)
  if (!$("fs-birth").hidden || !$("fs-partner").hidden) void ensureCities();

  const askMods = MODULES.filter((m) => ids.includes(m.id) && m.cat === "ask");
  const noQuestion = ($("f-question") as HTMLTextAreaElement).value.trim() === "";
  if (!any) $("f-hint").textContent = "先勾选至少一个模块";
  else if (askMods.length && noQuestion) $("f-hint").textContent = `「${askMods[0].name}」是问事占卜，建议在“想问点什么”里写上你要问的事（不写会按当前时间起卦）`;
  else $("f-hint").textContent = "出生时间越准，排盘越准；不确定就勾掉「知道出生时间」";
}

// ---------------- 出生地: 省 → 市 级联(全国省市表懒加载) ----------------

/** 首次需要时加载省市表,并给本人/对方两处下拉都建好级联 */
async function ensureCities() {
  if (citiesDoc) return;
  try {
    citiesDoc = (await (await fetch("data/cities-cn.json")).json()) as CitiesDoc;
  } catch {
    citiesDoc = { source: "fallback", provinces: [{ name: "上海市", lon: 121.47, lat: 31.23, cities: [{ name: "上海市", lon: 121.47, lat: 31.23 }] }] };
  }
  for (const [provId, cityId] of [["f-prov", "f-city"], ["p-prov", "p-city"]] as const) {
    const provSel = $(provId) as HTMLSelectElement;
    provSel.textContent = "";
    for (const p of citiesDoc.provinces) provSel.append(new Option(p.name, p.name));
    provSel.addEventListener("change", () => fillCities(provId, cityId));
    const sh = citiesDoc.provinces.find((p) => p.name === "上海市") ?? citiesDoc.provinces[0];
    provSel.value = sh.name;
    fillCities(provId, cityId);
  }
}

function fillCities(provId: string, cityId: string) {
  const provName = ($(provId) as HTMLSelectElement).value;
  const citySel = $(cityId) as HTMLSelectElement;
  citySel.textContent = "";
  const prov = citiesDoc?.provinces.find((p) => p.name === provName);
  for (const c of prov?.cities ?? []) {
    const o = new Option(c.name, c.name);
    o.dataset.lon = String(c.lon);
    o.dataset.lat = String(c.lat);
    citySel.append(o);
  }
}

/** 出生地文本(写进盘面口径,让 AI 与用户都能核对) */
function cityLabel(prefix: "f" | "p"): string {
  const isMain = prefix === "f";
  if (isMain && ($("f-geo-manual") as HTMLInputElement).checked) return "自定义坐标";
  const prov = ($(isMain ? "f-prov" : "p-prov") as HTMLSelectElement).selectedOptions[0]?.textContent ?? "";
  const city = ($(isMain ? "f-city" : "p-city") as HTMLSelectElement).selectedOptions[0]?.textContent ?? "";
  if (!city || city === prov) return prov || city;
  return `${prov} ${city}`;
}

// ---------------- 出生信息采集 ----------------

function geoOf(prefix: "f" | "p"): { lonE: number; latN: number; tz: number } {
  const isMain = prefix === "f";
  if (isMain && ($("f-geo-manual") as HTMLInputElement).checked) {
    return {
      lonE: Number(($("f-lon") as HTMLInputElement).value || 121.47),
      latN: Number(($("f-lat") as HTMLInputElement).value || 31.23),
      tz: Number(($("f-tz") as HTMLInputElement).value || 8),
    };
  }
  const opt = ($(isMain ? "f-city" : "p-city") as HTMLSelectElement).selectedOptions[0];
  return { lonE: Number(opt?.dataset.lon ?? 121.47), latN: Number(opt?.dataset.lat ?? 31.23), tz: 8 };
}

function birthFrom(prefix: "f" | "p"): BirthInput {
  const isMain = prefix === "f";
  const cal = isMain ? (($("f-cal") as HTMLSelectElement).value as "solar" | "lunar") : "solar";
  const dateVal = isMain ? ($("f-date") as HTMLInputElement).value : ($("p-date") as HTMLInputElement).value;
  const [dy, dm, dd] = dateVal ? dateVal.split("-").map(Number) : [1990, 1, 1];
  const timeKnown = isMain ? ($("f-time-known") as HTMLInputElement).checked : true;
  const timeVal = isMain ? ($("f-time") as HTMLInputElement).value : ($("p-time") as HTMLInputElement).value;
  const [hh, mm] = timeVal ? timeVal.split(":").map(Number) : [12, 0];
  const geo = geoOf(isMain ? "f" : "p");
  const gender = isMain
    ? (document.querySelector<HTMLInputElement>(`input[name="f-gender"]:checked`)?.value ?? "unknown")
    : (document.querySelector<HTMLInputElement>(`input[name="p-gender"]:checked`)?.value ?? "female");
  const isLunar = isMain && cal === "lunar";
  const timeSource = isMain ? ($("f-time-source") as HTMLSelectElement).value : undefined;
  return {
    cal,
    year: isLunar ? Number(($("f-lunar-year") as HTMLInputElement).value) || 1990 : dy,
    month: isLunar ? Number(($("f-lunar-month") as HTMLSelectElement).value) : dm,
    day: isLunar ? Number(($("f-lunar-day") as HTMLSelectElement).value) : dd,
    lunarLeap: isMain ? ($("f-lunar-leap") as HTMLInputElement).checked : false,
    timeKnown, hour: hh, minute: mm,
    dst: isMain ? ($("f-dst") as HTMLInputElement).checked : ($("p-dst") as HTMLInputElement).checked,
    lonE: geo.lonE, latN: geo.latN, tz: geo.tz,
    city: cityLabel(isMain ? "f" : "p"),
    gender: gender as BirthInput["gender"],
    timeSource: timeKnown ? timeSource : undefined,
  };
}

function syncDst() {
  const v = ($("f-date") as HTMLInputElement).value;
  if (!v) {
    $("f-dst-row").hidden = true;
    ($("f-dst") as HTMLInputElement).checked = false;
    return;
  }
  const [y, m, d] = v.split("-").map(Number);
  // 中国大陆夏令时只实行过 1986–1991;不在窗口内的人不该看到这个选项
  const inWindow = inDstWindow(y, m, d);
  $("f-dst-row").hidden = !inWindow;
  ($("f-dst") as HTMLInputElement).checked = inWindow;
}

// ---------------- 排盘 ----------------

function gatherInput(): FortuneInput {
  const req = requiresOf(checkedIds());
  const input: FortuneInput = { nowMs: Date.now() };
  if (req.has("birth") || req.has("time")) input.birth = birthFrom("f");
  if (req.has("partner")) input.partner = birthFrom("p");
  // 提问框对任何模块都开放(不限于问事类),空着就不发
  const q = ($("f-question") as HTMLTextAreaElement).value.trim();
  if (q) input.question = q;
  if (req.has("period") && ($("f-period-from") as HTMLInputElement).value) {
    input.period = {
      from: ($("f-period-from") as HTMLInputElement).value,
      to: ($("f-period-to") as HTMLInputElement).value || ($("f-period-from") as HTMLInputElement).value,
    };
  }
  if (req.has("name")) {
    input.name = {
      surname: ($("f-surname") as HTMLInputElement).value.trim(),
      given: ($("f-given") as HTMLInputElement).value.trim(),
    };
  }
  if (req.has("zeday") && ($("f-zeday-from") as HTMLInputElement).value) {
    input.zeday = {
      from: ($("f-zeday-from") as HTMLInputElement).value,
      to: ($("f-zeday-to") as HTMLInputElement).value || ($("f-zeday-from") as HTMLInputElement).value,
      event: ($("f-zeday-event") as HTMLInputElement).value.trim(),
    };
  }
  if (tosses.length === 6) input.tosses = [...tosses];
  const spread = ($("f-spread") as HTMLSelectElement).value;
  if (spread) input.spread = spread;
  const focus = ($("f-focus") as HTMLSelectElement).value;
  if (focus) input.focus = focus;
  return input;
}

function renderSection(s: Section): HTMLElement {
  const el = document.createElement("div");
  el.className = "f-sec";
  const h = document.createElement("h4");
  h.textContent = s.title;
  el.appendChild(h);
  if (s.warn?.length) {
    const w = document.createElement("div");
    w.className = "f-warn";
    w.textContent = s.warn.join(" ");
    el.appendChild(w);
  }
  if (s.kv?.length) {
    const dl = document.createElement("dl");
    dl.className = "f-kv";
    for (const [k, v] of s.kv) {
      const dt = document.createElement("dt"); dt.textContent = k;
      const dd = document.createElement("dd"); dd.textContent = v;
      dl.append(dt, dd);
    }
    el.appendChild(dl);
  }
  if (s.headers && s.rows) {
    const wrap = document.createElement("div");
    wrap.className = "f-table-wrap";
    const tb = document.createElement("table");
    tb.className = "f-table";
    const thead = tb.createTHead();
    const hr = thead.insertRow();
    for (const c of s.headers) {
      const th = document.createElement("th"); th.textContent = c; hr.appendChild(th);
    }
    const tbody = tb.createTBody();
    for (const r of s.rows) {
      const tr = tbody.insertRow();
      for (const c of r) { const td = tr.insertCell(); td.textContent = c; }
    }
    wrap.appendChild(tb);
    el.appendChild(wrap);
  }
  if (s.text?.length) {
    for (const t of s.text) {
      const p = document.createElement("p");
      p.className = "f-text";
      p.textContent = t;
      el.appendChild(p);
    }
  }
  return el;
}

async function run(withAi: boolean) {
  const ids = checkedIds();
  if (!ids.length) return;
  hideTip();
  const resultBox = $("f-result");
  resultBox.textContent = "";
  $("f-ai-card").hidden = true;
  $("f-hint").textContent = "排盘中…";
  const input = gatherInput();
  try {
    const { sections, errors } = await computeFortune(ids, input);
    $("f-hint").textContent = errors.length ? `完成（${errors.length} 个模块出错）` : "排盘完成 ✓";
    for (const id of ids) {
      const secs = sections[id];
      if (!secs) continue;
      const mod = MODULES.find((m) => m.id === id)!;
      const card = document.createElement("article");
      card.className = "card f-mod";
      const head = document.createElement("h2");
      head.className = "card-head";
      head.textContent = mod.name;
      card.appendChild(head);
      for (const s of secs) card.appendChild(renderSection(s));
      resultBox.appendChild(card);
    }
    for (const e of errors) {
      const p = document.createElement("p");
      p.className = "f-warn";
      p.textContent = e;
      resultBox.appendChild(p);
    }
    resultBox.scrollIntoView({ behavior: "smooth", block: "start" });
    if (withAi && cfg.api) await runAi(ids, input, sections);
  } catch (e) {
    $("f-hint").textContent = `排盘出错: ${(e as Error).message}`;
  }
}

// ---------------- AI 解读(SSE 流式) ----------------

async function runAi(ids: string[], input: FortuneInput, sections: Record<string, Section[]>) {
  const card = $("f-ai-card");
  const box = $("f-ai-text");
  box.textContent = "";
  card.hidden = false;
  card.querySelector(".f-ai-note")!.textContent = "（流式生成中…）";

  // 流式渲染: 累积原文,按帧节流做 Markdown → HTML
  let raw = "";
  let raf = 0;
  const paint = () => {
    raf = 0;
    box.innerHTML = renderMarkdown(raw) + (card.querySelector(".f-ai-note")!.textContent!.includes("生成中") ? '<span class="md-caret"></span>' : "");
  };
  const push = (v: string) => {
    raw += v;
    if (!raf) raf = requestAnimationFrame(paint);
  };

  try {
    const resp = await fetch(cfg.api, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        modules: ids.map((id) => ({ id, name: MODULES.find((m) => m.id === id)?.name ?? id })),
        sections,
        question: input.question ?? "",
        focus: input.focus ?? "",
      }),
    });
    if (!resp.ok || !resp.body) throw new Error(`接口 ${resp.status}`);
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    outer: while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith("data:")) continue;
        const payload = t.slice(5).trim();
        if (payload === "[DONE]") break outer;
        try {
          const evt = JSON.parse(payload);
          if (evt.t === "chunk") push(evt.v);
          if (evt.t === "error") throw new Error(evt.v);
        } catch { /* 非 JSON 行忽略 */ }
      }
    }
    card.querySelector(".f-ai-note")!.textContent = "（完成）";
    box.innerHTML = renderMarkdown(raw);
    card.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) {
    if (raw) box.innerHTML = renderMarkdown(raw);   // 中断也要把已收到的渲染出来
    card.querySelector(".f-ai-note")!.textContent = "（失败）";
    const p = document.createElement("p");
    p.className = "f-warn";
    p.textContent = `AI 解读失败: ${(e as Error).message}。盘面仍可在上方查看——解读功能不依赖本地计算。`;
    card.appendChild(p);
  }
}

// ---------------- 初始化 ----------------

function fillSelects() {
  const month = $("f-lunar-month") as HTMLSelectElement;
  const day = $("f-lunar-day") as HTMLSelectElement;
  for (let i = 1; i <= 12; i++) month.append(new Option(`${i} 月`, String(i)));
  for (let i = 1; i <= 30; i++) day.append(new Option(`${i} 日`, String(i)));
}

function wireEvents() {
  buildCats();
  document.querySelectorAll<HTMLInputElement>("#f-cats input").forEach((el) => el.addEventListener("change", refreshForm));
  ($("f-cal") as HTMLSelectElement).addEventListener("change", (e) => {
    const lunar = (e.target as HTMLSelectElement).value === "lunar";
    $("f-dates-solar").hidden = lunar;
    $("f-dates-lunar").hidden = !lunar;
  });
  ($("f-date") as HTMLInputElement).addEventListener("change", syncDst);
  ($("f-question") as HTMLTextAreaElement).addEventListener("input", refreshForm);
  ($("f-geo-manual") as HTMLInputElement).addEventListener("change", (e) => {
    const on = (e.target as HTMLInputElement).checked;
    $("f-geo-row").hidden = !on;
    ($("f-prov") as HTMLSelectElement).disabled = on;
    ($("f-city") as HTMLSelectElement).disabled = on;
  });

  ($("f-toss-btn") as HTMLButtonElement).addEventListener("click", () => {
    if (tosses.length >= 6) return;
    const v = tossCoins();
    tosses.push(v);
    const names = ["初爻", "二爻", "三爻", "四爻", "五爻", "上爻"];
    $("f-toss-result").textContent = `第 ${tosses.length} 摇（${names[tosses.length - 1]}）：${TOSS_LABEL[v]}   已摇 ${tosses.length}/6`;
    if (tosses.length === 6) {
      ($("f-toss-btn") as HTMLButtonElement).hidden = true;
      ($("f-toss-reset") as HTMLButtonElement).hidden = false;
      $("f-toss-result").textContent = "起卦完成：" + tosses.map((t) => TOSS_LABEL[t]).join("  ");
    }
  });
  ($("f-toss-reset") as HTMLButtonElement).addEventListener("click", () => {
    tosses = [];
    ($("f-toss-btn") as HTMLButtonElement).hidden = false;
    ($("f-toss-reset") as HTMLButtonElement).hidden = true;
    $("f-toss-result").textContent = "未摇铜钱 → 将按当前时间起卦（非正统，信息量打折）";
  });

  ($("f-run") as HTMLButtonElement).addEventListener("click", () => void run(false));
  ($("f-ai") as HTMLButtonElement).addEventListener("click", () => void run(true));
}

async function main() {
  try {
    cfg = await (await fetch("data/config.json", { cache: "no-cache" })).json() as Cfg;
  } catch {
    cfg = { api: "" };
  }
  fillSelects();
  wireEvents();
  if (cfg.api) ($("f-ai") as HTMLButtonElement).hidden = false;
  refreshForm();
}

void main();
