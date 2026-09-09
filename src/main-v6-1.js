import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import './style.css';

const BASE=import.meta.env.BASE_URL, PRODUCT_BASE=`${BASE}products/`, MODEL_BASE=`${BASE}models/`;
const FACE_MODEL='https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const WASM='https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm';
const video=document.querySelector('#camera'), canvas=document.querySelector('#glCanvas');
const startBtn=document.querySelector('#startBtn'), captureBtn=document.querySelector('#captureBtn');
const statusEl=document.querySelector('#status'), guide=document.querySelector('#guide');
const scaleRange=document.querySelector('#scaleRange'), offsetYRange=document.querySelector('#offsetYRange');
const sideButtons=[...document.querySelectorAll('[data-side]')], productStrip=document.querySelector('#productStrip');
const productNameEl=document.querySelector('#productName'), sizeStatusEl=document.querySelector('#sizeStatus'), toastEl=document.querySelector('#toast');

let landmarker=null, stream=null, running=false, lastVideoTime=-1, selectedSide='both';
let catalog=[], currentProduct=null, toastTimer=null;
const loader=new GLTFLoader(), cache=new Map(), motion={left:null,right:null};

const renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,preserveDrawingBuffer:true});
renderer.setClearColor(0x000000,0); renderer.setPixelRatio(Math.min(devicePixelRatio||1,2)); renderer.outputColorSpace=THREE.SRGBColorSpace;
const scene=new THREE.Scene();
const pmrem=new THREE.PMREMGenerator(renderer); scene.environment=pmrem.fromScene(new RoomEnvironment(),0.04).texture; pmrem.dispose();
const arCamera=new THREE.OrthographicCamera(0,1,1,0,-3000,3000); arCamera.position.z=1200;
scene.add(new THREE.HemisphereLight(0xffffff,0x303030,2.2));
const key=new THREE.DirectionalLight(0xffffff,2.3); key.position.set(260,-180,520); scene.add(key);
const fill=new THREE.DirectionalLight(0xfff7e8,1.1); fill.position.set(-180,60,380); scene.add(fill);

function makeRig(){const r=new THREE.Group();r.userData.holder=new THREE.Group();r.add(r.userData.holder);r.visible=false;return r}
const rigs={left:makeRig(),right:makeRig()}; scene.add(rigs.left,rigs.right);

function clamp(v,a,b){return Math.min(b,Math.max(a,v))}
function dist(a,b){return Math.hypot(a.x-b.x,a.y-b.y)}
function avg(a,b){return{x:(a.x+b.x)/2,y:(a.y+b.y)/2,z:((a.z||0)+(b.z||0))/2}}
function smooth(prev,next,k=.44){return prev?{x:prev.x+(next.x-prev.x)*k,y:prev.y+(next.y-prev.y)*k}:{...next}}
function toast(t){toastEl.textContent=t;toastEl.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>toastEl.hidden=true,1900)}

sideButtons.forEach(b=>b.onclick=()=>{selectedSide=b.dataset.side;sideButtons.forEach(x=>x.classList.toggle('active',x===b))});
startBtn.onclick=()=>running?stopCamera():start(); captureBtn.onclick=captureSnapshot;

function resize(){const r=video.getBoundingClientRect();if(!r.width||!r.height)return;renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));renderer.setSize(r.width,r.height,false);arCamera.left=0;arCamera.right=r.width;arCamera.top=0;arCamera.bottom=r.height;arCamera.updateProjectionMatrix()}
function cover(vw,vh,w,h){const s=Math.max(w/vw,h/vh);return{s,x:(w-vw*s)/2,y:(h-vh*s)/2}}
function pt(lm,t){return{x:t.x+lm.x*video.videoWidth*t.s,y:t.y+lm.y*video.videoHeight*t.s,z:lm.z||0}}

