/**
 * 试戴核心算法（纯计算，不依赖微信接口，可以在 Node 里测试）。
 *
 * 输入：微信 VisionKit 手部识别给出的 21 个关键点（与 OpenPose / MediaPipe 同一套编号，
 *       坐标是 0–1 的相对值），以及这条手串的珠子列表和手围。
 * 输出：每颗珠子在画面上的位置、大小、旋转角度、前后关系，以及手腕遮挡带。
 *
 * 做法：
 * 1. 用手掌长度（关键点 0 → 9）换算“每毫米多少像素”。手绕前臂转动时手掌长度基本不变，
 *    比用指根宽度稳定。
 * 2. 手腕截面按椭圆处理（宽约 0.36 × 手围，厚约 0.26 × 手围），用指根宽度的缩短程度
 *    估算手腕转了多少度，从而算出画面里手腕的宽度。
 * 3. 手串中心线也是椭圆：比手腕略大，周长等于珠子直径之和。珠子按弧长依次排在中心线上，
 *    最大的那颗（主珠）默认转到最靠近镜头的位置。
 * 4. 正投影到画面。在手腕后面、而且落在手腕宽度以内的珠子会被手腕挡住，绘制时裁掉。
 */

const KP = { WRIST: 0, THUMB_CMC: 1, INDEX_MCP: 5, MIDDLE_MCP: 9, RING_MCP: 13, PINKY_MCP: 17 };

// 人体比例（毫米）。手围 155mm 的女性：关键点 0→9 约 86mm，食指根到小指根中心距约 60mm，
// 手腕截面约 53mm × 39mm。数值按样张目测校准，真机测试后再调。
const BODY = {
  palmMm: (wristMm) => 86 + (wristMm - 155) * 0.45,
  knuckleMm: (wristMm) => wristMm * 0.39,
  wristSemiBreadth: (wristMm) => wristMm * 0.17,
  wristSemiDepth: (wristMm) => wristMm * 0.125,
};

const DEFAULT_ADJUST = Object.freeze({
  dx: 0, // 整体平移（像素）
  dy: 0,
  scale: 1, // 大小微调
  rotate: 0, // 手串绕手腕转动的比例，1 = 转一整圈
  tilt: 0.28, // 俯仰：正值表示手指一侧离镜头更远（最常见的拍法），负值反过来
  along: 0, // 沿前臂方向的额外位移（毫米），正值靠近手掌
  spin: 0, // 画面内整体转向（弧度）：手臂横着、斜着时，把手串转到与前臂垂直
});

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function finite(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function toPx(point, width, height) {
  return { x: finite(point.x, 0) * width, y: finite(point.y, 0) * height };
}

function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y };
}

function len(v) {
  return Math.hypot(v.x, v.y);
}

/**
 * 由关键点估算手腕姿态。
 * points：21 个 {x, y}（0–1）。width/height：画面像素。wristMm：手围（毫米）。
 * 返回 null 表示关键点不可用。
 */
function estimateWristPose(points, width, height, wristMm) {
  if (!Array.isArray(points) || points.length < 18) return null;
  const C = clamp(finite(wristMm, 155), 120, 240);
  const p0 = toPx(points[KP.WRIST], width, height);
  const p5 = toPx(points[KP.INDEX_MCP], width, height);
  const p9 = toPx(points[KP.MIDDLE_MCP], width, height);
  const p17 = toPx(points[KP.PINKY_MCP], width, height);
  const palm = sub(p9, p0);
  const palmPx = len(palm);
  if (!(palmPx > Math.min(width, height) * 0.03)) return null;

  const axis = { x: palm.x / palmPx, y: palm.y / palmPx }; // 指向手指
  const normal = { x: -axis.y, y: axis.x }; // 画面内垂直于前臂
  const pxPerMm = palmPx / BODY.palmMm(C);
  // 指根连线在“垂直前臂”方向上的投影，反映手背/手心正对镜头的程度
  const knuckle = sub(p17, p5);
  const knuckleAcross = Math.abs(knuckle.x * normal.x + knuckle.y * normal.y);
  const faceRatio = clamp(knuckleAcross / (BODY.knuckleMm(C) * pxPerMm), 0, 1);
  const roll = Math.acos(faceRatio);

  // 关键点 0 和 9 中点附近是手掌，不是手腕；手串戴在关键点 0 往手肘方向一点
  let quality = 'good';
  const margin = Math.min(width, height) * 0.02;
  if (p0.x < margin || p0.y < margin || p0.x > width - margin || p0.y > height - margin) quality = 'edge';

  return { wrist: p0, axis, normal, pxPerMm, palmPx, faceRatio, roll, wristMm: C, quality };
}

