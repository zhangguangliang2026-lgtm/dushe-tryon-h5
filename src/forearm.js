/**
 * 前臂方向、中线和宽度：看手腕往手肘方向那一段的皮肤。
 *
 * 为什么要看前臂：手链戴在前臂末端，方向应该跟着前臂走；但手部模型只给手上的点，
 * 手腕一弯（握拳上翘、手掌偏向一边），手掌的方向就和前臂差了 20–40°，手链看起来就是歪的、没套在手腕上。
 *
 * 做法：
 * 1. 在本帧手掌中间取皮肤颜色样本（这块一定是皮肤），对灯光偏色不敏感；
 * 2. 在手腕往手肘方向的一块区域里，挑出颜色像这块皮肤的像素；
 * 3. 对这些像素求主方向（二阶矩）：最长的方向就是前臂方向，均值点在前臂中线上，
 *    横向的分布换算出宽度（均匀带状区域的宽度 = √(12 × 横向方差)）。
 * 结果只在“像一条手臂”（又长又直、像素够多、和手掌方向差得不多）时才用，否则返回 null，
 * 调用方会退回只用手部关键点的结果。
 *
 * 坐标都是小图像素（bytes 为 RGBA）。
 */
function chroma(bytes, i) {
  const r = bytes[i];
  const g = bytes[i + 1];
  const b = bytes[i + 2];
  const s = r + g + b + 1;
  return [r / s, g / s, s / 3];
}

function skinModel(bytes, w, h, pts) {
  const mid = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const P = (i) => pts[i];
  const samples = [mid(P(0), P(9), 0.3), mid(P(0), P(9), 0.55), mid(P(0), P(5), 0.5), mid(P(0), P(17), 0.5), mid(P(5), P(17), 0.5), mid(P(0), P(13), 0.4)];
  const vals = [];
  for (const p of samples) {
    for (let dy = -2; dy <= 2; dy += 2) {
      for (let dx = -2; dx <= 2; dx += 2) {
        const x = Math.round(p.x + dx);
        const y = Math.round(p.y + dy);
        if (x >= 0 && y >= 0 && x < w && y < h) vals.push(chroma(bytes, (y * w + x) * 4));
      }
    }
  }
  if (vals.length < 20) return null;
  const mean = [0, 1, 2].map((k) => vals.reduce((s, v) => s + v[k], 0) / vals.length);
  const sd = [0, 1].map((k) => Math.sqrt(vals.reduce((s, v) => s + (v[k] - mean[k]) ** 2, 0) / vals.length));
  return { mean, tr: Math.max(0.014, sd[0] * 2.5), tg: Math.max(0.012, sd[1] * 2.5) };
}

function isSkin(bytes, i, m) {
  const c = chroma(bytes, i);
  const dr = (c[0] - m.mean[0]) / m.tr;
  const dg = (c[1] - m.mean[1]) / m.tg;
  const bright = c[2] / (m.mean[2] + 1);
  return dr * dr + dg * dg < 1 && bright > 0.5 && bright < 1.7;
}

// 沿一条线找穿过 c0 附近的那段连续皮肤，返回两端到 c0 的距离（允许 2 个像素的小缺口）
function skinRun(bytes, w, h, m, c0, n, maxLen) {
  const at = (t) => {
    const x = Math.round(c0.x + n.x * t);
    const y = Math.round(c0.y + n.y * t);
    if (x < 0 || y < 0 || x >= w || y >= h) return -1;
    return isSkin(bytes, (y * w + x) * 4, m) ? 1 : 0;
  };
  // 先在中心附近找到一个皮肤点
  let start = null;
  for (let k = 0; k <= maxLen * 0.4; k++) {
    if (at(k) === 1) {
      start = k;
      break;
    }
    if (at(-k) === 1) {
      start = -k;
      break;
    }
  }
  if (start == null) return null;
  const go = (dir) => {
    let t = start;
    let miss = 0;
    let last = start;
    while (Math.abs(t - start) < maxLen) {
      t += dir;
      const v = at(t);
      if (v === -1) return null; // 碰到画面边：量不准
      if (v === 1) {
        last = t;
        miss = 0;
      } else if (++miss > 2) return last;
    }
    return null;
  };
  const a = go(1);
  const b = go(-1);
  if (a == null || b == null) return null;
  return { lo: b, hi: a };
}

/**
 * pts：21 个关键点（小图像素）。palmAxis：手掌方向单位向量（手腕 → 中指根）。
 * 返回 { axis, center, width } 或 null。axis 指向手；center 是前臂中线上与关键点 0 齐平的一点。
 */
function measureForearm(bytes, w, h, pts, palmAxis) {
  const m = skinModel(bytes, w, h, pts);
  if (!m) return null;
  const p0 = pts[0];
  const L = Math.hypot(pts[9].x - p0.x, pts[9].y - p0.y);
  if (!(L > 6)) return null;
  const ax = palmAxis;
  const n = { x: -ax.y, y: ax.x };
  // 横着切几刀：手腕往手肘方向 0.3–1.4 个手掌长，每刀找穿过中间的那段皮肤
  const mids = [];
  for (let a = 0.3; a <= 1.4; a += 0.1) {
    const c0 = { x: p0.x - ax.x * a * L, y: p0.y - ax.y * a * L };
    const r = skinRun(bytes, w, h, m, c0, n, 1.6 * L);
    if (!r) continue;
    const mid = (r.lo + r.hi) / 2;
    mids.push({ x: c0.x + n.x * mid, y: c0.y + n.y * mid, w: r.hi - r.lo, a });
  }
  if (mids.length < 4) return null;
  // 中点连线拟合前臂方向（主成分）
  const mx = mids.reduce((s, p) => s + p.x, 0) / mids.length;
  const my = mids.reduce((s, p) => s + p.y, 0) / mids.length;
  let cxx = 0;
  let cyy = 0;
  let cxy = 0;
  for (const p of mids) {
    cxx += (p.x - mx) ** 2;
    cyy += (p.y - my) ** 2;
    cxy += (p.x - mx) * (p.y - my);
  }
  const ang = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
  let v = { x: Math.cos(ang), y: Math.sin(ang) };
  if (v.x * ax.x + v.y * ax.y < 0) v = { x: -v.x, y: -v.y };
  const agree = v.x * ax.x + v.y * ax.y;
  // 中点离拟合直线的偏差：太乱说明切到了别的东西
  const nv = { x: -v.y, y: v.x };
  const resid = Math.sqrt(mids.reduce((s, p) => s + ((p.x - mx) * nv.x + (p.y - my) * nv.y) ** 2, 0) / mids.length);
  // 切线方向和前臂不完全垂直，量到的宽度要乘上夹角余弦
  // 宽度只看靠近手腕的几刀（前臂往手肘方向会变粗）
  const near = mids.filter((p) => p.a <= 0.8);
  const widths = (near.length >= 2 ? near : mids).map((p) => p.w * agree).sort((x, y) => x - y);
  const width = widths[widths.length >> 1];
  if (agree < 0.7 || resid > 0.12 * L || width < 0.5 * L || width > 2.4 * L) return null;
  const t = (p0.x - mx) * v.x + (p0.y - my) * v.y;
  return { axis: v, center: { x: mx + v.x * t, y: my + v.y * t }, width, slices: mids.length, agree };
}

module.exports = { measureForearm, skinModel, isSkin };
