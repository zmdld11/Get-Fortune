// 对拍脚本(临时): 5 组出生信息 TS vs Python 输出对照
import { fourPillars, gzName, lunarStr } from "../src/paipan/bazi";
import { sunPosition, planetLon, fmtDeg, mod360, angdiff } from "../src/paipan/astro";

const samples: [number, number, number, number, number, number, string][] = [
  [1990, 6, 15, 8, 30, 121.47, "male"],
  [1985, 12, 25, 23, 10, 104.07, "female"],
  [2000, 2, 29, 14, 5, 116.4, "male"],
  [1975, 4, 3, 6, 45, 113.25, "female"],
  [2010, 8, 8, 20, 55, 118.78, "male"],
];
console.log("== 八字对拍 ==");
for (const [y, m, d, hh, mm, lon, g] of samples) {
  const fp = fourPillars(y, m, d, hh, mm, lon, 8, g);
  console.log(`${y}-${m}-${d} ${hh}:${mm} E${lon} ${g}: 四柱=${fp.pillars.map(gzName).join(" ")} tst=${fp.tst.toFixed(2)} 农历=${lunarStr(y, m, d)}`);
}
console.log("== 天文对拍(1900-01-01 00UT) ==");
const jd = 2415020.5;
console.log("sun", sunPosition(jd).toFixed(4), "水星", planetLon("水星", jd).toFixed(4), "木星", planetLon("木星", jd).toFixed(4), "冥王", planetLon("冥王星", jd).toFixed(4));
console.log("fmt 水星:", fmtDeg(planetLon("水星", jd)), " 2020大合土星:", fmtDeg(planetLon("土星", 2459205.27)));
console.log("mod360(-30)=", mod360(-30), " angdiff(5,355)=", angdiff(5, 355));
