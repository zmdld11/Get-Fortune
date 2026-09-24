// astro.ts — 西方占星天文计算核心（命盘/行运/推进通用）
// 移植自 fortune-calc skill 的 scripts/astro.py（Meeus《Astronomical Algorithms》+
// JPL "Approximate Positions of the Planets"）。
// 精度声明(1950–2050): 太阳±0.01° 月亮±0.05° 水金火±0.1° 木土±0.2° 天海冥±0.8°
// 四轴±0.2° Placidus宫头±0.5°。移植经 selftest 天象锚点回归验证。

export const SIGNS = ["白羊", "金牛", "双子", "巨蟹", "狮子", "处女",
  "天秤", "天蝎", "射手", "摩羯", "水瓶", "双鱼"];

const NAKSHATRAS = ["Ashwini", "Bharani", "Krittika", "Rohini", "Mrigashira", "Ardra",
  "Punarvasu", "Pushya", "Ashlesha", "Magha", "P.Phalguni", "U.Phalguni",
  "Hasta", "Chitra", "Swati", "Vishakha", "Anuradha", "Jyeshtha",
  "Mula", "P.Ashadha", "U.Ashadha", "Shravana", "Dhanishta", "Shatabhisha",
  "P.Bhadrapada", "U.Bhadrapada", "Revati"];
const NAK_LORDS = ["Ketu", "Venus", "Sun", "Moon", "Mars", "Rahu", "Jupiter", "Saturn", "Mercury"];
const DASHA_YEARS: Record<string, number> = { Ketu: 7, Venus: 20, Sun: 6, Moon: 10, Mars: 7, Rahu: 18, Jupiter: 16, Saturn: 19, Mercury: 17 };
const ASPECT_DEFS: [string, number, number][] = [
  ["合相", 0, 8], ["六合", 60, 4], ["刑相", 90, 6],
  ["拱相", 120, 6], ["桎距", 150, 3], ["对冲", 180, 8],
];

/** mod：与 Python % 语义一致（结果非负） */
export function mod360(x: number): number {
  return ((x % 360) + 360) % 360;
}

/** a-b 归一到 (-180,180] */
export function angdiff(a: number, b: number): number {
  return mod360(a - b + 180) - 180;
}

export function fmtDeg(lon: number): string {
  lon = mod360(lon);
  const s = Math.floor(lon / 30);
  const d = lon - 30 * s;
  let deg = Math.floor(d);
  let minutes = Math.round((d - deg) * 60);
  if (minutes === 60) { deg += 1; minutes = 0; }
  let sign = s;
  if (deg === 30) { deg = 0; sign = (s + 1) % 12; }
  return `${SIGNS[sign]} ${deg}°${String(minutes).padStart(2, "0")}′`;
}

