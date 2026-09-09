import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import './style.css';

const BASE = import.meta.env.BASE_URL;
const PRODUCTS_URL = `${BASE}products/products.json`;
const FACE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm';

const video = document.querySelector('#camera');
const canvas = document.querySelector('#glCanvas');
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

let stream = null;
let landmarker = null;
let running = false;
let lastVideoTime = -1;
let catalog = [];
let currentProduct = null;
let selectedSide = 'both';
let angleImages = {};
let toastTimer = null;
const motion = { left: null, right: null };

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const avg = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
function smooth(prev, next, k = .38) { return prev ? { x: prev.x + (next.x - prev.x) * k, y: prev.y + (next.y - prev.y) * k } : { ...next }; }
function toast(text) { toastEl.textContent = text; toastEl.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.hidden = true, 1800); }

sideButtons.forEach(btn => btn.onclick = () => { selectedSide = btn.dataset.side; sideButtons.forEach(x => x.classList.toggle('active', x === btn)); });
startBtn.onclick = () => running ? stopCamera() : startCamera();
captureBtn.onclick = captureSnapshot;

function resize() {
  const r = video.getBoundingClientRect(); const dpr = Math.min(devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
function clearOverlay() { const r = canvas.getBoundingClientRect(); ctx.clearRect(0, 0, r.width, r.height); }
function cover(vw, vh, w, h) { const s = Math.max(w / vw, h / vh); return { s, x: (w - vw * s) / 2, y: (h - vh * s) / 2 }; }
function pt(lm, t) { return { x: t.x + lm.x * video.videoWidth * t.s, y: t.y + lm.y * video.videoHeight * t.s }; }

function headPose(lms, t) {
  const ls = pt(lms[234], t), rs = pt(lms[454], t), lj = pt(lms[132], t), rj = pt(lms[361], t);
  const fore = pt(lms[10], t), chin = pt(lms[152], t), nose = pt(lms[1], t);
  const fw = dist(ls, rs), fh = dist(fore, chin), center = avg(ls, rs);
  const turn = clamp((nose.x - center.x) / Math.max(fw * .32, 1), -1, 1);
  const roll = Math.atan2(rs.y - ls.y, rs.x - ls.x);
  const dx = rs.x - ls.x, dy = rs.y - ls.y, d = Math.hypot(dx, dy) || 1, ax = { x: dx / d, y: dy / d };
  const leftBase = { x: ls.x * .40 + lj.x * .60, y: ls.y * .36 + lj.y * .64 };
  const rightBase = { x: rs.x * .40 + rj.x * .60, y: rs.y * .36 + rj.y * .64 };
  const out = fw * Number(currentProduct?.ear_outset ?? .10), drop = fh * Number(currentProduct?.ear_drop ?? .015);
  const lraw = { x: leftBase.x - ax.x * out + ax.y * drop, y: leftBase.y - ax.y * out + drop };
  const rraw = { x: rightBase.x + ax.x * out - ax.y * drop, y: rightBase.y + ax.y * out + drop };
  motion.left = smooth(motion.left, lraw); motion.right = smooth(motion.right, rraw);
  return { left: motion.left, right: motion.right, turn, roll, fw, fh };
}

function pixelsPerMm(lms, t) {
  const a = lms[468] ? pt(lms[468], t) : avg(pt(lms[33], t), pt(lms[133], t));
  const b = lms[473] ? pt(lms[473], t) : avg(pt(lms[362], t), pt(lms[263], t));
  return Math.max(dist(a, b) / 63, .1);
}
function pickAngle(turn, side) {
  const local = side === 'left' ? turn : -turn, a = Math.abs(local);
  if (a < .18) return 'front';
  if (local > 0) return a < .55 ? 'right45' : 'right90';
  return a < .55 ? 'left45' : 'left90';
}
function drawEarring(side, anchor, width, height, pose) {
  const key = pickAngle(pose.turn, side), img = angleImages[key] || angleImages.front;
  if (!img?.complete) return;
  const facing = side === 'left' ? clamp(.55 + pose.turn * 1.35, 0, 1) : clamp(.55 - pose.turn * 1.35, 0, 1);
  if (facing < .08) return;
  const depth = side === 'left' ? clamp(1 - pose.turn * .10, .86, 1.1) : clamp(1 + pose.turn * .10, .86, 1.1);
  ctx.save(); ctx.globalAlpha = clamp(facing * 1.15, 0, 1); ctx.translate(anchor.x, anchor.y); ctx.rotate(pose.roll);
  const mirror = side === 'left' && currentProduct.mirror_pair !== false ? -1 : 1; ctx.scale(mirror, 1);
  ctx.shadowColor = 'rgba(0,0,0,.16)'; ctx.shadowBlur = Math.max(1, width * .08); ctx.shadowOffsetY = Math.max(.4, height * .015);
  ctx.drawImage(img, -width * .5, -height * .5, width * depth, height * depth); ctx.restore();
}
function renderAR(lms) {
  clearOverlay(); const r = video.getBoundingClientRect(), t = cover(video.videoWidth, video.videoHeight, r.width, r.height), pose = headPose(lms, t);
  const ppm = pixelsPerMm(lms, t), userScale = Number(scaleRange.value), manualY = Number(offsetYRange.value) * pose.fh;
  const wear = Number(currentProduct.wear_scale || 1), corr = Number(currentProduct.scale_correction || 1), sized = Number(currentProduct.width_mm) > 0 && Number(currentProduct.height_mm) > 0;
  let w, h;
  if (sized) { w = Number(currentProduct.width_mm) * ppm * corr * userScale * wear; h = Number(currentProduct.height_mm) * ppm * corr * userScale * wear; }
  else if (currentProduct.product_type === 'drop') { h = pose.fh * .25 * userScale * wear; w = h * .22; }
  else { w = pose.fh * .09 * userScale * wear; h = w; }
  if (currentProduct.product_type !== 'drop') { const min = pose.fh * Number(currentProduct.min_screen_ratio ?? .043), maxSide = Math.max(w, h, 1); if (maxSide < min) { const k = min / maxSide; w *= k; h *= k; } }
  const L = { x: pose.left.x, y: pose.left.y + manualY }, R = { x: pose.right.x, y: pose.right.y + manualY };
  if (selectedSide === 'left' || selectedSide === 'both') drawEarring('left', L, w, h, pose);
  if (selectedSide === 'right' || selectedSide === 'both') drawEarring('right', R, w, h, pose);
}

function imageUrl(product) { const v = product.image || ''; return /^(https?:|data:)/i.test(v) ? v : `${BASE}products/${v}`; }
function renderStrip() {
  productStrip.innerHTML = '';
  catalog.forEach((p, i) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'product-card'; b.innerHTML = `<img class="product-thumb" src="${imageUrl(p)}" alt="${p.name || p.sku}"><span class="product-sku">${p.sku}</span><span class="product-charm">${p.charm || ''}</span>`; b.onclick = () => selectProduct(i, true); productStrip.appendChild(b); });
}
async function loadImage(src) { return new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = src; }); }
async function selectProduct(i, user = false) {
  if (!catalog[i]) return; currentProduct = catalog[i]; productNameEl.textContent = `${currentProduct.sku} · ${currentProduct.name || ''}`;
  const sized = Number(currentProduct.width_mm) > 0 && Number(currentProduct.height_mm) > 0;
  sizeStatusEl.textContent = `${sized ? `實尺寸 ${currentProduct.width_mm} × ${currentProduct.height_mm} mm` : '尺寸資料待核對'}｜多角度 PNG v7.2`;
  const assets = currentProduct.angle_assets || {}; const pairs = await Promise.all(Object.entries(assets).map(async ([k, src]) => [k, await loadImage(src)])); angleImages = Object.fromEntries(pairs);
  [...productStrip.children].forEach((c, n) => c.classList.toggle('active', n === i)); productStrip.children[i]?.scrollIntoView({ behavior: user ? 'smooth' : 'auto', inline: 'center', block: 'nearest' }); if (user) toast(`已切換 ${currentProduct.sku}`);
}
async function loadCatalog() {
  const r = await fetch(`${PRODUCTS_URL}?v=${Date.now()}`, { cache: 'no-store' }); catalog = await r.json(); renderStrip();
  const q = new URLSearchParams(location.search).get('sku'), i = q ? catalog.findIndex(p => String(p.sku).toLowerCase() === q.toLowerCase()) : 0; await selectProduct(i >= 0 ? i : 0, false);
}

