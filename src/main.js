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
  sku: 'DEMO',
  name: 'W.RINES 試戴樣品',
  charm: 'DEMO',
  image: 'demo-earring.svg',
  width_mm: null,
  height_mm: null,
  dimension_status: 'NEEDS_PHYSICAL_SIZE',
  scale_correction: 1,
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
let currentProductIndex = 0;
let earring = new Image();
let toastTimer = null;

sideButtons.forEach((button) => {
  button.onclick = () => {
    selectedSide = button.dataset.side;
    sideButtons.forEach((item) => item.classList.toggle('active', item === button));
  };
});

startBtn.onclick = async () => running ? stopCamera() : await start();
captureBtn.onclick = captureSnapshot;

function describeError(error) {
  if (!error) return 'Unknown error';
  if (typeof error === 'string') return error;
  if (error instanceof Event) {
    const target = error.target;
    return `Event:${error.type}${target?.src ? ` | ${target.src}` : ''}`;
  }
  return [error.name, error.message].filter(Boolean).join(' | ') || String(error);
}

function showToast(text) {
  toastEl.textContent = text;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 2200);
}

async function loadCatalog() {
  try {
    const response = await fetch(`${CATALOG_URL}?v=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`CATALOG_${response.status}`);
    const data = await response.json();
    if (Array.isArray(data) && data.length) catalog = data;
  } catch (error) {
    console.warn('Catalog load failed, using fallback product.', error);
    catalog = [FALLBACK_PRODUCT];
  }

  const requestedSku = new URLSearchParams(location.search).get('sku');
  const requestedIndex = requestedSku
    ? catalog.findIndex((item) => String(item.sku).toLowerCase() === requestedSku.toLowerCase())
    : -1;

  renderProductStrip();
  await selectProduct(requestedIndex >= 0 ? requestedIndex : 0, false);
}

function productImageUrl(product) {
  return `${PRODUCT_BASE}${product.image}`;
}

function renderProductStrip() {
  productStrip.innerHTML = '';
  catalog.forEach((product, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'product-card';
    button.dataset.index = index;
    button.innerHTML = `
      <img class="product-thumb" src="${productImageUrl(product)}" alt="${product.name || product.sku}" loading="lazy" />
      <span class="product-sku">${product.sku || ''}</span>
      <span class="product-charm">${product.charm || ''}</span>
    `;
    button.onclick = () => selectProduct(index, true);
    productStrip.appendChild(button);
  });
}

async function selectProduct(index, userInitiated = false) {
  if (!catalog[index]) return;
  currentProductIndex = index;
  currentProduct = catalog[index];

  const nextImage = new Image();
  nextImage.src = productImageUrl(currentProduct);
  try {
    await nextImage.decode();
    earring = nextImage;
  } catch (error) {
    console.warn('Product image decode failed', currentProduct.sku, error);
    nextImage.onload = () => { earring = nextImage; };
  }

  productNameEl.textContent = `${currentProduct.sku} · ${currentProduct.name || ''}`;
  const hasPhysicalSize = Number(currentProduct.width_mm) > 0 && Number(currentProduct.height_mm) > 0;
  sizeStatusEl.textContent = hasPhysicalSize
    ? `實尺寸 ${currentProduct.width_mm} × ${currentProduct.height_mm} mm`
    : '尺寸資料待核對｜目前為比例預覽';

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
      statusEl.textContent = '載入辨識引擎';
      visionFileset = await FilesetResolver.forVisionTasks(source);
      return visionFileset;
    } catch (error) {
      lastError = error;
      console.warn(`MediaPipe WASM source failed: ${source}`, error);
    }
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
  try {
    landmarker = await createLandmarker('GPU');
  } catch (gpuError) {
    console.warn('GPU delegate failed, falling back to CPU', gpuError);
    statusEl.textContent = '切換相容模式';
    landmarker = await createLandmarker('CPU');
  }
}

async function openCamera() {
  if (!window.isSecureContext) throw new Error('INSECURE_CONTEXT');
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('GET_USER_MEDIA_UNAVAILABLE');
  statusEl.textContent = '要求相機權限';
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'user' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
  } catch (firstError) {
    console.warn('Preferred front camera constraints failed, retrying basic video', firstError);
    return navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  }
}

function cameraErrorMessage(error) {
  const name = error?.name || '';
  const message = error?.message || '';
  if (message === 'INSECURE_CONTEXT') return '目前不是安全連線，請使用 HTTPS 網址開啟。';
  if (message === 'GET_USER_MEDIA_UNAVAILABLE') return '目前瀏覽器沒有提供相機功能。請直接用 Safari App 開啟此頁。';
  if (name === 'NotAllowedError' || name === 'SecurityError') return '相機權限被拒絕。請到 iPhone「設定 → Safari → 相機」，改成允許或詢問，再重新整理此頁。';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return '找不到可用的相機。請確認相機沒有被系統限制。';
  if (name === 'NotReadableError' || name === 'TrackStartError') return '相機目前無法被讀取，可能正被其他 App 使用。請關閉其他使用相機的 App 後再試。';
  if (name === 'OverconstrainedError') return '目前裝置不支援指定的相機模式，請重新整理後再試。';
  return `相機錯誤：${describeError(error)}`;
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
    startBtn.textContent = '關閉相機';
    statusEl.textContent = '相機已開啟';
    try {
      await initLandmarker();
      statusEl.textContent = '尋找臉部';
    } catch (modelError) {
      console.error('Face Landmarker init failed', modelError);
      statusEl.textContent = '臉部模型載入失敗';
      alert(`相機已成功開啟，但臉部辨識模型載入失敗。\n${describeError(modelError)}`);
    }
    requestAnimationFrame(predict);
  } catch (error) {
    console.error('Camera startup failed', error);
    stopCamera();
    statusEl.textContent = '無法開啟相機';
    alert(cameraErrorMessage(error));
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
  clearOverlay();
  guide.classList.remove('hidden');
  startBtn.textContent = '開啟相機';
  if (statusEl.textContent !== '無法開啟相機') statusEl.textContent = '已關閉';
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

function point(landmark, transform) {
  return {
    x: transform.offsetX + landmark.x * video.videoWidth * transform.scale,
    y: transform.offsetY + landmark.y * video.videoHeight * transform.scale,
    z: landmark.z || 0,
  };
}

function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function averagePoint(...pts) { return { x: pts.reduce((s,p)=>s+p.x,0)/pts.length, y: pts.reduce((s,p)=>s+p.y,0)/pts.length, z: pts.reduce((s,p)=>s+(p.z||0),0)/pts.length }; }
function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }
function normalize2(v) { const d = Math.hypot(v.x, v.y) || 1; return { x: v.x/d, y: v.y/d }; }

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

function buildEarAnchors(landmarks, transform) {
  const leftSide = point(landmarks[234], transform);
  const rightSide = point(landmarks[454], transform);
  const leftJaw = point(landmarks[132], transform);
  const rightJaw = point(landmarks[361], transform);
  const forehead = point(landmarks[10], transform);
  const chin = point(landmarks[152], transform);
  const nose = point(landmarks[1], transform);

  const faceWidth = distance(leftSide, rightSide);
  const faceHeight = distance(forehead, chin);
  const across = normalize2({ x: rightSide.x-leftSide.x, y:rightSide.y-leftSide.y });
  const down = normalize2({ x: chin.x-forehead.x, y:chin.y-forehead.y });

  const leftBase = averagePoint(leftSide, leftJaw, { x:leftSide.x, y:leftJaw.y, z:0 });
  const rightBase = averagePoint(rightSide, rightJaw, { x:rightSide.x, y:rightJaw.y, z:0 });

  const dLeft = distance(nose, leftSide);
  const dRight = distance(nose, rightSide);
  const yaw = clamp((dLeft-dRight) / Math.max(dLeft+dRight,1), -0.38, 0.38);
  const outward = faceWidth * 0.055;
  const drop = faceHeight * 0.018;

  return {
    leftAnchor: { x:leftBase.x - across.x*outward*(1-yaw*.9) + down.x*drop, y:leftBase.y - across.y*outward*(1-yaw*.9) + down.y*drop },
    rightAnchor:{ x:rightBase.x + across.x*outward*(1+yaw*.9) + down.x*drop, y:rightBase.y + across.y*outward*(1+yaw*.9) + down.y*drop },
    faceHeight,
    yaw,
    roll: Math.atan2(rightSide.y-leftSide.y, rightSide.x-leftSide.x),
  };
}

function drawEarring(anchor, width, height, rotation, mirror, alpha=1) {
  if (!earring.complete || !earring.naturalWidth) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(anchor.x, anchor.y);
  ctx.rotate(rotation);
  if (mirror) ctx.scale(-1,1);
  ctx.drawImage(earring, -width/2, 0, width, height);
  ctx.restore();
}

function render(landmarks) {
  const rect = video.getBoundingClientRect();
  const transform = cover(video.videoWidth, video.videoHeight, rect.width, rect.height);
  const { leftAnchor, rightAnchor, faceHeight, yaw, roll } = buildEarAnchors(landmarks, transform);
  const pxPerMm = physicalScale(landmarks, transform);
  const userScale = Number(scaleRange.value);
  const manualY = Number(offsetYRange.value) * faceHeight;
  const correction = Number(currentProduct.scale_correction || 1);
  const hasPhysical = Number(currentProduct.width_mm) > 0 && Number(currentProduct.height_mm) > 0;

  let baseWidth, baseHeight;
  if (hasPhysical) {
    baseWidth = Number(currentProduct.width_mm) * pxPerMm * correction * userScale;
    baseHeight = Number(currentProduct.height_mm) * pxPerMm * correction * userScale;
  } else {
    const aspect = earring.naturalWidth && earring.naturalHeight ? earring.naturalWidth/earring.naturalHeight : 0.55;
    baseHeight = faceHeight * 0.19 * userScale;
    baseWidth = baseHeight * aspect;
  }

  const leftScale = clamp(1-yaw*.45, .76, 1.18);
  const rightScale = clamp(1+yaw*.45, .76, 1.18);
  const leftAlpha = clamp(1-Math.max(0,yaw)*.18, .82, 1);
  const rightAlpha = clamp(1+Math.min(0,yaw)*.18, .82, 1);
  const L = { x:leftAnchor.x, y:leftAnchor.y+manualY };
  const R = { x:rightAnchor.x, y:rightAnchor.y+manualY };

  if (selectedSide === 'left' || selectedSide === 'both') drawEarring(L, baseWidth*leftScale, baseHeight*leftScale, roll, true, leftAlpha);
  if (selectedSide === 'right' || selectedSide === 'both') drawEarring(R, baseWidth*rightScale, baseHeight*rightScale, roll, false, rightAlpha);
}

async function captureSnapshot() {
  if (!running || video.readyState < 2) {
    showToast('請先開啟相機');
    return;
  }

  const rect = video.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const shot = document.createElement('canvas');
  shot.width = Math.round(rect.width*dpr);
  shot.height = Math.round(rect.height*dpr);
  const sctx = shot.getContext('2d');
  sctx.setTransform(dpr,0,0,dpr,0,0);

  const transform = cover(video.videoWidth, video.videoHeight, rect.width, rect.height);
  sctx.save();
  sctx.translate(rect.width,0);
  sctx.scale(-1,1);
  sctx.drawImage(video, transform.offsetX, transform.offsetY, video.videoWidth*transform.scale, video.videoHeight*transform.scale);
  sctx.drawImage(canvas, 0,0,canvas.width,canvas.height, 0,0,rect.width,rect.height);
  sctx.restore();

  const grad = sctx.createLinearGradient(0,0,0,120);
  grad.addColorStop(0,'rgba(0,0,0,.55)');
  grad.addColorStop(1,'rgba(0,0,0,0)');
  sctx.fillStyle = grad;
  sctx.fillRect(0,0,rect.width,120);
  sctx.fillStyle = '#f5f0e7';
  sctx.font = '600 15px -apple-system, BlinkMacSystemFont, sans-serif';
  sctx.fillText('W.RINES', 18, 30);
  sctx.font = '11px -apple-system, BlinkMacSystemFont, sans-serif';
  sctx.globalAlpha = .82;
  sctx.fillText(`${currentProduct.sku} · ${currentProduct.name || ''}`, 18, 50);
  sctx.globalAlpha = 1;

  const blob = await new Promise((resolve) => shot.toBlob(resolve,'image/png',.96));
  if (!blob) {
    showToast('截圖失敗，請再試一次');
    return;
  }

  const filename = `WRINES_AR_${currentProduct.sku}_${Date.now()}.png`;
  const file = new File([blob], filename, { type:'image/png' });

  try {
    if (navigator.canShare?.({ files:[file] })) {
      await navigator.share({ files:[file], title:'W.RINES AR Try-On' });
      showToast('截圖已完成');
      return;
    }
  } catch (error) {
    if (error?.name === 'AbortError') return;
    console.warn('Share failed, using download fallback', error);
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  showToast('截圖已下載');
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
        statusEl.textContent = '已偵測臉部';
        render(result.faceLandmarks[0]);
      } else {
        guide.classList.remove('hidden');
        statusEl.textContent = '尋找臉部';
      }
    } catch (error) {
      console.error('Face detection failed', error);
      statusEl.textContent = '臉部辨識錯誤';
    }
  }
  requestAnimationFrame(predict);
}

loadCatalog();
window.addEventListener('resize', resize);
window.addEventListener('pagehide', stopCamera);