function headPose(lms,t){
  const ls=pt(lms[234],t),rs=pt(lms[454],t),lj=pt(lms[132],t),rj=pt(lms[361],t),fore=pt(lms[10],t),chin=pt(lms[152],t),nose=pt(lms[1],t);
  const fw=dist(ls,rs),fh=dist(fore,chin),dx=rs.x-ls.x,dy=rs.y-ls.y,d=Math.hypot(dx,dy)||1,ax={x:dx/d,y:dy/d};
  const dl=dist(nose,ls),dr=dist(nose,rs),yaw=clamp((dl-dr)/Math.max(dl+dr,1),-.46,.46),roll=Math.atan2(dy,dx),pitch=clamp((((nose.y-fore.y)/Math.max(fh,1))-.47)*2.1,-.30,.30);
  // 234/454 只到臉側，不是耳洞。X 直接取臉側，再向外推出約 12% 臉寬到耳垂區，避免黏在臉頰。
  const lb={x:ls.x,y:ls.y*.62+lj.y*.38}, rb={x:rs.x,y:rs.y*.62+rj.y*.38};
  const out=fw*Number(currentProduct?.ear_outset??.12),drop=fh*Number(currentProduct?.ear_drop??.01);
  const lraw={x:lb.x-ax.x*out*(1-yaw*.45),y:lb.y-ax.y*out*(1-yaw*.45)+drop};
  const rraw={x:rb.x+ax.x*out*(1+yaw*.45),y:rb.y+ax.y*out*(1+yaw*.45)+drop};
  motion.left=smooth(motion.left,lraw);motion.right=smooth(motion.right,rraw);
  return{left:motion.left,right:motion.right,yaw,roll,pitch,fw,fh}
}

function pixelsPerMm(lms,t){const a=lms[468]?pt(lms[468],t):avg(pt(lms[33],t),pt(lms[133],t)),b=lms[473]?pt(lms[473],t):avg(pt(lms[362],t),pt(lms[263],t));return Math.max(dist(a,b)/63,.1)}

function tuneMaterials(root){root.traverse(n=>{if(!n.isMesh)return;const mats=Array.isArray(n.material)?n.material:[n.material];mats.forEach(m=>{if(!m)return;m.side=THREE.DoubleSide;if('envMapIntensity'in m)m.envMapIntensity=1.65;if('metalness'in m)m.metalness=Math.min(Number(m.metalness??.5),.72);if('roughness'in m)m.roughness=Math.max(Number(m.roughness??.25),.18);m.needsUpdate=true})})}

function normalizeAsset(root,p){
  let box=new THREE.Box3().setFromObject(root),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());
  if(p.product_type==='drop') root.position.set(-center.x,-box.max.y,-center.z); else root.position.sub(center);
  box=new THREE.Box3().setFromObject(root);size=box.getSize(new THREE.Vector3());
  const sx=1/Math.max(size.x,.001),sy=1/Math.max(size.y,.001),sz=1/Math.max(Math.max(size.x,size.y),.001),ms=Number(p.model_scale||1);
  // X/Y 各自正規化，讓 width_mm / height_mm 真正代表最終畫面尺寸，不再因原始 GLB 比例導致耳釘縮成像素點。
  root.scale.set(sx*ms,sy*ms,sz*ms);tuneMaterials(root)
}

async function assetFor(p){const name=p.model_glb;if(!name)throw new Error(`NO_GLB:${p.sku}`);if(!cache.has(name)){const gltf=await loader.loadAsync(`${MODEL_BASE}${name}?v=61`);const root=gltf.scene;normalizeAsset(root,p);cache.set(name,root)}return cache.get(name).clone(true)}
async function applyProduct(p){for(const rig of Object.values(rigs)){const h=rig.userData.holder;while(h.children.length)h.remove(h.children[0]);try{h.add(await assetFor(p))}catch(e){console.error(e);toast(`${p.sku} 3D 模型載入失敗`)}}}

