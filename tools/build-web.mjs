// build-web.mjs — 打包独立站前端到 web/dist(esbuild + 静态资源拷贝)
import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "web", "dist");

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, "data"), { recursive: true });

const result = await esbuild.build({
  entryPoints: [path.join(root, "web", "app.ts")],
  bundle: true,
  format: "esm",
  target: "es2020",
  outdir: out,
  entryNames: "app",
  minify: true,
  legalComments: "none",
  // wuge.ts 在 Node 分支里动态 import 它;浏览器分支走 fetch,永不执行
  external: ["node:fs/promises"],
  metafile: true,
  logLevel: "warning",
});

for (const [file, meta] of Object.entries(result.metafile.outputs)) {
  console.log(`  ${path.relative(root, file)}  ${(meta.bytes / 1024).toFixed(1)}kb`);
}

fs.copyFileSync(path.join(root, "web", "index.html"), path.join(out, "index.html"));
fs.copyFileSync(path.join(root, "web", "favicon.svg"), path.join(out, "favicon.svg"));
fs.copyFileSync(path.join(root, "web", "data", "config.json"), path.join(out, "data", "config.json"));
// 全国省—市坐标表(32KB,前端在需要出生地时懒加载)
fs.copyFileSync(path.join(root, "web", "data", "cities-cn.json"), path.join(out, "data", "cities-cn.json"));
// 康熙笔画表: 233KB,前端懒加载(首次用「姓名五格」才下载),不内联进 app.js
fs.copyFileSync(path.join(root, "src", "paipan", "data", "kangxi.json"), path.join(out, "data", "kangxi.json"));
console.log("  web/dist/index.html + data/{config,kangxi}.json");