export function julianDay(y: number, m: number, d: number, ut = 0): number {
  if (m <= 2) { y -= 1; m += 12; }
  const A = Math.floor(y / 100);
  const B = 2 - A + Math.floor(A / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + B - 1524.5 + ut / 24;
}

export function obliquity(T: number): number {
  return 23.4392911 - 0.0130041667 * T - 1.63889e-6 * T * T + 5.03611e-7 * T ** 3;
}

/** 黄经章动(度, 近似) */
export function nutationLon(T: number): number {
  const om = (125.04452 - 1934.136261 * T) * Math.PI / 180;
  const L = (280.4665 + 36000.7698 * T) * Math.PI / 180;
  const Lp = (218.3165 + 481267.8813 * T) * Math.PI / 180;
  return (-17.20 * Math.sin(om) - 1.32 * Math.sin(2 * L)
    - 0.23 * Math.sin(2 * Lp) + 0.21 * Math.sin(2 * om)) / 3600;
}

/** 太阳视黄经(度) */
export function sunPosition(jd: number): number {
  const T = (jd - 2451545.0) / 36525;
  const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
  const M = mod360(357.52911 + 35999.05029 * T - 0.0001537 * T * T) * Math.PI / 180;
  const C = ((1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(M)
    + (0.019993 - 0.000101 * T) * Math.sin(2 * M)
    + 0.000289 * Math.sin(3 * M));
  const om = (125.04 - 1934.136 * T) * Math.PI / 180;
  return mod360(L0 + C - 0.00569 - 0.00478 * Math.sin(om));
}

/** 月亮视黄经、视黄纬(度)。ELP2000 主要项 */
export function moonPosition(jd: number): [number, number] {
  const T = (jd - 2451545.0) / 36525;
  const Lp = 218.3164477 + 481267.88123421 * T - 0.0015786 * T * T + T ** 3 / 538841 - T ** 4 / 65194000;
  const D = 297.8501921 + 445267.1114034 * T - 0.0018819 * T * T + T ** 3 / 545868 - T ** 4 / 113065000;
  const M = 357.5291092 + 35999.0502909 * T - 0.0001536 * T * T + T ** 3 / 24490000;
  const Mp = 134.9633964 + 477198.8675055 * T + 0.0087414 * T * T + T ** 3 / 69699 - T ** 4 / 14712000;
  const F = 93.2720950 + 483202.0175233 * T - 0.0036539 * T * T - T ** 3 / 3526000 + T ** 4 / 863310000;
  const Dr = mod360(D) * Math.PI / 180, Mr = mod360(M) * Math.PI / 180;
  const Mpr = mod360(Mp) * Math.PI / 180, Fr = mod360(F) * Math.PI / 180;
  const lonTerms: [number, number][] = [
    [6.288774, Mpr], [1.274027, 2 * Dr - Mpr], [0.658314, 2 * Dr], [0.213618, 2 * Mpr],
    [-0.185116, Mr], [-0.114332, 2 * Fr], [0.058793, 2 * Dr - 2 * Mpr], [0.057066, 2 * Dr - Mr - Mpr],
    [0.053322, 2 * Dr + Mpr], [0.045758, 2 * Dr - Mr], [-0.040923, Mr - Mpr], [-0.034720, Dr],
    [-0.030383, Mr + Mpr], [0.015327, 2 * Dr - 2 * Fr], [-0.012528, Mpr + 2 * Fr],
    [0.010980, Mpr - 2 * Fr], [0.010675, 4 * Dr - Mpr], [0.010034, 3 * Mpr],
    [0.008548, 4 * Dr - 2 * Mpr], [-0.007888, 2 * Dr + Mr - Mpr], [-0.006766, 2 * Dr + Mr],
    [-0.005163, Dr - Mpr], [0.004987, Dr + Mpr], [0.004036, 2 * Dr - Mr + Mpr],
    [0.003994, 2 * Dr + 2 * Mpr], [0.003861, 4 * Dr], [0.003665, 2 * Dr - 3 * Mpr],
    [-0.002689, Mr - 2 * Mpr], [-0.002602, 2 * Dr - Mpr + 2 * Fr], [0.002390, 2 * Dr - Mr - 2 * Mpr],
    [-0.002348, Dr + Mr], [0.002236, 2 * Dr - 2 * Mr], [-0.002120, Mr + 2 * Mpr],
    [-0.002069, 2 * Mr], [0.002048, 2 * Dr - 2 * Mr - Mpr], [-0.001773, 2 * Dr + Mpr - 2 * Fr],
    [-0.001595, 2 * Dr + 2 * Fr], [0.001215, 4 * Dr - Mr - Mpr], [-0.001110, 2 * Mpr + 2 * Fr],
  ];
  const latTerms: [number, number][] = [
    [5.128122, Fr], [0.280602, Mpr + Fr], [0.277693, Mpr - Fr], [0.173237, 2 * Dr - Fr],
    [0.055413, 2 * Dr - Mpr + Fr], [0.046271, 2 * Dr - Mpr - Fr], [0.032573, 2 * Dr + Fr],
    [0.017198, 2 * Mpr + Fr], [0.009266, 2 * Dr + Mpr - Fr], [0.008822, 2 * Mpr - Fr],
    [0.008216, 2 * Dr - Mr - Fr], [0.004324, 2 * Dr - 2 * Mpr - Fr], [0.004200, 2 * Dr + Mpr + Fr],
  ];
  const lon = mod360(Lp + lonTerms.reduce((s, [c, a]) => s + c * Math.sin(a), 0) + nutationLon(T));
  const lat = latTerms.reduce((s, [c, a]) => s + c * Math.sin(a), 0);
  return [lon, lat];
}

// JPL 近似根数: [a, ȧ, e, ė, I, İ, L, L̇, ϖ, ϖ̇, Ω, Ω̇]  速率单位: /儒略世纪
const PLANET_ELEMS: Record<string, number[]> = {
  "水星": [0.38709927, 0.00000037, 0.20563593, 0.00001906, 7.00497902, -0.00594749,
    252.25032350, 149472.67411175, 77.45779628, 0.16047689, 48.33076593, -0.12534081],
  "金星": [0.72333566, 0.00000390, 0.00677672, -0.00004107, 3.39467605, -0.00078890,
    181.97909950, 58517.81538729, 131.60246718, 0.00268329, 76.67984255, -0.27769418],
  "地月": [1.00000261, 0.00000562, 0.01671123, -0.00004392, -0.00001531, -0.01294668,
    100.46457166, 35999.37244981, 102.93768193, 0.32327364, 0.0, 0.0],
  "火星": [1.52371034, 0.00001847, 0.09339410, 0.00007882, 1.84969142, -0.00813131,
    -4.55343205, 19140.30268499, -23.94362959, 0.44441088, 49.55953891, -0.29257343],
  "木星": [5.20288700, -0.00011607, 0.04838624, -0.00013253, 1.30439695, -0.00183714,
    34.39644051, 3034.74612775, 14.72847983, 0.21252668, 100.47390909, 0.20469106],
  "土星": [9.53667594, -0.00125060, 0.05386179, -0.00050991, 2.48599187, 0.00193609,
    49.95424423, 1222.49362201, 92.59887831, -0.41897216, 113.66242448, -0.28867794],
  "天王星": [19.18916464, -0.00196176, 0.04725744, -0.00004397, 0.77263783, -0.00242939,
    313.23810451, 428.48202785, 170.95427630, 0.40805281, 74.01692503, 0.04240589],
  "海王星": [30.06992276, 0.00026291, 0.00859048, 0.00005105, 1.77004347, 0.00035372,
    -55.12002969, 218.45945325, 44.96476227, -0.32241464, 131.78422574, -0.00508664],
  "冥王星": [39.48211675, -0.31596166, 0.24882730, 0.00005170, 17.14001206, 0.00004818,
    238.92903833, 145.20780515, 224.06891629, -0.04062942, 110.30393684, -0.01183482],
};

function helioVec(name: string, T: number): [number, number, number] {
  let [a, ad, e, ed, inc, idot, L, Ld, peri, pd, node, nd] = PLANET_ELEMS[name];
  a += ad * T;
  e += ed * T;
  inc = (inc + idot * T) * Math.PI / 180;
  L += Ld * T;
  peri += pd * T;
  node += nd * T;
  const M = mod360(L - peri) * Math.PI / 180;
  let E = M + e * Math.sin(M);
  for (let i = 0; i < 8; i++) {  // 牛顿迭代解开普勒方程
    const dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= dE;
    if (Math.abs(dE) < 1e-12) break;
  }
  const xv = a * (Math.cos(E) - e);
  const yv = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const v = Math.atan2(yv, xv);
  const r = Math.hypot(xv, yv);
  const u = v + peri * Math.PI / 180 - node * Math.PI / 180;  // 纬度幅角
  const O = mod360(node) * Math.PI / 180;
  const xh = r * (Math.cos(O) * Math.cos(u) - Math.sin(O) * Math.sin(u) * Math.cos(inc));
  const yh = r * (Math.sin(O) * Math.cos(u) + Math.cos(O) * Math.sin(u) * Math.cos(inc));
  const zh = r * Math.sin(u) * Math.sin(inc);
  return [xh, yh, zh];
}

/** 行星地心视黄经(含光行时一阶修正:按行星视运动回推) */
export function planetLon(name: string, jd: number): number {
  const T = (jd - 2451545.0) / 36525;
  let [xe, ye] = helioVec("地月", T);
  let [xp, yp, zp] = helioVec(name, T);
  const r = Math.sqrt((xp - xe) ** 2 + (yp - ye) ** 2 + zp ** 2);
  // 光行时: 用 0.005775518 天/AU 回推一次
  const T2 = (jd - 0.0057755183 * r - 2451545.0) / 36525;
  [xe, ye] = helioVec("地月", T2);
  [xp, yp] = helioVec(name, T2);
  return mod360(Math.atan2(yp - ye, xp - xe) * 180 / Math.PI + nutationLon((jd - 2451545.0) / 36525));
}

/** 月亮真北交点黄经 */
export function trueNode(jd: number): number {
  const T = (jd - 2451545.0) / 36525;
  const om = 125.0445479 - 1934.1362891 * T + 0.0020754 * T * T;
  const D = mod360(297.8501921 + 445267.1114034 * T) * Math.PI / 180;
  const M = mod360(357.5291092 + 35999.0502909 * T) * Math.PI / 180;
  const Mp = mod360(134.9633964 + 477198.8675055 * T) * Math.PI / 180;
  const F = mod360(93.2720950 + 483202.0175233 * T) * Math.PI / 180;
  const corr = (-1.4979 * Math.sin(2 * (D - F)) - 0.1500 * Math.sin(M) - 0.1226 * Math.sin(2 * D)
    + 0.1176 * Math.sin(2 * F) - 0.0801 * Math.sin(2 * D - Mp));
  return mod360(om + corr);
}

/** 格林尼治恒星时(度) */
export function gmst(jd: number): number {
  const T = (jd - 2451545.0) / 36525;
  const theta = 280.46061837 + 360.98564736629 * (jd - 2451545.0)
    + 0.000387933 * T * T - T ** 3 / 38710000;
  return mod360(theta);
}

/** 返回 [上升, 天顶] 黄经。atan2 形式自带正确象限 */
export function ascMc(ramc: number, eps: number, lat: number): [number, number] {
  const ramcR = ramc * Math.PI / 180, e = eps * Math.PI / 180, p = lat * Math.PI / 180;
  const mc = Math.atan2(Math.sin(ramcR), Math.cos(ramcR) * Math.cos(e));
  const asc = Math.atan2(Math.cos(ramcR),
    -(Math.sin(ramcR) * Math.cos(e) + Math.tan(p) * Math.sin(e)));
  return [mod360(asc * 180 / Math.PI), mod360(mc * 180 / Math.PI)];
}

export function raOfEcl(lon: number, eps: number): number {
  const l = lon * Math.PI / 180;
  return mod360(Math.atan2(Math.sin(l) * Math.cos(eps * Math.PI / 180), Math.cos(l)) * 180 / Math.PI);
}

/** Placidus 中间宫头 11,12,2,3。高纬(|φ|>60°)退化为等宫并告警 */
export function placidusCusps(ramc: number, eps: number, lat: number): [number, number, number, number, string[]] {
  const e = eps * Math.PI / 180, p = lat * Math.PI / 180;
  const warn: string[] = [];
  const decl = (lam: number) => Math.asin(Math.sin(e) * Math.sin(lam * Math.PI / 180));
  const sda = (lam: number) => {
    const x = -Math.tan(p) * Math.tan(decl(lam));
    if (Math.abs(x) >= 1) throw new Error("circumpolar");
    return Math.acos(x) * 180 / Math.PI;
  };
  const raOf = (lam: number) => raOfEcl(lam, eps);
  const solve = (fn: (l: number) => number, lam0: number) => {
    let lam = mod360(lam0);
    for (let i = 0; i < 60; i++) {
      const diff = angdiff(fn(lam), raOf(lam));
      lam = mod360(lam + diff * 0.9);
      if (Math.abs(diff) < 1e-6) break;
    }
    return lam;
  };
  try {
    const c11 = solve((l) => mod360(ramc + sda(l) / 3.0), raOfEcl(mod360(ramc + 30), eps));
    const c12 = solve((l) => mod360(ramc + 2 * sda(l) / 3.0), raOfEcl(mod360(ramc + 60), eps));
    const c2 = solve((l) => mod360(ramc + sda(l) + (180 - sda(l)) / 3.0),
      raOfEcl(mod360(ramc + 120), eps));
    const c3 = solve((l) => mod360(ramc + sda(l) + 2 * (180 - sda(l)) / 3.0),
      raOfEcl(mod360(ramc + 150), eps));
    return [c11, c12, c2, c3, warn];
  } catch {
    const [asc, mc] = ascMc(ramc, eps, lat);
    const step = angdiff(asc, mc) / 3.0;
    warn.push("高纬度 Placidus 退化,已用等宫近似");
    return [mod360(mc + step), mod360(mc + 2 * step), mod360(asc + step), mod360(asc + 2 * step), warn];
  }
}

/** lon 所在宫位(1-12)。要求每个宫 < 180°(Placidus 满足) */
export function houseOf(lon: number, cusps: number[]): number {
  for (let i = 0; i < 12; i++) {
    const a = cusps[i];
    const b = cusps[(i + 1) % 12];
    const d = angdiff(lon, a);
    const w = angdiff(b, a);
    if (d >= 0 && d < w) return i + 1;
  }
  return 12;
}

export type PosMap = Record<string, [number, boolean]>;

/** 全部星体视黄经 {名: [黄经, 逆行?]} */
export function positions(jd: number): PosMap {
  const out: PosMap = { "太阳": [sunPosition(jd), false], "月亮": [moonPosition(jd)[0], false] };
  for (const p of ["水星", "金星", "火星", "木星", "土星", "天王星", "海王星", "冥王星"]) {
    const lo = planetLon(p, jd);
    const loNext = planetLon(p, jd + 0.5);
    out[p] = [lo, angdiff(loNext, lo) < 0];
  }
  out["北交点"] = [trueNode(jd), true];
  return out;
}

export const AXIS_NAMES = ["上升", "天顶", "下降", "天底"];

export interface Aspect { orb: number; n1: string; name: string; n2: string; sep: number; adeg: number }

export function aspects(posDict: PosMap, extraAxes?: Record<string, number>): Aspect[] {
  const items: [string, number][] = Object.entries(posDict).map(([k, v]) => [k, v[0]]);
  if (extraAxes) for (const [k, v] of Object.entries(extraAxes)) items.push([k, v]);
  const res: Aspect[] = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const [n1, l1] = items[i];
      const [n2, l2] = items[j];
      if (AXIS_NAMES.includes(n1) && AXIS_NAMES.includes(n2)) continue;  // 轴对轴是恒等关系
      const sep = Math.abs(angdiff(l2, l1));
      for (const [aname, adeg, aorb] of ASPECT_DEFS) {
        const major = [0, 60, 90, 120, 180].includes(adeg);
        const orb = aorb + (major && (n1 === "太阳" || n2 === "太阳" || n1 === "月亮" || n2 === "月亮") ? 2 : 0);
        const d = Math.abs(sep - adeg);
        if (d <= orb) { res.push({ orb: d, n1, name: aname, n2, sep, adeg }); break; }
      }
    }
  }
  res.sort((a, b) => a.orb - b.orb);
  return res;
}

