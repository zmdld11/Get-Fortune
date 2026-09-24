// gen-kangxi.mjs — 生成康熙笔画全量字表 data/kangxi.json（一次性数据生成脚本）
// 数据源（均为权威公开数据，禁止手抄记忆值）：
//   1. Unicode Unihan 数据库 kRSUnicode 字段（部首序.余笔，部首序即康熙 214 部首体系）
//   2. opencc-js 简体→繁体转换（姓名学以繁体字形计康熙笔画，如 刘→劉→15画）
// 康熙总笔画 = 部首笔画 + 余笔（214 部首的笔画数是固定标准表）。
// 运行：npm i -D opencc-js && 下载 Unihan.zip 解压后
//   node scripts/gen-kangxi.mjs /path/to/Unihan_IRGSources.txt
import fs from "node:fs";
import * as OpenCC from "opencc-js";

const [, , irgPath] = process.argv;
if (!irgPath) {
  console.error("用法: node scripts/gen-kangxi.mjs Unihan_IRGSources.txt");
  process.exit(1);
}

// 214 康熙部首的笔画数（按部首序分组边界，固定标准）
const RADICAL_STROKES = (n) => {
  if (n <= 6) return 1;
  if (n <= 29) return 2;
  if (n <= 60) return 3;
  if (n <= 94) return 4;
  if (n <= 117) return 5;
  if (n <= 146) return 6;
  if (n <= 166) return 7;
  if (n <= 176) return 8;
  if (n <= 186) return 9;
  if (n <= 194) return 10;
  if (n <= 204) return 11;
  if (n <= 213) return 12;
  return 13; // 214 龠
};

// 1. 解析 kRSUnicode: "U+4E00\tkRSUnicode\t1.1" → { 中: [部首, 余笔] }
const rs = new Map();
for (const line of fs.readFileSync(irgPath, "utf8").split("\n")) {
  if (line.startsWith("#") || !line.trim()) continue;
  const [cp, field, value] = line.split("\t");
  if (field !== "kRSUnicode") continue;
  // 可能有多值（空格分隔），取第一个（主 decomposition）
  const first = value.split(" ")[0];
  const [rad, extra] = first.split(".").map(Number);
  if (!Number.isInteger(rad) || !Number.isInteger(extra)) continue;
  if (rad < 1 || rad > 214) continue;
  rs.set(String.fromCodePoint(parseInt(cp.slice(2), 16)), [rad, extra]);
}
console.error(`kRSUnicode 字符数: ${rs.size}`);

// 2. 简体键 → 繁体字形的康熙笔画
const converter = OpenCC.Converter({ from: "cn", to: "t" });
const out = {};
for (const [ch, [rad, extra]] of rs) {
  // 只收 CJK 基本区 + 扩展A（姓名用字足够，控制体积）
  const cp = ch.codePointAt(0);
  if (!(cp >= 0x3400 && cp <= 0x9fff)) continue;
  const trad = converter(ch);
  // 繁体可能转出多字（如「乾」单字不变；多字结果跳过该简体键）
  if ([...trad].length !== 1) continue;
  const rsTrad = rs.get(trad);
  if (!rsTrad) continue;
  const total = RADICAL_STROKES(rsTrad[0]) + rsTrad[1];
  out[ch] = total;
}

// 3. 排序输出（按 Unicode 码点，稳定 diff）
const sorted = Object.fromEntries(Object.entries(out).sort((a, b) => a[0].codePointAt(0) - b[0].codePointAt(0)));
const jsonPath = new URL("../src/paipan/data/kangxi.json", import.meta.url);
fs.mkdirSync(new URL("../src/scripts/fortune/data/", import.meta.url), { recursive: true });
fs.writeFileSync(jsonPath, JSON.stringify(sorted));
console.error(`输出 ${Object.keys(sorted).length} 字 → ${jsonPath.pathname}`);

// 4. 抽查已知锚点（来自通行姓名学字表，人工核对过的样本）
const checks = { "刘": 15, "陈": 16, "张": 11, "王": 4, "海": 11, "清": 12, "恬": 10, "陳": 16, "劉": 15 };
let bad = 0;
for (const [ch, want] of Object.entries(checks)) {
  if (sorted[ch] !== want) { console.error(`✗ ${ch} got=${sorted[ch]} want=${want}`); bad++; }
}
console.error(bad ? `锚点失败 ${bad} 项` : "锚点抽查全部通过");
process.exit(bad ? 1 : 0);
