/**
 * 把 computeLayout 的结果画到 Canvas 2D 上。
 * 只用标准 Canvas 2D 接口，小程序和 Node（测试预览）里都能跑。
 *
 * 绘制顺序：
 * 1. 手腕后面的珠子：和手腕有重叠的整颗不画（被手腕挡住）；完全露在手腕外侧的整颗画出、略暗。
 *    不再按直线裁剪，避免出现被切成三角的碎片。
 * 2. 前面珠子投在皮肤上的柔和阴影。
 * 3. 前面的珠子（珠子照片的穿线孔是水平的，旋转到手串的切线方向）。
 */

function bandClip(ctx, band, width, height, inset) {
  // 手腕带以外的两块区域（互不重叠），合起来作为裁剪区
  const far = (width + height) * 2;
  const { cx, cy, nx, ny, ax, ay } = band;
  const halfWidth = Math.max(0, band.halfWidth - (inset || 0));
  const side = (sign) => {
    const ox = cx + nx * halfWidth * sign;
    const oy = cy + ny * halfWidth * sign;
    const p1 = { x: ox - ax * far, y: oy - ay * far };
    const p2 = { x: ox + ax * far, y: oy + ay * far };
    const p3 = { x: p2.x + nx * far * sign, y: p2.y + ny * far * sign };
    const p4 = { x: p1.x + nx * far * sign, y: p1.y + ny * far * sign };
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.lineTo(p3.x, p3.y);
    ctx.lineTo(p4.x, p4.y);
    ctx.closePath();
  };
  ctx.beginPath();
  side(1);
  side(-1);
  ctx.clip();
}

function drawBead(ctx, image, bead, darken, tint) {
  const r = bead.diameter / 2;
  ctx.save();
  ctx.translate(bead.x, bead.y);
  ctx.rotate(bead.angle);
  if (image) {
    ctx.drawImage(image, -r, -r, r * 2, r * 2);
  } else {
    ctx.fillStyle = '#c9c2ba';
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
  }
  if (tint) {
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = tint;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.97, 0, Math.PI * 2);
    ctx.fill();
  }
  if (darken > 0) {
    ctx.globalAlpha = Math.min(0.6, darken);
    ctx.fillStyle = '#1d1712';
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.97, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawShadow(ctx, bead, layout) {
  const r = bead.diameter / 2;
  // 阴影往手肘方向和画面下方偏一点
  const ox = -layout.band.ax * r * 0.18;
  const oy = -layout.band.ay * r * 0.18 + r * 0.22;
  const g = ctx.createRadialGradient(bead.x + ox, bead.y + oy, r * 0.2, bead.x + ox, bead.y + oy, r * 1.25);
  g.addColorStop(0, 'rgba(40, 24, 14, 0.30)');
  g.addColorStop(1, 'rgba(40, 24, 14, 0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(bead.x + ox, bead.y + oy, r * 1.25, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * ctx：Canvas 2D 上下文（已按需要 setTransform 好像素比）
 * layout：computeLayout 的结果
 * images：{ key: 已加载的图片对象 }
 * opts：{ width, height, shadow: true, tone: { shade, tint }, occlusion }
 *   tone 来自 wrist-snap.sceneTone，按环境压暗；occlusion 来自 utils/occlude.js 的 makeOcclusion，按真实轮廓遮挡背面珠子
 */
function drawTryon(ctx, layout, images, opts) {
  if (!layout) return;
  const o = Object.assign({ shadow: true }, opts || {});
  const back = layout.beads.filter((b) => b.back && !b.hidden);
  const front = layout.beads.filter((b) => !b.back);

  const tone = o.tone || {};
  const shade = tone.shade || 0;
  if (o.occlusion) {
    // 有原画面像素时：去掉大部分被手臂盖住的，其余背面珠子画出来，再按真实手臂轮廓把皮肤盖回去
    const visibleBack = o.occlusion.filter(back.filter((b) => !b.deep));
    visibleBack.forEach((b) => drawBead(ctx, images[b.key], b, shade + 0.1 + 0.1 * Math.max(0, b.relZ), tone.tint));
    if (visibleBack.length) o.occlusion.restore(ctx, visibleBack);
  } else {
    // 没有像素时：只画完全露在手腕外侧的（手链垂下来那一段），不裁剪，避免出现切成三角的碎片
    back
      .filter((b) => b.clearOutside)
      .forEach((b) => drawBead(ctx, images[b.key], b, shade + 0.1 + 0.1 * Math.max(0, b.relZ), tone.tint));
  }
  if (o.shadow) {
    ctx.save();
    front.forEach((b) => drawShadow(ctx, b, layout));
    ctx.restore();
  }
  // 侧面的珠子正在拐到背面，受光少，略暗
  front.forEach((b) => drawBead(ctx, images[b.key], b, shade + 0.12 * (b.side || 0), tone.tint));
}

/** 调试用：画出关键点和手腕带 */
function drawDebug(ctx, points, width, height, layout) {
  ctx.save();
  if (points) {
    ctx.fillStyle = '#18c964';
    points.forEach((p, i) => {
      ctx.beginPath();
      ctx.arc(p.x * width, p.y * height, i === 0 ? 6 : 3.5, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  if (layout) {
    const { cx, cy, nx, ny, ax, ay, halfWidth } = layout.band;
    const L = halfWidth * 2;
    ctx.strokeStyle = 'rgba(255, 80, 80, 0.9)';
    ctx.lineWidth = 2;
    [-1, 1].forEach((s) => {
      ctx.beginPath();
      ctx.moveTo(cx + nx * halfWidth * s - ax * L, cy + ny * halfWidth * s - ay * L);
      ctx.lineTo(cx + nx * halfWidth * s + ax * L, cy + ny * halfWidth * s + ay * L);
      ctx.stroke();
    });
  }
  ctx.restore();
}

module.exports = { drawTryon, drawDebug, drawBead };