export interface LunarPhase { elong: number; illum: number; name: string }

export function lunarPhase(jd: number): LunarPhase {
  const sun = sunPosition(jd);
  const moon = moonPosition(jd)[0];
  const e = mod360(moon - sun);
  const illum = (1 - Math.cos(e * Math.PI / 180)) / 2;
  let name: string;
  if (e < 22.5 || e >= 337.5) name = "新月";
  else if (e < 67.5) name = "娥眉月(盈)";
  else if (e < 112.5) name = "上弦月";
  else if (e < 157.5) name = "盈凸月";
  else if (e < 202.5) name = "满月";
  else if (e < 247.5) name = "亏凸月";
  else if (e < 292.5) name = "下弦月";
  else name = "残月(亏)";
  return { elong: e, illum, name };
}

export function lahiriAyanamsa(jd: number): number {
  const year = 2000 + (jd - 2451545.0) / 365.25;
  return 23.85306 + 0.013966 * (year - 2000.0);
}

export interface VedicInfo { sid: number; nakshatra: string; pada: number; lord: string }

export function vedicInfo(lonTropical: number, jd: number): VedicInfo {
  const ayan = lahiriAyanamsa(jd);
  const sid = mod360(lonTropical - ayan);
  const nakI = Math.floor(sid / (360.0 / 27.0));
  const pada = Math.floor((sid % (360.0 / 27.0)) / (360.0 / 108.0)) + 1;
  return { sid, nakshatra: NAKSHATRAS[nakI], pada, lord: NAK_LORDS[nakI % 9] };
}