async function initLandmarker() {
  if (landmarker) return; statusEl.textContent = '載入臉部模型'; const vision = await FilesetResolver.forVisionTasks(WASM);
  try { landmarker = await FaceLandmarker.createFromOptions(vision, { baseOptions: { modelAssetPath: FACE_MODEL, delegate: 'GPU' }, runningMode: 'VIDEO', numFaces: 1, minFaceDetectionConfidence: .5, minFacePresenceConfidence: .5, minTrackingConfidence: .5 }); }
  catch { landmarker = await FaceLandmarker.createFromOptions(vision, { baseOptions: { modelAssetPath: FACE_MODEL, delegate: 'CPU' }, runningMode: 'VIDEO', numFaces: 1 }); }
}
async function startCamera() {
  startBtn.disabled = true; startBtn.textContent = '啟動中…';
  try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'user' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false }); video.srcObject = stream; await video.play(); running = true; captureBtn.disabled = false; resize(); await initLandmarker(); statusEl.textContent = '尋找臉部'; startBtn.textContent = '關閉相機'; requestAnimationFrame(predict); }
  catch (e) { console.error(e); statusEl.textContent = '無法開啟相機'; alert(`啟動失敗：${e?.message || e}`); }
  finally { startBtn.disabled = false; if (!running) startBtn.textContent = '開啟相機'; }
}
function stopCamera() { running = false; stream?.getTracks().forEach(t => t.stop()); stream = null; video.srcObject = null; captureBtn.disabled = true; motion.left = motion.right = null; clearOverlay(); guide.classList.remove('hidden'); statusEl.textContent = '已關閉'; startBtn.textContent = '開啟相機'; }
function predict() {
  if (!running) return; resize();
  if (landmarker && video.readyState >= 2 && video.currentTime !== lastVideoTime) { lastVideoTime = video.currentTime; try { const result = landmarker.detectForVideo(video, performance.now()); if (result.faceLandmarks?.length) { guide.classList.add('hidden'); statusEl.textContent = '已偵測臉部'; renderAR(result.faceLandmarks[0]); } else { clearOverlay(); guide.classList.remove('hidden'); statusEl.textContent = '尋找臉部'; } } catch (e) { console.error(e); statusEl.textContent = '臉部辨識錯誤'; } }
  requestAnimationFrame(predict);
}
async function captureSnapshot() {
  if (!running) return toast('請先開啟相機'); const r = video.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2), out = document.createElement('canvas'); out.width = Math.round(r.width * dpr); out.height = Math.round(r.height * dpr); const c = out.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); const t = cover(video.videoWidth, video.videoHeight, r.width, r.height);
  c.save(); c.translate(r.width, 0); c.scale(-1, 1); c.drawImage(video, t.x, t.y, video.videoWidth * t.s, video.videoHeight * t.s); c.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, r.width, r.height); c.restore();
  const blob = await new Promise(ok => out.toBlob(ok, 'image/png', .96)); if (!blob) return; const file = new File([blob], `WRINES_AR_${currentProduct.sku}_${Date.now()}.png`, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file], title: 'W.RINES AR Try-On' }); return; } catch (e) { if (e?.name === 'AbortError') return; } }
  const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = file.name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1200);
}

loadCatalog();
window.addEventListener('resize', resize);
window.addEventListener('pagehide', stopCamera);
