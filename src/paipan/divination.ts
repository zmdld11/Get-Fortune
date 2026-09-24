// divination.ts — 梅花易数时间起卦 + 六爻纳甲装卦
// 移植自 fortune-calc skill 的 scripts/divination.py。
import { solarToLunar, fourPillars, STEMS } from "./bazi";

// 八卦: 先天数1-8 → 爻(自下而上, 阳=1)
export const GU_BIN: Record<number, [number, number, number]> = {
  1: [1, 1, 1], 2: [1, 1, 0], 3: [1, 0, 1], 4: [1, 0, 0],
  5: [0, 1, 1], 6: [0, 1, 0], 7: [0, 0, 1], 8: [0, 0, 0],
};
const BIN_GU: Record<string, number> = {};
for (const [k, v] of Object.entries(GU_BIN)) BIN_GU[v.join("")] = Number(k);
export const GU_NAME: Record<number, string> = { 1: "乾", 2: "兑", 3: "离", 4: "震", 5: "巽", 6: "坎", 7: "艮", 8: "坤" };
export const GU_ELEM: Record<number, string> = { 1: "金", 2: "金", 3: "火", 4: "木", 5: "木", 6: "水", 7: "土", 8: "土" };
export const HEX_NAME: Record<string, string> = {
  "1,1": "乾为天", "1,2": "天泽履", "1,3": "天火同人", "1,4": "天雷无妄",
  "1,5": "天风姤", "1,6": "天水讼", "1,7": "天山遁", "1,8": "天地否",
  "2,1": "泽天夬", "2,2": "兑为泽", "2,3": "泽火革", "2,4": "泽雷随",
  "2,5": "泽风大过", "2,6": "泽水困", "2,7": "泽山咸", "2,8": "泽地萃",
  "3,1": "火天大有", "3,2": "火泽睽", "3,3": "离为火", "3,4": "火雷噬嗑",
  "3,5": "火风鼎", "3,6": "火水未济", "3,7": "火山旅", "3,8": "火地晋",
  "4,1": "雷天大壮", "4,2": "雷泽归妹", "4,3": "雷火丰", "4,4": "震为雷",
  "4,5": "雷风恒", "4,6": "雷水解", "4,7": "雷山小过", "4,8": "雷地豫",
  "5,1": "风天小畜", "5,2": "风泽中孚", "5,3": "风火家人", "5,4": "风雷益",
  "5,5": "巽为风", "5,6": "风水涣", "5,7": "风山渐", "5,8": "风地观",
  "6,1": "水天需", "6,2": "水泽节", "6,3": "水火既济", "6,4": "水雷屯",
  "6,5": "水风井", "6,6": "坎为水", "6,7": "水山蹇", "6,8": "水地比",
  "7,1": "山天大畜", "7,2": "山泽损", "7,3": "山火贲", "7,4": "山雷颐",
  "7,5": "山风蛊", "7,6": "山水蒙", "7,7": "艮为山", "7,8": "山地剥",
  "8,1": "地天泰", "8,2": "地泽临", "8,3": "地火明夷", "8,4": "地雷复",
  "8,5": "地风升", "8,6": "地水师", "8,7": "地山谦", "8,8": "坤为地",
};

function bitsToGu(bits: number[]): number { return BIN_GU[bits.join("")]; }

export function bitsToName(bits: number[]): string {
  // bits: 6爻自下而上(0-5)
  return HEX_NAME[`${bitsToGu(bits.slice(3))},${bitsToGu(bits.slice(0, 3))}`];
}

const SHENG: Record<string, string> = { "木": "火", "火": "土", "土": "金", "金": "水", "水": "木" };
const KE: Record<string, string> = { "木": "土", "土": "水", "水": "火", "火": "金", "金": "木" };

export interface MeihuaCast {
  ben: number[]; name: string; changed: number[]; changedName: string;
  hu: number[]; huName: string;
  moving: number; up: number; low: number;
  tiGu: number; yongGu: number; tiElem: string; yongElem: string; tiYongRel: string;
}

