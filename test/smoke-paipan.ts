// 冒烟测试(临时): 全模块 compute 跑通性验证
import { computeFortune, MODULES } from "../src/paipan/index";

const birth = {
  cal: "solar" as const, year: 1990, month: 6, day: 15,
  timeKnown: true, hour: 8, minute: 30, dst: false,
  lonE: 121.47, latN: 31.23, tz: 8, city: "上海", gender: "male" as const,
};
const partner = { ...birth, year: 1992, month: 11, day: 3, hour: 14, minute: 40, gender: "female" as const };
const input = {
  birth, partner,
  question: "工作这两年该不该跳槽",
  focus: "事业",
  period: { from: "2026-09-01", to: "2027-06-01" },
  name: { surname: "刘", given: "德华" },
  zeday: { from: "2026-10-01", to: "2026-11-15", event: "搬家" },
  tosses: [7, 8, 9, 8, 7, 6],
  spread: "three",
  nowMs: Date.now(),
};

const all = MODULES.map((m) => m.id);
const t0 = performance.now();
const { sections, errors } = await computeFortune(all, input as never);
const dt = Math.round(performance.now() - t0);
console.log(`模块数 ${all.length}, 耗时 ${dt}ms, 失败 ${errors.length}`);
for (const e of errors) console.log("✗", e);
for (const id of all) {
  const secs = sections[id];
  if (!secs) { console.log(`? ${id}: 无输出`); continue; }
  const n = secs.reduce((s, x) => s + (x.rows?.length ?? 0) + (x.kv?.length ?? 0) + (x.text?.length ?? 0), 0);
  console.log(`✓ ${id}: ${secs.length} 节, ${n} 条数据`);
}
// 抽查两个模块的实际输出
console.log("\n=== bazi 口径节 ===");
console.log(JSON.stringify(sections["bazi"]?.[0], null, 1));
console.log("\n=== liuyao 卦象 ===");
console.log(sections["liuyao"]?.[1]?.title, sections["liuyao"]?.[1]?.rows?.slice(0, 3));
