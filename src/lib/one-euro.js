/**
 * One Euro 滤波：手静止时强平滑（不抖），手快速移动时弱平滑（不拖影）。
 * 参考 Casiez 等 2012 年论文《1€ Filter》。
 */

function alpha(cutoff, dt) {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

function createFilter(options) {
  const o = Object.assign({ minCutoff: 1.2, beta: 0.04, dCutoff: 1 }, options || {});
  let x = null;
  let dx = 0;
  let last = 0;
  return {
    filter(value, timeSec) {
      if (x === null) {
        x = value;
        last = timeSec;
        return value;
      }
      const dt = Math.max(1e-3, timeSec - last);
      last = timeSec;
      const rawDx = (value - x) / dt;
      dx = dx + alpha(o.dCutoff, dt) * (rawDx - dx);
      const cutoff = o.minCutoff + o.beta * Math.abs(dx);
      x = x + alpha(cutoff, dt) * (value - x);
      return x;
    },
    reset() {
      x = null;
      dx = 0;
    },
  };
}

/** 一组关键点（每点 x、y）的滤波器 */
function createPointsFilter(count, options) {
  const fx = Array.from({ length: count }, () => createFilter(options));
  const fy = Array.from({ length: count }, () => createFilter(options));
  return {
    filter(points, timeSec) {
      return points.slice(0, count).map((p, i) => ({ x: fx[i].filter(p.x, timeSec), y: fy[i].filter(p.y, timeSec) }));
    },
    reset() {
      fx.forEach((f) => f.reset());
      fy.forEach((f) => f.reset());
    },
  };
}

module.exports = { createFilter, createPointsFilter };
