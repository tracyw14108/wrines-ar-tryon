import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import './style.css';

const BASE = import.meta.env.BASE_URL;
const PRODUCT_BASE = `${BASE}products/`;
const MODEL_BASE = `${BASE}models/`;
const MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm';

const video = document.querySelector('#camera');
const canvas = document.querySelector('#glCanvas');
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

let landmarker, stream, running = false, lastTime = -1;
let side = 'both', catalog = [], product = null, toastTimer;
const loader = new GLTFLoader();
const cache = new Map();

const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
renderer.setClearColor(0x000000, 0);
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(0, 1, 1, 0, -2000, 2000);
camera.position.z = 1000;
scene.add(new THREE.HemisphereLight(0xffffff, 0x222222, 2));
const key = new THREE.DirectionalLight(0xffffff, 2.3); key.position.set(200, -150, 400); scene.add(key);
const fill = new THREE.DirectionalLight(0xffffff, 0.8); fill.position.set(-180, 40, 280); scene.add(fill);

const rigs = { left: makeRig(), right: makeRig() };
scene.add(rigs.left, rigs.right);
const motion = { left: null, right: null };

function makeRig() {
  const rig = new THREE.Group();
  rig.userData.holder = new THREE.Group();
  rig.add(rig.userData.holder);
  rig.visible = false;
  return rig;
}

function toast(text) {
  toastEl.textContent = text; toastEl.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.hidden = true, 1800);
}

function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function avg(a, b) { return { x:(a.x+b.x)/2, y:(a.y+b.y)/2, z:((a.z||0)+(b.z||0))/2 }; }
function smooth(prev, next, k=.42) { return prev ? { x:prev.x+(next.x-prev.x)*k, y:prev.y+(next.y-prev.y)*k } : next; }

function resize() {
  const r = video.getBoundingClientRect();
  if (!r.width || !r.height) return;
  renderer.setSize(r.width, r.height, false);
  camera.left = 0; camera.right = r.width; camera.top = 0; camera.bottom = r.height; camera.updateProjectionMatrix();
}

function cover(vw, vh, w, h) {
  const s = Math.max(w/vw, h/vh);
  return { s, x:(w-vw*s)/2, y:(h-vh*s)/2 };
}

function pt(lm, t) {
  return { x:t.x + lm.x*video.videoWidth*t.s, y:t.y + lm.y*video.videoHeight*t.s, z:lm.z || 0 };
}

function headPose(lms, t) {
  const ls=pt(lms[234],t), rs=pt(lms[454],t), lj=pt(lms[132],t), rj=pt(lms[361],t);
  const forehead=pt(lms[10],t), chin=pt(lms[152],t), nose=pt(lms[1],t);
  const fw=dist(ls,rs), fh=dist(forehead,chin);
  const dx=rs.x-ls.x, dy=rs.y-ls.y, dl=Math.hypot(dx,dy)||1;
  const ax={x:dx/dl,y:dy/dl};
  const dlft=dist(nose,ls), drgt=dist(nose,rs);
  const yaw=clamp((dlft-drgt)/Math.max(dlft+drgt,1),-.46,.46);
  const roll=Math.atan2(dy,dx);
  const pitch=clamp((((nose.y-forehead.y)/Math.max(fh,1))-.47)*2.1,-.3,.3);
  const outward=fw*.06;
  const lb={x:ls.x*.52+lj.x*.48, y:ls.y*.54+lj.y*.46};
  const rb={x:rs.x*.52+rj.x*.48, y:rs.y*.54+rj.y*.46};
  motion.left=smooth(motion.left,{x:lb.x-ax.x*outward*(1-yaw*.5),y:lb.y-ax.y*outward*(1-yaw*.5)});
  motion.right=smooth(motion.right,{x:rb.x+ax.x*outward*(1+yaw*.5),y:rb.y+ax.y*outward*(1+yaw*.5)});
  return { left:motion.left, right:motion.right, yaw, roll, pitch, fw, fh };
}

function pixelsPerMm(lms,t) {
  const a=lms[468]?pt(lms[468],t):avg(pt(lms[33],t),pt(lms[133],t));
  const b=lms[473]?pt(lms[473],t):avg(pt(lms[362],t),pt(lms[263],t));
  return Math.max(dist(a,b)/63, .1);
}

function metal() {
  return new THREE.MeshPhysicalMaterial({ color:0xf3f3f0, metalness:1, roughness:.18, clearcoat:1, clearcoatRoughness:.08 });
}
function pearl() {
  return new THREE.MeshPhysicalMaterial({ color:0xf8f5ee, metalness:.03, roughness:.18, clearcoat:.8 });
}
function star(mat) {
  const s=new THREE.Shape();
  for(let i=0;i<10;i++){const r=i%2?0.22:0.5,a=i*Math.PI/5-Math.PI/2,x=Math.cos(a)*r,y=Math.sin(a)*r;i?s.lineTo(x,y):s.moveTo(x,y)}
  s.closePath(); const g=new THREE.ExtrudeGeometry(s,{depth:.14,bevelEnabled:true,bevelSize:.03,bevelThickness:.025,bevelSegments:2}); g.center(); return new THREE.Mesh(g,mat);
}
function bow(mat) {
  const g=new THREE.Group();
  const a=new THREE.Mesh(new THREE.SphereGeometry(.24,28,28),mat); a.scale.set(1.25,.8,.42); a.position.x=-.2;
  const b=a.clone(); b.position.x=.2; const k=new THREE.Mesh(new THREE.SphereGeometry(.13,24,24),mat); g.add(a,b,k); return g;
}