/** Vimshottari 大运: [主星, 起始年份] */
export function vimshottari(moonSid: number, birthJd: number): [string, number][] {
  const seg = 360.0 / 27.0;
  const frac = (moonSid % seg) / seg;
  const lord = NAK_LORDS[Math.floor(moonSid / seg) % 9];
  const order = ["Ketu", "Venus", "Sun", "Moon", "Mars", "Rahu", "Jupiter", "Saturn", "Mercury"];
  const i0 = order.indexOf(lord);
  const out: [string, number][] = [];
  let startYear = 2000 + (birthJd - 2451545.0) / 365.25 + (1 - frac) * DASHA_YEARS[lord];
  out.push([lord, startYear]);
  let k = i0;
  for (let i = 0; i < 8; i++) {
    k = (k + 1) % 9;
    startYear += DASHA_YEARS[order[k]];
    out.push([order[k], startYear]);
  }
  return out;
}

export interface FullChart {
  jd: number; eps: number; ramc: number; pos: PosMap;
  houses: Record<string, number>; cusps: number[]; houseWarn?: string[];
  axes: Record<string, number>; aspects: Aspect[];
  phase: LunarPhase; pof: number; isDay: boolean; altSun: number; name: string;
}

/** 完整本命盘。hh/mm 为当地钟表时间 */
export function fullChart(y: number, m: number, d: number, hh: number, mm: number,
  lat: number, lonE: number, tz = 8.0, name = ""): FullChart {
  const ut = hh + mm / 60.0 - tz;
  const jd = julianDay(y, m, d, ut);
  const T = (jd - 2451545.0) / 36525;
  const eps = obliquity(T);
  const ramc = mod360(gmst(jd) + lonE);
  const [asc, mc] = ascMc(ramc, eps, lat);
  const ic = mod360(mc + 180);
  const dsc = mod360(asc + 180);
  const [c11, c12, c2, c3, houseWarn] = placidusCusps(ramc, eps, lat);
  // Placidus 宫头成对出现: V=XI−180, VI=XII−180, VIII=II+180, IX=III+180
  const cusps = [asc, c2, c3, ic, mod360(c11 - 180), mod360(c12 - 180),
    dsc, mod360(c2 + 180), mod360(c3 + 180), mc, c11, c12];
  const pos = positions(jd);
  const houses: Record<string, number> = {};
  for (const k of Object.keys(pos)) houses[k] = houseOf(pos[k][0], cusps);
  // 昼/夜: 太阳地平高度
  const sun = pos["太阳"][0];
  const dec = Math.asin(Math.sin(eps * Math.PI / 180) * Math.sin(sun * Math.PI / 180)) * 180 / Math.PI;
  const H = (ramc - raOfEcl(sun, eps)) * Math.PI / 180;
  const alt = Math.asin(
    Math.sin(lat * Math.PI / 180) * Math.sin(dec * Math.PI / 180)
    + Math.cos(lat * Math.PI / 180) * Math.cos(dec * Math.PI / 180) * Math.cos(H)) * 180 / Math.PI;
  const isDay = alt > 0;
  const pof = isDay ? mod360(asc + pos["月亮"][0] - sun) : mod360(asc + sun - pos["月亮"][0]);
  const axes: Record<string, number> = { "上升": asc, "天顶": mc, "下降": dsc, "天底": ic };
  return {
    jd, eps, ramc, pos, houses, cusps, houseWarn, axes,
    aspects: aspects(pos, axes), phase: lunarPhase(jd), pof, isDay, altSun: alt, name,
  };
}
