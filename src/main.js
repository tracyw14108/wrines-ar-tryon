import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import './style.css';

const MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const PRODUCT_BASE = `${import.meta.env.BASE_URL}products/`;

const video = document.querySelector('#camera');
const canvas = document.querySelector('#overlay');
const ctx = canvas.getContext('2d');
const startBtn = document.querySelector('#startBtn');
const statusEl = document.querySelector('#status');
const guide = document.querySelector('#guide');
const scaleRange = document.querySelector('#scaleRange');
const offsetYRange = document.querySelector('#offsetYRange');
const sideButtons = [...document.querySelectorAll('[data-side]')];

let landmarker = null;
let stream = null;
let running = false;
let lastVideoTime = -1;
let selectedSide = 'both';

const earring = new Image();
earring.src = `${PRODUCT_BASE}demo-earring.svg`;

sideButtons.forEach((button) => {
  button.onclick = () => {
    selectedSide = button.dataset.side;
    sideButtons.forEach((item) => item.classList.toggle('active', item === button));
  };
});

startBtn.onclick = async () => running ? stopCamera() : await start();

async function init() {
  if (landmarker) return;

  statusEl.textContent = '載入臉部模型';
  const vision = await FilesetResolver.forVisionTasks(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm'
  );

  landmarker = await FaceLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: MODEL,
      delegate: 'GPU',
    },
    runningMode: 'VIDEO',
    numFaces: 1,
    minFaceDetectionConfidence: 0.5,
    minFacePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
}

async function start() {
  try {
    await init();
    statusEl.textContent = '要求相機權限';

    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'user',
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    });

    video.srcObject = stream;
    await video.play();

    running = true;
    startBtn.textContent = '關閉相機';
    statusEl.textContent = '尋找臉部';
    requestAnimationFrame(predict);
  } catch (error) {
    console.error(error);
    statusEl.textContent = '無法開啟相機';
    alert('請允許相機權限，並使用 localhost 或 HTTPS 開啟。');
  }
}

function stopCamera() {
  running = false;
  if (stream) stream.getTracks().forEach((track) => track.stop());
  stream = null;
  video.srcObject = null;
  clearOverlay();
  guide.classList.remove('hidden');
  startBtn.textContent = '開啟相機';
  statusEl.textContent = '已關閉';
}

function resize() {
  const rect = video.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function clearOverlay() {
  const rect = canvas.getBoundingClientRect();
  ctx.clearRect(0, 0, rect.width, rect.height);
}

function cover(videoW, videoH, viewW, viewH) {
  const scale = Math.max(viewW / videoW, viewH / videoH);
  return {
    scale,
    offsetX: (viewW - videoW * scale) / 2,
    offsetY: (viewH - videoH * scale) / 2,
  };
}

function point(landmark, transform) {
  return {
    x: transform.offsetX + landmark.x * video.videoWidth * transform.scale,
    y: transform.offsetY + landmark.y * video.videoHeight * transform.scale,
  };
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function drawEarring(anchor, size, rotation, mirror) {
  if (!earring.complete || !earring.naturalWidth) return;

  const aspect = earring.naturalWidth / earring.naturalHeight || 0.55;
  const width = size * aspect;

  ctx.save();
  ctx.translate(anchor.x, anchor.y);
  ctx.rotate(rotation);
  if (mirror) ctx.scale(-1, 1);
  ctx.drawImage(earring, -width / 2, 0, width, size);
  ctx.restore();
}

function render(landmarks) {
  const rect = video.getBoundingClientRect();
  const transform = cover(video.videoWidth, video.videoHeight, rect.width, rect.height);

  const leftFace = point(landmarks[234], transform);
  const rightFace = point(landmarks[454], transform);
  const forehead = point(landmarks[10], transform);
  const chin = point(landmarks[152], transform);

  const faceHeight = distance(forehead, chin);
  const scale = Number(scaleRange.value);
  const offsetY = Number(offsetYRange.value) * faceHeight;
  const earringHeight = faceHeight * 0.24 * scale;
  const headRoll = Math.atan2(rightFace.y - leftFace.y, rightFace.x - leftFace.x);

  const leftAnchor = {
    x: leftFace.x - faceHeight * 0.018,
    y: leftFace.y + faceHeight * 0.08 + offsetY,
  };

  const rightAnchor = {
    x: rightFace.x + faceHeight * 0.018,
    y: rightFace.y + faceHeight * 0.08 + offsetY,
  };

  if (selectedSide === 'left' || selectedSide === 'both') {
    drawEarring(leftAnchor, earringHeight, headRoll, true);
  }

  if (selectedSide === 'right' || selectedSide === 'both') {
    drawEarring(rightAnchor, earringHeight, headRoll, false);
  }
}

function predict() {
  if (!running) return;

  resize();
  clearOverlay();

  if (
    landmarker &&
    video.readyState >= 2 &&
    video.currentTime !== lastVideoTime
  ) {
    lastVideoTime = video.currentTime;
    const result = landmarker.detectForVideo(video, performance.now());

    if (result.faceLandmarks?.length) {
      guide.classList.add('hidden');
      statusEl.textContent = '已偵測臉部';
      render(result.faceLandmarks[0]);
    } else {
      guide.classList.remove('hidden');
      statusEl.textContent = '尋找臉部';
    }
  }

  requestAnimationFrame(predict);
}

window.addEventListener('resize', resize);
window.addEventListener('pagehide', stopCamera);
