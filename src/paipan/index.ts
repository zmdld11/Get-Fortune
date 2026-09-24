// index.ts — 算命组件模块注册表:五类 28 个模块的统一计算编排
// 所有模块【纯本地计算】,产出结构化盘面 Section;DeepSeek 只做解读不做计算。
import {
  fullChart, positions, lunarPhase, vedicInfo, vimshottari, fmtDeg,
  julianDay, sunPosition, moonPosition, mod360, angdiff, houseOf,
  type FullChart,
} from "./astro";
import {
  fourPillars, solarToLunar, lunarToSolar, gzName, STEMS, BRANCHES, STEM_ELEM,
  BRANCH_ELEM, HIDDEN, NAYIN, SHENG_XIAO, strength, dayun, shensha, liunian,
  stemGod, branchGod, inDstWindow, LIU_HE, LIU_CHONG, LIU_HAI, JIE,
  LUNAR_MONTH_CN, LUNAR_DAY_CN, termJdUtc, type FourPillars,
} from "./bazi";
import { meihuaTimeCast, liuyaoCast, liuyaoTimeCast, type MeihuaCast } from "./divination";
import { numerology, chenggu, kyusei, maya, xiu28 } from "./misc";
import { ziweiChart } from "./ziwei";
import { drawTarot, drawRunes } from "./tarot";
import { wuge } from "./wuge";
import { MODULE_DESCS } from "./descs";

// ---------------- 类型 ----------------

export type Cat = "birth" | "forecast" | "ask" | "relation" | "practical";

export interface BirthInput {
  cal: "solar" | "lunar";
  year: number; month: number; day: number;
  lunarLeap?: boolean;
  timeKnown: boolean; hour: number; minute: number;
  dst: boolean;
  lonE: number; latN: number; tz: number;
  city?: string; timeSource?: string;
  gender: "male" | "female" | "unknown";
}

export interface FortuneInput {
  birth?: BirthInput;
  partner?: BirthInput;
  question?: string;
  focus?: string;               // 学业/事业财运/感情/健康/流年
  period?: { from: string; to: string };      // YYYY-MM-DD
  name?: { surname: string; given: string };
  zeday?: { from: string; to: string; event: string };
  tosses?: number[];            // 六爻摇钱 6-9 ×6(初爻→上爻)
  spread?: string;              // tarot: single/three/celtic
  nowMs?: number;               // C 类起卦时刻
}

export interface Section {
  title: string;
  headers?: string[]; rows?: string[][];
  kv?: [string, string][];
  text?: string[];
  warn?: string[];
}

export interface ComputeCtx {
  input: FortuneInput;
  nowMs: number;
}

export interface ModuleDef {
  id: string; name: string; cat: Cat;
  /** 需要的输入: birth=本人出生信息 time=出生时间 partner=双人 question=问题 */
  requires: string[];
  /** 技术口径(一行,浮窗副行小字) */
  note?: string;
  /** 白话解释: 这套系统是什么、能看出什么(悬浮浮窗主文案,见 descs.ts) */
  desc?: string;
  compute(ctx: ComputeCtx): Section[] | Promise<Section[]>;
}

export const CATS: { id: Cat; name: string; hint: string }[] = [
  { id: "birth", name: "出生盘", hint: "需要生日+时间+出生地+性别" },
  { id: "forecast", name: "推运", hint: "出生数据 + 关注时间段" },
  { id: "ask", name: "问事占卜", hint: "一个具体问题,时间起卦用当前时刻" },
  { id: "relation", name: "关系合盘", hint: "需要双方出生数据" },
  { id: "practical", name: "实用", hint: "择日/起名评分" },
];

// ---------------- 输入解析 ----------------

export interface ResolvedBirth {
  y: number; m: number; d: number; hh: number; mm: number;
  lonE: number; latN: number; tz: number; gender: string;
  timeKnown: boolean; city?: string; timeSource?: string;
  lunar: { year: number; month: number; isLeap: boolean; day: number };
  dstApplied: boolean; jd: number; birthSolarJd: number; hourIdx: number;
  fp: FourPillars; notes: string[];
}

