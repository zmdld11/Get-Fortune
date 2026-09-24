// ziwei.ts — 紫微斗数安星(全书派通行口径)
// 依据 fortune-calc skill references/ziwei.md(手算流程文档)公式化实现。
// 口径声明: 闰月生人以十五为界(上半月随前月、下半月随后月);庚干/戊干四化各派有异,
// 此处取全书版并在输出中标注。
import { solarToLunar, gzName, BRANCHES, STEMS, NAYIN } from "./bazi";

const ELEM_TO_JU: Record<string, number> = { "水": 2, "木": 3, "金": 4, "土": 5, "火": 6 };

// 十干四化(全书版): [化禄, 化权, 化科, 化忌]
const SIHUA: Record<string, [string, string, string, string]> = {
  "甲": ["廉贞", "破军", "武曲", "太阳"],
  "乙": ["天机", "天梁", "紫微", "太阴"],
  "丙": ["天同", "天机", "文昌", "廉贞"],
  "丁": ["太阴", "天同", "天机", "巨门"],
  "戊": ["贪狼", "太阴", "右弼", "天机"],
  "己": ["武曲", "贪狼", "天梁", "文曲"],
  "庚": ["太阳", "武曲", "太阴", "天同"],
  "辛": ["巨门", "太阳", "文曲", "文昌"],
  "壬": ["天梁", "紫微", "左辅", "武曲"],
  "癸": ["破军", "巨门", "太阴", "贪狼"],
};
// 年干禄存位(地支序)
const LUCUN: Record<string, number> = {
  "甲": 2, "乙": 3, "丙": 5, "戊": 5, "丁": 6, "己": 6, "庚": 8, "辛": 9, "壬": 11, "癸": 0,
};
// 天魁/天钺(年干): [魁支序, 钺支序]
const KUI_YUE: Record<string, [number, number]> = {
  "甲": [1, 7], "戊": [1, 7], "庚": [1, 7], "乙": [0, 8], "己": [0, 8],
  "丙": [11, 9], "丁": [11, 9], "壬": [3, 5], "癸": [3, 5], "辛": [6, 2],
};
const WUHU_START: Record<string, number> = {
  "甲": 2, "己": 2, "乙": 4, "庚": 4, "丙": 6, "辛": 6, "丁": 8, "壬": 8, "戊": 0, "癸": 0,
};  // 寅宫天干序: 甲己丙 乙庚戊 丙辛庚 丁壬壬 戊癸甲

export interface ZiweiPalace {
  branchIdx: number; branch: string; stem: string;
  name: string; stars: string[]; isShen: boolean;
  majorLimit: string | null;
}

export interface ZiweiChart {
  ju: number; juName: string; mingIdx: number; shenIdx: number;
  yearGz: string; palaces: ZiweiPalace[];
  sihua: Record<string, string>; sihuaNote: string;
  leapAdjusted: boolean; effectiveMonth: number;
  mingStars: string[];
}

const PALACE_NAMES = ["命宫", "兄弟", "夫妻", "子女", "财帛", "疾厄", "迁移", "仆役", "官禄", "田宅", "福德", "父母"];

const mod12 = (x: number) => ((x % 12) + 12) % 12;

/**
 * 安星全流程。
 * @param y,m,d    公历出生日期(内部转农历)
 * @param hourIdx  时支序(子=0..亥=11),建议用真太阳时
 * @param gender   male/female
 */
