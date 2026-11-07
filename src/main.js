/**
 * 独奢 · 手链 AR 试戴测试页（网页版）
 * 手部识别：MediaPipe Hands（谷歌开源，Apache 2.0，模型文件随页面一起放在 ./mediapipe/，在手机本地运行）
 * 手链排布与绘制：沿用小程序原型的 tryon-core / tryon-render
 */
const core = require('./lib/tryon-core');
const render = require('./lib/tryon-render');
const { SAMPLES } = require('./lib/beads');
const { createPointsFilter } = require('./lib/one-euro');
const { hand3d } = require('./hand3d');

const HOLD_MS = 1200; // 手短暂认不出时保持的时间
const FADE_MS = 400;
const FOLLOW = 0.4; // 显示位置每帧靠近识别位置的比例
const PITCH_GAIN = 0.5; // 手腕弯曲时手掌方向不等于前臂方向，只用一半的俯仰

const $ = (id) => document.getElementById(id);
const state = {
  sample: 0,
  wristCm: 15.5,
  facing: 'environment',
  model: 0, // 0 精简 / 1 完整
  debug: false,
  running: false,
  busy: false,
  last: null, // 最近一次识别结果
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
  fit: 'contain', // contain 显示完整画面 / cover 铺满屏幕
  camLabel: '',
};
const filter = createPointsFilter(21, { minCutoff: 1.0, beta: 0.05 });

function beads() {
  return core.fitBeadsToWrist(SAMPLES[state.sample].beads, state.wristCm * 10);
}

function loadBeadImages() {
  const keys = new Set();
  SAMPLES.forEach((s) => s.beads.forEach((b) => keys.add(b.key)));
  return Promise.all(
    [...keys].map(
      (k) =>
        new Promise((resolve) => {
          const img = new Image();
          img.onload = () => {
            state.images[k] = img;
            resolve();
          };
          img.onerror = resolve;
          img.src = './beads/' + k + '.png';
        })
    )
  );
}

function setStatus(text, isError) {
  const el = $('status');
  el.textContent = text || '';
  el.style.display = text ? 'block' : 'none';
  el.className = isError ? 'status error' : 'status';
}

function updateLabels() {
  $('sampleName').textContent = SAMPLES[state.sample].title + ' · 手围 ' + state.wristCm + 'cm';
  $('modelBtn').textContent = state.model ? '模型：完整' : '模型：精简';
  $('debugBtn').textContent = state.debug ? '关调试' : '调试点';
  $('fitBtn').textContent = state.fit === 'cover' ? '画面：铺满' : '画面：完整';
  $('camBtn').textContent = state.facing === 'user' ? '换后置' : '换前置';
}