/** 农历→公历(用同一张经锚点验证的表反查),夏令时修正,统一出口 */
export function resolveBirth(b: BirthInput): ResolvedBirth {
  const notes: string[] = [];
  let y = b.year, m = b.month, d = b.day;
  if (b.cal === "lunar") {
    const solar = lunarToSolar(b.year, b.month, b.day, !!b.lunarLeap);
    y = solar.y; m = solar.m; d = solar.d;
    notes.push(`农历${b.lunarLeap ? "闰" : ""}${LUNAR_MONTH_CN[b.month - 1]}月${LUNAR_DAY_CN[b.day - 1]} → 公历 ${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  }
  let hh = b.timeKnown ? b.hour : 12;
  const mm = b.timeKnown ? b.minute : 0;
  let dstApplied = false;
  if (b.dst) {  // 是否按夏令时修正由 UI 预判(inDstWindow)后用户确认,计算端只认该开关
    hh -= 1; dstApplied = true;
    notes.push("已按中国大陆 1986–1991 夏季夏令时处理:钟表时间减 1 小时");
  }
  const lunar = solarToLunar(y, m, d);
  const fp = fourPillars(y, m, d, hh, mm, b.lonE, b.tz, b.gender === "female" ? "female" : "male");
  const jd = julianDay(y, m, d, hh + mm / 60 - b.tz);
  if (!b.timeKnown) notes.push("未提供出生时间:上升/宫位/时柱/紫微不可算,相关结果按正午估计仅供参考");
  if (b.timeSource === "rough") notes.push("时间来源为大概估计:请留意时辰贴边风险");
  return {
    y, m, d, hh, mm, lonE: b.lonE, latN: b.latN, tz: b.tz,
    gender: b.gender, timeKnown: b.timeKnown, city: b.city, timeSource: b.timeSource,
    lunar, dstApplied, jd, birthSolarJd: fp.birthSolarJd, hourIdx: fp.hourIdx, fp, notes,
  };
}

function section(title: string, s: Partial<Section>): Section {
  return { title, ...s };
}

const SIGN_RULER: Record<string, string> = {
  "白羊": "火星", "金牛": "金星", "双子": "水星", "巨蟹": "月亮", "狮子": "太阳",
  "处女": "水星", "天秤": "金星", "天蝎": "冥王星", "射手": "木星", "摩羯": "土星",
  "水瓶": "天王星", "双鱼": "海王星",
};

function signOf(lon: number): string {
  const s = Math.floor(mod360(lon) / 30);
  return ["白羊", "金牛", "双子", "巨蟹", "狮子", "处女", "天秤", "天蝎", "射手", "摩羯", "水瓶", "双鱼"][s];
}

// ---------------- A. 出生盘类 ----------------

const western: ModuleDef = {
  id: "western", name: "西方占星本命盘", cat: "birth",
  requires: ["birth", "time"], note: "精确黄经/Placidus宫位/相位/月相/福点",
  compute(ctx) {
    const b = resolveBirth(ctx.input.birth!);
    const c = fullChart(b.y, b.m, b.d, b.hh, b.mm, b.latN, b.lonE, b.tz, "本命");
    const rows = Object.entries(c.pos).map(([k, [lon, rx]]) =>
      [k, fmtDeg(lon), String(c.houses[k]), rx ? "℞" : ""]);
    const secs: Section[] = [
      section("口径", {
        kv: [
          ["出生", `${b.y}-${String(b.m).padStart(2, "0")}-${String(b.d).padStart(2, "0")} ${String(b.hh).padStart(2, "0")}:${String(b.mm).padStart(2, "0")}${b.city ? ` ${b.city}` : ""}`],
          ["坐标/时区", `东经${b.lonE}° 北纬${b.latN}° UTC+${b.tz}`],
          ["JD(UT)", c.jd.toFixed(4)],
        ],
        warn: b.notes,
      }),
      section("星体落座落宫", { headers: ["星体", "黄经", "宫位", "逆行"], rows }),
      section("四轴与宫头", {
        kv: [
          ["上升 ASC", fmtDeg(c.axes["上升"])], ["天顶 MC", fmtDeg(c.axes["天顶"])],
          ["宫头 1-12", c.cusps.map(fmtDeg).join(" · ")],
        ],
        warn: c.houseWarn ?? [],
      }),
      section("相位(按容许度)", {
        headers: ["星1", "相位", "星2", "实际夹角", "容许"],
        rows: c.aspects.map((a) => [a.n1, a.name, a.n2, `${a.sep.toFixed(2)}°`, `${a.orb.toFixed(2)}°`]),
      }),
      section("其他", {
        kv: [
          ["月相", `${c.phase.name}(距角${c.phase.elong.toFixed(1)}°,照度${Math.round(c.phase.illum * 100)}%)`],
          ["福点", fmtDeg(c.pof)],
          ["昼夜", `${c.isDay ? "昼" : "夜"}盘(太阳高度${c.altSun.toFixed(1)}°)`],
        ],
      }),
      section("关键结构证据", { text: westernEvidence(c) }),
    ];
    if (!b.timeKnown) {
      // 无时间: 宫位/四轴不可信,保留行星落座与相位
      secs.splice(1, 0, section("⚠ 无出生时间", { text: ["四轴/宫位/宫头按正午计算不可信,请忽略上述宫位列;行星落座与相位仍有效"] }));
    }
    return secs;
  },
};

function westernEvidence(c: FullChart): string[] {
  const out: string[] = [];
  const ascSign = signOf(c.axes["上升"]);
  out.push(`命主星: 上升${ascSign} → 主星${SIGN_RULER[ascSign]}(落${signOf(c.pos[SIGN_RULER[ascSign]]?.[0] ?? 0)}${c.houses[SIGN_RULER[ascSign]] ? ` ${c.houses[SIGN_RULER[ascSign]]}宫` : ""})`);
  const strong = c.aspects.filter((a) => a.orb < 3).slice(0, 3);
  if (strong.length) out.push(`最强相位(容许<3°): ${strong.map((a) => `${a.n1}${a.name}${a.n2}(差${a.orb.toFixed(1)}°)`).join("、")}`);
  const bySign: Record<string, number> = {};
  for (const [k, [lon]] of Object.entries(c.pos)) {
    if (["北交点"].includes(k)) continue;
    const s = signOf(lon);
    bySign[s] = (bySign[s] ?? 0) + 1;
  }
  const stell = Object.entries(bySign).filter(([, n]) => n >= 3);
  if (stell.length) out.push(`星群(≥3星同座): ${stell.map(([s, n]) => `${s}${n}颗`).join("、")}`);
  const elemCnt: Record<string, number> = { 火: 0, 土: 0, 风: 0, 水: 0 };
  const elemOf = ["火", "土", "风", "水"];
  for (const k of ["太阳", "月亮", "水星", "金星", "火星"]) {
    elemCnt[elemOf[Math.floor(mod360(c.pos[k][0]) / 30) % 4]]++;
  }
  out.push(`日月水金火四元素: 火${elemCnt["火"]} 土${elemCnt["土"]} 风${elemCnt["风"]} 水${elemCnt["水"]}`);
  return out;
}

const vedic: ModuleDef = {
  id: "vedic", name: "印度占星(恒星制)", cat: "birth",
  requires: ["birth"], note: "sidereal落座/27宿/Vimshottari大运",
  compute(ctx) {
    const b = resolveBirth(ctx.input.birth!);
    const jd = julianDay(b.y, b.m, b.d, b.hh + b.mm / 60 - b.tz);
    const rows: string[][] = [];
    for (const [k, lon] of [["太阳", sunPosition(jd)], ["月亮", moonPosition(jd)[0]], ["上升点(需时间)", 0]] as [string, number][]) {
      if (k.startsWith("上升")) {
        if (!b.timeKnown) { rows.push([k, "—(无时间不可算)", "—", "—"]); continue; }
        const c = fullChart(b.y, b.m, b.d, b.hh, b.mm, b.latN, b.lonE, b.tz);
        const v = vedicInfo(c.axes["上升"], jd);
        rows.push([k, `${fmtDeg(v.sid)}(恒星制)`, v.nakshatra, `${v.pada}步`]);
        continue;
      }
      const v = vedicInfo(lon, jd);
      rows.push([k, `${fmtDeg(v.sid)}(恒星制)`, v.nakshatra, `${v.pada}步`]);
    }
    const moonSid = vedicInfo(moonPosition(jd)[0], jd).sid;
    const dasha = vimshottari(moonSid, jd)
      .map(([lord, yr]) => `${lord}@${yr.toFixed(0)}`).join(" → ");
    return [
      section("口径", { kv: [["岁差", "Lahiri"]], warn: b.notes }),
      section("恒星制落座", { headers: ["点", "黄经", "27宿", "步"], rows }),
      section("Vimshottari 大运", { text: [dasha] }),
    ];
  },
};

const bazi4: ModuleDef = {
  id: "bazi", name: "八字四柱", cat: "birth",
  requires: ["birth"], note: "真太阳时/十神/旺衰/大运/神煞/流年",
  compute(ctx) {
    const b = resolveBirth(ctx.input.birth!);
    const fp = b.fp;
    const [py, pm, pd, ph] = fp.pillars;
    const ds = pd % 10;
    const secs: Section[] = [
      section("口径", {
        kv: [
          ["真太阳时", `${Math.floor(fp.tst).toString().padStart(2, "0")}:${((fp.tst % 1) * 60).toFixed(0).padStart(2, "0")}(均时差${fp.eot >= 0 ? "+" : ""}${fp.eot.toFixed(1)}分)`],
          ["农历", `${gzName((b.lunar.year - 4 + 240) % 60)[0]}年 ${b.lunar.isLeap ? "闰" : ""}${LUNAR_MONTH_CN[b.lunar.month - 1]}月${LUNAR_DAY_CN[b.lunar.day - 1]}`],
          ["八字年", `${fp.baziYear}(${fp.nightZi ? "晚子时,日柱已进一天" : "平常"})`],
        ],
        warn: [...b.notes, ...fp.warnings],
      }),
      section("四柱", {
        headers: ["", "年柱", "月柱", "日柱", "时柱"],
        rows: [
          ["干支", ...fp.pillars.map(gzName)],
          ["十神", ...[stemGod(ds, py % 10), stemGod(ds, pm % 10), "日主", stemGod(ds, ph % 10)]],
          ["藏干", ...fp.pillars.map((p) => HIDDEN[BRANCHES[p % 12]].join("、"))],
          ["支十神", ...fp.pillars.map((p) => branchGod(ds, p % 12))],
          ["纳音", ...fp.pillars.map((p) => NAYIN[Math.floor(p / 2)])],
        ],
      }),
    ];
    const st = strength(ds, fp.pillars);
    secs.push(section("旺衰(启发式,需人工复核)", {
      kv: [
        ["同党占比", `${Math.round(st.ratio * 100)}% → ${st.ratio >= 0.55 ? "身强" : st.ratio <= 0.45 ? "身弱" : "中和"}`],
        ["得令/得根/得势", `${st.deLing ? "是" : "否"} / ${st.deDi ? "是" : "否"} / ${st.deShi ? "是" : "否"}`],
      ],
    }));
    const [dys, start, fwd] = dayun(pm, py, b.gender === "female" ? "female" : "male", fp.birthSolarJd, b.y);
    secs.push(section(`大运(${fwd ? "顺行" : "逆行"},约${start.toFixed(1)}岁起运)` , {
      headers: ["干支", "干/支十神", "年龄段"],
      rows: dys.map((gz, i) => [
        gzName(gz),
        `${stemGod(ds, gz % 10)}/${branchGod(ds, gz % 12)}`,
        `${Math.floor(start + i * 10)}-${Math.floor(start + (i + 1) * 10)}岁`,
      ]),
    }));
    const ss = shensha(fp.pillars);
    const ssKv: [string, string][] = Object.entries(ss).filter(([, v]) => v.length).map(([k, v]) => [k, v.join("、")]);
    if (ssKv.length) secs.push(section("神煞(辅助证据)", { kv: ssKv }));
    const cur = new Date().getFullYear();
    const lnRows: string[][] = [];
    for (let yy = cur; yy < cur + 4; yy++) {
      const [name, rel] = liunian(fp.pillars, yy);
      lnRows.push([String(yy), name, rel.length ? rel.join("、") : "无刑冲合害"]);
    }
    secs.push(section("近四年流年", { headers: ["年份", "干支", "与原局关系"], rows: lnRows }));
    return secs;
  },
};

const ziweiM: ModuleDef = {
  id: "ziwei", name: "紫微斗数", cat: "birth",
  requires: ["birth", "time"], note: "12宫/14主星/四化/大限",
  compute(ctx) {
    const b = resolveBirth(ctx.input.birth!);
    if (!b.timeKnown) return [section("⚠ 需要出生时间", { text: ["紫微斗数安星必须用到时辰,请补齐出生时间(精确到时分)"] })];
    const z = ziweiChart(b.y, b.m, b.d, b.hourIdx, b.gender);
    return [
      section("口径", {
        kv: [
          ["命宫", `${z.palaces[0].stem}${z.palaces[0].branch}`],
          ["身宫", `${BRANCHES[z.shenIdx]}`],
          ["五行局", z.juName],
          ["年干支", z.yearGz],
        ],
        text: [z.sihuaNote, ...(z.leapAdjusted ? [`⚠ 闰月生人按"十五为界"取${z.effectiveMonth}月(各派有异)`] : [])],
        warn: b.notes,
      }),
      section("十二宫", {
        headers: ["宫位", "干支", "主星与辅星", "大限"],
        rows: z.palaces.map((p) => [
          p.name + (p.name === "命宫" ? "" : ""),
          `${p.stem}${p.branch}`,
          (p.stars.length ? p.stars.join(" ") : "—") + (p.isShen ? " [身宫]" : ""),
          p.majorLimit ?? "",
        ]),
      }),
      section("四化(全书版)", {
        kv: Object.entries(z.sihua).map(([star, t]) => [`${star}化${t}`, "—"]),
      }),
    ];
  },
};

const meihuaLife: ModuleDef = {
  id: "meihua_life", name: "梅花易数终身卦", cat: "birth",
  requires: ["birth", "time"], note: "时间起卦,只谈大格局倾向",
  compute(ctx) {
    const b = resolveBirth(ctx.input.birth!);
    const yzhi = (((b.lunar.year - 4) % 12) + 12) % 12 + 1;
    const cast = meihuaTimeCast(yzhi, b.lunar.month, b.lunar.day, b.hourIdx + 1);
    return meihuaSections(cast, b.notes);
  },
};

function meihuaSections(cast: MeihuaCast, notes: string[]): Section[] {
  return [
    section("卦象", {
      kv: [
        ["本卦", `${cast.name}(上${["乾", "兑", "离", "震", "巽", "坎", "艮", "坤"][cast.up - 1]}下${["乾", "兑", "离", "震", "巽", "坎", "艮", "坤"][cast.low - 1]})`],
        ["动爻", `第${cast.moving}爻`],
        ["互卦", cast.huName],
        ["变卦", cast.changedName],
        ["体用", `${cast.tiElem}体 / ${cast.yongElem}用`],
        ["体用关系", cast.tiYongRel],
      ],
      text: ["六爻(自下而上): " + cast.ben.map((v) => (v ? "▀▀▀" : "▀▀ ▀")).join(" ")],
      warn: notes,
    }),
  ];
}

const numerologyM: ModuleDef = {
  id: "numerology", name: "生命数字", cat: "birth",
  requires: ["birth"], note: "娱乐级开场甜点,颗粒度极粗",
  compute(ctx) {
    const b = resolveBirth(ctx.input.birth!);
    const n = numerology(b.y, b.m, b.d);
    return [section("生命数字", {
      kv: [
        ["生命路数", `${n.lifePath}(${n.lifePathMeaning})`],
        ["生日数", `${n.birthday}(${n.birthdayMeaning})`],
      ],
      text: ["⚠ 数字系统颗粒度极粗,只作开场参考,不下重大结论"],
      warn: b.notes,
    })];
  },
};

const chengguM: ModuleDef = {
  id: "chenggu", name: "称骨算命", cat: "birth",
  requires: ["birth", "time"], note: "骨重+中性概括,不引歌诀",
  compute(ctx) {
    const b = resolveBirth(ctx.input.birth!);
    const cg = chenggu(b.y, b.m, b.d, b.hourIdx);
    return [section("称骨(袁天罡)", {
      kv: [
        ["总骨重", `${cg.total} 两`],
        ["构成", `年${cg.yearW}(${cg.yearGz}) + 月${cg.monthW} + 日${cg.dayW} + 时${cg.hourW}`],
        ["概括", cg.summary],
      ],
      text: ["⚠ 民俗系统;歌诀原文各版本有异,此处不给歌诀只给骨重与中性概括"],
      warn: b.notes,
    })];
  },
};

const kyuseiM: ModuleDef = {
  id: "kyusei", name: "日本九星气学", cat: "birth",
  requires: ["birth"], note: "本命星",
  compute(ctx) {
    const b = resolveBirth(ctx.input.birth!);
    const k = kyusei(b.y, b.m, b.d);
    return [section("九星本命星", {
      kv: [
        ["本命星", k.name],
        ["计算", `${k.usedYear}年${k.beforeLichun ? "(立春前算前一年)" : ""}`],
      ],
      warn: b.notes,
    })];
  },
};

const mayaM: ModuleDef = {
  id: "maya", name: "玛雅历 Tzolk'in", cat: "birth",
  requires: ["birth"], note: "传统计数(非 Dreamspell)",
  compute(ctx) {
    const b = resolveBirth(ctx.input.birth!);
    const my = maya(b.y, b.m, b.d);
    return [section("玛雅卓尔金历", {
      kv: [
        ["太阳印记", `${my.num} ${my.day}(${my.cn})`],
        ["卓尔金历日序", `第 ${my.kin} 日(以 1 Imix 为第 1 日)`],
      ],
      text: ["⚠ 新时代 Dreamspell 与传统计数相差约两年,本结果为传统计数"],
      warn: b.notes,
    })];
  },
};

const xiu28M: ModuleDef = {
  id: "xiu28", name: "二十八宿", cat: "birth",
  requires: ["birth", "time"], note: "按出生时月亮所在宿(等分简化口径)",
  compute(ctx) {
    const b = resolveBirth(ctx.input.birth!);
    const jd = julianDay(b.y, b.m, b.d, b.hh + b.mm / 60 - b.tz);
    const x = xiu28(moonPosition(jd)[0], jd);
    return [section("二十八宿(天文口径)", {
      kv: [
        ["值宿", `${x.xiu}宿(${x.xiang})`],
        ["月亮恒星黄经", `${x.sid.toFixed(2)}°`],
      ],
      text: ["⚠ 简化等分口径;古制各宿宽度不等"],
      warn: b.notes,
    })];
  },
};

// ---------------- B. 推运类 ----------------

const SLOW = ["木星", "土星", "天王星", "海王星", "冥王星"];

const transits: ModuleDef = {
  id: "transits", name: "行运盘", cat: "forecast",
  requires: ["birth", "time", "period"], note: "慢行星过四轴/合本命星的时间窗",
  compute(ctx) {
    const b = resolveBirth(ctx.input.birth!);
    const natal = fullChart(b.y, b.m, b.d, b.hh, b.mm, b.latN, b.lonE, b.tz);
    const from = julianDay(...(ctx.input.period!.from.split("-").map(Number) as [number, number, number]), 0);
    const to = julianDay(...(ctx.input.period!.to.split("-").map(Number) as [number, number, number]), 0);
    // 触发点: 本命四轴 + 个人星体(日月水金火)
    const targets: [string, number][] = [
      ["上升", natal.axes["上升"]], ["天顶", natal.axes["天顶"]],
      ...Object.entries(natal.pos).filter(([k]) => ["太阳", "月亮", "水星", "金星", "火星", "木星", "土星"].includes(k)).map(([k, v]) => [k, v[0]] as [string, number]),
    ];
    const hits: { jd: number; tp: string; planet: string; aspect: string }[] = [];
    for (let jd = from; jd <= to; jd += 1) {
      const pos = positions(jd);
      for (const p of SLOW) {
        for (const [tp, lon] of targets) {
          const sep = Math.abs(angdiff(pos[p][0], lon));
          for (const [nm, adeg] of [["合相", 0], ["刑相", 90], ["拱相", 120], ["对冲", 180]] as [string, number][]) {
            const orb = tp === "上升" || tp === "天顶" ? 2 : 1;
            if (Math.abs(sep - adeg) < orb / 30) {  // ≈1天内精确
              hits.push({ jd, tp, planet: p, aspect: nm });
            }
          }
        }
      }
    }
    // 去重: 同一触发在约20天桶内只留首次
    const seen = new Set<string>();
    const rows: string[][] = [];
    const jdToDate = (jd: number) => {
      const z = new Date((jd + 0.5 - 2440587.5) * 86400000 + 8 * 3600000);
      return z.toISOString().slice(0, 10);
    };
    for (const h of hits.sort((a, b2) => a.jd - b2.jd)) {
      const bucket = Math.floor(h.jd / 20);
      const k2 = `${h.planet}|${h.tp}|${h.aspect}|${bucket}`;
      if (seen.has(k2)) continue;
      seen.add(k2);
      rows.push([jdToDate(h.jd), `${h.planet} ${h.aspect} 本命${h.tp}`]);
      if (rows.length >= 40) break;
    }
    const now = positions(ctx.nowMs / 86400000 + 2440587.5);
    const nowRows = SLOW.map((p) => [p, fmtDeg(now[p][0]), now[p][1] ? "℞" : ""]);
    return [
      section("口径", {
        kv: [["行运黄经来源", "同一套自实现星历(与Python脚本一致)"], ["触发阈值", "四轴±2°/个人星±1°(经验口径)"]],
        warn: b.notes,
      }),
      section("当前慢行星位置", { headers: ["行星", "黄经", "逆行"], rows: nowRows }),
      section(`行运时间窗 ${ctx.input.period!.from} ~ ${ctx.input.period!.to}`, {
        headers: ["日期(±1天)", "触发"],
        rows: rows.length ? rows : [["(区间内无精确触发)", "—"]],
      }),
    ];
  },
};

const progressions: ModuleDef = {
  id: "progressions", name: "次限推进", cat: "forecast",
  requires: ["birth", "time"], note: "1天=1年;只看日月水金",
  compute(ctx) {
    const b = resolveBirth(ctx.input.birth!);
    const natalJd = julianDay(b.y, b.m, b.d, b.hh + b.mm / 60 - b.tz);
    const age = (ctx.nowMs - Date.UTC(b.y, b.m - 1, b.d)) / (365.2422 * 86400000);
    const pjds = [Math.floor(age), Math.floor(age) + 1].map((n) => natalJd + n * 365.2422);
    const rows: string[][] = [];
    for (const [i, pjd] of pjds.entries()) {
      const pos = positions(pjd);
      for (const p of ["太阳", "月亮", "水星", "金星"]) {
        rows.push([`${Math.floor(age) + i}岁`, p, fmtDeg(pos[p][0]), `${signOf(pos[p][0])}`]);
      }
    }
    const natalPos = positions(natalJd);
    const pSun = positions(pjds[0])["太阳"][0], pMoon = positions(pjds[0])["月亮"][0];
    const nSun = natalPos["太阳"][0];
    return [
      section("口径", { kv: [["规则", "出生后1天=1年"]], warn: b.notes }),
      section("当前与次岁次限位置", { headers: ["年龄", "星体", "黄经", "落座"], rows }),
      section("次限日月相位(本命太阳为基准)", {
        kv: [["次限太阳-本命太阳", `${angdiff(pSun, nSun).toFixed(1)}°`], ["次限日月距角", `${angdiff(pMoon, pSun).toFixed(1)}°`]],
        text: ["次限日月合/冲(约29.5年周期)是人生大节点"],
      }),
    ];
  },
};

const profection: ModuleDef = {
  id: "profection", name: "小限法", cat: "forecast",
  requires: ["birth", "time"], note: "年宫=(年龄 mod 12)+1",
  compute(ctx) {
    const b = resolveBirth(ctx.input.birth!);
    const c = fullChart(b.y, b.m, b.d, b.hh, b.mm, b.latN, b.lonE, b.tz);
    const age = Math.floor((ctx.nowMs - Date.UTC(b.y, b.m - 1, b.d)) / (365.2422 * 86400000));
    const house = (age % 12) + 1;
    const cusp = c.cusps[house - 1];
    const sign = signOf(cusp);
    const lord = SIGN_RULER[sign];
    const themes: Record<number, string> = { 1: "自身", 7: "关系", 4: "家业", 10: "事业" };
    return [section("小限法(年度主题)", {
      kv: [
        [`本命年(${age}岁)`, `第${house}宫(自上升起算)`],
        ["年宫落座/主星", `${sign} → ${lord}`],
        ["主题", themes[house] ?? "一般年份"],
      ],
      text: ["与行运叠加才给强结论:小限X宫+行运土星压该宫主 = 双重验证"],
      warn: b.notes,
    })];
  },
};

const firdaria: ModuleDef = {
  id: "firdaria", name: "法达", cat: "forecast",
  requires: ["birth", "time"], note: "昼生从太阳起,夜生从月亮起(经验系统)",
  compute(ctx) {
    const b = resolveBirth(ctx.input.birth!);
    const c = fullChart(b.y, b.m, b.d, b.hh, b.mm, b.latN, b.lonE, b.tz);
    const seq: [string, number][] = c.isDay
      ? [["日", 7], ["金", 8], ["水", 13], ["月", 9], ["土", 11], ["木", 12], ["火", 7], ["北交", 2], ["南交", 2]]
      : [["月", 9], ["土", 11], ["木", 12], ["火", 7], ["北交", 2], ["南交", 2], ["日", 10], ["金", 8], ["水", 13]];
    const birth = Date.UTC(b.y, b.m - 1, b.d);
    const age = (ctx.nowMs - birth) / (365.2422 * 86400000);
    const rows: string[][] = [];
    let acc = 0;
    for (const [name, yrs] of seq) {
      const s = acc, e = acc + yrs;
      if ((age >= s - 1 && age <= e + 1) || rows.length < 2) {
        rows.push([`${s}-${e}岁`, `${name}主限`, age >= s && age < e ? "← 当前" : ""]);
      }
      acc = e;
      if (acc > age + 15 && rows.length > 3) break;
    }
    return [section("法达主限", {
      headers: ["年龄段", "主星", "状态"], rows,
      text: ["期内子限按 Chaldean 序轮流(此处略),解释对应星体本命状态;经验系统"],
      warn: b.notes,
    })];
  },
};

const solarReturn: ModuleDef = {
  id: "solar_return", name: "太阳返照盘", cat: "forecast",
  requires: ["birth"], note: "年运(生日到生日),坐标用出生地简化",
  compute(ctx) {
    const b = resolveBirth(ctx.input.birth!);
    const natalJd = julianDay(b.y, b.m, b.d, b.hh + b.mm / 60 - b.tz);
    const natalSun = sunPosition(natalJd);
    const thisYear = new Date(ctx.nowMs).getFullYear();
    let srJd: number | null = null;
    for (const yy of [thisYear, thisYear - 1]) {
      let lo = julianDay(yy, b.m, b.d, 0) - 2, hi = lo + 4;
      for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2;
        if (angdiff(sunPosition(mid), natalSun) > 0) hi = mid; else lo = mid;
        if (hi - lo < 1e-6) break;
      }
      const cand = (lo + hi) / 2;
      if (cand <= ctx.nowMs / 86400000 + 2440587.5) srJd = cand;
    }
    if (srJd === null) return [section("错误", { text: ["太阳返照时刻计算失败"] })];
    // 返照时刻 → 当地钟表时间 → 整盘重排(秒级传入保证ASC精度)
    const [ly, lm, ld, lh, lmi, lsec] = jdToLocal(srJd, b.tz);
    const c = fullChart(ly, lm, ld, lh + lmi / 60 + lsec / 3600, 0, b.latN, b.lonE, b.tz);
    const rows = Object.entries(c.pos).map(([k, [lon, rx]]) => [k, fmtDeg(lon), String(c.houses[k]), rx ? "℞" : ""]);
    return [
      section("口径", {
        kv: [
          ["返照时刻(当地)", `${ly}-${String(lm).padStart(2, "0")}-${String(ld).padStart(2, "0")} ${String(lh).padStart(2, "0")}:${String(lmi).padStart(2, "0")}:${String(Math.round(lsec)).padStart(2, "0")}`],
          ["坐标", `用出生地坐标(现居地不同则上升/宫位会变,东经${b.lonE}° 北纬${b.latN}°)`],
        ],
        warn: b.notes,
      }),
      section("返照盘", { headers: ["星体", "黄经", "宫位", "逆行"], rows }),
      section("解读重点", { text: [`返照ASC ${fmtDeg(c.axes["上升"])} / MC ${fmtDeg(c.axes["天顶"])}`, "只看:ASC、MC、日月合相所在宫、四轴附近星、命主星去向;有效期到下个生日"] }),
    ];
  },
};

/** JD → 当地钟表时间 [年,月,日,时,分,秒] */
function jdToLocal(jdUtc: number, tz: number): [number, number, number, number, number, number] {
  const ms = (jdUtc - 2440587.5) * 86400000 + tz * 3600000;
  const d = new Date(ms);
  return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds() + d.getUTCMilliseconds() / 1000];
}

const baziLiunian: ModuleDef = {
  id: "bazi_liunian", name: "八字流年", cat: "forecast",
  requires: ["birth"], note: "干支刑冲合害 + 大运叠加",
  compute(ctx) {
    const b = resolveBirth(ctx.input.birth!);
    const fp = b.fp;
    const cur = new Date(ctx.nowMs).getFullYear();
    const rows: string[][] = [];
    for (let yy = cur; yy < cur + 6; yy++) {
      const [name, rel] = liunian(fp.pillars, yy);
      rows.push([String(yy), name, rel.length ? rel.join("、") : "无刑冲合害"]);
    }
    const [dys, start, fwd] = dayun(fp.pillars[1], fp.pillars[0], b.gender === "female" ? "female" : "male", fp.birthSolarJd, b.y);
    const age = cur - b.y;
    const di = Math.max(0, Math.min(7, Math.floor((age - start) / 10)));
    const curDayun = age >= start ? gzName(dys[Math.min(di, dys.length - 1)]) : "未起运";
    return [
      section("当前大运", { kv: [["大运", `${curDayun}(${fwd ? "顺" : "逆"}行)`]] }),
      section("未来六年流年", { headers: ["年份", "干支", "与原局关系"], rows, warn: b.notes }),
    ];
  },
};

const ziweiDayun: ModuleDef = {
  id: "ziwei_dayun", name: "紫微大限流年", cat: "forecast",
  requires: ["birth", "time"], note: "当前大限宫 + 流年宫",
  compute(ctx) {
    const b = resolveBirth(ctx.input.birth!);
    if (!b.timeKnown) return [section("⚠ 需要出生时间", { text: ["紫微需要时辰"] })];
    const z = ziweiChart(b.y, b.m, b.d, b.hourIdx, b.gender);
    const age = new Date(ctx.nowMs).getFullYear() - b.y;
    const cur = z.palaces.find((p) => {
      if (!p.majorLimit) return false;
      const [s, e] = p.majorLimit.split("-").map(Number);
      return age >= s && age <= e;
    });
    const yearBranch = BRANCHES[(new Date(ctx.nowMs).getFullYear() - 4 + 960) % 60 % 12];
    const yearPalace = z.palaces.find((p) => p.branch === yearBranch);
    return [
      section("大限流曜", {
        kv: [
          [`虚岁 ${age}`, cur ? `大限在 ${cur.name}(${cur.stem}${cur.branch}, ${cur.majorLimit})` : "未入大限"],
          ["流年宫", yearPalace ? `${new Date(ctx.nowMs).getFullYear()}年 → ${yearPalace.name}(${yearPalace.branch}) 星: ${yearPalace.stars.join(" ") || "—"}` : "—"],
        ],
        text: ["行运优先级: 当前大限宫的四化+主星重于本命"],
        warn: b.notes,
      }),
    ];
  },
};

// ---------------- C. 问事占卜类 ----------------

function nowLocal(ctx: ComputeCtx) {
  const d = new Date(ctx.nowMs);
  const tz = -d.getTimezoneOffset() / 60;
  return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate(), hh: d.getHours(), mm: d.getMinutes(), tz };
}

const liuyaoM: ModuleDef = {
  id: "liuyao", name: "六爻纳甲", cat: "ask",
  requires: ["question"], note: "网页摇铜钱最正统;无钱用时间起卦(声明非正统)",
  compute(ctx) {
    // 六兽按当日日干起(青龙/朱雀/勾陈/腾蛇/白虎/玄武)
    const { y, m, d, hh, mm, tz } = nowLocal(ctx);
    const lonE = 15 * tz;
    const fpNow = fourPillars(y, m, d, hh, mm, lonE);
    const dayStem = STEMS[fpNow.pillars[2] % 10];
    let cast, warn: string[] = [];
    if (ctx.input.tosses && ctx.input.tosses.length === 6) {
      cast = liuyaoCast(ctx.input.tosses, dayStem);
    } else {
      cast = liuyaoTimeCast(y, m, d, hh, mm, lonE);
      warn.push("⚠ 未摇铜钱,采用时间起卦——非正统,信息量打折");
    }
    warn.push(`六兽按当日日干「${dayStem}」起`);
    // lines[0..5] = 初爻→上爻;显示自上而下,标签按爻序号取(勿用倒序标签数组——Python 报表层曾在此错位)
    const labels = ["初爻", "二爻", "三爻", "四爻", "五爻", "上爻"];
    const rows: string[][] = [];
    for (let i = 5; i >= 0; i--) {
      const [liuqin, ganzhi] = cast.lines[i];
      const marks: string[] = [];
      if (cast.movers.includes(i + 1)) marks.push(cast.bits[i] === 1 ? "老阳○动" : "老阴×动");
      if (i + 1 === cast.world) marks.push("世");
      if (i + 1 === (cast.world + 2) % 6 + 1) marks.push("应");
      rows.push([labels[i], cast.beasts?.[i] ?? "", liuqin, ganzhi, marks.join(" ")]);
    }
    return [
      section("所问之事", { kv: [["问题", ctx.input.question ?? "(未填)"]], warn: [...warn] }),
      section(`本卦 ${cast.name} [${cast.palace}宫·${cast.typ}]`, {
        headers: ["爻位", "六兽", "六亲", "干支", "标记"], rows,
      }),
      section("变卦与断卦提示", {
        kv: [["变卦", cast.changedName ?? "(无动爻)"]],
        text: [
          "取用神: 自身/事体成败看世爻;求财妻财;婚姻男看妻财女看官鬼;官司官鬼;考试文书父母;子女晚辈子孙。",
          "断卦步骤: 用神旺衰(月建日辰生扶?) → 动爻与用神生克 → 世应关系 → 变卦定结局。",
        ],
      }),
    ];
  },
};

const meihuaAsk: ModuleDef = {
  id: "meihua_ask", name: "梅花易数问事", cat: "ask",
  requires: ["question"], note: "时间起卦,体用生克断吉凶",
  compute(ctx) {
    const { y, m, d, hh, mm, tz } = nowLocal(ctx);
    const lonE = 15 * tz;
    const lunar = solarToLunar(y, m, d);
    const fp = fourPillars(y, m, d, hh, mm, lonE);
    const yzhi = (((lunar.year - 4) % 12) + 12) % 12 + 1;
    const cast = meihuaTimeCast(yzhi, lunar.month, lunar.day, fp.hourIdx + 1);
    const secs = meihuaSections(cast, [`起卦时刻 ${y}-${m}-${d} ${hh}:${mm}(农历${LUNAR_MONTH_CN[lunar.month - 1]}月${LUNAR_DAY_CN[lunar.day - 1]},时支${BRANCHES[fp.hourIdx]})`]);
    secs.unshift(section("所问之事", { kv: [["问题", ctx.input.question ?? "(未填)"]] }));
    return secs;
  },
};

const horary: ModuleDef = {
  id: "horary", name: "卜卦占星", cat: "ask",
  requires: ["question"], note: "按提问时刻排盘;坐标用出生地(或默认上海)",
  compute(ctx) {
    const { y, m, d, hh, mm, tz } = nowLocal(ctx);
    const b = ctx.input.birth ? resolveBirth(ctx.input.birth) : null;
    const latN = b?.latN ?? 31.23, lonE = b?.lonE ?? 121.47;
    const c = fullChart(y, m, d, hh, mm, latN, lonE, tz);
    const ascSign = signOf(c.axes["上升"]);
    const rows = Object.entries(c.pos).map(([k, [lon, rx]]) => [k, fmtDeg(lon), String(c.houses[k]), rx ? "℞" : ""]);
    const HOUSE_TOPICS = ["1 自身", "2 财", "3 通信", "4 家宅", "5 子女", "6 病", "7 婚姻对手", "8 债遗", "9 远方学业", "10 事业", "11 朋友愿望", "12 隐秘"];
    return [
      section("卦象时刻", {
        kv: [
          ["时刻", `${y}-${m}-${d} ${hh}:${mm}`],
          ["ASC", `${fmtDeg(c.axes["上升"])}(${ascSign},命主星${SIGN_RULER[ascSign]})`],
        ],
        text: ["问卜者 = ASC + 命主星 + 月亮;所问之事按对应宫头+宫主星判断", "一事一卦,不重复问同一事"],
      }),
      section("卦象星盘", { headers: ["星体", "黄经", "宫位", "逆行"], rows }),
      section("宫位主题", { text: [HOUSE_TOPICS.join(" / ")] }),
      section("月亮(问卜者代表)", { kv: [["月亮", `${fmtDeg(c.pos["月亮"][0])} ${signOf(c.pos["月亮"][0])}`], ["月相", c.phase.name]] }),
    ];
  },
};

const tarotM: ModuleDef = {
  id: "tarot", name: "塔罗", cat: "ask",
  requires: ["question"], note: "随机抽取+牌意表,默认三张牌阵",
  compute(ctx) {
    const spread = ctx.input.spread ?? "three";
    const cards = drawTarot(spread);
    return [
      section("所问之事", { kv: [["问题", ctx.input.question ?? "(未填)"]] }),
      section(`牌阵(${spread === "celtic" ? "凯尔特十字" : spread === "single" ? "单张" : "三张"})`, {
        headers: ["位置", "牌", "正逆", "关键词"],
        rows: cards.map((c) => [c.position, c.card.name, c.reversed ? "逆位" : "正位", c.card.keywords.join("、")]),
        text: ["解读结构 = 牌意关键词 + 位置含义 + 对应问题三句;逆位 = 受阻内化"],
      }),
    ];
  },
};

const runesM: ModuleDef = {
  id: "runes", name: "卢恩符文", cat: "ask",
  requires: ["question"], note: "三张(过去/现在/走向)",
  compute(ctx) {
    const runes = drawRunes();
    return [
      section("所问之事", { kv: [["问题", ctx.input.question ?? "(未填)"]] }),
      section("卢恩三抽", {
        headers: ["位置", "符文", "含义", "正逆"],
        rows: runes.map((r) => [r.position, r.name, r.meaning, r.reversed ? "逆位(受阻内化)" : "正位"]),
      }),
    ];
  },
};

// ---------------- D. 关系类 ----------------

function chartOf(b: ResolvedBirth): FullChart {
  return fullChart(b.y, b.m, b.d, b.hh, b.mm, b.latN, b.lonE, b.tz);
}

const synastry: ModuleDef = {
  id: "synastry", name: "占星合盘", cat: "relation",
  requires: ["birth", "partner", "time"], note: "双方日月水金火ASC/MC交叉相位矩阵",
  compute(ctx) {
    const A = resolveBirth(ctx.input.birth!);
    const B = resolveBirth(ctx.input.partner!);
    const ca = chartOf(A), cb = chartOf(B);
    const pick = (c: FullChart): [string, number][] => [
      ...["太阳", "月亮", "水星", "金", "火"].map((s) => (s.length === 1 ? s + "星" : s)).map((s) => [s, c.pos[s]?.[0] ?? 0] as [string, number]),
      ["ASC", c.axes["上升"]], ["MC", c.axes["天顶"]],
    ];
    const pa = pick(ca), pb = pick(cb);
    const rows: string[][] = [];
    for (const [n1, l1] of pa) {
      for (const [n2, l2] of pb) {
        const sep = Math.abs(angdiff(l2, l1));
        const isLum = /太阳|月亮|ASC|MC/.test(n1 + n2);
        const isVF = /金|火/.test(n1 + n2);
        const orbs: [string, number][] = [["合相", 0], ["六合", 60], ["刑相", 90], ["拱相", 120], ["对冲", 180]];
        for (const [nm, adeg] of orbs) {
          const orb = (isLum ? 8 : isVF ? 5 : 6);
          if (Math.abs(sep - adeg) <= orb) {
            rows.push([`A.${n1}`, nm, `B.${n2}`, `${sep.toFixed(1)}°`]);
            break;
          }
        }
      }
    }
    return [
      section("双方三大件", {
        kv: [
          ["A", `日${signOf(ca.pos["太阳"][0])} 月${signOf(ca.pos["月亮"][0])} 升${signOf(ca.axes["上升"])}`],
          ["B", `日${signOf(cb.pos["太阳"][0])} 月${signOf(cb.pos["月亮"][0])} 升${signOf(cb.axes["上升"])}`],
        ],
        warn: [...A.notes.map((s) => "A: " + s), ...B.notes.map((s) => "B: " + s)],
      }),
      section("交叉相位矩阵", { headers: ["A", "相位", "B", "夹角"], rows: rows.length ? rows : [["(无容许度内交叉相位)", "—", "—", "—"]] }),
      section("叙事口径", { text: ["'谁的行星压谁的点'属传统说法:A的土星合B的太阳=约束方;金火相位看吸引;日月相位看长期相处"] }),
    ];
  },
};

const composite: ModuleDef = {
  id: "composite", name: "组合盘", cat: "relation",
  requires: ["birth", "partner", "time"], note: "短弧中点合成一盏盘",
  compute(ctx) {
    const A = resolveBirth(ctx.input.birth!);
    const B = resolveBirth(ctx.input.partner!);
    const ca = chartOf(A), cb = chartOf(B);
    const rows: string[][] = [];
    for (const k of ["太阳", "月亮", "水星", "金星", "火星", "木星", "土星"]) {
      const l1 = ca.pos[k][0], l2 = cb.pos[k][0];
      let mid = mod360((l1 + l2) / 2);
      if (Math.abs(angdiff(l1, l2)) > 90 && Math.abs(angdiff(l1, l2)) < 270) mid = mod360(mid + 180);  // 短弧中点
      rows.push([k, fmtDeg(mid), signOf(mid)]);
    }
    return [
      section("组合盘中点", { headers: ["星体", "中点黄经", "落座"], rows, warn: ["组合盘看'关系的自己':落座+落宫(此处以A盘宫位近似)"] }),
    ];
  },
};

const baziHehun: ModuleDef = {
  id: "bazi_hehun", name: "八字合婚", cat: "relation",
  requires: ["birth", "partner"], note: "年支/日柱/用神互补/神煞互看",
  compute(ctx) {
    const A = resolveBirth(ctx.input.birth!);
    const B = resolveBirth(ctx.input.partner!);
    const fa = A.fp, fb = B.fp;
    const ya = BRANCHES[fa.pillars[0] % 12], yb = BRANCHES[fb.pillars[0] % 12];
    const rels: string[] = [];
    if (LIU_HE[ya] === yb) rels.push(`年支六合(${ya}${yb})=顺`);
    if (LIU_CHONG[ya] === yb) rels.push(`年支相冲(${ya}${yb})=易摩擦(概率倾向非判决)`);
    if (LIU_HAI[ya] === yb) rels.push(`年支相害(${ya}${yb})`);
    const daStemA = fa.pillars[2] % 10, daStemB = fb.pillars[2] % 10;
    const WUHE: [number, number][] = [[0, 5], [1, 6], [2, 7], [3, 8], [4, 9]];
    const stemHe = WUHE.some(([a2, b2]) => (daStemA === a2 && daStemB === b2) || (daStemA === b2 && daStemB === a2));
    const dayBrA = BRANCHES[fa.pillars[2] % 12], dayBrB = BRANCHES[fb.pillars[2] % 12];
    const brHe = LIU_HE[dayBrA] === dayBrB;
    const brChong = LIU_CHONG[dayBrA] === dayBrB;
    const sa = strength(fa.pillars[2] % 10, fa.pillars);
    const elemNeeds = sa.ratio <= 0.45 ? `A偏弱,喜${STEM_ELEM[fa.pillars[2] % 10]}之生扶(印比)` : sa.ratio >= 0.55 ? `A偏强,喜克泄耗` : "A中和";
    return [
      section("双方四柱", {
        headers: ["", "年柱", "月柱", "日柱", "时柱"],
        rows: [
          ["A", ...fa.pillars.map(gzName)],
          ["B", ...fb.pillars.map(gzName)],
        ],
        warn: [...A.notes, ...B.notes],
      }),
      section("关系清单", {
        text: [
          ...rels,
          `日干${stemHe ? "五合" : "非五合"}(甲己乙庚丙辛丁壬戊癸)`,
          `日支${brHe ? "六合" : brChong ? "相冲" : "无特殊"}(${dayBrA}/${dayBrB})`,
          `用神互补: ${elemNeeds};对方格局五行是否恰为喜用,需对照双方盘面`,
          "红线: 不出'必离''克死'类断语,以上为概率倾向",
        ],
      }),
      section("神煞互看", {
        kv: [
          ["A 神煞", Object.entries(shensha(fa.pillars)).filter(([, v]) => v.length).map(([k, v]) => `${k}:${v.join("")}`).join("; ") || "无"],
          ["B 神煞", Object.entries(shensha(fb.pillars)).filter(([, v]) => v.length).map(([k, v]) => `${k}:${v.join("")}`).join("; ") || "无"],
        ],
      }),
    ];
  },
};

const zodiacMatch: ModuleDef = {
  id: "zodiac_match", name: "生肖/星座速配", cat: "relation",
  requires: ["birth", "partner"], note: "娱乐级",
  compute(ctx) {
    const A = resolveBirth(ctx.input.birth!);
    const B = resolveBirth(ctx.input.partner!);
    const za = SHENG_XIAO[BRANCHES.indexOf(BRANCHES[(A.lunar.year - 4 + 240) % 60 % 12])];
    const zb = SHENG_XIAO[BRANCHES.indexOf(BRANCHES[(B.lunar.year - 4 + 240) % 60 % 12])];
    const ca = chartOf(A), cb = chartOf(B);
    const rel = LIU_HE[BRANCHES[(A.lunar.year - 4 + 240) % 60 % 12]] === BRANCHES[(B.lunar.year - 4 + 240) % 60 % 12] ? "生肖六合"
      : LIU_CHONG[BRANCHES[(A.lunar.year - 4 + 240) % 60 % 12]] === BRANCHES[(B.lunar.year - 4 + 240) % 60 % 12] ? "生肖相冲" : "生肖无特殊";
    return [section("速配(娱乐级)", {
      kv: [
        ["A", `${za}年 / 日座${signOf(ca.pos["太阳"][0])}`],
        ["B", `${zb}年 / 日座${signOf(cb.pos["太阳"][0])}`],
        ["生肖关系", rel],
      ],
      text: ["⚠ 纯娱乐,太阳星座只是极粗颗粒度,认真看请用合盘/合婚"],
    })];
  },
};

// ---------------- E. 实用类 ----------------

const zeday: ModuleDef = {
  id: "zeday", name: "择日择吉", cat: "practical",
  requires: ["zeday"], note: "建除十二神+避开冲刑害+四绝四离(民俗口径)",
  compute(ctx) {
    const { from, to } = ctx.input.zeday!;
    const [fy, fm, fd] = from.split("-").map(Number);
    const [ty, tm, td] = to.split("-").map(Number);
    const b = ctx.input.birth ? resolveBirth(ctx.input.birth) : null;
    const rows: string[][] = [];
    const JIANCHU = ["建", "除", "满", "平", "定", "执", "破", "危", "成", "收", "开", "闭"];
    for (let t = Date.UTC(fy, fm - 1, fd); t <= Date.UTC(ty, tm - 1, td); t += 86400000) {
      const dt = new Date(t);
      const y = dt.getUTCFullYear(), m = dt.getUTCMonth() + 1, dd = dt.getUTCDate();
      const noonJd = julianDay(y, m, dd, 12);
      const jdn = Math.floor(noonJd + 0.5);
      const dayGz = (((jdn + 49) % 60) + 60) % 60;
      const dayBr = dayGz % 12;
      // 月支 = 最近一个已过的"节"(跨年取 y-1/y/y+1 三年)
      let monthBr = 2;
      let bestJd = -Infinity;
      for (const yy of [y - 1, y, y + 1]) {
        for (const [lon, br] of JIE) {
          const jd = termJdUtc(yy, lon);
          if (jd !== null && jd <= noonJd && jd > bestJd) { bestJd = jd; monthBr = BRANCHES.indexOf(br); }
        }
      }
      const jc = JIANCHU[((dayBr - monthBr) % 12 + 12) % 12];
      const tags: string[] = [`${gzName(dayGz)}日`, `建除:${jc}`];
      let good = "可";
      if (["破", "闭"].includes(jc)) good = "忌";
      else if (["建", "满", "平", "收"].includes(jc)) good = "黑(慎)";
      else good = "黄(吉)";
      if (b) {
        const pBr = b.fp.pillars[0] % 12, dBr = b.fp.pillars[2] % 12;
        if (LIU_CHONG[BRANCHES[dayBr]] === BRANCHES[pBr] || LIU_CHONG[BRANCHES[dayBr]] === BRANCHES[dBr]) tags.push(`冲当事人(${b.gender === "female" ? "女" : "男"}命)`);
        if (LIU_HAI[BRANCHES[dayBr]] === BRANCHES[pBr]) tags.push("害年支");
      }
      // 四绝四离: 二分二至/四立的前一日
      for (const [lon, label] of [[0, "四绝(分至前)"], [90, "四绝"], [180, "四绝"], [270, "四绝"], [315, "四离(四立前)"], [45, "四离"], [135, "四离"], [225, "四离"]] as [number, string][]) {
        const jd = termJdUtc(y, lon);
        if (jd !== null && Math.abs(noonJd - jd + 0.5) < 0.75) tags.push(label + "(避大事)");
      }
      rows.push([`${y}-${String(m).padStart(2, "0")}-${String(dd).padStart(2, "0")}`, tags.join(" "), good]);
      if (rows.length > 62) break;
    }
    return [
      section("择日候选", { headers: ["日期", "标记", "建除吉凶"], rows }),
      section("口径", { text: ["建满平收黑,除危定执黄,成开皆可用,破闭不相当;四绝四离避大事;优先当事人喜用神当令之日", "民俗口径,不构成保证"] }),
    ];
  },
};

const nameluck: ModuleDef = {
  id: "nameluck", name: "姓名五格评分", cat: "practical",
  requires: ["name"], note: "八字喜用+五格数理(康熙笔画全量表)",
  compute(ctx) {
    return (async () => {
      const { surname, given } = ctx.input.name!;
      const wg = await wuge(surname, given);
      const secs: Section[] = [section("康熙笔画", {
        headers: ["字", "康熙笔画"],
        rows: wg.strokes.map((s) => [s.char, s.strokes === null ? "未收录(请查字典核对,不参与评分)" : String(s.strokes)]),
      })];
      if (!wg.ok) {
        secs.push(section("⚠ 无法完整评分", { text: [`以下字未收录: ${wg.missingChars.join("、")};按纪律不猜笔画,请查字典后人工补算`] }));
      } else {
        secs.push(section("五格数理", {
          headers: ["格", "数", "吉凶"],
          rows: [
            ["天格", String(wg.tian), wg.luck.tian], ["人格(主)", String(wg.ren), wg.luck.ren],
            ["地格", String(wg.di), wg.luck.di], ["外格", String(wg.wai), wg.luck.wai],
            ["总格", String(wg.zong), wg.luck.zong],
          ],
        }));
        secs.push(section("三才", { kv: [["三才配置", wg.sancai]], text: [wg.sancaiNote] }));
      }
      if (ctx.input.birth) {
        const b = resolveBirth(ctx.input.birth);
        const st = strength(b.fp.pillars[2] % 10, b.fp.pillars);
        const dayElem = STEM_ELEM[b.fp.pillars[2] % 10];
        const GEN: Record<string, string> = { "木": "水", "火": "木", "土": "火", "金": "土", "水": "金" };
        const need = st.ratio <= 0.45 ? `偏弱,喜${GEN[dayElem]}(印)与${dayElem}(比)` : st.ratio >= 0.55 ? "偏强,喜克泄耗(官杀/食伤/财)" : "中和";
        secs.push(section("八字喜用(供起名参考)", { kv: [["日主", `${dayElem}`, ], ["旺衰", need]], warn: b.notes }));
      }
      return secs;
    })();
  },
};

// ---------------- 注册表 ----------------

export const MODULES: ModuleDef[] = [
  western, vedic, bazi4, ziweiM, meihuaLife, numerologyM, chengguM, kyuseiM, mayaM, xiu28M,
  transits, progressions, profection, firdaria, solarReturn, baziLiunian, ziweiDayun,
  liuyaoM, meihuaAsk, horary, tarotM, runesM,
  synastry, composite, baziHehun, zodiacMatch,
  zeday, nameluck,
];

// 白话解释(悬浮浮窗用)集中放 descs.ts,便于单独维护文案
for (const m of MODULES) {
  const d = MODULE_DESCS[m.id];
  if (d) m.desc = d;
}

export function getModule(id: string): ModuleDef | undefined {
  return MODULES.find((m) => m.id === id);
}

export interface FortuneResult {
  sections: Record<string, Section[]>;
  errors: string[];
}

/** 批量计算所选模块 */
export async function computeFortune(ids: string[], input: FortuneInput): Promise<FortuneResult> {
  const ctx: ComputeCtx = { input, nowMs: input.nowMs ?? Date.now() };
  const sections: Record<string, Section[]> = {};
  const errors: string[] = [];
  for (const id of ids) {
    const mod = getModule(id);
    if (!mod) continue;
    try {
      sections[id] = await mod.compute(ctx);
    } catch (e) {
      errors.push(`${mod.name}: ${(e as Error).message}`);
    }
  }
  return { sections, errors };
}
