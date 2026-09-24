// bazi.ts — 八字排盘 + 农历转换 + 真太阳时（子平法）
// 移植自 fortune-calc skill 的 scripts/bazi_tools.py。
// 规则口径(均为最通行做法):
//   · 时辰/月柱按【真太阳时】(经度差 + 均时差); 年界【立春】; 月界【十二节】
//   · 日柱按出生地钟表日期, 23:00(真太阳时)后为晚子时 → 日柱进一天(默认,可改)
//   · 大运: 阳男阴女顺排, 阴男阳女逆排; 3日折1年
import { julianDay, sunPosition, obliquity, mod360, angdiff } from "./astro";

export const STEMS = "甲乙丙丁戊己庚辛壬癸";
export const BRANCHES = "子丑寅卯辰巳午未申酉戌亥";
export const STEM_ELEM = ["木", "木", "火", "火", "土", "土", "金", "金", "水", "水"];
export const BRANCH_ELEM = ["水", "土", "木", "木", "土", "火", "火", "土", "金", "金", "土", "水"];
export const HIDDEN: Record<string, string[]> = {
  "子": ["癸"], "丑": ["己", "癸", "辛"], "寅": ["甲", "丙", "戊"], "卯": ["乙"],
  "辰": ["戊", "乙", "癸"], "巳": ["丙", "庚", "戊"], "午": ["丁", "己"],
  "未": ["己", "丁", "乙"], "申": ["庚", "壬", "戊"], "酉": ["辛"],
  "戌": ["戊", "辛", "丁"], "亥": ["壬", "甲"],
};
export const NAYIN = ["海中金", "炉中火", "大林木", "路旁土", "剑锋金", "山头火", "涧下水", "城头土",
  "白蜡金", "杨柳木", "泉中水", "屋上土", "霹雳火", "松柏木", "长流水", "沙中金",
  "山下火", "平地木", "壁上土", "金箔金", "覆灯火", "天河水", "大驿土", "钗钏金",
  "桑柘木", "大溪水", "沙中土", "天上火", "石榴木", "大海水"];
export const SHENG_XIAO = ["鼠", "牛", "虎", "兔", "龙", "蛇", "马", "羊", "猴", "鸡", "狗", "猪"];
export const JIE: [number, string][] = [
  [315, "寅"], [345, "卯"], [15, "辰"], [45, "巳"], [75, "午"], [105, "未"],
  [135, "申"], [165, "酉"], [195, "戌"], [225, "亥"], [255, "子"], [285, "丑"],
];
const WU_HU: Record<string, string> = { "甲": "丙", "乙": "戊", "丙": "庚", "丁": "壬", "戊": "甲", "己": "丙", "庚": "戊", "辛": "庚", "壬": "壬", "癸": "甲" };
const WU_SHU: Record<string, string> = { "甲": "甲", "乙": "丙", "丙": "戊", "丁": "庚", "戊": "壬", "己": "甲", "庚": "丙", "辛": "戊", "壬": "庚", "癸": "壬" };

export function gzName(idx: number): string {
  return STEMS[((idx % 10) + 10) % 10] + BRANCHES[((idx % 12) + 12) % 12];
}

/** 天干序s 地支序b → 六十甲子序(中国剩余定理, s/b 必须同奇偶) */
export function stemBranchToGz(s: number, b: number): number {
  for (let k = 0; k < 6; k++) {
    const n = s + 10 * k;
    if (n % 12 === ((b % 12) + 12) % 12) return n % 60;
  }
  throw new Error(`干支不同奇偶: ${s},${b}`);
}

