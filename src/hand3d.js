/**
 * 用 MediaPipe 的 3D 手部坐标（世界坐标，单位米：x 右、y 下、z 远离镜头）算出：
 * - pitch：前臂朝镜头倾斜的程度（sin 值，正 = 手指一侧更远），给 computeLayout 的 pitch3d
 * - roll：手腕绕前臂转了多少（弧度，0 = 手心正对镜头，π = 手背正对镜头）
 * - cosPitch：前臂在画面里被透视缩短的比例，用来修正比例（手斜着时手链不再偏小）
 * handedness：MediaPipe 给的 'Left' / 'Right'，用来统一左右手的手心朝向。
 */
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

function hand3d(world, handedness) {
  if (!world || world.length < 18) return null;
  const A = unit(sub(world[9], world[0])); // 前臂方向，指向手指
  let P = unit(cross(sub(world[5], world[0]), sub(world[17], world[0])));
  if (handedness === 'Right') P = P.map((v) => -v); // 统一成“手心朝外”的方向
  // 参考方向：朝向镜头、并垂直于前臂
  const toCam = [0, 0, -1];
  const c = unit(toCam.map((v, i) => v - dot(toCam, A) * A[i]));
  const r2 = cross(A, c);
  const roll = Math.atan2(dot(P, r2), dot(P, c));
  const pitch = Math.max(-0.85, Math.min(0.85, A[2]));
  // 前臂绕自己转动时，正面皮肤在画面上移动的方向（给手链转向用）
  const spinDir = [r2[0], r2[1]];
  return { pitch, roll, cosPitch: Math.sqrt(1 - pitch * pitch), spinDir, axis3: A, palm: P };
}

module.exports = { hand3d };
