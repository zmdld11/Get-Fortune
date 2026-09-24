// selftest.ts — 排盘库回归自测（node 端运行: npm run test:paipan）
// 锚点全部移植自 fortune-calc skill 三个 Python 脚本的 --selftest（外部天象事件
// + 历法事实），另加 misc/ziwei/wuge 的公式校验。全绿才算移植合格。

import {
  julianDay, sunPosition, moonPosition, planetLon, trueNode, gmst, obliquity,
  ascMc, placidusCusps, mod360, angdiff,
} from "./astro";
import {
  gzName, solarToLunar, termJdUtc, jdToLocalStr, fourPillars, dayun,
  eqOfTimeMinutes, leapMonthOf, LUNAR_INFO,
} from "./bazi";
import { meihuaTimeCast, liuyaoCast, PALACES, bitsToName } from "./divination";
import { numerology, chenggu, kyusei, maya, xiu28 } from "./misc";
import { ziweiChart } from "./ziwei";
import { wuge } from "./wuge";
import { TAROT_DECK, CELTIC_CROSS } from "./tarot";

let ok = true;
let passCount = 0;
let failCount = 0;

function chk(desc: string, got: unknown, want: unknown, tol = 0): void {
  const good = tol > 0
    ? Math.abs((got as number) - (want as number)) <= tol
    : JSON.stringify(got) === JSON.stringify(want);
  if (good) passCount++;
  else { ok = false; failCount++; }
  console.log(`[${good ? "通过" : "失败"}] ${desc}  got=${JSON.stringify(got)}${tol ? ` want≈${want}±${tol}` : ` want=${JSON.stringify(want)}`}`);
}

async function testAstro() {
  console.log("—— astro.ts（西占天文引擎）——");
  chk("JD 2000-01-01 12UT", julianDay(2000, 1, 1, 12), 2451545.0, 1e-6);
  chk("JD 1900-01-01 00UT(历书值)", julianDay(1900, 1, 1, 0), 2415020.5, 1e-6);
  chk("太阳 J2000", sunPosition(2451545.0), 280.39, 0.05);
  const jdE = julianDay(1999, 8, 11, 11.05);  // 1999-08-11 欧洲日全食,极大≈11:03UT
  const e = Math.abs(((moonPosition(jdE)[0] - sunPosition(jdE)) + 180) % 360 - 180);
  chk("1999-08-11日食日月距角≈0", e, 0.0, 0.3);
  const jdG = julianDay(2020, 12, 21, 18.5);  // 木土大合≈0°06′宝瓶
  const lj = planetLon("木星", jdG), ls = planetLon("土星", jdG);
  chk("2020大合相: 木土黄经≈300.4", (lj + ls) / 2, 300.42, 0.5);
  chk("2020大合相: 二者间距<0.2°", Math.abs(lj - ls), 0.0, 0.2);
  chk("冥王2008-12-15入摩羯(≈270.5)", planetLon("冥王星", julianDay(2008, 12, 15, 0)), 270.5, 0.8);
  const jd1900 = 2415020.5;
  chk("太阳 1900(理论≈280.2)", sunPosition(jd1900), 280.1536, 0.03);
  chk("月亮 1900", moonPosition(jd1900)[0], 272.4147, 0.05);
  chk("水星", planetLon("水星", jd1900), 260.3932, 0.3);
  chk("金星", planetLon("金星", jd1900), 307.7728, 0.3);
  chk("火星", planetLon("火星", jd1900), 285.2617, 0.3);
  chk("木星", planetLon("木星", jd1900), 242.5194, 0.4);
  chk("土星", planetLon("土星", jd1900), 269.2527, 0.4);
  chk("天王星", planetLon("天王星", jd1900), 251.5387, 0.5);
  chk("海王星", planetLon("海王星", jd1900), 86.6090, 0.5);
  chk("冥王星", planetLon("冥王星", jd1900), 76.6507, 0.7);
  chk("真北交点", trueNode(jd1900), 260.1827, 1.2);
  // 四轴与宫头(1900-01-01 00:00 UT, 上海 121.47E 31.23N)
  const T = (jd1900 - 2451545.0) / 36525;
  const eps = obliquity(T);
  const ramc = mod360(gmst(jd1900) + 121.47);
  const [asc, mc] = ascMc(ramc, eps, 31.23);
  chk("上升", asc, 296.2466, 0.5);
  chk("天顶", mc, 224.1163, 0.4);
  const [c11, c12, c2, c3] = placidusCusps(ramc, eps, 31.23);
  chk("Placidus 11宫头", c11, 248.7081, 0.6);
  chk("Placidus 12宫头", c12, 271.3671, 0.6);
  chk("Placidus 2宫头", c2, 336.0835, 0.6);
  chk("Placidus 3宫头", c3, 13.8711, 0.8);
}