/** 十神: 日主对天干 (五行=序//2, 阴阳=序%2) */
export function stemGod(dayStemIdx: number, otherStemIdx: number): string {
  const e1 = Math.floor(dayStemIdx / 2), y1 = dayStemIdx % 2;
  const e2 = Math.floor(otherStemIdx / 2), y2 = otherStemIdx % 2;
  if (e1 === e2) return y1 === y2 ? "比肩" : "劫财";
  const d = ((e2 - e1) % 5 + 5) % 5;
  if (d === 1) return y1 === y2 ? "食神" : "伤官";
  if (d === 2) return y1 === y2 ? "偏财" : "正财";
  if (d === 3) return y1 === y2 ? "七杀" : "正官";
  return y1 === y2 ? "偏印" : "正印";
}

/** 地支十神: 按本气藏干对日主取十神 */
export function branchGod(dayStemIdx: number, branchIdx: number): string {
  const mainStem = STEMS.indexOf(HIDDEN[BRANCHES[branchIdx]][0]);
  return stemGod(dayStemIdx, mainStem);
}

// ---------------- 农历(1900–2030, 经典位编码表) ----------------

export const LUNAR_INFO = [
  0x04bd8, 0x04ae0, 0x0a570, 0x054d5, 0x0d260, 0x0d950, 0x16554, 0x056a0, 0x09ad0, 0x055d2,
  0x04ae0, 0x0a5b6, 0x0a4d0, 0x0d250, 0x1d255, 0x0b540, 0x0d6a0, 0x0ada2, 0x095b0, 0x14977,
  0x04970, 0x0a4b0, 0x0b4b5, 0x06a50, 0x06d40, 0x1ab54, 0x02b60, 0x09570, 0x052f2, 0x04970,
  0x06566, 0x0d4a0, 0x0ea50, 0x16a95, 0x05ad0, 0x02b60, 0x186e3, 0x092e0, 0x1c8d7, 0x0c950,
  0x0d4a0, 0x1d8a6, 0x0b550, 0x056a0, 0x1a5b4, 0x025d0, 0x092d0, 0x0d2b2, 0x0a950, 0x0b557,
  0x06ca0, 0x0b550, 0x15355, 0x04da0, 0x0a5b0, 0x14573, 0x052b0, 0x0a9a8, 0x0e950, 0x06aa0,
  0x0aea6, 0x0ab50, 0x04b60, 0x0aae4, 0x0a570, 0x05260, 0x0f263, 0x0d950, 0x05b57, 0x056a0,
  0x096d0, 0x04dd5, 0x04ad0, 0x0a4d0, 0x0d4d4, 0x0d250, 0x0d558, 0x0b540, 0x0b6a0, 0x195a6,
  0x095b0, 0x049b0, 0x0a974, 0x0a4b0, 0x0b27a, 0x06a50, 0x06d40, 0x0af46, 0x0ab60, 0x09570,
  0x04af5, 0x04970, 0x064b0, 0x074a3, 0x0ea50, 0x06b58, 0x055c0, 0x0ab60, 0x096d5, 0x092e0,
  0x0c960, 0x0d954, 0x0d4a0, 0x0da50, 0x07552, 0x056a0, 0x0abb7, 0x025d0, 0x092d0, 0x0cab5,
  0x0a950, 0x0b4a0, 0x0baa4, 0x0ad50, 0x055d9, 0x04ba0, 0x0a5b0, 0x15176, 0x052b0, 0x0a930,
  0x07954, 0x06aa0, 0x0ad50, 0x05b52, 0x04b60, 0x0a6e6, 0x0a4e0, 0x0d260, 0x0ea65, 0x0d530,
  0x05aa0,
];  // 1900..2030

export const LUNAR_MONTH_CN = ["正", "二", "三", "四", "五", "六", "七", "八", "九", "十", "冬", "腊"];
export const LUNAR_DAY_CN = ["初一", "初二", "初三", "初四", "初五", "初六", "初七", "初八", "初九", "初十",
  "十一", "十二", "十三", "十四", "十五", "十六", "十七", "十八", "十九", "二十",
  "廿一", "廿二", "廿三", "廿四", "廿五", "廿六", "廿七", "廿八", "廿九", "三十"];

