// misc.ts — 轻计算命理模块: 生命数字 / 称骨 / 九星气学 / 玛雅历 / 二十八宿
// 依据 fortune-calc skill references/misc-systems.md。全部为民俗/新时代系统,
// 输出统一标注娱乐与参考属性。称骨只给骨重与中性概括,不引歌诀(禁编造古籍原文)。
import { gzName, solarToLunar, STEMS, BRANCHES } from "./bazi";
import { lahiriAyanamsa, mod360 } from "./astro";

// ---------------- 生命数字 ----------------

const NUM_MEANING: Record<number, string> = {
  1: "开创", 2: "协作", 3: "表达", 4: "稳建", 5: "自由", 6: "责任",
  7: "探究", 8: "权力", 9: "博爱", 11: "灵性直觉", 22: "建筑大师", 33: "疗愈导师",
};

function reduceNum(n: number): number {
  while (n > 9 && n !== 11 && n !== 22 && n !== 33) {
    n = String(n).split("").reduce((s, c) => s + Number(c), 0);
  }
  return n;
}

export interface Numerology {
  lifePath: number; lifePathMeaning: string; birthday: number; birthdayMeaning: string;
  expression?: number; soul?: number; personality?: number;
}

const PYTH: Record<string, number> = {};
"ajs".split("").forEach((c) => (PYTH[c] = 1));
"bkt".split("").forEach((c) => (PYTH[c] = 2));
"clu".split("").forEach((c) => (PYTH[c] = 3));
"dmv".split("").forEach((c) => (PYTH[c] = 4));
"enw".split("").forEach((c) => (PYTH[c] = 5));
"fox".split("").forEach((c) => (PYTH[c] = 6));
"gpy".split("").forEach((c) => (PYTH[c] = 7));
"hqz".split("").forEach((c) => (PYTH[c] = 8));
"ir".split("").forEach((c) => (PYTH[c] = 9));
const VOWELS = new Set("aeiou");

/** nameLetters: 姓名的拉丁字母转写(中文名给拼音),不传则只算日期数 */
export function numerology(y: number, m: number, d: number, nameLetters?: string): Numerology {
  const dateStr = `${y}${String(m).padStart(2, "0")}${String(d).padStart(2, "0")}`;
  const lifePath = reduceNum(dateStr.split("").reduce((s, c) => s + Number(c), 0));
  const birthday = reduceNum(d);
  const out: Numerology = {
    lifePath, lifePathMeaning: NUM_MEANING[lifePath] ?? "",
    birthday, birthdayMeaning: NUM_MEANING[birthday] ?? "",
  };
  if (nameLetters) {
    const letters = nameLetters.toLowerCase().replace(/[^a-z]/g, "");
    const expr = reduceNum(letters.split("").reduce((s, c) => s + (PYTH[c] ?? 0), 0));
    const soul = reduceNum(letters.split("").filter((c) => VOWELS.has(c)).reduce((s, c) => s + (PYTH[c] ?? 0), 0));
    const pers = reduceNum(letters.split("").filter((c) => !VOWELS.has(c)).reduce((s, c) => s + (PYTH[c] ?? 0), 0));
    out.expression = expr; out.soul = soul; out.personality = pers;
  }
  return out;
}

// ---------------- 称骨算命(袁天罡) ----------------
// 骨重表(两): 年(60甲子) / 月(农历1-12) / 日(农历1-30) / 时(12时辰)

const CHENGGU_YEAR = [
  1.2, 0.9, 0.6, 0.7, 1.2, 0.9, 0.9, 0.8, 0.7, 0.8, 1.5, 0.9, 1.6, 0.8, 0.8, 1.9, 1.2, 0.6, 0.8, 0.7,
  1.5, 1.5, 0.6, 1.6, 1.5, 0.7, 0.9, 1.2, 1.0, 0.7, 1.5, 0.8, 0.5, 1.4, 1.4, 0.9, 1.2, 0.7, 0.9, 1.2,
  1.2, 0.7, 1.3, 0.5, 1.4, 0.5, 0.9, 1.7, 0.5, 0.7, 1.2, 0.8, 1.6, 0.6, 1.9, 0.6, 0.8, 1.6, 0.6, 0.6,
];
const CHENGGU_MONTH = [0.6, 0.7, 1.8, 0.9, 0.5, 1.6, 0.9, 1.5, 1.8, 0.8, 0.9, 0.5];
const CHENGGU_DAY = [
  0.5, 1.0, 0.8, 1.5, 0.5, 1.5, 0.8, 1.6, 0.8, 1.6, 0.9, 1.7, 0.8, 1.7, 1.0, 0.8, 0.9, 1.8, 0.5, 1.5,
  1.0, 0.9, 0.8, 0.9, 1.5, 1.8, 0.7, 0.8, 1.6, 0.6,
];
const CHENGGU_HOUR = [1.6, 0.6, 0.7, 1.0, 0.9, 1.6, 1.0, 0.8, 0.8, 0.9, 0.6, 0.6];

export interface ChengGu {
  total: number; yearW: number; monthW: number; dayW: number; hourW: number;
  yearGz: string; summary: string;
}