function proxyAsset(p) {
  const g=new THREE.Group(), m=metal(), q=pearl(), name=`${p.name||''} ${p.sku||''}`;
  if (p.product_type==='drop') {
    const top=new THREE.Mesh(new THREE.SphereGeometry(.11,24,24),m); top.position.y=.05;
    const chain=new THREE.Mesh(new THREE.CylinderGeometry(.022,.022,.7,16),m); chain.position.y=.42;
    const tip=new THREE.Mesh(new THREE.SphereGeometry(.13,28,28),q); tip.position.y=.82; g.add(top,chain,tip);
  } else if (/星|五角/.test(name)) g.add(star(m));
  else if (/蝴蝶/.test(name)) g.add(bow(m));
  else if (/珍珠/.test(name)) g.add(new THREE.Mesh(new THREE.SphereGeometry(.48,32,32),q));
  else { const d=new THREE.Mesh(new THREE.CylinderGeometry(.42,.42,.18,32),m); d.rotation.x=Math.PI/2; g.add(d); }
  normalizeAsset(g,p); return g;
}

function normalizeAsset(obj,p) {
  const box=new THREE.Box3().setFromObject(obj), c=box.getCenter(new THREE.Vector3()); obj.position.sub(c);
  const b=new THREE.Box3().setFromObject(obj), s=b.getSize(new THREE.Vector3());
  const fit=p.product_type==='drop'?Math.max(s.y,.001):Math.max(s.x,s.y,.001); obj.scale.multiplyScalar((1/fit)*Number(p.model_scale||1));
}

async function assetFor(p) {
  if (p.model_glb) {
    const key=p.model_glb;
    if (!cache.has(key)) {
      const gltf=await loader.loadAsync(`${MODEL_BASE}${key}`);
      const root=gltf.scene; normalizeAsset(root,p); cache.set(key,root);
    }
    return cache.get(key).clone(true);
  }
  return proxyAsset(p);
}

async function applyProduct(p) {
  for (const rig of Object.values(rigs)) {
    const h=rig.userData.holder;
    while(h.children.length) h.remove(h.children[0]);
    h.add(await assetFor(p));
  }
}

function productUrl(p){ return `${PRODUCT_BASE}${p.image}`; }
function renderStrip(){
  productStrip.innerHTML='';
  catalog.forEach((p,i)=>{
    const b=document.createElement('button'); b.className='product-card';
    b.innerHTML=`<img class="product-thumb" src="${productUrl(p)}" alt=""><span class="product-sku">${p.sku}</span><span class="product-charm">${p.charm||''}</span>`;
    b.onclick=()=>selectProduct(i,true); productStrip.appendChild(b);
  });
}

async function selectProduct(i,user=false){
  if(!catalog[i])return; product=catalog[i];
  productNameEl.textContent=`${product.sku} · ${product.name||''}`;
  const sized=Number(product.width_mm)>0&&Number(product.height_mm)>0;
  sizeStatusEl.textContent=`${sized?`實尺寸 ${product.width_mm} × ${product.height_mm} mm`:'尺寸資料待核對'}｜${product.model_glb?'GLB 3D':'3D proxy（等待正式 GLB）'}`;
  await applyProduct(product);
  [...productStrip.children].forEach((x,n)=>x.classList.toggle('active',n===i));
  productStrip.children[i]?.scrollIntoView({behavior:user?'smooth':'auto',inline:'center',block:'nearest'});
  if(user)toast(`已切換 ${product.sku}`);
}

async function loadCatalog(){
  const r=await fetch(`${PRODUCT_BASE}products.json?v=${Date.now()}`,{cache:'no-store'}); catalog=await r.json(); renderStrip();
  const sku=new URLSearchParams(location.search).get('sku'); const i=sku?catalog.findIndex(p=>p.sku.toLowerCase()===sku.toLowerCase()):0;
  await selectProduct(i>=0?i:0,false);
}

async function initLandmarker(){
  if(landmarker)return; statusEl.textContent='載入臉部模型';
  const vision=await FilesetResolver.forVisionTasks(WASM);
  try { landmarker=await FaceLandmarker.createFromOptions(vision,{baseOptions:{modelAssetPath:MODEL,delegate:'GPU'},runningMode:'VIDEO',numFaces:1}); }
  catch { landmarker=await FaceLandmarker.createFromOptions(vision,{baseOptions:{modelAssetPath:MODEL,delegate:'CPU'},runningMode:'VIDEO',numFaces:1}); }
}

async function openCamera(){
  return navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'user'},width:{ideal:1280},height:{ideal:720}},audio:false});
}