function testBazi() {
  console.log("—— bazi.ts（八字/农历/真太阳时）——");
  let jdn = Math.floor(julianDay(2000, 1, 1, 0) + 0.5);
  chk("2000-01-01 日柱", gzName((((jdn + 49) % 60) + 60) % 60), "戊午");
  jdn = Math.floor(julianDay(1900, 1, 1, 0) + 0.5);
  chk("1900-01-01 日柱", gzName((((jdn + 49) % 60) + 60) % 60), "甲戌");
  chk("1900 年柱", gzName(1900 - 4), "庚子");
  chk("1984 年柱", gzName(1984 - 4), "甲子");
  chk("2005 寒露落10-08", jdToLocalStr(termJdUtc(2005, 195)!).slice(0, 10), "2005-10-08");
  chk("2005 立春落02-03/04", ["2005-02-03", "2005-02-04"].includes(jdToLocalStr(termJdUtc(2005, 315)!).slice(0, 10)), true);
  // 农历锚点
  chk("1900-01-31=正月初一(表基准)", solarToLunar(1900, 1, 31), { year: 1900, month: 1, isLeap: false, day: 1 });
  chk("2005-02-09=正月初一", solarToLunar(2005, 2, 9), { year: 2005, month: 1, isLeap: false, day: 1 });
  chk("2020-01-25=正月初一", solarToLunar(2020, 1, 25), { year: 2020, month: 1, isLeap: false, day: 1 });
  chk("2024-02-10=正月初一", solarToLunar(2024, 2, 10), { year: 2024, month: 1, isLeap: false, day: 1 });
  chk("2010-02-14=正月初一", solarToLunar(2010, 2, 14), { year: 2010, month: 1, isLeap: false, day: 1 });
  chk("2000-02-05=正月初一", solarToLunar(2000, 2, 5), { year: 2000, month: 1, isLeap: false, day: 1 });
  chk("1990-01-27=正月初一", solarToLunar(1990, 1, 27), { year: 1990, month: 1, isLeap: false, day: 1 });
  chk("1980-02-16=正月初一", solarToLunar(1980, 2, 16), { year: 1980, month: 1, isLeap: false, day: 1 });
  chk("2000-01-01=冬月廿五", solarToLunar(2000, 1, 1), { year: 1999, month: 11, isLeap: false, day: 25 });
  chk("闰月:2004闰2/2009闰5/2017闰6/2020闰4/2023闰2/2025闰6",
    [2004, 2009, 2017, 2020, 2023, 2025].map((y) => leapMonthOf(LUNAR_INFO[y - 1900])),
    [2, 5, 6, 4, 2, 6]);
  // 四柱全链路: 1900-01-01 00:00(东经120°) 真太阳时23:56.7 → 晚子时;立春前属己亥;大雪后子月
  const fp = fourPillars(1900, 1, 1, 0, 0, 120.0, 8.0);
  chk("1900-01-01子月晚子时四柱", fp.pillars.map(gzName), ["己亥", "丙子", "甲戌", "甲子"]);
  chk("该例真太阳时≈23:57", Math.abs(fp.tst - 23.945) < 0.05, true);
  chk("该例触发晚子时进日柱", fp.nightZi, true);
  // 大运: 己亥阴年男逆排, 首运乙亥, 起运约8.1岁
  const [dl, start, fwd] = dayun(fp.pillars[1], fp.pillars[0], "male", fp.birthSolarJd, 1900);
  chk("大运逆排", fwd, false);
  chk("大运首两步", dl.slice(0, 2).map(gzName), ["乙亥", "甲戌"]);
  chk("起运约8.1岁", Math.abs(start - 8.1) < 0.5, true);
  chk("均时差10-19≈+15分", Math.abs(eqOfTimeMinutes(julianDay(1900, 10, 19, 0)) - 15.0) < 1.0, true);
}

function testDivination() {
  console.log("—— divination.ts（梅花/六爻）——");
  const cast = meihuaTimeCast(12, 11, 25, 1);
  chk("梅花本卦", cast.name, "地天泰");
  chk("梅花变卦", cast.changedName, "地风升");
  chk("梅花动爻", cast.moving, 1);
  chk("梅花互卦", cast.huName, "雷泽归妹");
  chk("梅花体用(动在下卦→上卦体)", [cast.tiElem, cast.yongElem], ["土", "金"]);
  const c = liuyaoCast([7, 7, 7, 7, 7, 7], "甲");
  chk("六爻纯阳卦名", c.name, "乾为天");
  chk("宫/世", [c.palace, c.world], ["乾", 6]);
  chk("初爻纳甲", c.lines[0], ["子孙", "甲子"]);
  chk("四爻纳甲", c.lines[3], ["官鬼", "壬午"]);
  chk("上爻纳甲", c.lines[5], ["父母", "壬戌"]);
  const c2 = liuyaoCast([7, 7, 7, 7, 7, 9], "甲");
  chk("上爻老阳之变卦", c2.changedName, "泽天夬");
  chk("泽天夬=坤宫五世", PALACES["泽天夬"], ["坤", 5, "五世"]);
  chk("乾宫归魂=火天大有", PALACES["火天大有"], ["乾", 3, "归魂"]);
  chk("乾宫游魂=火地晋", PALACES["火地晋"], ["乾", 4, "游魂"]);
  chk("八宫装满64卦", Object.keys(PALACES).length, 64);
  chk("六兽甲日起青龙", c.beasts![0], "青龙");
}

