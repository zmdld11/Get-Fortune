// wuge.ts — 姓名五格剖象(日式熊崎法) + 康熙笔画查询
// 依据 fortune-calc skill references/bazi.md §7。
// 康熙笔画数据: data/kangxi.json 由 tools/gen-kangxi.mjs 从 Unicode Unihan 官方
// 数据库(kRSUnicode) + opencc 简繁转换生成,覆盖 2.6 万字,每个笔画数有权威出处;
// 字表里查不到的字 → 不评分并明确标注,禁止猜(任务纪律)。
// 加载策略: 浏览器端懒加载同源静态资源(233KB 不进首屏,首次用姓名五格才下载);
// Node 端(自测)直接读文件。
type StrokeTable = Record<string, number>;

let table: StrokeTable | null = null;
let loading: Promise<StrokeTable> | null = null;

/** 懒加载字表(首次调用才真正取数据,同一次会话只取一次) */
export function loadKangxi(): Promise<StrokeTable> {
  if (table) return Promise.resolve(table);
  if (!loading) {
    loading = (async () => {
      if (typeof window === "undefined") {
        const { readFile } = await import("node:fs/promises");
        table = JSON.parse(await readFile(new URL("./data/kangxi.json", import.meta.url), "utf8")) as StrokeTable;
      } else {
        const resp = await fetch(new URL("data/kangxi.json", document.baseURI));
        if (!resp.ok) throw new Error(`康熙笔画表加载失败(HTTP ${resp.status})`);
        table = (await resp.json()) as StrokeTable;
      }
      return table;
    })();
  }
  return loading;
}

/** 数理吉凶(81数,通行版;个别数字各派有异,仅民俗参考) */
export const SHULI: Record<number, "吉" | "凶" | "半吉"> = (() => {
  const t: Record<number, "吉" | "凶" | "半吉"> = {};
  const ji = [1, 3, 5, 6, 7, 8, 11, 13, 15, 16, 17, 18, 21, 23, 24, 25, 29, 31, 32, 33, 35, 37, 39, 41, 45, 47, 48, 52, 63, 65, 67, 68, 81];
  const ban = [27, 30, 38, 40, 42, 43, 49, 50, 51, 53, 55, 57, 58, 61, 70, 71, 72, 73, 75, 77, 78];
  for (let i = 1; i <= 81; i++) t[i] = ji.includes(i) ? "吉" : ban.includes(i) ? "半吉" : "凶";
  return t;
})();

export interface WugeResult {
  ok: boolean; missingChars: string[];
  tian: number; ren: number; di: number; wai: number; zong: number;
  strokes: { char: string; strokes: number | null }[];
  sancai: string; sancaiNote: string;
  luck: { tian: string; ren: string; di: string; wai: string; zong: string };
}

const wuxingOfNum = (n: number): string => {
  const u = n % 10 === 0 ? 10 : n % 10;
  if (u <= 2) return "木";
  if (u <= 4) return "火";
  if (u <= 6) return "土";
  if (u <= 8) return "金";
  return "水";
};

const pmod = (x: number, n: number) => ((x % n) + n) % n;

/**
 * 五格剖象(异步: 首次调用加载字表)。查不到康熙笔画的字 → ok=false + missingChars
 * (不评分,提示查字典)。规则: 天格=单姓笔画+1(复姓取姓和); 人格=姓末字+名首字;
 * 地格=双名和(单名+1); 外格=总−人+1(单名单姓恒为2,复姓单名=姓首字+1); 总格=全部和。
 */
export async function wuge(surname: string, given: string): Promise<WugeResult> {
  const kx = await loadKangxi();
  const chars = [...(surname + given)];
  const strokes = chars.map((ch) => (ch in kx ? kx[ch] : null));
  const missingChars = chars.filter((_, i) => strokes[i] === null);
  const s = strokes.map((v) => v ?? 0);
  const surnameLen = [...surname].length;
  const givenLen = [...given].length;

  const tian = surnameLen === 1 ? s[0] + 1 : s.slice(0, surnameLen).reduce((a, b) => a + b, 0);
  const ren = s[surnameLen - 1] + (givenLen > 0 ? s[surnameLen] : 0);
  const di = givenLen === 1 ? s[surnameLen] + 1 : s.slice(surnameLen).reduce((a, b) => a + b, 0);
  const zong = s.reduce((a, b) => a + b, 0);
  const wai = givenLen === 1 ? (surnameLen === 1 ? 2 : s[0] + 1) : zong - ren + 1;

  const numShuli = (n: number) => SHULI[pmod(n - 1, 81) + 1] ?? "半吉";
  const luck = {
    tian: numShuli(tian), ren: numShuli(ren), di: numShuli(di),
    wai: numShuli(wai), zong: numShuli(zong),
  };
  const sancai = `${wuxingOfNum(tian)}${wuxingOfNum(ren)}${wuxingOfNum(di)}`;
  const ok = missingChars.length === 0 && surnameLen > 0 && givenLen > 0;
  return {
    ok, missingChars, tian, ren, di, wai, zong,
    strokes: chars.map((ch, i) => ({ char: ch, strokes: strokes[i] })),
    sancai,
    sancaiNote: "三才=天人地格个位数五行(1-2木 3-4火 5-6土 7-8金 9-0水);五格为日式熊崎氏系统,民俗参考",
    luck,
  };
}
