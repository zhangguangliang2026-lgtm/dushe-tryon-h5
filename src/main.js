/**
 * 独奢 · 手链 AR 试戴测试页（网页版）
 * 手部识别：MediaPipe（谷歌开源，Apache 2.0），方案 A 旧版 Hands / 方案 B 新版 Tasks（CPU），都在手机本地运行
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
  backIndex: 0,
  backCams: [],
  frontCams: [],
  modelReady: false,
  switching: false,
  src: 'video',
  delegate: 'CPU',
  errText: '',
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
  $('modelBtn').textContent = '识别方案 ' + (state.engineName || '-');
  $('debugBtn').textContent = state.debug ? '关调试' : '调试点';
  $('fitBtn').textContent = state.fit === 'cover' ? '画面：铺满' : '画面：完整';
  $('camBtn').textContent = state.facing === 'user' ? '换后置' : '换前置';
  const n = (state.backCams || []).length;
  $('lensBtn').textContent = n > 1 && state.facing !== 'user' ? '镜头 ' + (state.backIndex + 1) + '/' + n : '换镜头';
}

// ---------- 识别 ----------
// 大文件从国内的 npm 镜像（阿里云 npmmirror）下载；GitHub 在国内手机上很慢，下到一半会断。
const NPM = 'https://registry.npmmirror.com/';
const LEGACY_BASES = [NPM + '@mediapipe/hands/0.4.1675469240/files/', './mediapipe/'];
const TASKS_BASES = [NPM + '@mediapipe/tasks-vision/1.2.2/files/', './tasks/'];
// 手部模型：npmmirror 不直接提供这个包里的单个文件，但提供整个包的压缩包（国内 CDN），下载后在手机上解压取出模型
const MODEL_TGZ = NPM + '@beautinique/frontend-tryon-assets/-/frontend-tryon-assets-1.0.2.tgz';
const MODEL_URLS = [
  MODEL_TGZ,
  './models/hand_landmarker.task',
  'https://cdn.jsdelivr.net/gh/zhangguangliang2026-lgtm/dushe-tryon-h5@main/models/hand_landmarker.task',
  'https://testingcf.jsdelivr.net/gh/zhangguangliang2026-lgtm/dushe-tryon-h5@main/models/hand_landmarker.task',
];

function withTimeout(p, ms, what) {
  return Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error(what + '超过 ' + Math.round(ms / 1000) + ' 秒没有完成')), ms)),
  ]);
}

function loadScript(url) {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = url;
    el.crossOrigin = 'anonymous';
    el.onload = resolve;
    el.onerror = () => reject(new Error('脚本加载失败 ' + url));
    document.head.appendChild(el);
  });
}

// 方案 A：MediaPipe Hands（旧版，文件约 12MB，全部走国内镜像）
function legacyEngine(base) {
  let hands = null;
  let pending = null;
  return {
    name: 'A',
    async load() {
      if (!window.Hands) await withTimeout(loadScript(base + 'hands.js'), 20000, '方案A脚本');
      hands = new window.Hands({ locateFile: (f) => base + f });
      hands.setOptions({ maxNumHands: 1, modelComplexity: 0, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
      hands.onResults((r) => {
        if (pending) pending(r);
      });
      await withTimeout(hands.initialize(), 60000, '方案A模型加载');
    },
    detect(input) {
      return new Promise((resolve, reject) => {
        pending = (r) => {
          pending = null;
          resolve(r);
        };
        hands.send({ image: input }).then(() => {
          // send 结束时一般已经回调过；没回调说明这帧没有结果
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
      } catch (e) {}
    },
  };
}

// 方案 B：MediaPipe Tasks（新版），CPU 计算，不经过显卡
async function fetchModel() {
  // 三个来源同时下，谁先下完用谁
  const ctrls = MODEL_URLS.map(() => new AbortController());
  const got = MODEL_URLS.map(() => 0);
  const timer = setInterval(() => {
    setStatus('正在下载手部模型 ' + (Math.max.apply(null, got) / 1048576).toFixed(1) + 'MB…（只有第一次需要）');
  }, 300);
  try {
    return await Promise.any(
      MODEL_URLS.map(async (u, i) => {
        const res = await fetch(u, { signal: ctrls[i].signal });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const reader = res.body.getReader();
        const parts = [];
        for (;;) {
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
        log('手部模型来自 ' + ['国内镜像', 'GitHub', 'jsDelivr', 'jsDelivr-CF'][i] + ' ' + ((performance.now() - T0) / 1000).toFixed(1) + 's');
        return buf;
      })
    );
  } catch (e) {
    throw new Error('手部模型三个来源都下载失败');
  } finally {
    clearInterval(timer);
  }
}

// 解压 .tgz，取出 package/models/hand_landmarker.task
async function untarModel(gz) {
  const tar = new Uint8Array(await new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  const dec = new TextDecoder();
  let off = 0;
  while (off + 512 <= tar.length) {
    const name = dec.decode(tar.subarray(off, off + 100)).split('\0')[0];
    if (!name) break;
    const size = parseInt(dec.decode(tar.subarray(off + 124, off + 136)).split('\0')[0].trim(), 8) || 0;
    if (name === 'package/models/hand_landmarker.task') {
      const out = tar.slice(off + 512, off + 512 + size);
      if (out.length !== 7819105) throw new Error('模型大小不对 ' + out.length);
      return out;
    }
    off += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error('压缩包里没有手部模型');
}

function tasksEngine(delegate) {
  let lm = null;
  let lastTs = 0;
  return {
    name: 'B',
    async load() {
      let vision = null;
      let base = null;
      for (const b of TASKS_BASES) {
        try {
          vision = await withTimeout(window.__loadVision(b + 'vision_bundle.mjs'), 20000, '方案B脚本');
          base = b;
          break;
        } catch (e) {
          log('方案B脚本 ' + b + ' 失败 ' + e.message);
        }
      }
      if (!vision) throw new Error('方案B脚本加载失败');
      const fileset = await withTimeout(vision.FilesetResolver.forVisionTasks(base + 'wasm'), 60000, '方案B运行库');
      const model = await fetchModel();
      lm = await withTimeout(
        vision.HandLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetBuffer: model, delegate },
          runningMode: 'VIDEO',
          numHands: 1,
        }),
        60000,
        '方案B模型启动'
      );
    },
    detect(input) {
      const ts = Math.max(performance.now(), lastTs + 1);
      lastTs = ts;
      const r = lm.detectForVideo(input, ts);
      return Promise.resolve({
        multiHandLandmarks: r.landmarks || [],
        multiHandWorldLandmarks: r.worldLandmarks || [],
        multiHandedness: (r.handedness || []).map((h) => ({ label: h[0] && h[0].categoryName, score: h[0] && h[0].score })),
      });
    },
    close() {
      try {
        if (lm) lm.close();
      } catch (e) {}
    },
  };
}

let engine = null;
// 依次尝试：A 镜像 → B → A 本站。每个方案都要在真实画面上识别成功才算数
async function loadEngine(order) {
  state.modelReady = false;
  for (const make of order) {
    const eng = make();
    const t0 = performance.now();
    log('加载方案' + eng.name + '…');
    setStatus('正在加载识别方案 ' + eng.name + '（第一次需要下载，约十几 MB）…');
    try {
      await eng.load();
      log('方案' + eng.name + ' 加载完成 ' + ((performance.now() - t0) / 1000).toFixed(1) + 's');
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
      log('方案' + eng.name + ' 失败：' + e.message);
      eng.close();
    }
  }
  return false;
}
// 两个方案的运行库放在同一个页面里会冲突，所以换方案时重新打开页面（带上参数自动开始）
const params = new URLSearchParams(location.search);
const WANT = params.get('engine') === 'A' ? 'A' : 'B';
const ORDER_ALL =
  WANT === 'A'
    ? [() => legacyEngine(LEGACY_BASES[0]), () => legacyEngine(LEGACY_BASES[1])]
    : [() => tasksEngine('CPU')];
function reloadWith(engineName, reason) {
  const tried = (params.get('tried') || '').split(',').filter(Boolean);
  if (tried.indexOf(engineName) >= 0) return false;
  tried.push(WANT);
  log('换方案' + engineName + '：' + reason);
  const q = new URLSearchParams({ engine: engineName, auto: '1', tried: tried.join(','), why: '方案' + WANT + ' ' + reason, v: '8' });
  setTimeout(() => location.replace(location.pathname + '?' + q.toString()), 800);
  return true;
}

// 识别出错或卡住：换另一个方案
async function engineFailed(msg) {
  log('方案' + state.engineName + ' 识别' + msg);
  state.engineFails = (state.engineFails || 0) + 1;
  if (state.engineFails < 2 && !/秒/.test(msg)) return;
  state.modelReady = false;
  if (!reloadWith(state.engineName === 'A' ? 'B' : 'A', msg)) {
    state.errText = '方案' + state.engineName + ' ' + msg;
    $('log').style.display = 'block';
  }
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
  if (!state.firstResult) {
    state.firstResult = true;
    log('第一次识别完成');
  }
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
      '方案' + (state.engineName || '-') + ' · ' + Math.round(state.frames / sec) + ' 帧/秒 · 识别 ' + Math.round(state.detects / sec) + ' 次/秒 · 认出 ' + Math.round(state.hits / sec) + ' · ' + Math.round(state.detectMs) + 'ms';
    if (state.debug) {
      $('fps').textContent += ' · ' + video.videoWidth + '×' + video.videoHeight + ' · ' + state.camLabel;
      if (state.roll != null) $('fps').textContent += ' · 转 ' + Math.round((state.roll * 180) / Math.PI) + '°';
    }
    if (state.errText) setStatus('识别没跑起来：' + state.errText + '。请截图发给开发', true);
    else setStatus(state.hits ? '' : '张开手掌对准镜头，认出后可以随意转动手腕');
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
        engineFailed('超过 6 秒没返回');
      }, 6000);
      Promise.resolve()
        .then(() => eng.detect(video))
        .then((r) => {
          if (eng !== engine) return;
          onResults(r);
          state.detectMs = state.detectMs * 0.8 + (performance.now() - t0) * 0.2;
        })
        .catch((e) => eng === engine && engineFailed('出错 ' + ((e && e.message) || e)))
        .finally(() => {
          done = true;
          clearTimeout(guard);
          if (eng === engine) state.busy = false;
        });
    }
  }
  else if (performance.now() - state.since > 1000) {
    $('fps').textContent = '等待画面 · 状态 ' + video.readyState;
    state.since = performance.now();
  }
  requestAnimationFrame(loop);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// 屏幕上的诊断记录：调试点打开时显示，出错时自动显示
const logs = [];
function log(msg) {
  const t = ((performance.now() - T0) / 1000).toFixed(1);
  logs.push(t + 's ' + msg);
  if (logs.length > 20) logs.shift();
  const el = $('log');
  if (el) el.textContent = logs.join('\n');
}
const T0 = performance.now();

function stopStream() {
  const old = video.srcObject;
  if (!old) return false;
  old.getTracks().forEach((t) => t.stop());
  video.srcObject = null;
  return true;
}

// 摄像头名字里的编号，比如 “camera 0, facing back” → 0。安卓上 0 号一般是后置主摄，编号大的常是长焦、微距
function camNo(d) {
  const m = /camera\s*(\d+)/i.exec(d.label || '');
  return m ? +m[1] : 99;
}
const isFront = (d) => /front|user|前/i.test(d.label || '');

async function refreshCams() {
  try {
    const all = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput' && d.deviceId);
    if (!all.some((d) => d.label)) return; // 还没授权，拿不到名字
    state.backCams = all.filter((d) => !isFront(d)).sort((x, y) => camNo(x) - camNo(y));
    state.frontCams = all.filter(isFront).sort((x, y) => camNo(x) - camNo(y));
  } catch (e) {
    log('列摄像头失败 ' + e.name);
  }
}

function pickCam() {
  const list = state.facing === 'user' ? state.frontCams : state.backCams;
  if (!list || !list.length) return null;
  const i = state.facing === 'user' ? 0 : Math.min(state.backIndex, list.length - 1);
  return list[i];
}

async function waitIdle() {
  state.switching = true;
  for (let i = 0; i < 50 && state.busy; i++) await wait(100); // 等手上这次识别做完再关摄像头
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
    setStatus('这个浏览器不能打开摄像头。请点右上角「…」，选「在浏览器打开」再试', true);
    return;
  }
  const token = (state.camToken = (state.camToken || 0) + 1);
  setButtons(false);
  await waitIdle();
  if (stopStream()) await wait(1000); // 华为实测：关掉上一个摄像头后等 1 秒再开，11 次切换都正常
  await refreshCams();
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (token !== state.camToken) return;
    const cam = pickCam();
    const constraints = cam ? { deviceId: { exact: cam.deviceId } } : { facingMode: state.facing };
    try {
      log('打开 ' + (cam ? cam.label : state.facing === 'user' ? '前置(默认)' : '后置(默认)') + (attempt ? ' 重试' + attempt : ''));
      const stream = await openOnce(constraints, token);
      if (!stream) return;
      const track = stream.getVideoTracks()[0];
      const set = track.getSettings ? track.getSettings() : {};
      log('成功 ' + track.label + ' ' + (set.width || '?') + '×' + (set.height || '?'));
      track.onended = () => log('摄像头被关闭');
      track.onmute = () => log('摄像头暂停出画面');
      track.onunmute = () => log('摄像头恢复');
      video.srcObject = stream;
      try {
        await video.play();
      } catch (e) {
        log('播放失败 ' + e.name);
      }
      state.camLabel = track.label || (state.facing === 'user' ? '前置' : '后置');
      // 第一次授权前拿不到摄像头名字：授权后再看一遍，如果开的不是后置主摄，换过去
      if (!cam && state.facing !== 'user') {
        await refreshCams();
        const best = pickCam();
        if (best && best.label !== track.label) {
          log('换成主摄 ' + best.label);
          state.switching = false;
          setButtons(true);
          return startCamera();
        }
      }
      state.switching = false;
      setButtons(true);
      $('start').style.display = 'none';
      if (!state.engineStart) state.engineStart = performance.now();
      setStatus(state.modelReady ? '' : '正在加载识别模型…');
      if (!state.running) {
        state.running = true;
        requestAnimationFrame(loop);
      }
      updateLabels();
      return;
    } catch (e) {
      lastErr = e;
      log('失败 ' + (e.name || '') + ' ' + (e.message || ''));
      await wait(1000);
    }
  }
  state.switching = false;
  setButtons(true);
  $('log').style.display = 'block';
  setStatus('摄像头打不开：' + (lastErr && lastErr.name) + '。可以再点一次切换，或点右上角「…」选「在浏览器打开」', true);
}

function setButtons(on) {
  ['camBtn', 'lensBtn', 'modelBtn'].forEach((id) => ($(id).disabled = !on));
}

// ---------- 按钮 ----------
$('start').onclick = async () => {
  $('start').disabled = true;
  $('log').style.display = 'block';
  setStatus('正在加载识别模型（首次约 8MB，网络慢时要等一会）…');
  await loadBeadImages();
  if (!(await loadEngine(ORDER_ALL))) {
    if (reloadWith(WANT === 'A' ? 'B' : 'A', '加载失败')) return;
    setStatus('识别方案都加载失败，请截图发给开发，然后刷新再试', true);
    $('start').disabled = false;
    return;
  }
  setStatus('正在打开摄像头…');
  await startCamera();
  // 第一次识别成功后才收起记录，没成功就一直显示，方便截图
  const hide = setInterval(() => {
    if (state.firstResult && !state.errText) {
      clearInterval(hide);
      setTimeout(() => {
        if (!state.debug) $('log').style.display = 'none';
      }, 3000);
    }
  }, 500);
};
$('lensBtn').onclick = () => {
  // 只在后置的几个镜头之间切换，挑一个能拍到整个手腕的
  if (state.facing === 'user') state.facing = 'environment';
  else state.backIndex = (state.backIndex + 1) % Math.max(1, (state.backCams || []).length);
  state.last = null;
  filter.reset();
  startCamera();
};
$('nextBtn').onclick = () => {
  state.sample = (state.sample + 1) % SAMPLES.length;
  updateLabels();
};
$('camBtn').onclick = () => {
  state.facing = state.facing === 'user' ? 'environment' : 'user';
  state.last = null;
  filter.reset();
  startCamera();
};
$('fitBtn').onclick = () => {
  state.fit = state.fit === 'cover' ? 'contain' : 'cover';
  layoutCanvas();
  updateLabels();
};
$('debugBtn').onclick = () => {
  state.debug = !state.debug;
  $('log').style.display = state.debug ? 'block' : 'none';
  updateLabels();
};
$('modelBtn').onclick = () => {
  const q = new URLSearchParams({ engine: state.engineName === 'A' ? 'B' : 'A', auto: '1', v: '8' });
  location.replace(location.pathname + '?' + q.toString());
};
$('wristMinus').onclick = () => {
  state.wristCm = Math.max(13, state.wristCm - 0.5);
  updateLabels();
};
$('wristPlus').onclick = () => {
  state.wristCm = Math.min(19, state.wristCm + 0.5);
  updateLabels();
};
// 微信里不能直接下载，改为弹出图片，长按保存
$('shotBtn').onclick = () => {
  $('shotImg').src = canvas.toDataURL('image/jpeg', 0.92);
  $('shotBox').style.display = 'flex';
};
$('shotBox').onclick = () => ($('shotBox').style.display = 'none');
window.addEventListener('resize', layoutCanvas);
setButtons(false); // 识别准备好之前不能开摄像头
updateLabels();
setStatus('点下面的按钮打开摄像头');
// 测试用：自动化验证时直接注入识别结果
window.__tryon = { state, onResults, drawFrame, layoutCanvas, startCamera };
if (params.get('why')) log('上一次：' + params.get('why') + '，已自动换方案');
if (params.get('auto') === '1') setTimeout(() => $('start').click(), 300);
