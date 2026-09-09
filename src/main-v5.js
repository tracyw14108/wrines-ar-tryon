import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import './style.css';

const MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const PRODUCT_BASE = `${import.meta.env.BASE_URL}products/`;
const CATALOG_URL = `${PRODUCT_BASE}products.json`;
const WASM_SOURCES = [
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm',
  'https://unpkg.com/@mediapipe/tasks-vision/wasm',
];

const FALLBACK_PRODUCT = {
  sku: 'DEMO', name: 'W.RINES 試戴樣品', charm: 'DEMO', image: 'demo-earring.svg',
  width_mm: null, height_mm: null, scale_correction: 1,
  product_type: 'stud', pivot_x: 0.5, pivot_y: 0.5, wear_scale: 0.75,
  contact_shadow: 0.14,
};

const video = document.querySelector('#camera');
const canvas = document.querySelector('#overlay');
const ctx = canvas.getContext('2d');
const startBtn = document.querySelector('#startBtn');
const captureBtn = document.querySelector('#captureBtn');
const statusEl = document.querySelector('#status');
const guide = document.querySelector('#guide');
const scaleRange = document.querySelector('#scaleRange');
const offsetYRange = document.querySelector('#offsetYRange');
const sideButtons = [...document.querySelectorAll('[data-side]')];
const productStrip = document.querySelector('#productStrip');
const productNameEl = document.querySelector('#productName');
const sizeStatusEl = document.querySelector('#sizeStatus');
const toastEl = document.querySelector('#toast');

let landmarker = null;
let visionFileset = null;
let stream = null;
let running = false;
let lastVideoTime = -1;
let selectedSide = 'both';
let catalog = [FALLBACK_PRODUCT];
let currentProduct = FALLBACK_PRODUCT;
let earring = new Image();
let toastTimer = null;

const pose = {
  left: null,
  right: null,
  yaw: 0,
  pitch: 0,
  roll: 0,
};

sideButtons.forEach((button) => {
  button.onclick = () => {
    selectedSide = button.dataset.side;
    sideButtons.forEach((item) => item.classList.toggle('active', item === button));
  };
});
startBtn.onclick = async () => running ? stopCamera() : await start();
captureBtn.onclick = captureSnapshot;

function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function normalize2(v) { const d = Math.hypot(v.x, v.y) || 1; return { x: v.x / d, y: v.y / d }; }
function smoothPoint(prev, next, t = 0.62) {
  if (!prev) return { ...next };
  return { x: lerp(prev.x, next.x, t), y: lerp(prev.y, next.y, t) };
}
function averagePoint(...pts) {
  return {
    x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
    y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
    z: pts.reduce((s, p) => s + (p.z || 0), 0) / pts.length,
  };
}
function showToast(text) {
  toastEl.textContent = text;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 2200);
}
function describeError(error) {
  if (!error) return 'Unknown error';
  if (typeof error === 'string') return error;
  return [error.name, error.message].filter(Boolean).join(' | ') || String(error);
}

