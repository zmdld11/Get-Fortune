// gen-cities.mjs — 生成全国省—市坐标表 web/data/cities-cn.json
// 数据源: 阿里云 DataV 行政区划 GeoJSON(geo.datav.aliyun.com/areas_v3/bound/{adcode}_full.json)
//   · 坐标取自每个行政区 properties.center(GCJ-02,与 WGS-84 差 ~500m,对排盘完全无影响)
//   · 覆盖 34 个省级行政区 → 全部地级行政区(直辖市/特别行政区取本级中心)
// 用法: npm run gen:cities   (需要能访问外网;产物提交进仓库,构建期不联网)
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "web", "data", "cities-cn.json");
const BASE = "https://geo.datav.aliyun.com/areas_v3/bound";

const get = async (url) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
  return r.json();
};

const round = (n) => Math.round(n * 100) / 100;

console.log("① 拉全国省级列表");
const cn = await get(`${BASE}/100000_full.json`);
const provinces = cn.features
  .filter((f) => f.properties.level === "province" && f.properties.center)
  .map((f) => ({
    adcode: f.properties.adcode,
    name: f.properties.name,
    lon: round(f.properties.center[0]),
    lat: round(f.properties.center[1]),
  }));
console.log(`   省级 ${provinces.length} 个`);

const out = [];
for (const p of provinces) {
  let cities = [];
  try {
    const detail = await get(`${BASE}/${p.adcode}_full.json`);
    cities = detail.features
      .filter((f) => f.properties.level === "city" && f.properties.center)
      .map((f) => ({
        name: f.properties.name,
        lon: round(f.properties.center[0]),
        lat: round(f.properties.center[1]),
      }));
  } catch (e) {
    console.log(`   ! ${p.name} 拉取失败(${e.message}),用本级中心兜底`);
  }
  // 直辖市/特别行政区/无下级市: 本级即城市
  const self = { name: p.name, lon: p.lon, lat: p.lat };
  if (cities.length === 0) cities = [self];
  out.push({ name: p.name, lon: p.lon, lat: p.lat, cities });
  process.stdout.write(`   ${p.name}(${cities.length}) `);
}

const total = out.reduce((s, p) => s + p.cities.length, 0);
const doc = {
  source: "阿里云 DataV 行政区划 geo.datav.aliyun.com/areas_v3 (GCJ-02 中心点)",
  note: "地级行政区中心点坐标;直辖市/特别行政区取本级中心。精度对排盘足够(0.01°≈2.4 秒时差)",
  provinces: out,
};
fs.writeFileSync(OUT, JSON.stringify(doc, null, 1) + "\n");
console.log(`\n✓ 写入 ${path.relative(ROOT, OUT)}`);
console.log(`  省级 ${out.length} / 市级 ${total} / 体积 ${(fs.statSync(OUT).size / 1024).toFixed(1)}KB`);

// 锚点抽查: 几个知名城市的坐标应落在合理范围
const find = (pn, cn_) => out.find((p) => p.name.includes(pn))?.cities.find((c) => c.name.includes(cn_));
const checks = [
  [find("北京", "北京"), 116.4, 39.9],
  [find("上海", "上海"), 121.4, 31.2],
  [find("新疆", "喀什"), 75.9, 39.4],
  [find("海南", "三亚"), 109.5, 18.2],
];
for (const [c, lon, lat] of checks) {
  const ok = c && Math.abs(c.lon - lon) < 1.5 && Math.abs(c.lat - lat) < 1.5;
  console.log(`${ok ? "✓" : "✗"} ${c?.name ?? "(未找到)"} 经度${c?.lon} 纬度${c?.lat} (期望≈${lon},${lat})`);
}