async function testMisc() {
  console.log("—— misc.ts（轻计算模块）——");
  const num = numerology(1990, 1, 27);
  chk("生命数字 1990-01-27=11(大师数不复约)", num.lifePath, 11);
  const cg = chenggu(1984, 2, 2, 0);  // 甲子年正月初一子时
  chk("称骨 甲子年正月初一子时=3.9两", cg.total, 3.9);
  chk("称骨 年柱干支=甲子", cg.yearGz, "甲子");
  chk("九星 2005-06-01=四绿", kyusei(2005, 6, 1).star, 4);
  chk("九星 1999-06-01=一白(s=1→11-1=10取1)", kyusei(1999, 6, 1).star, 1);
  const my = maya(2012, 12, 21);
  chk("玛雅 2012-12-21=4 Ahau(锚点)", [my.num, my.day], [4, "Ahau"]);
  const my2 = maya(2012, 12, 22);
  chk("玛雅 次日=5 Imix", [my2.num, my2.day], [5, "Imix"]);
  const x = xiu28(10, julianDay(1900, 1, 1, 0));
  chk("二十八宿 输出带四象", x.xiang.length > 0, true);
}

async function testZiwei() {
  console.log("—— ziwei.ts（紫微安星,公式校验）——");
  // 2000-01-01 = 农历己卯年冬月廿五, 子时 → 命身同宫于子, 水二局, 紫微在丑
  const z = ziweiChart(2000, 1, 1, 0, "male");
  chk("命宫=子(冬月廿五子时)", z.mingIdx, 0);
  chk("子时命身同宫", z.shenIdx, z.mingIdx);
  chk("水二局(丙子命宫纳音)", z.ju, 2);
  const zw = z.palaces.find((p) => p.stars.some((s) => s.startsWith("紫微")));
  chk("紫微在丑(水二局廿五日)", zw?.branch, "丑");
  const stars = z.palaces.flatMap((p) => p.stars.map((s) => s.replace(/化[禄权科忌]$/, "")));
  for (const s of ["紫微", "天机", "太阳", "武曲", "天同", "廉贞", "天府", "太阴", "贪狼", "巨门", "天相", "天梁", "七杀", "破军"]) {
    chk(`十四主星已安: ${s}`, stars.includes(s), true);
  }
  chk("己年四化(武曲禄/贪狼权/天梁科/文曲忌)", z.sihua["武曲"] === "禄" && z.sihua["贪狼"] === "权" && z.sihua["天梁"] === "科" && z.sihua["文曲"] === "忌", true);
  const wc = z.palaces.find((p) => p.stars.some((s) => s.startsWith("文昌")));
  chk("文昌子时在戌", wc?.branch, "戌");
  // 大限: 水二局2岁起, 阳男阴女顺行——己卯阴年男逆行, 命宫大限2-11
  const ming = z.palaces[0];
  chk("命宫大限2-11", ming.majorLimit, "2-11");
}

async function testWuge() {
  console.log("—— wuge.ts（五格+康熙笔画表）——");
  const r = await wuge("刘", "德华");
  chk("康熙笔画 刘=15 德=15 华=14(全量表)", [r.strokes[0].strokes, r.strokes[1].strokes, r.strokes[2].strokes], [15, 15, 14]);
  chk("五格 天16 人30 地29 外15 总44", [r.tian, r.ren, r.di, r.wai, r.zong], [16, 30, 29, 15, 44]);
  chk("字表覆盖→评分可用", r.ok, true);
  const r2 = await wuge("王", "𠔻");
  chk("生僻字不猜→missingChars标注", r2.ok === false && r2.missingChars.includes("𠔻"), true);
}

function testTarot() {
  console.log("—— tarot.ts（牌库完整性）——");
  chk("塔罗78张", TAROT_DECK.length, 78);
  chk("大阿卡纳22张", TAROT_DECK.slice(0, 22).length, 22);
  chk("小阿卡纳56张", TAROT_DECK.length - 22, 56);
  chk("凯尔特十字10位", CELTIC_CROSS.length, 10);
  chk("牌名无重复", new Set(TAROT_DECK.map((c) => c.name)).size, 78);
  chk("每张牌有牌意", TAROT_DECK.every((c) => c.keywords.length >= 3), true);
}

async function main() {
  console.log("排盘库回归自测 fortune-paipan");
  testAstro();
  testBazi();
  testDivination();
  await testMisc();
  await testZiwei();
  await testWuge();
  testTarot();
  console.log(`\n${passCount} 通过 / ${failCount} 失败 — ${ok ? "全部通过 ✓" : "存在失败项 ✗"}`);
  if (!ok) process.exit(1);
}

main();