async function loadCatalog() {
  try {
    const response = await fetch(`${CATALOG_URL}?v=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`CATALOG_${response.status}`);
    const data = await response.json();
    if (Array.isArray(data) && data.length) catalog = data;
  } catch (error) {
    console.warn('Catalog load failed', error);
    catalog = [FALLBACK_PRODUCT];
  }

  const requestedSku = new URLSearchParams(location.search).get('sku');
  const requestedIndex = requestedSku
    ? catalog.findIndex((p) => String(p.sku).toLowerCase() === requestedSku.toLowerCase())
    : -1;
  renderProductStrip();
  await selectProduct(requestedIndex >= 0 ? requestedIndex : 0, false);
}

function productImageUrl(product) { return `${PRODUCT_BASE}${product.image}`; }

function renderProductStrip() {
  productStrip.innerHTML = '';
  catalog.forEach((product, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'product-card';
    button.innerHTML = `
      <img class="product-thumb" src="${productImageUrl(product)}" alt="${product.name || product.sku}" loading="lazy" />
      <span class="product-sku">${product.sku || ''}</span>
      <span class="product-charm">${product.charm || ''}</span>`;
    button.onclick = () => selectProduct(index, true);
    productStrip.appendChild(button);
  });
}

async function selectProduct(index, userInitiated = false) {
  if (!catalog[index]) return;
  currentProduct = { ...FALLBACK_PRODUCT, ...catalog[index] };
  const nextImage = new Image();
  nextImage.src = productImageUrl(currentProduct);
  try {
    await nextImage.decode();
    earring = nextImage;
  } catch (error) {
    console.warn('Image decode failed', error);
    nextImage.onload = () => { earring = nextImage; };
  }

  productNameEl.textContent = `${currentProduct.sku} · ${currentProduct.name || ''}`;
  const hasPhysicalSize = Number(currentProduct.width_mm) > 0 && Number(currentProduct.height_mm) > 0;
  sizeStatusEl.textContent = hasPhysicalSize
    ? `實尺寸 ${currentProduct.width_mm} × ${currentProduct.height_mm} mm｜v5 頭部姿態鎖定`
    : '尺寸資料待核對｜v5 頭部姿態鎖定預覽';
  [...productStrip.children].forEach((card, i) => card.classList.toggle('active', i === index));
  const active = productStrip.children[index];
  if (active) active.scrollIntoView({ behavior: userInitiated ? 'smooth' : 'auto', inline: 'center', block: 'nearest' });
  if (userInitiated) showToast(`已切換 ${currentProduct.sku}`);
}

async function loadVisionFileset() {
  if (visionFileset) return visionFileset;
  let lastError = null;
  for (const source of WASM_SOURCES) {
    try {
      visionFileset = await FilesetResolver.forVisionTasks(source);
      return visionFileset;
    } catch (error) { lastError = error; }
  }
  throw new Error(`MEDIAPIPE_WASM_LOAD_FAILED | ${describeError(lastError)}`);
}

async function createLandmarker(delegate) {
  const vision = await loadVisionFileset();
  return FaceLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: MODEL, delegate },
    runningMode: 'VIDEO',
    numFaces: 1,
    minFaceDetectionConfidence: 0.5,
    minFacePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
}

async function initLandmarker() {
  if (landmarker) return;
  statusEl.textContent = '載入臉部模型';
  try { landmarker = await createLandmarker('GPU'); }
  catch (gpuError) {
    console.warn('GPU failed, using CPU', gpuError);
    landmarker = await createLandmarker('CPU');
  }
}

async function openCamera() {
  if (!window.isSecureContext) throw new Error('INSECURE_CONTEXT');
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('GET_USER_MEDIA_UNAVAILABLE');
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'user' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
  } catch (error) {
    return navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  }
}

async function start() {
  startBtn.disabled = true;
  startBtn.textContent = '啟動中…';
  try {
    stream = await openCamera();
    video.srcObject = stream;
    await video.play();
    running = true;
    captureBtn.disabled = false;
    resize();
    await initLandmarker();
    statusEl.textContent = '尋找臉部';
    startBtn.textContent = '關閉相機';
    requestAnimationFrame(predict);
  } catch (error) {
    console.error(error);
    stopCamera();
    alert(`無法啟動：${describeError(error)}`);
  } finally {
    startBtn.disabled = false;
    if (!running) startBtn.textContent = '開啟相機';
  }
}

function stopCamera() {
  running = false;
  if (stream) stream.getTracks().forEach((track) => track.stop());
  stream = null;
  video.srcObject = null;
  captureBtn.disabled = true;
  pose.left = null;
  pose.right = null;
  pose.yaw = pose.pitch = pose.roll = 0;
  clearOverlay();
  guide.classList.remove('hidden');
  startBtn.textContent = '開啟相機';
  statusEl.textContent = '已關閉';
}

function resize() {
  const rect = video.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.round(rect.width * dpr));
  const h = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
function clearOverlay() {
  const rect = canvas.getBoundingClientRect();
  ctx.clearRect(0, 0, rect.width, rect.height);
}
function cover(videoW, videoH, viewW, viewH) {
  const scale = Math.max(viewW / videoW, viewH / videoH);
  return { scale, offsetX: (viewW - videoW * scale) / 2, offsetY: (viewH - videoH * scale) / 2 };
}
function point(lm, transform) {
  return {
    x: transform.offsetX + lm.x * video.videoWidth * transform.scale,
    y: transform.offsetY + lm.y * video.videoHeight * transform.scale,
    z: lm.z || 0,
  };
}

function physicalScale(landmarks, transform) {
  let leftPupil, rightPupil;
  if (landmarks[468] && landmarks[473]) {
    leftPupil = point(landmarks[468], transform);
    rightPupil = point(landmarks[473], transform);
  } else {
    leftPupil = averagePoint(point(landmarks[33], transform), point(landmarks[133], transform));
    rightPupil = averagePoint(point(landmarks[362], transform), point(landmarks[263], transform));
  }
  const ipdPx = distance(leftPupil, rightPupil);
  return ipdPx > 1 ? ipdPx / 63 : 1;
}

function estimateHeadPose(landmarks, transform) {
  const leftSide = point(landmarks[234], transform);
  const rightSide = point(landmarks[454], transform);
  const leftJaw = point(landmarks[132], transform);
  const rightJaw = point(landmarks[361], transform);
  const forehead = point(landmarks[10], transform);
  const chin = point(landmarks[152], transform);
  const nose = point(landmarks[1], transform);
  const noseBridge = point(landmarks[6], transform);
  const leftEye = averagePoint(point(landmarks[33], transform), point(landmarks[133], transform));
  const rightEye = averagePoint(point(landmarks[362], transform), point(landmarks[263], transform));
  const eyeMid = averagePoint(leftEye, rightEye);

  const faceWidth = distance(leftSide, rightSide);
  const faceHeight = distance(forehead, chin);
  const across = normalize2({ x: rightSide.x - leftSide.x, y: rightSide.y - leftSide.y });
  const down = normalize2({ x: chin.x - forehead.x, y: chin.y - forehead.y });

  const dLeft = distance(nose, leftSide);
  const dRight = distance(nose, rightSide);
  const yawRaw = clamp((dLeft - dRight) / Math.max(dLeft + dRight, 1), -0.48, 0.48);

  const expectedNoseY = eyeMid.y + (chin.y - eyeMid.y) * 0.34;
  const pitchRaw = clamp((nose.y - expectedNoseY) / Math.max(faceHeight, 1), -0.22, 0.22);
  const rollRaw = Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x);

  pose.yaw = lerp(pose.yaw, yawRaw, 0.58);
  pose.pitch = lerp(pose.pitch, pitchRaw, 0.5);
  pose.roll = lerp(pose.roll, rollRaw, 0.62);

  const leftBase = { x: leftSide.x * 0.56 + leftJaw.x * 0.44, y: leftSide.y * 0.56 + leftJaw.y * 0.44 };
  const rightBase = { x: rightSide.x * 0.56 + rightJaw.x * 0.44, y: rightSide.y * 0.56 + rightJaw.y * 0.44 };

  const outward = faceWidth * 0.018;
  const drop = faceHeight * 0.002;
  const yawShift = faceWidth * pose.yaw * 0.13;

  const leftRaw = {
    x: leftBase.x - across.x * outward + down.x * drop + yawShift,
    y: leftBase.y - across.y * outward + down.y * drop,
  };
  const rightRaw = {
    x: rightBase.x + across.x * outward + down.x * drop + yawShift,
    y: rightBase.y + across.y * outward + down.y * drop,
  };

  pose.left = smoothPoint(pose.left, leftRaw, 0.68);
  pose.right = smoothPoint(pose.right, rightRaw, 0.68);

  return {
    leftAnchor: pose.left,
    rightAnchor: pose.right,
    faceHeight,
    yaw: pose.yaw,
    pitch: pose.pitch,
    roll: pose.roll,
    noseBridge,
  };
}

function drawContactShadow(anchor, width, height, roll, alpha) {
  const strength = Number(currentProduct.contact_shadow ?? 0.14);
  if (strength <= 0) return;
  ctx.save();
  ctx.translate(anchor.x, anchor.y);
  ctx.rotate(roll);
  ctx.globalAlpha = strength * alpha;
  ctx.filter = `blur(${Math.max(1.2, Math.min(3, width * 0.07))}px)`;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(1.2, 1.8, Math.max(3.5, width * 0.28), Math.max(2, height * 0.09), 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawRigidEarring(anchor, width, height, roll, yaw, pitch, mirror, alpha = 1) {
  if (!earring.complete || !earring.naturalWidth) return;

  const pivotX = clamp(Number(currentProduct.pivot_x ?? 0.5), 0, 1);
  const pivotY = clamp(Number(currentProduct.pivot_y ?? 0.5), 0, 1);

  // 把臉部 yaw 轉成耳環平面的 3D-like 旋轉：
  // 正面時接近原比例，左右轉頭時水平收窄並產生剪切，形成「跟頭一起轉」而非固定貼圖。
  const yawAngle = clamp(yaw * 2.25, -1.0, 1.0); // 約 ±57°
  const pitchAngle = clamp(pitch * 2.2, -0.46, 0.46);
  const xForeshorten = clamp(Math.cos(yawAngle), 0.42, 1);
  const yForeshorten = clamp(Math.cos(pitchAngle), 0.78, 1.04);
  const perspectiveShearX = Math.sin(yawAngle) * 0.24;
  const perspectiveShearY = Math.sin(pitchAngle) * 0.08;

  drawContactShadow(anchor, width * xForeshorten, height * yForeshorten, roll, alpha);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(anchor.x, anchor.y);
  ctx.rotate(roll);

  if (mirror) ctx.scale(-1, 1);

  // affine 近似商品平面繞垂直軸/水平軸旋轉。
  ctx.transform(
    xForeshorten,
    perspectiveShearY,
    perspectiveShearX,
    yForeshorten,
    0,
    0,
  );

  ctx.drawImage(
    earring,
    -width * pivotX,
    -height * pivotY,
    width,
    height,
  );
  ctx.restore();
}

function render(landmarks) {
  const rect = video.getBoundingClientRect();
  const transform = cover(video.videoWidth, video.videoHeight, rect.width, rect.height);
  const { leftAnchor, rightAnchor, faceHeight, yaw, pitch, roll } = estimateHeadPose(landmarks, transform);
  const pxPerMm = physicalScale(landmarks, transform);
  const userScale = Number(scaleRange.value);
  const manualY = Number(offsetYRange.value) * faceHeight;
  const correction = Number(currentProduct.scale_correction || 1);
  const wearScale = Number(currentProduct.wear_scale || 1);
  const hasPhysical = Number(currentProduct.width_mm) > 0 && Number(currentProduct.height_mm) > 0;
  const type = currentProduct.product_type || 'stud';

  let baseWidth, baseHeight;
  if (hasPhysical) {
    baseWidth = Number(currentProduct.width_mm) * pxPerMm * correction * userScale * wearScale;
    baseHeight = Number(currentProduct.height_mm) * pxPerMm * correction * userScale * wearScale;
  } else {
    const aspect = earring.naturalWidth && earring.naturalHeight ? earring.naturalWidth / earring.naturalHeight : 0.55;
    baseHeight = faceHeight * (type === 'drop' ? 0.25 : 0.105) * userScale * wearScale;
    baseWidth = baseHeight * aspect;
  }

  // 耳環跟著同一個頭部姿態走，沒有自由漂移/延遲擺動。
  // 靠近鏡頭那側略大，遠側略小；角度則由同一 yaw/pitch/roll 驅動。
  const leftDepth = clamp(1 - yaw * 0.34, 0.82, 1.16);
  const rightDepth = clamp(1 + yaw * 0.34, 0.82, 1.16);
  const leftAlpha = clamp(1 - Math.max(0, yaw) * 0.16, 0.82, 1);
  const rightAlpha = clamp(1 + Math.min(0, yaw) * 0.16, 0.82, 1);

  const L = { x: leftAnchor.x, y: leftAnchor.y + manualY };
  const R = { x: rightAnchor.x, y: rightAnchor.y + manualY };

  if (selectedSide === 'left' || selectedSide === 'both') {
    drawRigidEarring(L, baseWidth * leftDepth, baseHeight * leftDepth, roll, yaw, pitch, true, leftAlpha);
  }
  if (selectedSide === 'right' || selectedSide === 'both') {
    drawRigidEarring(R, baseWidth * rightDepth, baseHeight * rightDepth, roll, yaw, pitch, false, rightAlpha);
  }
}

async function captureSnapshot() {
  if (!running || video.readyState < 2) { showToast('請先開啟相機'); return; }
  const rect = video.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const shot = document.createElement('canvas');
  shot.width = Math.round(rect.width * dpr);
  shot.height = Math.round(rect.height * dpr);
  const sctx = shot.getContext('2d');
  sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const transform = cover(video.videoWidth, video.videoHeight, rect.width, rect.height);
  sctx.save();
  sctx.translate(rect.width, 0);
  sctx.scale(-1, 1);
  sctx.drawImage(video, transform.offsetX, transform.offsetY, video.videoWidth * transform.scale, video.videoHeight * transform.scale);
  sctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, rect.width, rect.height);
  sctx.restore();
  sctx.fillStyle = 'rgba(0,0,0,.42)';
  sctx.fillRect(0, 0, rect.width, 62);
  sctx.fillStyle = '#f5f0e7';
  sctx.font = '600 15px -apple-system, BlinkMacSystemFont, sans-serif';
  sctx.fillText('W.RINES', 18, 27);
  sctx.font = '11px -apple-system, BlinkMacSystemFont, sans-serif';
  sctx.fillText(`${currentProduct.sku} · ${currentProduct.name || ''}`, 18, 47);

  const blob = await new Promise((resolve) => shot.toBlob(resolve, 'image/png', 0.96));
  if (!blob) return;
  const filename = `WRINES_AR_${currentProduct.sku}_${Date.now()}.png`;
  const file = new File([blob], filename, { type: 'image/png' });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'W.RINES AR Try-On' });
      return;
    }
  } catch (error) {
    if (error?.name === 'AbortError') return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function predict() {
  if (!running) return;
  resize();
  clearOverlay();
  if (landmarker && video.readyState >= 2 && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    try {
      const result = landmarker.detectForVideo(video, performance.now());
      if (result.faceLandmarks?.length) {
        guide.classList.add('hidden');
        statusEl.textContent = '已鎖定耳朵';
        render(result.faceLandmarks[0]);
      } else {
        guide.classList.remove('hidden');
        statusEl.textContent = '尋找臉部';
      }
    } catch (error) {
      console.error(error);
      statusEl.textContent = '臉部辨識錯誤';
    }
  }
  requestAnimationFrame(predict);
}

loadCatalog();
window.addEventListener('resize', resize);
window.addEventListener('pagehide', stopCamera);