/**
 * 没识别到手时的手动姿态：手腕放在画面中间，前臂竖直（手指朝上）。
 */
function manualPose(width, height, wristMm) {
  const C = clamp(finite(wristMm, 155), 120, 240);
  const shortSide = Math.min(width, height);
  const pxPerMm = (shortSide * 0.62) / (BODY.wristSemiBreadth(C) * 2 + 20);
  return {
    wrist: { x: width / 2, y: height * 0.5 },
    axis: { x: 0, y: -1 },
    normal: { x: 1, y: 0 },
    pxPerMm,
    palmPx: BODY.palmMm(C) * pxPerMm,
    faceRatio: 1,
    roll: 0,
    wristMm: C,
    quality: 'manual',
    manual: true,
  };
}

/**
 * 把珠子按顺序循环补齐 / 截短，使内圈周长 ≈ 手围 + 余量（与制作台一致，默认余量 10mm）。
 * 已经按手围排好的作品不需要调用。
 */
function fitBeadsToWrist(beads, wristMm, allowanceMm) {
  const list = (beads || []).filter((b) => finite(b.sizeMm, 0) > 0);
  if (!list.length) return [];
  const target = finite(wristMm, 155) + finite(allowanceMm, 10);
  const inner = (arr) => {
    const sum = arr.reduce((s, b) => s + b.sizeMm, 0);
    const avg = sum / arr.length;
    return sum - Math.PI * avg;
  };
  const out = list.slice();
  let i = 0;
  while (inner(out) < target && out.length < 80) out.push(list[i++ % list.length]);
  while (out.length > 6 && inner(out.slice(0, -1)) >= target) out.pop();
  return out;
}

// 椭圆周长采样表：t → 累计弧长
function ellipseTable(ra, rb, samples) {
  const n = samples || 720;
  const ts = new Float64Array(n + 1);
  const ss = new Float64Array(n + 1);
  let prev = { x: ra, y: 0 };
  for (let i = 1; i <= n; i++) {
    const t = (i / n) * Math.PI * 2;
    const cur = { x: ra * Math.cos(t), y: rb * Math.sin(t) };
    ts[i] = t;
    ss[i] = ss[i - 1] + Math.hypot(cur.x - prev.x, cur.y - prev.y);
    prev = cur;
  }
  return { ts, ss, perimeter: ss[n] };
}

function tAtArc(table, s) {
  const P = table.perimeter;
  let v = ((s % P) + P) % P;
  let lo = 0;
  let hi = table.ss.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (table.ss[mid] <= v) lo = mid;
    else hi = mid;
  }
  const span = table.ss[hi] - table.ss[lo] || 1;
  return table.ts[lo] + ((v - table.ss[lo]) / span) * (table.ts[hi] - table.ts[lo]);
}

function normalize3(v) {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}