function renderStrip(){productStrip.innerHTML='';catalog.forEach((p,i)=>{const b=document.createElement('button');b.type='button';b.className='product-card';b.innerHTML=`<img class="product-thumb" src="${PRODUCT_BASE}${p.image}" alt="${p.name||p.sku}"><span class="product-sku">${p.sku}</span><span class="product-charm">${p.charm||''}</span>`;b.onclick=()=>selectProduct(i,true);productStrip.appendChild(b)})}
async function selectProduct(i,user=false){if(!catalog[i])return;currentProduct=catalog[i];productNameEl.textContent=`${currentProduct.sku} · ${currentProduct.name||''}`;const sized=Number(currentProduct.width_mm)>0&&Number(currentProduct.height_mm)>0;sizeStatusEl.textContent=`${sized?`實尺寸 ${currentProduct.width_mm} × ${currentProduct.height_mm} mm`:'尺寸資料待核對'}｜GLB 3D v6.1`;await applyProduct(currentProduct);[...productStrip.children].forEach((c,n)=>c.classList.toggle('active',n===i));productStrip.children[i]?.scrollIntoView({behavior:user?'smooth':'auto',inline:'center',block:'nearest'});if(user)toast(`已切換 ${currentProduct.sku}`)}
async function loadCatalog(){const r=await fetch(`${PRODUCT_BASE}products.json?v=${Date.now()}`,{cache:'no-store'});catalog=await r.json();renderStrip();const q=new URLSearchParams(location.search).get('sku'),i=q?catalog.findIndex(p=>String(p.sku).toLowerCase()===q.toLowerCase()):0;await selectProduct(i>=0?i:0,false)}

async function initLandmarker(){if(landmarker)return;statusEl.textContent='載入臉部模型';const vision=await FilesetResolver.forVisionTasks(WASM);try{landmarker=await FaceLandmarker.createFromOptions(vision,{baseOptions:{modelAssetPath:FACE_MODEL,delegate:'GPU'},runningMode:'VIDEO',numFaces:1,minFaceDetectionConfidence:.5,minFacePresenceConfidence:.5,minTrackingConfidence:.5})}catch{landmarker=await FaceLandmarker.createFromOptions(vision,{baseOptions:{modelAssetPath:FACE_MODEL,delegate:'CPU'},runningMode:'VIDEO',numFaces:1})}}
async function start(){startBtn.disabled=true;startBtn.textContent='啟動中…';try{stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'user'},width:{ideal:1280},height:{ideal:720}},audio:false});video.srcObject=stream;await video.play();running=true;captureBtn.disabled=false;resize();await initLandmarker();statusEl.textContent='尋找臉部';startBtn.textContent='關閉相機';requestAnimationFrame(predict)}catch(e){console.error(e);statusEl.textContent='無法開啟相機';alert(`啟動失敗：${e?.message||e}`)}finally{startBtn.disabled=false;if(!running)startBtn.textContent='開啟相機'}}
function stopCamera(){running=false;stream?.getTracks().forEach(t=>t.stop());stream=null;video.srcObject=null;captureBtn.disabled=true;motion.left=motion.right=null;rigs.left.visible=rigs.right.visible=false;renderer.clear();guide.classList.remove('hidden');statusEl.textContent='已關閉';startBtn.textContent='開啟相機'}

function updateRig(rig,which,a,w,h,pose,alpha){if(!a||!rig.userData.holder.children.length){rig.visible=false;return}const depth=which==='left'?clamp(1-pose.yaw*.34,.8,1.17):clamp(1+pose.yaw*.34,.8,1.17),persp=which==='left'?clamp(1-Math.max(0,pose.yaw)*.78,.58,1):clamp(1+Math.min(0,pose.yaw)*.78,.58,1);rig.visible=true;rig.position.set(a.x,a.y,0);rig.rotation.set(pose.pitch*1.15,-pose.yaw*1.75,pose.roll);rig.scale.set(w*persp*depth,h*depth,Math.max(w,h)*.42*depth);rig.userData.holder.scale.x=which==='left'&&currentProduct.mirror_pair!==false?-1:1;rig.traverse(n=>{if(n.isMesh){const mats=Array.isArray(n.material)?n.material:[n.material];mats.forEach(m=>{m.transparent=true;m.opacity=alpha})}})}