const MS_DAY = 86400000;
function daysSinceEpoch1900(y: number, m: number, d: number): number {
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1900, 0, 31)) / MS_DAY);
}

function leapMonth(info: number): number { return info & 0xF; }
export function leapMonthOf(info: number): number { return info & 0xF; }
function monthDays(info: number, m: number): number { return (info & (0x10000 >> m)) ? 30 : 29; }
function leapDays(info: number): number { return (info & 0x10000) ? 30 : 29; }
function yearDays(info: number): number {
  let total = 0;
  for (let m = 1; m <= 12; m++) total += monthDays(info, m);
  if (leapMonth(info)) total += leapDays(info);
  return total;
}

export interface LunarDate { year: number; month: number; isLeap: boolean; day: number }

/** 公历→农历(1900–2030) */
export function solarToLunar(y: number, m: number, d: number): LunarDate {
  if (y < 1900 || y > 2030) throw new Error("农历表仅支持 1900–2030,超出范围请核对万年历");
  let offset = daysSinceEpoch1900(y, m, d);
  if (offset < 0) throw new Error("早于 1900-01-31");
  let year = 1900;
  while (year <= 2030 && offset >= yearDays(LUNAR_INFO[year - 1900])) {
    offset -= yearDays(LUNAR_INFO[year - 1900]);
    year += 1;
  }
  const info = LUNAR_INFO[year - 1900];
  const leap = leapMonth(info);
  let isLeap = false;
  let month = 1;
  while (month <= 12) {
    const days = isLeap ? leapDays(info) : monthDays(info, month);
    if (offset < days) break;
    offset -= days;
    if (!isLeap && month === leap) isLeap = true;
    else { isLeap = false; month += 1; }
  }
  return { year, month, isLeap, day: offset + 1 };
}