export function ziweiChart(y: number, m: number, d: number, hourIdx: number, gender: string): ZiweiChart {
  const lunar = solarToLunar(y, m, d);
  // 闰月以十五为界
  let effMonth = lunar.month;
  let leapAdjusted = false;
  if (lunar.isLeap) {
    effMonth = lunar.day <= 15 ? lunar.month : lunar.month + 1;
    leapAdjusted = true;
    if (effMonth > 12) { effMonth = 12; }
  }
  const ly = lunar.year;
  const yearGzIdx = ((ly - 4) % 60 + 60) % 60;
  const yearStem = STEMS[yearGzIdx % 10];

  // 1. 命宫/身宫(支): 寅起正月顺数至生月,再由该宫起子时: 命宫逆数、身宫顺数至生时
  const mingIdx = mod12(2 + (effMonth - 1) - hourIdx);
  const shenIdx = mod12(2 + (effMonth - 1) + hourIdx);

  // 2. 各宫天干(五虎遁) + 命宫五行局(纳音,取纳音名末字为五行)
  const stemStart = WUHU_START[yearStem];
  const palaceStem = (branchIdx: number) => STEMS[(stemStart + mod12(branchIdx - 2)) % 10];
  const mingGzIdx = stemBranchGzIdx(STEMS.indexOf(palaceStem(mingIdx)), mingIdx);
  const ju = ELEM_TO_JU[NAYIN[Math.floor(mingGzIdx / 2)].slice(-1)];
  const juName = `${["水", "木", "金", "土", "火"].find((e) => ELEM_TO_JU[e] === ju)}${ju}局`;

  // 3. 紫微定位(公式法,已验证对得上标准表)
  const dd = lunar.day;
  const j = mod12(ju - (dd % ju)) % ju;
  let pos = 2 + Math.floor((dd + j) / ju) - 1;
  if (j % 2 === 1) pos -= j;
  else if (j > 0) pos += j;
  const zw = mod12(pos);          // 紫微地支序
  const fw = mod12(4 - zw);       // 天府(寅申轴对称)

  // 4. 十四主星
  const starPos: Record<string, number> = {
    "紫微": zw,
    "天机": mod12(zw - 1),
    "太阳": mod12(zw - 3),
    "武曲": mod12(zw - 4),
    "天同": mod12(zw - 5),
    "廉贞": mod12(zw - 8),
    "天府": fw,
    "太阴": mod12(fw + 1),
    "贪狼": mod12(fw + 2),
    "巨门": mod12(fw + 3),
    "天相": mod12(fw + 4),
    "天梁": mod12(fw + 5),
    "七杀": mod12(fw + 6),
    "破军": mod12(fw + 10),
  };

  // 5. 四化(年干)
  const [lh, qq, kx, jj] = SIHUA[yearStem];
  const sihua: Record<string, string> = { [lh]: "禄", [qq]: "权", [kx]: "科", [jj]: "忌" };
  const sihuaNote = yearStem === "庚" ? "庚干化科取太阴(化科太阴/天同各派有异,此处取全书派)"
    : yearStem === "戊" ? "戊干化科取右弼(各派有异,此处取全书派)" : "全书版";

  // 6. 六吉六煞(常用八颗) + 禄存/擎羊/陀罗
  const lc = LUCUN[yearStem];
  starPos["禄存"] = lc;
  starPos["擎羊"] = mod12(lc + 1);
  starPos["陀罗"] = mod12(lc - 1);
  starPos["文昌"] = mod12(10 - hourIdx);   // 戌宫起子时逆数
  starPos["文曲"] = mod12(4 + hourIdx);    // 辰宫起子时顺数
  starPos["左辅"] = mod12(4 + effMonth - 1);
  starPos["右弼"] = mod12(10 - (effMonth - 1));
  const [kui, yue] = KUI_YUE[yearStem];
  starPos["天魁"] = kui;
  starPos["天钺"] = yue;
  // ⚠ 火星/铃星/地空/地劫各派起宫表有出入,不硬排(注明)

  // 7. 大限: 阳男阴女顺行、阴男阳女逆行,从命宫起,每宫十年,起始岁数=局数
  const yangYear = yearGzIdx % 2 === 0;
  const forward = (yangYear && gender === "male") || (!yangYear && gender === "female");

  const palaces: ZiweiPalace[] = [];
  for (let i = 0; i < 12; i++) {
    const branchIdx = mod12(mingIdx - i);   // 命宫逆行排十二宫
    const stars: string[] = [];
    for (const [star, p] of Object.entries(starPos)) {
      if (p === branchIdx) stars.push(star + (sihua[star] ? `化${sihua[star]}` : ""));
    }
    // 大限: 从命宫(起始岁=局数)起每宫十年,顺逆跟阴阳男女
    const rank = forward ? mod12(branchIdx - mingIdx) : mod12(mingIdx - branchIdx);
    const startAge = ju + rank * 10;
    const endAge = startAge + 9;
    palaces.push({
      branchIdx, branch: BRANCHES[branchIdx], stem: palaceStem(branchIdx),
      name: PALACE_NAMES[i], stars, isShen: branchIdx === shenIdx,
      majorLimit: `${startAge}-${endAge}`,
    });
  }
  const mingPalace = palaces[0];
  return {
    ju, juName, mingIdx, shenIdx, yearGz: gzName(yearGzIdx), palaces,
    sihua, sihuaNote, leapAdjusted, effectiveMonth: effMonth,
    mingStars: mingPalace.stars,
  };
}

function stemBranchGzIdx(s: number, b: number): number {
  for (let k = 0; k < 6; k++) {
    const n = s + 10 * k;
    if (n % 12 === b % 12) return n % 60;
  }
  throw new Error(`干支不同奇偶: ${s},${b}`);
}