// ---------- 识别 ----------
let hands = null;
function createHands() {
  hands = new window.Hands({ locateFile: (f) => './mediapipe/' + f });
  hands.setOptions({ maxNumHands: 1, modelComplexity: state.model, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
  hands.onResults(onResults);
}

// 左右手判断偶尔会在两帧之间跳变，跳一次手链就会转半圈，所以要连续多帧都变了才认
const hand = { label: null, other: 0 };
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
  const lm = res.multiHandLandmarks && res.multiHandLandmarks[0];
  if (!lm) return;
  state.hits += 1;
  const now = performance.now();
  const pts = filter.filter(lm.map((p) => ({ x: p.x, y: p.y })), now / 1000);
  const world = res.multiHandWorldLandmarks && res.multiHandWorldLandmarks[0];
  const hd = res.multiHandedness && res.multiHandedness[0];
  const h = hand3d(world, stickyHand(hd && hd.label, hd && hd.score));
  if (h) {
    // 转动角度平滑：处理 ±180° 跳变
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

// ---------- 画面 ----------
const video = $('video');
const canvas = $('stage');
const ctx = canvas.getContext('2d');

function layoutCanvas() {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return;
  if (canvas.width !== vw || canvas.height !== vh) {
    canvas.width = vw;
    canvas.height = vh;
  }
  const box = $('viewport').getBoundingClientRect();
  const s = state.fit === 'cover' ? Math.max(box.width / vw, box.height / vh) : Math.min(box.width / vw, box.height / vh);
  canvas.style.width = vw * s + 'px';
  canvas.style.height = vh * s + 'px';
  canvas.style.left = (box.width - vw * s) / 2 + 'px';
  canvas.style.top = (box.height - vh * s) / 2 + 'px';
  canvas.style.transform = state.facing === 'user' ? 'scaleX(-1)' : 'none';
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
      // 手斜着时，手掌在画面里被缩短，按 3D 方向把比例补回来
      pose = Object.assign({}, pose, { pxPerMm: pose.pxPerMm / Math.max(0.6, state.cosPitch || 1) });
      const list = beads();
      let rotate = 0;
      if (state.roll != null && state.spinDir) {
        // 手链跟着手腕转：手背朝镜头时主珠在正面
        const probe = core.computeLayout({ pose, beads: list, pitch3d: state.pitch });
        const sign = Math.sign(probe.frontDir.x * state.spinDir[0] + probe.frontDir.y * state.spinDir[1]) || 1;
        rotate = (sign * (state.roll - Math.PI)) / (2 * Math.PI);
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
  if (now - state.since > 1000) {
    const sec = (now - state.since) / 1000;
    $('fps').textContent =
      Math.round(state.frames / sec) + ' 帧/秒 · 识别 ' + Math.round(state.detects / sec) + ' 次/秒 · 认出 ' + Math.round(state.hits / sec) + ' · ' + Math.round(state.detectMs) + 'ms';
    if (state.debug) {
      $('fps').textContent += ' · ' + video.videoWidth + '×' + video.videoHeight + ' · ' + state.camLabel;
      if (state.roll != null) $('fps').textContent += ' · 转 ' + Math.round((state.roll * 180) / Math.PI) + '°';
    }
    setStatus(state.hits ? '' : '张开手掌对准镜头，认出后可以随意转动手腕');
    state.frames = 0;
    state.detects = 0;
    state.hits = 0;
    state.since = now;
  }
}

async function loop() {
  if (!state.running) return;
  if (video.srcObject) checkStuck(performance.now());
  if (video.readyState >= 2) {
    layoutCanvas();
    drawFrame();
    if (!state.busy) {
      state.busy = true;
      const t0 = performance.now();
      const guard = setTimeout(() => (state.busy = false), 3000); // 识别卡住时不让整个页面停住
      hands
        .send({ image: video })
        .then(() => {
          state.detectMs = state.detectMs * 0.8 + (performance.now() - t0) * 0.2;
        })
        .catch((e) => setStatus('识别出错：' + e.message, true))
        .finally(() => {
          clearTimeout(guard);
          state.busy = false;
        });
    }
  }
  requestAnimationFrame(loop);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function openStream(plain) {
  const video0 = plain ? { facingMode: state.facing } : { facingMode: state.facing, width: { ideal: 640 }, height: { ideal: 480 } };
  return navigator.mediaDevices.getUserMedia({ audio: false, video: video0 });
}

async function startCamera(plain) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setStatus('这个浏览器不能打开摄像头。请点右上角「…」，选「在浏览器打开」再试', true);
    return;
  }
  const token = (state.camToken = (state.camToken || 0) + 1);
  try {
    if (video.srcObject) {
      video.srcObject.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
      await wait(300); // 有的手机要等上一个摄像头完全释放
    }
    const stream = await openStream(plain);
    if (token !== state.camToken) return stream.getTracks().forEach((t) => t.stop());
    video.srcObject = stream;
    await video.play();
    state.camLabel = (state.facing === 'user' ? '前置' : '后置') + (plain ? '·默认' : '');
    state.lastVideoTime = -1;
    state.videoStuckSince = performance.now();
    state.plain = !!plain;
    if (!state.running) {
      state.running = true;
      setStatus('正在加载识别模型（首次约 10MB）…');
      requestAnimationFrame(loop);
    }
    $('start').style.display = 'none';
    updateLabels();
  } catch (e) {
    if (!plain) return startCamera(true);
    setStatus('摄像头打不开：' + (e.name || '') + ' ' + (e.message || '') + '。请允许使用摄像头，或换浏览器打开', true);
  }
}

// 摄像头画面 2.5 秒没有变化：换默认参数重开一次，还不行就提示
function checkStuck(now) {
  if (video.currentTime !== state.lastVideoTime) {
    state.lastVideoTime = video.currentTime;
    state.videoStuckSince = now;
    return;
  }
  if (now - state.videoStuckSince < 2500) return;
  state.videoStuckSince = now + 1e9;
  if (!state.plain) startCamera(true);
  else setStatus('摄像头没有画面。请点「切换摄像头」，或点右上角「…」选「在浏览器打开」', true);
}

// ---------- 按钮 ----------
$('start').onclick = async () => {
  setStatus('准备中…');
  await loadBeadImages();
  createHands();
  startCamera(false);
};
$('nextBtn').onclick = () => {
  state.sample = (state.sample + 1) % SAMPLES.length;
  updateLabels();
};
$('camBtn').onclick = () => {
  state.facing = state.facing === 'user' ? 'environment' : 'user';
  state.last = null;
  filter.reset();
  startCamera(false);
};
$('fitBtn').onclick = () => {
  state.fit = state.fit === 'cover' ? 'contain' : 'cover';
  layoutCanvas();
  updateLabels();
};
$('debugBtn').onclick = () => {
  state.debug = !state.debug;
  updateLabels();
};
$('modelBtn').onclick = () => {
  state.model = state.model ? 0 : 1;
  if (hands) hands.setOptions({ modelComplexity: state.model });
  updateLabels();
};
$('wristMinus').onclick = () => {
  state.wristCm = Math.max(13, state.wristCm - 0.5);
  updateLabels();
};
$('wristPlus').onclick = () => {
  state.wristCm = Math.min(19, state.wristCm + 0.5);
  updateLabels();
};
$('shotBtn').onclick = () => {
  const a = document.createElement('a');
  a.download = 'dushe-tryon.png';
  a.href = canvas.toDataURL('image/png');
  a.click();
};
window.addEventListener('resize', layoutCanvas);
updateLabels();
setStatus('点下面的按钮打开摄像头');
// 测试用：自动化验证时直接注入识别结果
window.__tryon = { state, onResults, drawFrame, layoutCanvas, startCamera };