/** 农历→公历(同一张表反查)。isLeap=true 表示闰月 */
export function lunarToSolar(y: number, m: number, d: number, isLeap = false): { y: number; m: number; d: number } {
  if (y < 1900 || y > 2030) throw new Error("农历表仅支持 1900–2030,超出范围请核对万年历");
  const info = LUNAR_INFO[y - 1900];
  const leap = leapMonth(info);
  if (isLeap && leap !== m) throw new Error(`${y}年农历${m}月不是闰月`);
  let offset = 0;
  for (let yy = 1900; yy < y; yy++) offset += yearDays(LUNAR_INFO[yy - 1900]);
  for (let mm = 1; mm < m; mm++) offset += monthDays(info, mm);
  if (isLeap) offset += monthDays(info, m);
  offset += d - 1;
  const dt = new Date(Date.UTC(1900, 0, 31) + offset * MS_DAY);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

// ---------------- 真太阳时 / 节气 ----------------

export function eqOfTimeMinutes(jd: number): number {
  const T = (jd - 2451545.0) / 36525;
  const L0 = mod360(280.46646 + 36000.76983 * T + 0.0003032 * T * T);
  const lam = sunPosition(jd);
  const eps = obliquity(T);
  const lamR = lam * Math.PI / 180;
  const ra = mod360(Math.atan2(Math.sin(lamR) * Math.cos(eps * Math.PI / 180), Math.cos(lamR)) * 180 / Math.PI);
  return 4.0 * angdiff(L0, ra);
}

/** 某公历年前后太阳视黄经越过 targetLon 的 UT 时刻(JD)；找不到返回 null */
export function termJdUtc(gregYear: number, targetLon: number): number | null {
  const f = (jd: number) => angdiff(sunPosition(jd), targetLon);
  const jd0 = julianDay(gregYear, 1, 1, 0) - 20;
  const jd1 = julianDay(gregYear + 1, 1, 1, 0) + 20;
  let prev = f(jd0);
  let jd = jd0 + 1.0;
  while (jd <= jd1) {
    const cur = f(jd);
    if (prev < 0 && cur >= 0) {
      let lo = jd - 1.0, hi = jd;
      for (let i = 0; i < 45; i++) {
        const mid = (lo + hi) / 2;
        if (f(mid) < 0) lo = mid;
        else hi = mid;
      }
      return (lo + hi) / 2;
    }
    prev = cur;
    jd += 1.0;
  }
  return null;
}

export function jdToLocalStr(jdUtc: number, tz = 8.0): string {
  const total = jdUtc + tz / 24.0 + 0.5;
  const days = Math.floor(total);
  const frac = total - days;
  // JDN → 公历(Fliegel-Van Flandern)
  let l = days + 68569;
  const n = Math.floor(4 * l / 146097);
  l -= Math.floor((146097 * n + 3) / 4);
  let yr = Math.floor(4000 * (l + 1) / 1461001);
  l = l - Math.floor(1461 * yr / 4) + 31;
  let mo = Math.floor(80 * l / 2447);
  const d = l - Math.floor(2447 * mo / 80);
  const l2 = Math.floor(mo / 11);
  mo = mo + 2 - 12 * l2;
  yr = 100 * (n - 49) + yr + l2;
  const hh = frac * 24;
  const h = Math.floor(hh);
  const mi = Math.floor((hh - h) * 60);
  return `${String(yr).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")} ${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
}

// ---------------- 四柱 ----------------

export interface FourPillars {
  tst: number; eot: number; hourIdx: number; nightZi: boolean;
  pillars: [number, number, number, number];
  baziYear: number; warnings: string[];
  birthSolarJd: number; dayDate: { y: number; m: number; d: number };
}

export function fourPillars(y: number, m: number, d: number, hh: number, mm: number,
  lonE: number, tz = 8.0, gender = "male", nightZiAdvance = true): FourPillars {
  const jdClock = julianDay(y, m, d, hh + mm / 60.0 - tz);
  const eot = eqOfTimeMinutes(jdClock);
  const tst = hh + mm / 60.0 + (lonE - 15.0 * tz) * 4.0 / 60.0 + eot / 60.0;
  // 真太阳时对应的"太阳日"
  let dayOff = 0, tstN = tst;
  while (tstN >= 24.0) { tstN -= 24.0; dayOff += 1; }
  while (tstN < 0.0) { tstN += 24.0; dayOff -= 1; }
  const hourIdx = Math.floor((((tstN + 1.0) % 24.0) + 24.0) % 24.0 / 2);  // 0=子..11=亥
  const nightZi = hourIdx === 0 && tstN >= 23.0;
  // 日柱: 钟表日期 + 真太阳日偏移, 晚子时再 +1
  const base = new Date(Date.UTC(y, m - 1, d) + dayOff * MS_DAY);
  const dayShift = nightZi && nightZiAdvance ? 1 : 0;
  const dayDate = new Date(base.getTime() + dayShift * MS_DAY);
  const by = dayDate.getUTCFullYear(), bm = dayDate.getUTCMonth() + 1, bd = dayDate.getUTCDate();
  const jdn = Math.floor(julianDay(by, bm, bd, 0) + 0.5);
  const dayGz = (((jdn + 49) % 60) + 60) % 60;
  // 年柱: 立春界
  const lichun = termJdUtc(y, 315);
  const baziYear = jdClock >= (lichun ?? Infinity) ? y : y - 1;
  const yearGz = (((baziYear - 4) % 60) + 60) % 60;
  // 月柱: 十二节(用真太阳时出生瞬间: 钟表JD + 真太阳时修正)
  const birthSolarJd = jdClock + (tst - (hh + mm / 60.0)) / 24.0;
  const candidates: [number, string][] = [];
  for (const yy of [y - 1, y, y + 1]) {
    for (const [lonT, br] of JIE) {
      const jdT = termJdUtc(yy, lonT);
      if (jdT !== null && jdT <= birthSolarJd) candidates.push([jdT, br]);
    }
  }
  candidates.sort((a, b) => a[0] - b[0]);
  const [termJd, monthBranch] = candidates[candidates.length - 1];
  const monthBranchIdx = BRANCHES.indexOf(monthBranch);
  const mStem = WU_HU[STEMS[yearGz % 10]];  // 寅月干,再顺推到实际月支
  // 注意: 子/丑月在寅月之前,步数须 mod 12 顺推(倒推会绕进上一年的干序)
  const sMonth = (STEMS.indexOf(mStem) + (((monthBranchIdx - 2) % 12) + 12) % 12) % 10;
  const monthGz = stemBranchToGz(sMonth, monthBranchIdx);
  // 时柱: 五鼠遁(子时干,再推进到实际时支)
  const hStem = WU_SHU[STEMS[dayGz % 10]];
  const sHour = (STEMS.indexOf(hStem) + hourIdx) % 10;
  const hourGz = stemBranchToGz(sHour, hourIdx);
  // 边界警告: 真太阳时距时辰界(奇数整点) <10 分钟
  const warnings: string[] = [];
  const hStart = hourIdx * 2 - 1;  // 本时辰起点(奇数整点)
  const dist = Math.min(Math.abs(tstN - hStart), Math.abs(hStart + 2 - tstN));
  if (dist < 0.17) warnings.push(`⚠ 真太阳时距时辰边界仅 ${Math.round(dist * 60)} 分钟,时柱可能翻转`);
  if ((birthSolarJd - termJd) * 24 < 0.3) warnings.push("⚠ 出生紧贴节气瞬间,月柱不稳");
  return {
    tst: tstN, eot, hourIdx, nightZi,
    pillars: [yearGz, monthGz, dayGz, hourGz],
    baziYear, warnings, birthSolarJd,
    dayDate: { y: by, m: bm, d: bd },
  };
}

// ---------------- 旺衰 / 大运 / 神煞 ----------------

export interface Strength { ratio: number; deLing: boolean; deDi: boolean; deShi: boolean }

/** 透明打分(启发式): 返回(支持占比, 得令, 得根, 得势) */
export function strength(dayStemIdx: number, pillars: number[]): Strength {
  const dayE = STEM_ELEM[dayStemIdx];
  const gen: Record<string, string> = { "木": "水", "火": "木", "土": "火", "金": "土", "水": "金" };
  const supportE = new Set([dayE, gen[dayE]]);
  const opposeE = new Set(["木", "火", "土", "金", "水"].filter((e) => !supportE.has(e)));
  let sup = 0.0, opp = 0.0;
  for (let i = 0; i < pillars.length; i++) {
    const gz = pillars[i];
    const b = gz % 12;
    if (i === 1) {  // 月令权重最高
      if (supportE.has(BRANCH_ELEM[b])) sup += 3.0;
      if (opposeE.has(BRANCH_ELEM[b])) opp += 3.0;
      for (const h of HIDDEN[BRANCHES[b]].slice(1)) {
        if (supportE.has(STEM_ELEM[STEMS.indexOf(h)])) sup += 0.7;
        else if (opposeE.has(STEM_ELEM[STEMS.indexOf(h)])) opp += 0.7;
      }
    } else {
      const w = i === 2 ? 1.2 : 1.0;
      if (supportE.has(BRANCH_ELEM[b])) sup += w;
      else if (opposeE.has(BRANCH_ELEM[b])) opp += w;
    }
  }
  for (let i = 0; i < pillars.length; i++) {
    if (i === 2) continue;
    const e = STEM_ELEM[pillars[i] % 10];
    if (supportE.has(e)) sup += 1.0;
    else if (opposeE.has(e)) opp += 1.0;
  }
  const ratio = sup + opp ? sup / (sup + opp) : 0.5;
  const monthB = pillars[1] % 12;
  const deLing = supportE.has(BRANCH_ELEM[monthB]);
  const deDi = pillars.some((gz) => supportE.has(BRANCH_ELEM[gz % 12]));
  const otherStems = [pillars[0] % 10, pillars[1] % 10, pillars[3] % 10];
  const deShi = otherStems.filter((s) => supportE.has(STEM_ELEM[s])).length >= 2;
  return { ratio, deLing, deDi, deShi };
}

/** 大运列表 [干支...] + 起运岁数 + 顺逆 */
export function dayun(monthGz: number, yearGz: number, gender: string, birthSolarJd: number, y: number): [number[], number, boolean] {
  const yangYear = yearGz % 2 === 0;
  const forward = (yangYear && gender === "male") || (!yangYear && gender === "female");
  let jdT: number | null = null;
  if (forward) {
    for (const yy of [y, y + 1]) {
      for (const [lonT] of JIE) {
        const jdC = termJdUtc(yy, lonT);
        if (jdC !== null && jdC > birthSolarJd && (jdT === null || jdC < jdT)) jdT = jdC;
      }
    }
  } else {
    for (const yy of [y - 1, y]) {
      for (const [lonT] of JIE) {
        const jdC = termJdUtc(yy, lonT);
        if (jdC !== null && jdC <= birthSolarJd && (jdT === null || jdC > jdT)) jdT = jdC;
      }
    }
  }
  const days = Math.abs((jdT ?? birthSolarJd) - birthSolarJd);
  const startYears = days / 3.0;
  const step = forward ? 1 : -1;
  const out: number[] = [];
  let gz = monthGz;
  for (let k = 1; k <= 8; k++) {
    gz = (((gz + step) % 60) + 60) % 60;
    out.push(gz);
  }
  return [out, startYears, forward];
}

const TIAN_YI: Record<string, [string, string]> = {
  "甲": ["丑", "未"], "戊": ["丑", "未"], "庚": ["丑", "未"], "乙": ["子", "申"],
  "己": ["子", "申"], "丙": ["亥", "酉"], "丁": ["亥", "酉"], "壬": ["巳", "卯"],
  "癸": ["巳", "卯"], "辛": ["午", "寅"],
};
const TRIAD: Record<string, number> = {
  "申": 0, "子": 0, "辰": 0, "寅": 1, "午": 1, "戌": 1, "巳": 2, "酉": 2, "丑": 2,
  "亥": 3, "卯": 3, "未": 3,
};
const TAOHUA = ["酉", "卯", "午", "子"];
const YIMA = ["寅", "申", "亥", "巳"];
const HUAGAI = ["辰", "戌", "丑", "未"];
const JIANGXING = ["子", "午", "酉", "卯"];
const WENCHANG: Record<string, string> = {
  "甲": "巳", "乙": "午", "丙": "申", "戊": "申", "丁": "酉", "己": "酉",
  "庚": "亥", "辛": "子", "壬": "寅", "癸": "卯",
};
const YANG_REN: Record<string, string> = { "甲": "卯", "丙": "午", "戊": "午", "庚": "酉", "壬": "子" };
const YIN_CHA_YANG_CUO = new Set(["丙子", "丁丑", "戊寅", "辛卯", "壬辰", "癸巳", "丙午", "丁未", "戊申", "辛酉", "壬戌", "癸亥"]);
const KUI_GANG = new Set(["庚辰", "庚戌", "壬辰", "戊戌"]);
const HONG_LUAN = ["卯", "寅", "丑", "子", "亥", "戌", "酉", "申", "未", "午", "巳", "辰"];
export const LIU_HE: Record<string, string> = {
  "子": "丑", "丑": "子", "寅": "亥", "亥": "寅", "卯": "戌", "戌": "卯",
  "辰": "酉", "酉": "辰", "巳": "申", "申": "巳", "午": "未", "未": "午",
};
export const LIU_CHONG: Record<string, string> = {
  "子": "午", "午": "子", "丑": "未", "未": "丑", "寅": "申", "申": "寅",
  "卯": "酉", "酉": "卯", "辰": "戌", "戌": "辰", "巳": "亥", "亥": "巳",
};
export const LIU_HAI: Record<string, string> = {
  "子": "未", "未": "子", "丑": "午", "午": "丑", "寅": "巳", "巳": "寅",
  "卯": "辰", "辰": "卯", "申": "亥", "亥": "申", "酉": "戌", "戌": "酉",
};

export function shensha(pillars: number[]): Record<string, string[]> {
  const [y, mo, day, h] = pillars;
  const dstem = STEMS[day % 10], dbranch = BRANCHES[day % 12];
  const res: Record<string, string[]> = {};
  const ty = TIAN_YI[dstem];
  res["天乙贵人"] = [BRANCHES[y % 12], BRANCHES[h % 12]].filter((b) => ty.includes(b));
  const tri = TRIAD[dbranch];
  res["咸池桃花"] = [BRANCHES[y % 12], BRANCHES[h % 12]].filter((b) => b === TAOHUA[tri]);
  res["驿马"] = [BRANCHES[y % 12], BRANCHES[mo % 12], BRANCHES[h % 12]].filter((b) => b === YIMA[tri]);
  res["华盖"] = [BRANCHES[y % 12], BRANCHES[mo % 12], BRANCHES[h % 12]].filter((b) => b === HUAGAI[tri]);
  res["将星"] = dbranch === JIANGXING[tri] ? ["日支" + dbranch] : [];
  res["文昌"] = [BRANCHES[mo % 12], BRANCHES[h % 12]].filter((b) => b === WENCHANG[dstem]);
  if (dstem in YANG_REN) {
    res["羊刃"] = [BRANCHES[mo % 12], BRANCHES[h % 12]].filter((b) => b === YANG_REN[dstem]);
  }
  const xun = day - day % 10;
  res["空亡"] = [BRANCHES[(xun % 12 + 10) % 12], BRANCHES[(xun % 12 + 11) % 12]];
  if (YIN_CHA_YANG_CUO.has(gzName(day))) res["阴差阳错日"] = ["是"];
  if (KUI_GANG.has(gzName(day))) res["魁罡"] = ["是"];
  const hl = HONG_LUAN[y % 12];
  res["红鸾/天喜"] = ["红鸾" + hl, "天喜" + LIU_CHONG[hl]];
  return res;
}

/** 流年: 返回 [干支名, 关系列表] */
export function liunian(pillars: number[], year: number): [string, string[]] {
  const gz = (((year - 4) % 60) + 60) % 60;
  const b = BRANCHES[gz % 12];
  const rel: string[] = [];
  const tags = ["年", "月", "日", "时"];
  pillars.forEach((p, i) => {
    const pb = BRANCHES[p % 12];
    if (LIU_CHONG[b] === pb) rel.push(`冲${tags[i]}支${pb}`);
    if (LIU_HE[b] === pb) rel.push(`合${tags[i]}支${pb}`);
    if (LIU_HAI[b] === pb) rel.push(`害${tags[i]}支${pb}`);
  });
  return [gzName(gz), rel];
}

/** 公历→农历的展示串（含干支年+生肖） */
export function lunarStr(y: number, m: number, d: number): string {
  const { year: ly, month: lm, isLeap: lleap, day: ld } = solarToLunar(y, m, d);
  const ygz = gzName((ly - 4 + 960) % 60);
  return `${ygz[0]}年${lleap ? "闰" : ""}${LUNAR_MONTH_CN[lm - 1]}月${LUNAR_DAY_CN[ld - 1]} (${SHENG_XIAO[BRANCHES.indexOf(ygz[1])]}年)`;
}

/** 中国大陆 1986–1991 夏季夏令时(钟表比标准时快1h)。返回 true=应减1h */
export function inDstWindow(y: number, m: number, d: number): boolean {
  if (y < 1986 || y > 1991) return false;
  return (m > 4 || (m === 4 && d >= 15)) && (m < 9 || (m === 9 && d <= 14));
}
