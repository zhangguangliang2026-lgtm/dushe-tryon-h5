(() => {
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __commonJS = (cb, mod) => function __require() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };

  // src/lib/tryon-core.js
  var require_tryon_core = __commonJS({
    "src/lib/tryon-core.js"(exports, module) {
      var KP = { WRIST: 0, THUMB_CMC: 1, INDEX_MCP: 5, MIDDLE_MCP: 9, RING_MCP: 13, PINKY_MCP: 17 };
      var BODY = {
        palmMm: (wristMm) => 86 + (wristMm - 155) * 0.45,
        knuckleMm: (wristMm) => wristMm * 0.39,
        wristSemiBreadth: (wristMm) => wristMm * 0.17,
        wristSemiDepth: (wristMm) => wristMm * 0.125
      };
      var DEFAULT_ADJUST = Object.freeze({
        dx: 0,
        // 整体平移（像素）
        dy: 0,
        scale: 1,
        // 大小微调
        rotate: 0,
        // 手串绕手腕转动的比例，1 = 转一整圈
        tilt: 0.28,
        // 俯仰：正值表示手指一侧离镜头更远（最常见的拍法），负值反过来
        along: 0,
        // 沿前臂方向的额外位移（毫米），正值靠近手掌
        spin: 0
        // 画面内整体转向（弧度）：手臂横着、斜着时，把手串转到与前臂垂直
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
        const axis = { x: palm.x / palmPx, y: palm.y / palmPx };
        const normal = { x: -axis.y, y: axis.x };
        const pxPerMm = palmPx / BODY.palmMm(C);
        const knuckle = sub(p17, p5);
        const knuckleAcross = Math.abs(knuckle.x * normal.x + knuckle.y * normal.y);
        const faceRatio = clamp(knuckleAcross / (BODY.knuckleMm(C) * pxPerMm), 0, 1);
        const roll = Math.acos(faceRatio);
        let quality = "good";
        const margin = Math.min(width, height) * 0.02;
        if (p0.x < margin || p0.y < margin || p0.x > width - margin || p0.y > height - margin) quality = "edge";
        return { wrist: p0, axis, normal, pxPerMm, palmPx, faceRatio, roll, wristMm: C, quality };
      }
      function manualPose(width, height, wristMm) {
        const C = clamp(finite(wristMm, 155), 120, 240);
        const shortSide = Math.min(width, height);
        const pxPerMm = shortSide * 0.62 / (BODY.wristSemiBreadth(C) * 2 + 20);
        return {
          wrist: { x: width / 2, y: height * 0.5 },
          axis: { x: 0, y: -1 },
          normal: { x: 1, y: 0 },
          pxPerMm,
          palmPx: BODY.palmMm(C) * pxPerMm,
          faceRatio: 1,
          roll: 0,
          wristMm: C,
          quality: "manual",
          manual: true
        };
      }
      function fitBeadsToWrist(beads2, wristMm, allowanceMm) {
        const list = (beads2 || []).filter((b) => finite(b.sizeMm, 0) > 0);
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
      function ellipseTable(ra, rb, samples) {
        const n = samples || 720;
        const ts = new Float64Array(n + 1);
        const ss = new Float64Array(n + 1);
        let prev = { x: ra, y: 0 };
        for (let i = 1; i <= n; i++) {
          const t = i / n * Math.PI * 2;
          const cur = { x: ra * Math.cos(t), y: rb * Math.sin(t) };
          ts[i] = t;
          ss[i] = ss[i - 1] + Math.hypot(cur.x - prev.x, cur.y - prev.y);
          prev = cur;
        }
        return { ts, ss, perimeter: ss[n] };
      }
      function tAtArc(table, s) {
        const P = table.perimeter;
        let v = (s % P + P) % P;
        let lo = 0;
        let hi = table.ss.length - 1;
        while (hi - lo > 1) {
          const mid = lo + hi >> 1;
          if (table.ss[mid] <= v) lo = mid;
          else hi = mid;
        }
        const span = table.ss[hi] - table.ss[lo] || 1;
        return table.ts[lo] + (v - table.ss[lo]) / span * (table.ts[hi] - table.ts[lo]);
      }
      function normalize3(v) {
        const l = Math.hypot(v.x, v.y, v.z) || 1;
        return { x: v.x / l, y: v.y / l, z: v.z / l };
      }
      function cross3(a, b) {
        return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
      }
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
      function focalIndex(beads2, preferred) {
        if (Number.isInteger(preferred) && preferred >= 0 && preferred < beads2.length) return preferred;
        let best = 0;
        beads2.forEach((b, i) => {
          if (b.sizeMm > beads2[best].sizeMm) best = i;
        });
        return best;
      }
      function splitWraps(beads2, wrapCount) {
        const n = clamp(Math.round(finite(wrapCount, 1)), 1, 4);
        if (n === 1) return [beads2];
        if (beads2.some((b) => Number.isInteger(b.wrap))) {
          const wraps2 = Array.from({ length: n }, () => []);
          beads2.forEach((b) => wraps2[clamp(b.wrap || 0, 0, n - 1)].push(b));
          return wraps2.filter((w) => w.length);
        }
        const total = beads2.reduce((s, b) => s + b.sizeMm, 0);
        const wraps = Array.from({ length: n }, () => []);
        let acc = 0;
        beads2.forEach((b) => {
          const k = Math.min(n - 1, Math.floor(acc / total * n));
          wraps[k].push(b);
          acc += b.sizeMm;
        });
        return wraps.filter((w) => w.length);
      }
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
        const beads2 = (opt.beads || []).filter((b3) => finite(b3.sizeMm, 0) > 0);
        if (!opt.pose || !beads2.length) return null;
        const adj = Object.assign({}, DEFAULT_ADJUST, opt.adjust || {});
        const pose = spinPose(opt.pose, adj.spin);
        const C = pose.wristMm;
        const pxPerMm = pose.pxPerMm * clamp(finite(adj.scale, 1), 0.5, 2);
        const tilt = clamp(finite(opt.pitch3d, adj.tilt), -0.85, 0.85);
        const cosP = Math.sqrt(1 - tilt * tilt);
        const d = normalize3({ x: pose.axis.x * cosP, y: pose.axis.y * cosP, z: tilt });
        const b1 = { x: pose.normal.x, y: pose.normal.y, z: 0 };
        const b2 = normalize3(cross3(d, b1));
        const cr = Math.cos(pose.roll);
        const sr = Math.sin(pose.roll);
        const e1 = { x: cr * b1.x + sr * b2.x, y: cr * b1.y + sr * b2.y, z: cr * b1.z + sr * b2.z };
        const e2 = { x: -sr * b1.x + cr * b2.x, y: -sr * b1.y + cr * b2.y, z: -sr * b1.z + cr * b2.z };
        const a = BODY.wristSemiBreadth(C);
        const b = BODY.wristSemiDepth(C);
        const halfWidthPx = Math.hypot(a * cr, b * sr) * pxPerMm;
        const wraps = splitWraps(beads2, opt.wrapCount);
        const maxBead = Math.max.apply(null, beads2.map((x) => x.sizeMm));
        const baseAlong = (pose.centered ? 0 : -(12 + maxBead / 2)) + finite(adj.along, 0);
        const placed = [];
        const rings = [];
        wraps.forEach((wrapBeads, w) => {
          const sum = wrapBeads.reduce((s, x) => s + x.sizeMm, 0);
          const avg = sum / wrapBeads.length;
          const ra = a + avg / 2 + 0.5;
          const rbMin = b + avg / 2;
          const rb = Math.max(rbMin, solveSemiAxis(ra, sum));
          const sag = rb - rbMin;
          const table = ellipseTable(ra, rb);
          const scaleArc = table.perimeter / sum;
          const alongMm = baseAlong - w * (maxBead * 1.02);
          const wristCenter = {
            x: pose.wrist.x + d.x * alongMm * pxPerMm + finite(adj.dx, 0),
            y: pose.wrist.y + d.y * alongMm * pxPerMm + finite(adj.dy, 0),
            z: d.z * alongMm * pxPerMm
          };
          const away = e2.z >= 0 ? 1 : -1;
          const center = {
            x: wristCenter.x + e2.x * away * sag * pxPerMm,
            y: wristCenter.y + e2.y * away * sag * pxPerMm,
            z: wristCenter.z + e2.z * away * sag * pxPerMm
          };
          let frontT = 0;
          let minZ = Infinity;
          for (let i = 0; i < 360; i++) {
            const t = i / 360 * Math.PI * 2;
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
          const focal = focalIndex(wrapBeads, w === 0 ? opt.frontIndex : void 0);
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
              z: center.z + (lx * e1.z + ly * e2.z) * pxPerMm
            };
            const tx = (-ra * st * e1.x + rb * ct * e2.x) * pxPerMm;
            const ty = (-ra * st * e1.y + rb * ct * e2.y) * pxPerMm;
            const relZ = (lx * e1.z + ly * e2.z) / Math.max(ra, rb);
            const back = p.z - wristCenter.z > 0;
            const across = (p.x - wristCenter.x) * pose.normal.x + (p.y - wristCenter.y) * pose.normal.y;
            const radiusPx = bead.sizeMm * pxPerMm * 0.5;
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
              angle: Math.atan2(ty, tx)
            });
          });
          rings.push({ center: wristCenter, ra, rb, sag });
        });
        const nearest = placed.reduce((m, b3) => !m || b3.depth < m.depth ? b3 : m, null);
        const tl = Math.hypot(nearest.tx, nearest.ty) || 1;
        const frontDir = { x: nearest.tx / tl, y: nearest.ty / tl };
        placed.sort((p, q) => q.depth - p.depth);
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
            halfWidth: halfWidthPx
          },
          pxPerMm,
          rings,
          frontDir,
          // 手腕表面（厚度方向）半径，像素：手腕转一圈，表面走 2π × 它
          surfaceRadiusPx: b * pxPerMm
        };
      }
      function fromDusheDesign(design, resolve) {
        const items = design && design.items || [];
        return items.map((item) => {
          if (resolve) return resolve(item.skuId, item);
          const m = /^(.*)-(\d+(?:\.\d+)?)$/.exec(String(item.skuId || ""));
          if (!m) return null;
          return { key: m[1], sizeMm: Number(m[2]), wrap: item.wrapIndex };
        }).filter(Boolean);
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
        tAtArc
      };
    }
  });

  // src/lib/tryon-render.js
  var require_tryon_render = __commonJS({
    "src/lib/tryon-render.js"(exports, module) {
      function drawBead(ctx2, image, bead, darken, tint) {
        const r = bead.diameter / 2;
        ctx2.save();
        ctx2.translate(bead.x, bead.y);
        ctx2.rotate(bead.angle);
        if (image) {
          ctx2.drawImage(image, -r, -r, r * 2, r * 2);
        } else {
          ctx2.fillStyle = "#c9c2ba";
          ctx2.beginPath();
          ctx2.arc(0, 0, r, 0, Math.PI * 2);
          ctx2.fill();
        }
        if (tint) {
          ctx2.globalAlpha = 0.12;
          ctx2.fillStyle = tint;
          ctx2.beginPath();
          ctx2.arc(0, 0, r * 0.97, 0, Math.PI * 2);
          ctx2.fill();
        }
        if (darken > 0) {
          ctx2.globalAlpha = Math.min(0.6, darken);
          ctx2.fillStyle = "#1d1712";
          ctx2.beginPath();
          ctx2.arc(0, 0, r * 0.97, 0, Math.PI * 2);
          ctx2.fill();
        }
        ctx2.restore();
      }
      function drawShadow(ctx2, bead, layout) {
        const r = bead.diameter / 2;
        const ox = -layout.band.ax * r * 0.18;
        const oy = -layout.band.ay * r * 0.18 + r * 0.22;
        const g = ctx2.createRadialGradient(bead.x + ox, bead.y + oy, r * 0.2, bead.x + ox, bead.y + oy, r * 1.25);
        g.addColorStop(0, "rgba(40, 24, 14, 0.30)");
        g.addColorStop(1, "rgba(40, 24, 14, 0)");
        ctx2.fillStyle = g;
        ctx2.beginPath();
        ctx2.arc(bead.x + ox, bead.y + oy, r * 1.25, 0, Math.PI * 2);
        ctx2.fill();
      }
      function drawTryon(ctx2, layout, images, opts) {
        if (!layout) return;
        const o = Object.assign({ shadow: true }, opts || {});
        const back = layout.beads.filter((b) => b.back && !b.hidden);
        const front = layout.beads.filter((b) => !b.back);
        const tone = o.tone || {};
        const shade = tone.shade || 0;
        if (o.occlusion) {
          const visibleBack = o.occlusion.filter(back.filter((b) => !b.deep));
          visibleBack.forEach((b) => drawBead(ctx2, images[b.key], b, shade + 0.1 + 0.1 * Math.max(0, b.relZ), tone.tint));
          if (visibleBack.length) o.occlusion.restore(ctx2, visibleBack);
        } else {
          back.filter((b) => b.clearOutside).forEach((b) => drawBead(ctx2, images[b.key], b, shade + 0.1 + 0.1 * Math.max(0, b.relZ), tone.tint));
        }
        if (o.shadow) {
          ctx2.save();
          front.forEach((b) => drawShadow(ctx2, b, layout));
          ctx2.restore();
        }
        front.forEach((b) => drawBead(ctx2, images[b.key], b, shade + 0.12 * (b.side || 0), tone.tint));
      }
      function drawDebug(ctx2, points, width, height, layout) {
        ctx2.save();
        if (points) {
          ctx2.fillStyle = "#18c964";
          points.forEach((p, i) => {
            ctx2.beginPath();
            ctx2.arc(p.x * width, p.y * height, i === 0 ? 6 : 3.5, 0, Math.PI * 2);
            ctx2.fill();
          });
        }
        if (layout) {
          const { cx, cy, nx, ny, ax, ay, halfWidth } = layout.band;
          const L = halfWidth * 2;
          ctx2.strokeStyle = "rgba(255, 80, 80, 0.9)";
          ctx2.lineWidth = 2;
          [-1, 1].forEach((s) => {
            ctx2.beginPath();
            ctx2.moveTo(cx + nx * halfWidth * s - ax * L, cy + ny * halfWidth * s - ay * L);
            ctx2.lineTo(cx + nx * halfWidth * s + ax * L, cy + ny * halfWidth * s + ay * L);
            ctx2.stroke();
          });
        }
        ctx2.restore();
      }
      module.exports = { drawTryon, drawDebug, drawBead };
    }
  });

  // src/lib/beads.js
  var require_beads = __commonJS({
    "src/lib/beads.js"(exports, module) {
      var NAMES = {
        amazonite: "\u5929\u6CB3\u77F3",
        amethyst: "\u7D2B\u6C34\u6676",
        aqua: "\u6D77\u84DD\u5B9D",
        "black-tourmaline": "\u9ED1\u78A7\u73BA",
        citrine: "\u9EC4\u6C34\u6676",
        clear: "\u767D\u6C34\u6676",
        fluorite: "\u8424\u77F3",
        garnet: "\u77F3\u69B4\u77F3",
        jade: "\u7389\u9AD3",
        kyanite: "\u84DD\u6676\u77F3",
        labradorite: "\u62C9\u957F\u77F3",
        lapis: "\u9752\u91D1\u77F3",
        moon: "\u6708\u5149\u77F3",
        morganite: "\u6469\u6839\u77F3",
        obsidian: "\u9ED1\u66DC\u77F3",
        pearl: "\u73CD\u73E0",
        prehnite: "\u8461\u8404\u77F3",
        "red-agate": "\u7EA2\u739B\u7459",
        rose: "\u7C89\u6676",
        silver: "\u94F6\u73E0",
        smoky: "\u8336\u6676",
        strawberry: "\u8349\u8393\u6676",
        sunstone: "\u592A\u9633\u77F3",
        "tiger-eye": "\u864E\u773C\u77F3"
      };
      function imagePath(key) {
        return "/assets/beads/" + key + ".png";
      }
      function seq(list) {
        return list.map((id) => {
          const m = /^(.*)-(\d+)$/.exec(id);
          return { key: m[1], sizeMm: Number(m[2]) };
        });
      }
      var SAMPLES2 = [
        {
          id: "cool",
          title: "\u6E05\u900F\u6708\u5149",
          note: "\u6708\u5149\u77F3 \xB7 \u6D77\u84DD\u5B9D \xB7 \u767D\u6C34\u6676",
          beads: seq([
            "moon-10",
            "silver-6",
            "aqua-8",
            "clear-8",
            "amazonite-8",
            "prehnite-8",
            "moon-8",
            "fluorite-8",
            "kyanite-8",
            "silver-6",
            "clear-10",
            "aqua-8",
            "amazonite-8",
            "prehnite-8",
            "moon-8",
            "fluorite-8",
            "kyanite-8",
            "clear-8",
            "aqua-8"
          ])
        },
        {
          id: "warm",
          title: "\u6E29\u67D4\u7C89\u8C03",
          note: "\u7C89\u6676 \xB7 \u6469\u6839\u77F3 \xB7 \u8349\u8393\u6676",
          beads: seq([
            "rose-10",
            "morganite-8",
            "strawberry-8",
            "citrine-8",
            "silver-6",
            "rose-8",
            "sunstone-8",
            "red-agate-8",
            "morganite-8",
            "rose-12",
            "strawberry-8",
            "citrine-10",
            "silver-6",
            "rose-8",
            "sunstone-8",
            "red-agate-8",
            "morganite-8",
            "clear-8"
          ])
        },
        {
          id: "dark",
          title: "\u6DF1\u591C\u8336\u6676",
          note: "\u8336\u6676 \xB7 \u62C9\u957F\u77F3 \xB7 \u9ED1\u66DC\u77F3",
          beads: seq([
            "smoky-10",
            "labradorite-8",
            "obsidian-8",
            "black-tourmaline-8",
            "silver-6",
            "smoky-8",
            "garnet-8",
            "tiger-eye-8",
            "labradorite-8",
            "smoky-12",
            "obsidian-8",
            "black-tourmaline-8",
            "silver-6",
            "garnet-8",
            "tiger-eye-8",
            "smoky-8",
            "labradorite-8",
            "garnet-8"
          ])
        },
        {
          id: "pearl",
          title: "\u73CD\u73E0\u767D",
          note: "\u73CD\u73E0 \xB7 \u767D\u6C34\u6676 \xB7 \u94F6\u73E0",
          beads: seq(["pearl-8", "clear-8", "pearl-8", "silver-6", "pearl-8", "clear-8", "pearl-8", "moon-10", "pearl-8", "clear-8", "silver-6"])
        },
        {
          id: "men",
          title: "\u7537\u6B3E\u864E\u773C",
          note: "\u864E\u773C\u77F3 \xB7 \u9ED1\u66DC\u77F3 12mm",
          beads: seq(["tiger-eye-14", "obsidian-12", "tiger-eye-12", "obsidian-12", "lapis-12", "obsidian-12", "tiger-eye-12", "obsidian-12"])
        }
      ];
      module.exports = { NAMES, SAMPLES: SAMPLES2, imagePath };
    }
  });

  // src/lib/one-euro.js
  var require_one_euro = __commonJS({
    "src/lib/one-euro.js"(exports, module) {
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
          }
        };
      }
      function createPointsFilter2(count, options) {
        const fx = Array.from({ length: count }, () => createFilter(options));
        const fy = Array.from({ length: count }, () => createFilter(options));
        return {
          filter(points, timeSec) {
            return points.slice(0, count).map((p, i) => ({ x: fx[i].filter(p.x, timeSec), y: fy[i].filter(p.y, timeSec) }));
          },
          reset() {
            fx.forEach((f) => f.reset());
            fy.forEach((f) => f.reset());
          }
        };
      }
      module.exports = { createFilter, createPointsFilter: createPointsFilter2 };
    }
  });

  // src/hand3d.js
  var require_hand3d = __commonJS({
    "src/hand3d.js"(exports, module) {
      function sub(a, b) {
        return [a.x - b.x, a.y - b.y, a.z - b.z];
      }
      function cross(a, b) {
        return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
      }
      function dot(a, b) {
        return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      }
      function unit(v) {
        const l = Math.hypot(v[0], v[1], v[2]) || 1;
        return [v[0] / l, v[1] / l, v[2] / l];
      }
      function hand3d2(world, handedness) {
        if (!world || world.length < 18) return null;
        const A = unit(sub(world[9], world[0]));
        let P = unit(cross(sub(world[5], world[0]), sub(world[17], world[0])));
        if (handedness === "Right") P = P.map((v) => -v);
        const toCam = [0, 0, -1];
        const c = unit(toCam.map((v, i) => v - dot(toCam, A) * A[i]));
        const r2 = cross(A, c);
        const roll = Math.atan2(dot(P, r2), dot(P, c));
        const pitch = Math.max(-0.85, Math.min(0.85, A[2]));
        const spinDir = [r2[0], r2[1]];
        return { pitch, roll, cosPitch: Math.sqrt(1 - pitch * pitch), spinDir, axis3: A, palm: P };
      }
      module.exports = { hand3d: hand3d2 };
    }
  });

  // src/main.js
  var core = require_tryon_core();
  var render = require_tryon_render();
  var { SAMPLES } = require_beads();
  var { createPointsFilter } = require_one_euro();
  var { hand3d } = require_hand3d();
  var HOLD_MS = 1200;
  var FADE_MS = 400;
  var FOLLOW = 0.4;
  var PITCH_GAIN = 0.5;
  var $ = (id) => document.getElementById(id);
  var state = {
    sample: 0,
    wristCm: 15.5,
    facing: "environment",
    model: 0,
    // 0 精简 / 1 完整
    debug: false,
    running: false,
    busy: false,
    last: null,
    // 最近一次识别结果
    lastSeen: 0,
    shown: null,
    roll: null,
    pitch: 0,
    images: {},
    frames: 0,
    detects: 0,
    hits: 0,
    since: performance.now(),
    detectMs: 0,
    handLog: [],
    backIndex: 0,
    backCams: [],
    frontCams: [],
    modelReady: false,
    switching: false,
    src: "video",
    delegate: "CPU",
    errText: "",
    fit: "contain",
    // contain 显示完整画面 / cover 铺满屏幕
    camLabel: ""
  };
  var filter = createPointsFilter(21, { minCutoff: 1, beta: 0.05 });
  function beads() {
    return core.fitBeadsToWrist(SAMPLES[state.sample].beads, state.wristCm * 10);
  }
  function loadBeadImages() {
    const keys = /* @__PURE__ */ new Set();
    SAMPLES.forEach((s) => s.beads.forEach((b) => keys.add(b.key)));
    return Promise.all(
      [...keys].map(
        (k) => new Promise((resolve) => {
          const img = new Image();
          img.onload = () => {
            state.images[k] = img;
            resolve();
          };
          img.onerror = resolve;
          img.src = "./beads/" + k + ".png";
        })
      )
    );
  }
  function setStatus(text, isError) {
    const el = $("status");
    el.textContent = text || "";
    el.style.display = text ? "block" : "none";
    el.className = isError ? "status error" : "status";
  }
  function updateLabels() {
    $("sampleName").textContent = SAMPLES[state.sample].title + " \xB7 \u624B\u56F4 " + state.wristCm + "cm";
    $("modelBtn").textContent = "\u8BC6\u522B\u65B9\u6848 " + (state.engineName || "-");
    $("debugBtn").textContent = state.debug ? "\u5173\u8C03\u8BD5" : "\u8C03\u8BD5\u70B9";
    $("fitBtn").textContent = state.fit === "cover" ? "\u753B\u9762\uFF1A\u94FA\u6EE1" : "\u753B\u9762\uFF1A\u5B8C\u6574";
    $("camBtn").textContent = state.facing === "user" ? "\u6362\u540E\u7F6E" : "\u6362\u524D\u7F6E";
    const n = (state.backCams || []).length;
    $("lensBtn").textContent = n > 1 && state.facing !== "user" ? "\u955C\u5934 " + (state.backIndex + 1) + "/" + n : "\u6362\u955C\u5934";
  }
  var NPM = "https://registry.npmmirror.com/";
  var LEGACY_BASES = [NPM + "@mediapipe/hands/0.4.1675469240/files/", "./mediapipe/"];
  var TASKS_BASES = [NPM + "@mediapipe/tasks-vision/1.2.2/files/", "./tasks/"];
  var MODEL_TGZ = NPM + "@beautinique/frontend-tryon-assets/-/frontend-tryon-assets-1.0.2.tgz";
  var MODEL_URLS = [
    MODEL_TGZ,
    "./models/hand_landmarker.task",
    "https://cdn.jsdelivr.net/gh/zhangguangliang2026-lgtm/dushe-tryon-h5@main/models/hand_landmarker.task",
    "https://testingcf.jsdelivr.net/gh/zhangguangliang2026-lgtm/dushe-tryon-h5@main/models/hand_landmarker.task"
  ];
  function withTimeout(p, ms, what) {
    return Promise.race([
      p,
      new Promise((_, rej) => setTimeout(() => rej(new Error(what + "\u8D85\u8FC7 " + Math.round(ms / 1e3) + " \u79D2\u6CA1\u6709\u5B8C\u6210")), ms))
    ]);
  }
  function loadScript(url) {
    return new Promise((resolve, reject) => {
      const el = document.createElement("script");
      el.src = url;
      el.crossOrigin = "anonymous";
      el.onload = resolve;
      el.onerror = () => reject(new Error("\u811A\u672C\u52A0\u8F7D\u5931\u8D25 " + url));
      document.head.appendChild(el);
    });
  }
  function legacyEngine(base) {
    let hands = null;
    let pending = null;
    return {
      name: "A",
      async load() {
        if (!window.Hands) await withTimeout(loadScript(base + "hands.js"), 2e4, "\u65B9\u6848A\u811A\u672C");
        hands = new window.Hands({ locateFile: (f) => base + f });
        hands.setOptions({ maxNumHands: 1, modelComplexity: 0, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
        hands.onResults((r) => {
          if (pending) pending(r);
        });
        await withTimeout(hands.initialize(), 6e4, "\u65B9\u6848A\u6A21\u578B\u52A0\u8F7D");
      },
      detect(input) {
        return new Promise((resolve, reject) => {
          pending = (r) => {
            pending = null;
            resolve(r);
          };
          hands.send({ image: input }).then(() => {
            if (pending) {
              pending = null;
              resolve({});
            }
          }, reject);
        });
      },
      close() {
        try {
          if (hands) hands.close();
        } catch (e) {
        }
      }
    };
  }
  async function fetchModel() {
    const ctrls = MODEL_URLS.map(() => new AbortController());
    const got = MODEL_URLS.map(() => 0);
    const timer = setInterval(() => {
      setStatus("\u6B63\u5728\u4E0B\u8F7D\u624B\u90E8\u6A21\u578B " + (Math.max.apply(null, got) / 1048576).toFixed(1) + "MB\u2026\uFF08\u53EA\u6709\u7B2C\u4E00\u6B21\u9700\u8981\uFF09");
    }, 300);
    try {
      return await Promise.any(
        MODEL_URLS.map(async (u, i) => {
          const res = await fetch(u, { signal: ctrls[i].signal });
          if (!res.ok) throw new Error("HTTP " + res.status);
          const reader = res.body.getReader();
          const parts = [];
          for (; ; ) {
            const { done, value } = await reader.read();
            if (done) break;
            parts.push(value);
            got[i] += value.length;
          }
          let buf = new Uint8Array(got[i]);
          let o = 0;
          for (const part of parts) {
            buf.set(part, o);
            o += part.length;
          }
          if (u === MODEL_TGZ) buf = await untarModel(buf);
          ctrls.forEach((c, j) => j !== i && c.abort());
          log("\u624B\u90E8\u6A21\u578B\u6765\u81EA " + ["\u56FD\u5185\u955C\u50CF", "GitHub", "jsDelivr", "jsDelivr-CF"][i] + " " + ((performance.now() - T0) / 1e3).toFixed(1) + "s");
          return buf;
        })
      );
    } catch (e) {
      throw new Error("\u624B\u90E8\u6A21\u578B\u4E09\u4E2A\u6765\u6E90\u90FD\u4E0B\u8F7D\u5931\u8D25");
    } finally {
      clearInterval(timer);
    }
  }
  async function untarModel(gz) {
    const tar = new Uint8Array(await new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
    const dec = new TextDecoder();
    let off = 0;
    while (off + 512 <= tar.length) {
      const name = dec.decode(tar.subarray(off, off + 100)).split("\0")[0];
      if (!name) break;
      const size = parseInt(dec.decode(tar.subarray(off + 124, off + 136)).split("\0")[0].trim(), 8) || 0;
      if (name === "package/models/hand_landmarker.task") {
        const out = tar.slice(off + 512, off + 512 + size);
        if (out.length !== 7819105) throw new Error("\u6A21\u578B\u5927\u5C0F\u4E0D\u5BF9 " + out.length);
        return out;
      }
      off += 512 + Math.ceil(size / 512) * 512;
    }
    throw new Error("\u538B\u7F29\u5305\u91CC\u6CA1\u6709\u624B\u90E8\u6A21\u578B");
  }
  function tasksEngine(delegate) {
    let lm = null;
    let lastTs = 0;
    return {
      name: "B",
      async load() {
        let vision = null;
        let base = null;
        for (const b of TASKS_BASES) {
          try {
            vision = await withTimeout(window.__loadVision(b + "vision_bundle.mjs"), 2e4, "\u65B9\u6848B\u811A\u672C");
            base = b;
            break;
          } catch (e) {
            log("\u65B9\u6848B\u811A\u672C " + b + " \u5931\u8D25 " + e.message);
          }
        }
        if (!vision) throw new Error("\u65B9\u6848B\u811A\u672C\u52A0\u8F7D\u5931\u8D25");
        const fileset = await withTimeout(vision.FilesetResolver.forVisionTasks(base + "wasm"), 6e4, "\u65B9\u6848B\u8FD0\u884C\u5E93");
        const model = await fetchModel();
        lm = await withTimeout(
          vision.HandLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetBuffer: model, delegate },
            runningMode: "VIDEO",
            numHands: 1
          }),
          6e4,
          "\u65B9\u6848B\u6A21\u578B\u542F\u52A8"
        );
      },
      detect(input) {
        const ts = Math.max(performance.now(), lastTs + 1);
        lastTs = ts;
        const r = lm.detectForVideo(input, ts);
        return Promise.resolve({
          multiHandLandmarks: r.landmarks || [],
          multiHandWorldLandmarks: r.worldLandmarks || [],
          multiHandedness: (r.handedness || []).map((h) => ({ label: h[0] && h[0].categoryName, score: h[0] && h[0].score }))
        });
      },
      close() {
        try {
          if (lm) lm.close();
        } catch (e) {
        }
      }
    };
  }
  var engine = null;
  async function loadEngine(order) {
    state.modelReady = false;
    for (const make of order) {
      const eng = make();
      const t0 = performance.now();
      log("\u52A0\u8F7D\u65B9\u6848" + eng.name + "\u2026");
      setStatus("\u6B63\u5728\u52A0\u8F7D\u8BC6\u522B\u65B9\u6848 " + eng.name + "\uFF08\u7B2C\u4E00\u6B21\u9700\u8981\u4E0B\u8F7D\uFF0C\u7EA6\u5341\u51E0 MB\uFF09\u2026");
      try {
        await eng.load();
        log("\u65B9\u6848" + eng.name + " \u52A0\u8F7D\u5B8C\u6210 " + ((performance.now() - t0) / 1e3).toFixed(1) + "s");
        if (engine) engine.close();
        engine = eng;
        state.engineName = eng.name;
        state.engineFails = 0;
        state.engineStart = performance.now();
        state.firstResult = false;
        state.modelReady = true;
        updateLabels();
        return true;
      } catch (e) {
        log("\u65B9\u6848" + eng.name + " \u5931\u8D25\uFF1A" + e.message);
        eng.close();
      }
    }
    return false;
  }
  var params = new URLSearchParams(location.search);
  var WANT = params.get("engine") === "A" ? "A" : "B";
  var ORDER_ALL = WANT === "A" ? [() => legacyEngine(LEGACY_BASES[0]), () => legacyEngine(LEGACY_BASES[1])] : [() => tasksEngine("CPU")];
  function reloadWith(engineName, reason) {
    const tried = (params.get("tried") || "").split(",").filter(Boolean);
    if (tried.indexOf(engineName) >= 0) return false;
    tried.push(WANT);
    log("\u6362\u65B9\u6848" + engineName + "\uFF1A" + reason);
    const q = new URLSearchParams({ engine: engineName, auto: "1", tried: tried.join(","), why: "\u65B9\u6848" + WANT + " " + reason, v: "8" });
    setTimeout(() => location.replace(location.pathname + "?" + q.toString()), 800);
    return true;
  }
  async function engineFailed(msg) {
    log("\u65B9\u6848" + state.engineName + " \u8BC6\u522B" + msg);
    state.engineFails = (state.engineFails || 0) + 1;
    if (state.engineFails < 2 && !/秒/.test(msg)) return;
    state.modelReady = false;
    if (!reloadWith(state.engineName === "A" ? "B" : "A", msg)) {
      state.errText = "\u65B9\u6848" + state.engineName + " " + msg;
      $("log").style.display = "block";
    }
  }
  var hand = { label: null, other: 0 };
  function stickyHand(label, score) {
    if (!label) return hand.label;
    if (!hand.label) hand.label = label;
    else if (label !== hand.label) {
      hand.other += 1;
      if (hand.other >= 8 && (score || 0) > 0.8) {
        hand.label = label;
        hand.other = 0;
      }
    } else hand.other = 0;
    state.handLog.push(label);
    if (state.handLog.length > 60) state.handLog.shift();
    return hand.label;
  }
  function onResults(res) {
    state.detects += 1;
    if (!state.firstResult) {
      state.firstResult = true;
      log("\u7B2C\u4E00\u6B21\u8BC6\u522B\u5B8C\u6210");
    }
    const lm = res.multiHandLandmarks && res.multiHandLandmarks[0];
    if (!lm) return;
    state.hits += 1;
    const now = performance.now();
    const pts = filter.filter(lm.map((p) => ({ x: p.x, y: p.y })), now / 1e3);
    const world = res.multiHandWorldLandmarks && res.multiHandWorldLandmarks[0];
    const hd = res.multiHandedness && res.multiHandedness[0];
    const h = hand3d(world, stickyHand(hd && hd.label, hd && hd.score));
    if (h) {
      if (state.roll == null) state.roll = h.roll;
      else {
        let d = h.roll - state.roll;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        state.roll += d * 0.5;
        if (state.roll > Math.PI) state.roll -= 2 * Math.PI;
        if (state.roll < -Math.PI) state.roll += 2 * Math.PI;
      }
      state.pitch = state.pitch * 0.6 + h.pitch * PITCH_GAIN * 0.4;
      state.cosPitch = Math.sqrt(1 - Math.min(0.8, Math.abs(h.pitch)) ** 2 * PITCH_GAIN);
      state.spinDir = h.spinDir;
    }
    state.last = pts;
    state.lastSeen = now;
  }
  var video = $("video");
  var canvas = $("stage");
  var ctx = canvas.getContext("2d");
  function layoutCanvas() {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return;
    if (canvas.width !== vw || canvas.height !== vh) {
      canvas.width = vw;
      canvas.height = vh;
    }
    const box = $("viewport").getBoundingClientRect();
    const s = state.fit === "cover" ? Math.max(box.width / vw, box.height / vh) : Math.min(box.width / vw, box.height / vh);
    canvas.style.width = vw * s + "px";
    canvas.style.height = vh * s + "px";
    canvas.style.left = (box.width - vw * s) / 2 + "px";
    canvas.style.top = (box.height - vh * s) / 2 + "px";
    canvas.style.transform = state.facing === "user" ? "scaleX(-1)" : "none";
  }
  function drawFrame() {
    const W = canvas.width;
    const H = canvas.height;
    ctx.drawImage(video, 0, 0, W, H);
    const now = performance.now();
    const age = now - state.lastSeen;
    state.frames += 1;
    if (state.last && age < HOLD_MS + FADE_MS) {
      if (!state.shown) state.shown = state.last.map((p) => ({ x: p.x, y: p.y }));
      state.shown = state.shown.map((p, i) => ({ x: p.x + (state.last[i].x - p.x) * FOLLOW, y: p.y + (state.last[i].y - p.y) * FOLLOW }));
      let pose = core.estimateWristPose(state.shown, W, H, state.wristCm * 10);
      if (pose) {
        pose = Object.assign({}, pose, { pxPerMm: pose.pxPerMm / Math.max(0.6, state.cosPitch || 1) });
        const list = beads();
        let rotate = 0;
        if (state.roll != null && state.spinDir) {
          const probe = core.computeLayout({ pose, beads: list, pitch3d: state.pitch });
          const sign = Math.sign(probe.frontDir.x * state.spinDir[0] + probe.frontDir.y * state.spinDir[1]) || 1;
          rotate = sign * (state.roll - Math.PI) / (2 * Math.PI);
        }
        const layout = core.computeLayout({ pose, beads: list, pitch3d: state.pitch, adjust: { rotate } });
        ctx.globalAlpha = age < HOLD_MS ? 1 : Math.max(0, 1 - (age - HOLD_MS) / FADE_MS);
        render.drawTryon(ctx, layout, state.images, { width: W, height: H, shadow: true });
        ctx.globalAlpha = 1;
        if (state.debug) render.drawDebug(ctx, state.last, W, H, layout);
      }
    } else {
      state.shown = null;
      state.roll = null;
      hand.label = null;
      hand.other = 0;
      if (state.last) filter.reset();
      state.last = null;
    }
    if (now - state.since > 1e3) {
      const sec = (now - state.since) / 1e3;
      $("fps").textContent = "\u65B9\u6848" + (state.engineName || "-") + " \xB7 " + Math.round(state.frames / sec) + " \u5E27/\u79D2 \xB7 \u8BC6\u522B " + Math.round(state.detects / sec) + " \u6B21/\u79D2 \xB7 \u8BA4\u51FA " + Math.round(state.hits / sec) + " \xB7 " + Math.round(state.detectMs) + "ms";
      if (state.debug) {
        $("fps").textContent += " \xB7 " + video.videoWidth + "\xD7" + video.videoHeight + " \xB7 " + state.camLabel;
        if (state.roll != null) $("fps").textContent += " \xB7 \u8F6C " + Math.round(state.roll * 180 / Math.PI) + "\xB0";
      }
      if (state.errText) setStatus("\u8BC6\u522B\u6CA1\u8DD1\u8D77\u6765\uFF1A" + state.errText + "\u3002\u8BF7\u622A\u56FE\u53D1\u7ED9\u5F00\u53D1", true);
      else setStatus(state.hits ? "" : "\u5F20\u5F00\u624B\u638C\u5BF9\u51C6\u955C\u5934\uFF0C\u8BA4\u51FA\u540E\u53EF\u4EE5\u968F\u610F\u8F6C\u52A8\u624B\u8155");
      state.frames = 0;
      state.detects = 0;
      state.hits = 0;
      state.since = now;
    }
  }
  async function loop() {
    if (!state.running) return;
    if (video.readyState >= 2) {
      layoutCanvas();
      drawFrame();
      if (!state.busy && state.modelReady && !state.switching && engine) {
        state.busy = true;
        const t0 = performance.now();
        const eng = engine;
        let done = false;
        const guard = setTimeout(() => {
          if (done || eng !== engine) return;
          state.busy = false;
          engineFailed("\u8D85\u8FC7 6 \u79D2\u6CA1\u8FD4\u56DE");
        }, 6e3);
        Promise.resolve().then(() => eng.detect(video)).then((r) => {
          if (eng !== engine) return;
          onResults(r);
          state.detectMs = state.detectMs * 0.8 + (performance.now() - t0) * 0.2;
        }).catch((e) => eng === engine && engineFailed("\u51FA\u9519 " + (e && e.message || e))).finally(() => {
          done = true;
          clearTimeout(guard);
          if (eng === engine) state.busy = false;
        });
      }
    } else if (performance.now() - state.since > 1e3) {
      $("fps").textContent = "\u7B49\u5F85\u753B\u9762 \xB7 \u72B6\u6001 " + video.readyState;
      state.since = performance.now();
    }
    requestAnimationFrame(loop);
  }
  var wait = (ms) => new Promise((r) => setTimeout(r, ms));
  var logs = [];
  function log(msg) {
    const t = ((performance.now() - T0) / 1e3).toFixed(1);
    logs.push(t + "s " + msg);
    if (logs.length > 20) logs.shift();
    const el = $("log");
    if (el) el.textContent = logs.join("\n");
  }
  var T0 = performance.now();
  function stopStream() {
    const old = video.srcObject;
    if (!old) return false;
    old.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
    return true;
  }
  function camNo(d) {
    const m = /camera\s*(\d+)/i.exec(d.label || "");
    return m ? +m[1] : 99;
  }
  var isFront = (d) => /front|user|前/i.test(d.label || "");
  async function refreshCams() {
    try {
      const all = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput" && d.deviceId);
      if (!all.some((d) => d.label)) return;
      state.backCams = all.filter((d) => !isFront(d)).sort((x, y) => camNo(x) - camNo(y));
      state.frontCams = all.filter(isFront).sort((x, y) => camNo(x) - camNo(y));
    } catch (e) {
      log("\u5217\u6444\u50CF\u5934\u5931\u8D25 " + e.name);
    }
  }
  function pickCam() {
    const list = state.facing === "user" ? state.frontCams : state.backCams;
    if (!list || !list.length) return null;
    const i = state.facing === "user" ? 0 : Math.min(state.backIndex, list.length - 1);
    return list[i];
  }
  async function waitIdle() {
    state.switching = true;
    for (let i = 0; i < 50 && state.busy; i++) await wait(100);
  }
  async function openOnce(constraints, token) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: constraints });
    if (token !== state.camToken) {
      stream.getTracks().forEach((t) => t.stop());
      return null;
    }
    return stream;
  }
  async function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus("\u8FD9\u4E2A\u6D4F\u89C8\u5668\u4E0D\u80FD\u6253\u5F00\u6444\u50CF\u5934\u3002\u8BF7\u70B9\u53F3\u4E0A\u89D2\u300C\u2026\u300D\uFF0C\u9009\u300C\u5728\u6D4F\u89C8\u5668\u6253\u5F00\u300D\u518D\u8BD5", true);
      return;
    }
    const token = state.camToken = (state.camToken || 0) + 1;
    setButtons(false);
    await waitIdle();
    if (stopStream()) await wait(1e3);
    await refreshCams();
    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (token !== state.camToken) return;
      const cam = pickCam();
      const constraints = cam ? { deviceId: { exact: cam.deviceId } } : { facingMode: state.facing };
      try {
        log("\u6253\u5F00 " + (cam ? cam.label : state.facing === "user" ? "\u524D\u7F6E(\u9ED8\u8BA4)" : "\u540E\u7F6E(\u9ED8\u8BA4)") + (attempt ? " \u91CD\u8BD5" + attempt : ""));
        const stream = await openOnce(constraints, token);
        if (!stream) return;
        const track = stream.getVideoTracks()[0];
        const set = track.getSettings ? track.getSettings() : {};
        log("\u6210\u529F " + track.label + " " + (set.width || "?") + "\xD7" + (set.height || "?"));
        track.onended = () => log("\u6444\u50CF\u5934\u88AB\u5173\u95ED");
        track.onmute = () => log("\u6444\u50CF\u5934\u6682\u505C\u51FA\u753B\u9762");
        track.onunmute = () => log("\u6444\u50CF\u5934\u6062\u590D");
        video.srcObject = stream;
        try {
          await video.play();
        } catch (e) {
          log("\u64AD\u653E\u5931\u8D25 " + e.name);
        }
        state.camLabel = track.label || (state.facing === "user" ? "\u524D\u7F6E" : "\u540E\u7F6E");
        if (!cam && state.facing !== "user") {
          await refreshCams();
          const best = pickCam();
          if (best && best.label !== track.label) {
            log("\u6362\u6210\u4E3B\u6444 " + best.label);
            state.switching = false;
            setButtons(true);
            return startCamera();
          }
        }
        state.switching = false;
        setButtons(true);
        $("start").style.display = "none";
        if (!state.engineStart) state.engineStart = performance.now();
        setStatus(state.modelReady ? "" : "\u6B63\u5728\u52A0\u8F7D\u8BC6\u522B\u6A21\u578B\u2026");
        if (!state.running) {
          state.running = true;
          requestAnimationFrame(loop);
        }
        updateLabels();
        return;
      } catch (e) {
        lastErr = e;
        log("\u5931\u8D25 " + (e.name || "") + " " + (e.message || ""));
        await wait(1e3);
      }
    }
    state.switching = false;
    setButtons(true);
    $("log").style.display = "block";
    setStatus("\u6444\u50CF\u5934\u6253\u4E0D\u5F00\uFF1A" + (lastErr && lastErr.name) + "\u3002\u53EF\u4EE5\u518D\u70B9\u4E00\u6B21\u5207\u6362\uFF0C\u6216\u70B9\u53F3\u4E0A\u89D2\u300C\u2026\u300D\u9009\u300C\u5728\u6D4F\u89C8\u5668\u6253\u5F00\u300D", true);
  }
  function setButtons(on) {
    ["camBtn", "lensBtn", "modelBtn"].forEach((id) => $(id).disabled = !on);
  }
  $("start").onclick = async () => {
    $("start").disabled = true;
    $("log").style.display = "block";
    setStatus("\u6B63\u5728\u52A0\u8F7D\u8BC6\u522B\u6A21\u578B\uFF08\u9996\u6B21\u7EA6 8MB\uFF0C\u7F51\u7EDC\u6162\u65F6\u8981\u7B49\u4E00\u4F1A\uFF09\u2026");
    await loadBeadImages();
    if (!await loadEngine(ORDER_ALL)) {
      if (reloadWith(WANT === "A" ? "B" : "A", "\u52A0\u8F7D\u5931\u8D25")) return;
      setStatus("\u8BC6\u522B\u65B9\u6848\u90FD\u52A0\u8F7D\u5931\u8D25\uFF0C\u8BF7\u622A\u56FE\u53D1\u7ED9\u5F00\u53D1\uFF0C\u7136\u540E\u5237\u65B0\u518D\u8BD5", true);
      $("start").disabled = false;
      return;
    }
    setStatus("\u6B63\u5728\u6253\u5F00\u6444\u50CF\u5934\u2026");
    await startCamera();
    const hide = setInterval(() => {
      if (state.firstResult && !state.errText) {
        clearInterval(hide);
        setTimeout(() => {
          if (!state.debug) $("log").style.display = "none";
        }, 3e3);
      }
    }, 500);
  };
  $("lensBtn").onclick = () => {
    if (state.facing === "user") state.facing = "environment";
    else state.backIndex = (state.backIndex + 1) % Math.max(1, (state.backCams || []).length);
    state.last = null;
    filter.reset();
    startCamera();
  };
  $("nextBtn").onclick = () => {
    state.sample = (state.sample + 1) % SAMPLES.length;
    updateLabels();
  };
  $("camBtn").onclick = () => {
    state.facing = state.facing === "user" ? "environment" : "user";
    state.last = null;
    filter.reset();
    startCamera();
  };
  $("fitBtn").onclick = () => {
    state.fit = state.fit === "cover" ? "contain" : "cover";
    layoutCanvas();
    updateLabels();
  };
  $("debugBtn").onclick = () => {
    state.debug = !state.debug;
    $("log").style.display = state.debug ? "block" : "none";
    updateLabels();
  };
  $("modelBtn").onclick = () => {
    const q = new URLSearchParams({ engine: state.engineName === "A" ? "B" : "A", auto: "1", v: "8" });
    location.replace(location.pathname + "?" + q.toString());
  };
  $("wristMinus").onclick = () => {
    state.wristCm = Math.max(13, state.wristCm - 0.5);
    updateLabels();
  };
  $("wristPlus").onclick = () => {
    state.wristCm = Math.min(19, state.wristCm + 0.5);
    updateLabels();
  };
  $("shotBtn").onclick = () => {
    $("shotImg").src = canvas.toDataURL("image/jpeg", 0.92);
    $("shotBox").style.display = "flex";
  };
  $("shotBox").onclick = () => $("shotBox").style.display = "none";
  window.addEventListener("resize", layoutCanvas);
  setButtons(false);
  updateLabels();
  setStatus("\u70B9\u4E0B\u9762\u7684\u6309\u94AE\u6253\u5F00\u6444\u50CF\u5934");
  window.__tryon = { state, onResults, drawFrame, layoutCanvas, startCamera };
  if (params.get("why")) log("\u4E0A\u4E00\u6B21\uFF1A" + params.get("why") + "\uFF0C\u5DF2\u81EA\u52A8\u6362\u65B9\u6848");
  if (params.get("auto") === "1") setTimeout(() => $("start").click(), 300);
})();
