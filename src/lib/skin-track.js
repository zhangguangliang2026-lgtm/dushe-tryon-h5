/**
 * 皮肤纹理跟踪（块匹配）：在手腕附近取一小块皮肤（痣、汗毛、毛孔、明暗），下一帧在附近找最像的位置。
 *
 * 用途：
 * 1. 前后位置：皮肤边缘只能定左右，手链会顺着手臂滑走；纹理能把前后也钉住。
 * 2. 手腕转动：手腕转动时，皮肤纹理会横着移动，而手臂轮廓不动。
 *    两者横向位移之差，就是手腕表面转过的弧长。
 *
 * 只用灰度、隔点取样，每帧计算量很小。所有坐标都是相机帧像素。
 */

const STEP = 2; // 取样间隔（像素）
const HALF = 12; // 小块半径（取样点数），覆盖约 50×50 像素
const RADIUS = 16; // 搜索半径（像素）
const MIN_TEXTURE = 0.6; // 纹理太弱（几乎纯色）时不跟，按 11/07 华为录屏里的皮肤实测，约 1.1–4.5

function gray(bytes, i) {
  return bytes[i] * 0.299 + bytes[i + 1] * 0.587 + bytes[i + 2] * 0.114;
}

/** 取以 (cx, cy) 为中心的小块，减去均值（对整体亮度变化不敏感） */
function grabPatch(bytes, fw, fh, cx, cy) {
  const n = HALF * 2 + 1;
  const out = new Float32Array(n * n);
  const x0 = Math.round(cx) - HALF * STEP;
  const y0 = Math.round(cy) - HALF * STEP;
  if (x0 < 0 || y0 < 0 || x0 + (n - 1) * STEP >= fw || y0 + (n - 1) * STEP >= fh) return null;
  let sum = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const v = gray(bytes, ((y0 + j * STEP) * fw + x0 + i * STEP) * 4);
      out[j * n + i] = v;
      sum += v;
    }
  }
  const mean = sum / out.length;
  let energy = 0;
  for (let k = 0; k < out.length; k++) {
    out[k] -= mean;
    energy += Math.abs(out[k]);
  }
  return { data: out, n, cx: Math.round(cx), cy: Math.round(cy), texture: energy / out.length };
}

function sadAt(bytes, fw, fh, patch, ox, oy, limit) {
  const { n, data } = patch;
  const x0 = ox - HALF * STEP;
  const y0 = oy - HALF * STEP;
  if (x0 < 0 || y0 < 0 || x0 + (n - 1) * STEP >= fw || y0 + (n - 1) * STEP >= fh) return Infinity;
  // 先算这一块的均值，再算减均值后的差
  let sum = 0;
  for (let j = 0; j < n; j += 2) for (let i = 0; i < n; i += 2) sum += gray(bytes, ((y0 + j * STEP) * fw + x0 + i * STEP) * 4);
  const cnt = Math.ceil(n / 2) * Math.ceil(n / 2);
  const mean = sum / cnt;
  let sad = 0;
  for (let j = 0; j < n; j++) {
    const row = (y0 + j * STEP) * fw;
    for (let i = 0; i < n; i++) {
      sad += Math.abs(gray(bytes, (row + x0 + i * STEP) * 4) - mean - data[j * n + i]);
    }
    if (sad > limit) return sad;
  }
  return sad;
}

/**
 * 在新的一帧里找 patch。返回 { dx, dy, quality } 或 null。
 * quality：0–1，最佳匹配比周围明显好、而且皮肤有纹理时才高。
 */
function matchPatch(bytes, fw, fh, patch) {
  if (!patch || patch.texture < MIN_TEXTURE) return null; // 太平滑（没有纹理）跟不住
  let best = Infinity;
  let bx = 0;
  let by = 0;
  const scores = [];
  for (let dy = -RADIUS; dy <= RADIUS; dy += STEP) {
    for (let dx = -RADIUS; dx <= RADIUS; dx += STEP) {
      const s = sadAt(bytes, fw, fh, patch, patch.cx + dx, patch.cy + dy, best * 3);
      scores.push(s);
      if (s < best) {
        best = s;
        bx = dx;
        by = dy;
      }
    }
  }
  if (!Number.isFinite(best)) return null;
  // 在最佳点周围 1 像素再细找一次
  for (const [ex, ey] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    const s = sadAt(bytes, fw, fh, patch, patch.cx + bx + ex, patch.cy + by + ey, best);
    if (s < best) {
      best = s;
      bx += ex;
      by += ey;
    }
  }
  const finite = scores.filter(Number.isFinite).sort((a, b) => a - b);
  const median = finite[finite.length >> 1] || best;
  const quality = median > 0 ? Math.max(0, Math.min(1, 1 - best / median)) : 0;
  return { dx: bx, dy: by, quality };
}

module.exports = { grabPatch, matchPatch, STEP, HALF, RADIUS, MIN_TEXTURE };