function renderAR(lms){const r=video.getBoundingClientRect(),t=cover(video.videoWidth,video.videoHeight,r.width,r.height),pose=headPose(lms,t),ppm=pixelsPerMm(lms,t),u=Number(scaleRange.value),manualY=Number(offsetYRange.value)*pose.fh,wear=Number(currentProduct.wear_scale||1),corr=Number(currentProduct.scale_correction||1),sized=Number(currentProduct.width_mm)>0&&Number(currentProduct.height_mm)>0;let w=sized?Number(currentProduct.width_mm)*ppm*corr*u*wear:pose.fh*(currentProduct.product_type==='drop'?.045:.09)*u*wear,h=sized?Number(currentProduct.height_mm)*ppm*corr*u*wear:pose.fh*(currentProduct.product_type==='drop'?.24:.11)*u*wear;if(currentProduct.product_type!=='drop'){const min=pose.fh*Number(currentProduct.min_screen_ratio??.042),m=Math.max(w,h,1);if(m<min){const b=min/m;w*=b;h*=b}}const L={x:pose.left.x,y:pose.left.y+manualY},R={x:pose.right.x,y:pose.right.y+manualY};if(selectedSide==='left'||selectedSide==='both')updateRig(rigs.left,'left',L,w,h,pose,clamp(1-Math.max(0,pose.yaw)*.18,.8,1));else rigs.left.visible=false;if(selectedSide==='right'||selectedSide==='both')updateRig(rigs.right,'right',R,w,h,pose,clamp(1+Math.min(0,pose.yaw)*.18,.8,1));else rigs.right.visible=false;renderer.render(scene,arCamera)}

async function captureSnapshot(){if(!running)return toast('請先開啟相機');const r=video.getBoundingClientRect(),d=Math.min(devicePixelRatio||1,2),out=document.createElement('canvas');out.width=Math.round(r.width*d);out.height=Math.round(r.height*d);const c=out.getContext('2d');c.setTransform(d,0,0,d,0,0);const t=cover(video.videoWidth,video.videoHeight,r.width,r.height);c.save();c.translate(r.width,0);c.scale(-1,1);c.drawImage(video,t.x,t.y,video.videoWidth*t.s,video.videoHeight*t.s);c.drawImage(renderer.domElement,0,0,renderer.domElement.width,renderer.domElement.height,0,0,r.width,r.height);c.restore();const blob=await new Promise(ok=>out.toBlob(ok,'image/png',.96));if(!blob)return;const file=new File([blob],`WRINES_AR_${currentProduct.sku}_${Date.now()}.png`,{type:'image/png'});if(navigator.canShare?.({files:[file]})){try{await navigator.share({files:[file],title:'W.RINES AR Try-On'});return}catch(e){if(e?.name==='AbortError')return}}const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=file.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1200)}

function predict(){if(!running)return;resize();if(landmarker&&video.readyState>=2&&video.currentTime!==lastVideoTime){lastVideoTime=video.currentTime;try{const result=landmarker.detectForVideo(video,performance.now());if(result.faceLandmarks?.length){guide.classList.add('hidden');statusEl.textContent='已偵測臉部';renderAR(result.faceLandmarks[0])}else{guide.classList.remove('hidden');statusEl.textContent='尋找臉部';rigs.left.visible=rigs.right.visible=false;renderer.render(scene,arCamera)}}catch(e){console.error(e);statusEl.textContent='臉部辨識錯誤'}}requestAnimationFrame(predict)}

loadCatalog();window.addEventListener('resize',resize);window.addEventListener('pagehide',stopCamera);