/** 年支数(子1..亥12)/农历月/农历日/时支数(子1..亥12) → 卦象 */
export function meihuaTimeCast(yearZhiNum: number, lunarMonth: number, lunarDay: number, hourZhiNum: number): MeihuaCast {
  const s1 = yearZhiNum + lunarMonth + lunarDay;
  const s2 = s1 + hourZhiNum;
  const up = s1 % 8 || 8;
  const low = s2 % 8 || 8;
  const moving = s2 % 6 || 6;
  const bits = [...GU_BIN[low], ...GU_BIN[up]];  // 自下而上: 下卦在前(0-2), 上卦(3-5)
  const changed = [...bits];
  changed[moving - 1] ^= 1;
  const huLow = [bits[1], bits[2], bits[3]];
  const huUp = [bits[2], bits[3], bits[4]];
  // 体用: 动爻在下方三爻(初~三爻)→下卦为用,上卦为体;动爻在四~六爻→上卦为用
  let tiGu: number, yongGu: number;
  if (moving <= 3) { tiGu = up; yongGu = low; } else { tiGu = low; yongGu = up; }
  const ti = GU_ELEM[tiGu], yong = GU_ELEM[yongGu];
  let rel: string;
  if (yong === ti) rel = "体用比和(顺利,人事同心)";
  else if (SHENG[ti] === yong) rel = "体生用(泄气:付出、耗神,事多辛苦)";
  else if (SHENG[yong] === ti) rel = "用生体(进益:得助、得财、得人心)";
  else if (KE[ti] === yong) rel = "体克用(可成:我能掌控事,但需费力)";
  else rel = "用克体(受制:事带压力,需谨慎)";
  return {
    ben: bits, name: bitsToName(bits), changed, changedName: bitsToName(changed),
    hu: [...huLow, ...huUp], huName: bitsToName([...huLow, ...huUp]),
    moving, up, low,
    tiGu, yongGu, tiElem: ti, yongElem: yong, tiYongRel: rel,
  };
}

// ---------------- 六爻纳甲 ----------------

const NAJIA_IN: Record<string, string[]> = {
  "乾": ["子", "寅", "辰"], "坎": ["寅", "辰", "午"], "艮": ["辰", "午", "申"],
  "震": ["子", "寅", "辰"], "巽": ["丑", "亥", "酉"], "离": ["卯", "丑", "亥"],
  "坤": ["未", "巳", "卯"], "兑": ["巳", "卯", "丑"],
};
const NAJIA_OUT: Record<string, string[]> = {
  "乾": ["午", "申", "戌"], "坎": ["申", "戌", "子"], "艮": ["戌", "子", "寅"],
  "震": ["午", "申", "戌"], "巽": ["未", "巳", "卯"], "离": ["酉", "未", "巳"],
  "坤": ["丑", "亥", "酉"], "兑": ["亥", "酉", "未"],
};
const NAJIA_STEM: Record<string, [string, string]> = {
  "乾": ["甲", "壬"], "坎": ["戊", "戊"], "艮": ["丙", "丙"], "震": ["庚", "庚"],
  "巽": ["辛", "辛"], "离": ["己", "己"], "坤": ["乙", "癸"], "兑": ["丁", "丁"],
};
const BR_ELEM: Record<string, string> = {
  "子": "水", "亥": "水", "寅": "木", "卯": "木", "巳": "火", "午": "火",
  "申": "金", "酉": "金", "辰": "土", "戌": "土", "丑": "土", "未": "土",
};

function guNumByName(name: string): number {
  for (const [k, v] of Object.entries(GU_NAME)) if (v === name) return Number(k);
  throw new Error("unknown gu " + name);
}

/** 八宫归属: {卦名: [宫名, 世爻1-6, 类型]} */
function buildPalaces(): Record<string, [string, number, string]> {
  const palaces: Record<string, [string, number, string]> = {};
  for (const gStr of Object.keys(GU_BIN)) {
    const g = Number(gStr);
    const bits3 = GU_BIN[g];
    const pure = [...bits3, ...bits3];
    const name = HEX_NAME[`${g},${g}`];
    palaces[name] = [GU_NAME[g], 6, "本宫"];
    const shapes: Record<string, number[]> = {
      "一世": [0], "二世": [0, 1], "三世": [0, 1, 2], "四世": [0, 1, 2, 3],
      "五世": [0, 1, 2, 3, 4], "游魂": [0, 1, 2, 4], "归魂": [4],
    };
    for (const [typ, flips] of Object.entries(shapes)) {
      const b = [...pure];
      for (const i of flips) b[i] ^= 1;
      const w = { "一世": 1, "二世": 2, "三世": 3, "四世": 4, "五世": 5, "游魂": 4, "归魂": 3 }[typ]!;
      palaces[bitsToName(b)] = [GU_NAME[g], w, typ];
    }
  }
  return palaces;
}