export function chenggu(y: number, m: number, d: number, hourBranchIdx: number): ChengGu {
  const lunar = solarToLunar(y, m, d);
  const yearW = CHENGGU_YEAR[(lunar.year - 4 + 240) % 60];
  const monthW = CHENGGU_MONTH[lunar.month - 1];
  const dayW = CHENGGU_DAY[lunar.day - 1];
  const hourW = CHENGGU_HOUR[hourBranchIdx];
  const total = Math.round((yearW + monthW + dayW + hourW) * 10) / 10;
  const yearGz = gzName((lunar.year - 4 + 240) % 60);
  // 中性概括: 轻=自立早、重=承载大(不引歌诀,不下吉凶断语)
  let summary: string;
  if (total < 3.0) summary = "偏轻: 传统取象为自立较早、凡事亲力亲为";
  else if (total < 4.0) summary = "中等偏轻: 有担当也有弹性,进退空间大";
  else if (total < 5.0) summary = "中等: 承载与得助相当,稳中可行的格局";
  else if (total < 6.0) summary = "中等偏重: 责任与福分都厚,承载较大";
  else summary = "偏重: 传统取象为承载大、根基厚,亦多得助";
  return { total, yearW, monthW, dayW, hourW, yearGz, summary };
}

// ---------------- 日本九星气学 ----------------

export const KYUSEI_NAMES: Record<number, string> = {
  1: "一白水星", 2: "二黑土星", 3: "三碧木星", 4: "四绿木星", 5: "五黄土星",
  6: "六白金星", 7: "七赤金星", 8: "八白土星", 9: "九紫火星",
};

/** 本命星: 年各位数字反复相加至个位 s; 星数 = 11−s(得10取1); 立春(2/4)前算前一年 */
export function kyusei(y: number, m: number, d: number): { star: number; name: string; usedYear: number; beforeLichun: boolean } {
  const beforeLichun = m < 2 || (m === 2 && d < 4);
  const usedYear = beforeLichun ? y - 1 : y;
  let s = String(usedYear).split("").reduce((sum, c) => sum + Number(c), 0);
  while (s > 9) s = String(s).split("").reduce((sum, c) => sum + Number(c), 0);
  let star = 11 - s;
  if (star === 10) star = 1;
  return { star, name: KYUSEI_NAMES[star], usedYear, beforeLichun };
}

// ---------------- 玛雅历(Tzolk'in 传统计数) ----------------
// 锚点: 2012-12-21 = 4 Ahau(13.0.0.0.0, 史实锚点)。
// 注: misc-systems.md 参考文档里"第260日"与该锚点不完全自洽,此处按史实锚点实现。

const MAYA_DAYS = ["Imix", "Ik", "Akbal", "Kan", "Chicchan", "Cimi", "Manik", "Lamat", "Muluc", "Oc",
  "Chuen", "Eb", "Ben", "Ix", "Men", "Cib", "Caban", "Etznab", "Cauac", "Ahau"];
const MAYA_CN: Record<string, string> = {
  Imix: "鳄", Ik: "风", Akbal: "夜", Kan: "蜥蜴", Chicchan: "蛇", Cimi: "死", Manik: "鹿",
  Lamat: "兔", Muluc: "水", Oc: "狗", Chuen: "猴", Eb: "草", Ben: "苇", Ix: "豹",
  Men: "鹰", Cib: "秃鹫", Caban: "地震", Etznab: "燧石", Cauac: "雨", Ahau: "主人",
};

export function maya(y: number, m: number, d: number): { num: number; day: string; cn: string; kin: number } {
  const diff = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(2012, 11, 21)) / 86400000);
  const pmod = (x: number, n: number) => ((x % n) + n) % n;
  const num = pmod(diff + 3, 13) + 1;          // 1-13
  const dayIdx = pmod(diff + 19, 20);          // 0-19
  const kin = pmod(diff, 260) + 1;             // 卓尔金历 1-260
  return { num, day: MAYA_DAYS[dayIdx], cn: MAYA_CN[MAYA_DAYS[dayIdx]], kin };
}

// ---------------- 二十八宿(天文口径) ----------------

export const XIU28 = ["角", "亢", "氐", "房", "心", "尾", "箕", "斗", "牛", "女", "虚", "危", "室", "壁",
  "奎", "娄", "胃", "昴", "毕", "觜", "参", "井", "鬼", "柳", "星", "张", "翼", "轸"];
const XIU4: Record<string, string> = {
  "东方苍龙": "角亢氐房心尾箕", "北方玄武": "斗牛女虚危室壁",
  "西方白虎": "奎娄胃昴毕觜参", "南方朱雀": "井鬼柳星张翼轸",
};

/** 按出生时月亮恒星黄经等分28宿(简化口径;古制各宿宽度不等) */
export function xiu28(moonTropicalLon: number, jd: number): { xiu: string; xiang: string; sid: number } {
  const sid = mod360(moonTropicalLon - lahiriAyanamsa(jd));
  const idx = Math.floor(sid / (360 / 28)) % 28;
  const xiu = XIU28[idx];
  const xiang = Object.entries(XIU4).find(([, v]) => v.includes(xiu))![0];
  return { xiu, xiang, sid };
}

export function stemOf(i: number): string { return STEMS[i]; }
export function branchOf(i: number): string { return BRANCHES[i]; }