async function start(){
  startBtn.disabled=true; startBtn.textContent='啟動中…';
  try{stream=await openCamera();video.srcObject=stream;await video.play();running=true;captureBtn.disabled=false;resize();await initLandmarker();statusEl.textContent='尋找臉部';startBtn.textContent='關閉相機';requestAnimationFrame(predict)}
  catch(e){console.error(e);statusEl.textContent='無法開啟相機';alert(`啟動失敗：${e?.message||e}`)}
  finally{startBtn.disabled=false;if(!running)startBtn.textContent='開啟相機'}
}

function stopCamera(){
  running=false; stream?.getTracks().forEach(t=>t.stop()); stream=null; video.srcObject=null; captureBtn.disabled=true; motion.left=motion.right=null;
  rigs.left.visible=rigs.right.visible=false; renderer.clear(); guide.classList.remove('hidden'); statusEl.textContent='已關閉'; startBtn.textContent='開啟相機';
}

function updateRig(rig,which,anchor,w,h,pose,alpha){
  if(!anchor){rig.visible=false;return}
  const depth=which==='left'?clamp(1-pose.yaw*.36,.78,1.18):clamp(1+pose.yaw*.36,.78,1.18);
  const widthPerspective=which==='left'?clamp(1-Math.max(0,pose.yaw)*.9,.5,1):clamp(1+Math.min(0,pose.yaw)*.9,.5,1);
  rig.visible=true; rig.position.set(anchor.x,anchor.y,0); rig.rotation.set(pose.pitch*1.25,-pose.yaw*2.0,pose.roll);
  rig.scale.set(w*widthPerspective*depth,h*depth,Math.max(w,h)*.48*depth);
  rig.userData.holder.scale.x=which==='left'?-1:1;
  rig.traverse(n=>{if(n.isMesh){n.material.transparent=true;n.material.opacity=alpha}});
}

function renderAR(lms){
  const r=video.getBoundingClientRect(), t=cover(video.videoWidth,video.videoHeight,r.width,r.height), pose=headPose(lms,t), ppm=pixelsPerMm(lms,t);
  const u=Number(scaleRange.value), y=Number(offsetYRange.value)*pose.fh, wear=Number(product.wear_scale||1), corr=Number(product.scale_correction||1);
  const sized=Number(product.width_mm)>0&&Number(product.height_mm)>0;
  const w=sized?Number(product.width_mm)*ppm*corr*u*wear:pose.fh*(product.product_type==='drop'?.045:.09)*u*wear;
  const h=sized?Number(product.height_mm)*ppm*corr*u*wear:pose.fh*(product.product_type==='drop'?.24:.11)*u*wear;
  const L={x:pose.left.x,y:pose.left.y+y}, R={x:pose.right.x,y:pose.right.y+y};
  if(side==='left'||side==='both')updateRig(rigs.left,'left',L,w,h,pose,clamp(1-Math.max(0,pose.yaw)*.18,.8,1));else rigs.left.visible=false;
  if(side==='right'||side==='both')updateRig(rigs.right,'right',R,w,h,pose,clamp(1+Math.min(0,pose.yaw)*.18,.8,1));else rigs.right.visible=false;
  renderer.render(scene,camera);
}

async function captureSnapshot(){
  if(!running)return toast('請先開啟相機');
  const r=video.getBoundingClientRect(),d=Math.min(devicePixelRatio||1,2),out=document.createElement('canvas');out.width=r.width*d;out.height=r.height*d;
  const c=out.getContext('2d');c.setTransform(d,0,0,d,0,0);const t=cover(video.videoWidth,video.videoHeight,r.width,r.height);
  c.save();c.translate(r.width,0);c.scale(-1,1);c.drawImage(video,t.x,t.y,video.videoWidth*t.s,video.videoHeight*t.s);c.drawImage(renderer.domElement,0,0,renderer.domElement.width,renderer.domElement.height,0,0,r.width,r.height);c.restore();
  const blob=await new Promise(res=>out.toBlob(res,'image/png',.96));if(!blob)return;
  const file=new File([blob],`WRINES_AR_${product.sku}.png`,{type:'image/png'});
  if(navigator.canShare?.({files:[file]}))await navigator.share({files:[file],title:'W.RINES AR Try-On'});else{const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=file.name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000)}
}

function predict(){
  if(!running)return;resize();
  if(video.readyState>=2&&video.currentTime!==lastTime){lastTime=video.currentTime;const res=landmarker.detectForVideo(video,performance.now());
    if(res.faceLandmarks?.length){guide.classList.add('hidden');statusEl.textContent='已偵測臉部';renderAR(res.faceLandmarks[0])}
    else{guide.classList.remove('hidden');statusEl.textContent='尋找臉部';rigs.left.visible=rigs.right.visible=false;renderer.render(scene,camera)}}
  requestAnimationFrame(predict);
}

sideButtons.forEach(b=>b.onclick=()=>{side=b.dataset.side;sideButtons.forEach(x=>x.classList.toggle('active',x===b))});
startBtn.onclick=()=>running?stopCamera():start();captureBtn.onclick=captureSnapshot;
window.addEventListener('resize',resize);window.addEventListener('pagehide',stopCamera);
resize();loadCatalog();