export const PALACES = buildPalaces();

/** 以卦宫五行为我: 同我兄弟/生我父母/我生子孙/克我官鬼/我克妻财 */
function liuGuan(palaceElem: string, branch: string): string {
  const e = BR_ELEM[branch];
  if (e === palaceElem) return "兄弟";
  if (SHENG[e] === palaceElem) return "父母";
  if (SHENG[palaceElem] === e) return "子孙";
  if (KE[e] === palaceElem) return "官鬼";
  return "妻财";
}

const LIU_SHOU: Record<string, string> = {
  "甲": "青龙", "乙": "青龙", "丙": "朱雀", "丁": "朱雀", "戊": "勾陈",
  "己": "腾蛇", "庚": "白虎", "辛": "白虎", "壬": "玄武", "癸": "玄武",
};

/** 装纳甲+六亲。bits 自下而上。返回每爻[六亲, 干支] */
function najia(bits: number[], palaceElem: string): [string, string][] {
  const up = bitsToGu(bits.slice(3)), low = bitsToGu(bits.slice(0, 3));
  const upN = GU_NAME[up], lowN = GU_NAME[low];
  const lines: [string, string][] = [];
  for (let i = 0; i < 6; i++) {
    let br: string, st: string;
    if (i < 3) { br = NAJIA_IN[lowN][i]; st = NAJIA_STEM[lowN][0]; }
    else { br = NAJIA_OUT[upN][i - 3]; st = NAJIA_STEM[upN][1]; }
    lines.push([liuGuan(palaceElem, br), st + br]);
  }
  return lines;
}

export interface LiuyaoCast {
  bits: number[]; name: string; palace: string; world: number; typ: string;
  movers: number[]; changed: number[]; changedName: string | null;
  lines: [string, string][]; beasts?: string[];
}

/** tosses: 初爻→上爻, 值 6老阴/7少阳/8少阴/9老阳 */
export function liuyaoCast(tosses: number[], dayStemChar?: string): LiuyaoCast {
  const bits = tosses.map((t) => (t === 7 || t === 9 ? 1 : 0));
  const movers = tosses.map((t, i) => (t === 6 || t === 9 ? i + 1 : 0)).filter(Boolean);
  const name = bitsToName(bits);
  const [palace, world, typ] = PALACES[name];
  const changed = [...bits];
  for (const i of movers) changed[i - 1] ^= 1;
  const cName = movers.length ? bitsToName(changed) : null;
  const pelem = GU_ELEM[guNumByName(palace)];
  const out: LiuyaoCast = {
    bits, name, palace, world, typ, movers, changed, changedName: cName,
    lines: najia(bits, pelem),
  };
  if (dayStemChar) {
    const shou = LIU_SHOU[dayStemChar];
    const order = ["青龙", "朱雀", "勾陈", "腾蛇", "白虎", "玄武"];
    const i0 = order.indexOf(shou);
    out.beasts = Array.from({ length: 6 }, (_, i) => order[(i0 + i) % 6]);
  }
  return out;
}

/** 无铜钱时的替代: 用农历月日+时支数起卦(梅花法)装六爻——非正统,注明即可 */
export function liuyaoTimeCast(y: number, m: number, d: number, hh: number, mm: number, lonE: number): LiuyaoCast {
  const lunar = solarToLunar(y, m, d);
  const fp = fourPillars(y, m, d, hh, mm, lonE);
  const hnum = fp.hourIdx + 1;
  const yzhi = (((lunar.year - 4) % 12) + 12) % 12 + 1;
  const cast = meihuaTimeCast(yzhi, lunar.month, lunar.day, hnum);
  const tosses = cast.ben.map((b) => (b ? 7 : 8));
  const dayStem = STEMS[fp.pillars[2] % 10];
  return liuyaoCast(tosses, dayStem);
}

/** 网页摇钱: 单次掷三枚铜钱(字=2,背=3),返回 6老阴/7少阳/8少阴/9老阳 */
export function tossCoins(): number {
  const arr = new Uint32Array(3);
  crypto.getRandomValues(arr);
  const sum = arr.reduce((s, v) => s + (v % 2 === 0 ? 3 : 2), 0);
  return sum;
}