function cross3(a, b) {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

/** 已知一个半轴 ra 和椭圆周长，求另一个半轴（Ramanujan 近似 + 二分） */
function solveSemiAxis(ra, perimeter) {
  const P = (x, y) => Math.PI * (3 * (x + y) - Math.sqrt((3 * x + y) * (x + 3 * y)));
  let lo = ra * 0.2;
  let hi = ra * 4;
  if (P(ra, lo) >= perimeter) return lo;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (P(ra, mid) < perimeter) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** 主珠：未指定时取直径最大的那颗（并列时取第一颗） */
function focalIndex(beads, preferred) {
  if (Number.isInteger(preferred) && preferred >= 0 && preferred < beads.length) return preferred;
  let best = 0;
  beads.forEach((b, i) => {
    if (b.sizeMm > beads[best].sizeMm) best = i;
  });
  return best;
}

/** 按圈分珠子：有 wrap 字段就用，否则按长度平均分 */
function splitWraps(beads, wrapCount) {
  const n = clamp(Math.round(finite(wrapCount, 1)), 1, 4);
  if (n === 1) return [beads];
  if (beads.some((b) => Number.isInteger(b.wrap))) {
    const wraps = Array.from({ length: n }, () => []);
    beads.forEach((b) => wraps[clamp(b.wrap || 0, 0, n - 1)].push(b));
    return wraps.filter((w) => w.length);
  }
  const total = beads.reduce((s, b) => s + b.sizeMm, 0);
  const wraps = Array.from({ length: n }, () => []);
  let acc = 0;
  beads.forEach((b) => {
    const k = Math.min(n - 1, Math.floor((acc / total) * n));
    wraps[k].push(b);
    acc += b.sizeMm;
  });
  return wraps.filter((w) => w.length);
}

/**
 * 计算整条手串的画面布局。
 * options: { pose, beads: [{key, sizeMm, wrap?}], wrapCount, frontIndex, adjust, pitch3d? }
 * pitch3d：有 3D 关键点时可以传入前臂俯仰的 sin 值，替代 adjust.tilt。
 */
/** 把姿态在画面内绕手腕点转一个角度（顺时针为正） */
function spinPose(pose, angle) {
  const a = finite(angle, 0);
  if (!a) return pose;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const rot = (v) => ({ x: v.x * c - v.y * s, y: v.x * s + v.y * c });
  return Object.assign({}, pose, { axis: rot(pose.axis), normal: rot(pose.normal) });
}

function computeLayout(options) {
  const opt = options || {};
  const beads = (opt.beads || []).filter((b) => finite(b.sizeMm, 0) > 0);
  if (!opt.pose || !beads.length) return null;
  const adj = Object.assign({}, DEFAULT_ADJUST, opt.adjust || {});
  const pose = spinPose(opt.pose, adj.spin);
  const C = pose.wristMm;
  const pxPerMm = pose.pxPerMm * clamp(finite(adj.scale, 1), 0.5, 2);

  // 前臂方向的 3D 向量（画面 x 右、y 下、z 远离镜头）
  const tilt = clamp(finite(opt.pitch3d, adj.tilt), -0.85, 0.85);
  const cosP = Math.sqrt(1 - tilt * tilt);
  const d = normalize3({ x: pose.axis.x * cosP, y: pose.axis.y * cosP, z: tilt });
  const b1 = { x: pose.normal.x, y: pose.normal.y, z: 0 };
  const b2 = normalize3(cross3(d, b1));
  const cr = Math.cos(pose.roll);
  const sr = Math.sin(pose.roll);
  const e1 = { x: cr * b1.x + sr * b2.x, y: cr * b1.y + sr * b2.y, z: cr * b1.z + sr * b2.z }; // 手腕宽度方向
  const e2 = { x: -sr * b1.x + cr * b2.x, y: -sr * b1.y + cr * b2.y, z: -sr * b1.z + cr * b2.z }; // 手腕厚度方向

  const a = BODY.wristSemiBreadth(C);
  const b = BODY.wristSemiDepth(C);
  const halfWidthPx = Math.hypot(a * cr, b * sr) * pxPerMm;

  const wraps = splitWraps(beads, opt.wrapCount);
  const maxBead = Math.max.apply(null, beads.map((x) => x.sizeMm));
  // 手串戴在关键点 0 往手肘方向约 12mm + 半颗珠子处；贴合得到的姿态本身就在手腕中心
  const baseAlong = (pose.centered ? 0 : -(12 + maxBead / 2)) + finite(adj.along, 0);

  const placed = [];
  const rings = [];
  wraps.forEach((wrapBeads, w) => {
    const sum = wrapBeads.reduce((s, x) => s + x.sizeMm, 0);
    const avg = sum / wrapBeads.length;
    // 中心线椭圆：左右两侧贴着手腕（宽度方向只留半颗珠子），周长等于珠子直径之和；
    // 多出来的长度都放在厚度方向，并把整圈往远离镜头的一侧挪，像真手链一样正面贴着皮肤、松的部分垂在背面
    const ra = a + avg / 2 + 0.5;
    const rbMin = b + avg / 2;
    const rb = Math.max(rbMin, solveSemiAxis(ra, sum));
    const sag = rb - rbMin;
    const table = ellipseTable(ra, rb);
    const scaleArc = table.perimeter / sum; // 弧长与直径之和的比例（≈1）

    const alongMm = baseAlong - w * (maxBead * 1.02);
    const wristCenter = {
      x: pose.wrist.x + d.x * alongMm * pxPerMm + finite(adj.dx, 0),
      y: pose.wrist.y + d.y * alongMm * pxPerMm + finite(adj.dy, 0),
      z: d.z * alongMm * pxPerMm,
    };
    const away = e2.z >= 0 ? 1 : -1;
    const center = {
      x: wristCenter.x + e2.x * away * sag * pxPerMm,
      y: wristCenter.y + e2.y * away * sag * pxPerMm,
      z: wristCenter.z + e2.z * away * sag * pxPerMm,
    };

    // 找到最靠近镜头（z 最小）的位置
    let frontT = 0;
    let minZ = Infinity;
    for (let i = 0; i < 360; i++) {
      const t = (i / 360) * Math.PI * 2;
      const z = ra * Math.cos(t) * e1.z + rb * Math.sin(t) * e2.z;
      if (z < minZ) {
        minZ = z;
        frontT = t;
      }
    }
    let frontS = 0;
    for (let i = 1; i < table.ts.length; i++) {
      if (table.ts[i] >= frontT) {
        frontS = table.ss[i];
        break;
      }
    }

    const focal = focalIndex(wrapBeads, w === 0 ? opt.frontIndex : undefined);
    let acc = 0;
    const centersMm = wrapBeads.map((x) => {
      const c = acc + x.sizeMm / 2;
      acc += x.sizeMm;
      return c;
    });
    const offset = frontS - centersMm[focal] * scaleArc + finite(adj.rotate, 0) * table.perimeter;

    wrapBeads.forEach((bead, i) => {
      const s = centersMm[i] * scaleArc + offset;
      const t = tAtArc(table, s);
      const ct = Math.cos(t);
      const st = Math.sin(t);
      const lx = ra * ct;
      const ly = rb * st;
      const p = {
        x: center.x + (lx * e1.x + ly * e2.x) * pxPerMm,
        y: center.y + (lx * e1.y + ly * e2.y) * pxPerMm,
        z: center.z + (lx * e1.z + ly * e2.z) * pxPerMm,
      };
      const tx = (-ra * st * e1.x + rb * ct * e2.x) * pxPerMm;
      const ty = (-ra * st * e1.y + rb * ct * e2.y) * pxPerMm;
      const relZ = (lx * e1.z + ly * e2.z) / Math.max(ra, rb); // -1 最近 … 1 最远
      const back = p.z - wristCenter.z > 0;
      // 到前臂中线的画面距离，用来判断是否被手腕挡住
      const across = (p.x - wristCenter.x) * pose.normal.x + (p.y - wristCenter.y) * pose.normal.y;
      const radiusPx = bead.sizeMm * pxPerMm * 0.5;
      // 露出手腕边缘的比例：只露出一小条的背面珠子直接不画，避免出现“月牙”碎片
      const visible = clamp((Math.abs(across) + radiusPx - halfWidthPx) / (2 * radiusPx), 0, 1);
      placed.push({
        key: bead.key,
        sizeMm: bead.sizeMm,
        wrap: w,
        index: i,
        x: p.x,
        y: p.y,
        depth: p.z,
        relZ,
        back,
        hidden: back && visible < 0.5,
        // 背面珠子整颗都在手腕轮廓外（不和手腕重叠）才画
        clearOutside: Math.abs(across) - radiusPx * 0.85 > halfWidthPx,
        // 背面珠子整颗都在手腕轮廓内（一定被挡住），有像素遮挡时也不用画
        deep: back && Math.abs(across) + radiusPx < halfWidthPx * 0.92,
        tx,
        ty,
        // 0 = 正对镜头，1 = 在手腕侧面（正在拐到背面），绘制时侧面略暗
        side: clamp(1 - Math.abs(relZ) * 1.6, 0, 1),
        diameter: bead.sizeMm * pxPerMm * (1 - 0.05 * relZ),
        angle: Math.atan2(ty, tx),
      });
    });
    rings.push({ center: wristCenter, ra, rb, sag });
  });

  // 手链“往前转”（adjust.rotate 增大）时，正面那颗珠子在画面上移动的方向，给“跟着手腕转”用
  const nearest = placed.reduce((m, b) => (!m || b.depth < m.depth ? b : m), null);
  const tl = Math.hypot(nearest.tx, nearest.ty) || 1;
  const frontDir = { x: nearest.tx / tl, y: nearest.ty / tl };
  placed.sort((p, q) => q.depth - p.depth); // 远的先画
  const c0 = rings[0].center;
  return {
    beads: placed,
    band: {
      cx: c0.x,
      cy: c0.y,
      nx: pose.normal.x,
      ny: pose.normal.y,
      ax: pose.axis.x,
      ay: pose.axis.y,
      halfWidth: halfWidthPx,
    },
    pxPerMm,
    rings,
    frontDir,
    // 手腕表面（厚度方向）半径，像素：手腕转一圈，表面走 2π × 它
    surfaceRadiusPx: b * pxPerMm,
  };
}

/**
 * 从独奢制作台作品（design.items[].skuId 形如 "moon-10"）转成试戴珠子列表。
 * resolve(skuId) 可选：返回 {key, sizeMm}；不传时按 “材料-尺寸” 规则拆分。
 */
function fromDusheDesign(design, resolve) {
  const items = (design && design.items) || [];
  return items
    .map((item) => {
      if (resolve) return resolve(item.skuId, item);
      const m = /^(.*)-(\d+(?:\.\d+)?)$/.exec(String(item.skuId || ''));
      if (!m) return null;
      return { key: m[1], sizeMm: Number(m[2]), wrap: item.wrapIndex };
    })
    .filter(Boolean);
}

module.exports = {
  KP,
  BODY,
  DEFAULT_ADJUST,
  estimateWristPose,
  manualPose,
  fitBeadsToWrist,
  computeLayout,
  spinPose,
  fromDusheDesign,
  focalIndex,
  splitWraps,
  ellipseTable,
  tAtArc,
};
