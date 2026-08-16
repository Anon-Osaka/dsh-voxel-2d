/**
 * dsh-voxel-2d — 网页导出层。
 *
 * 让插件不只停留在“对话内体素工具”，还能生成可双击打开的独立 HTML + Three.js 单页应用。
 * 目前提供：
 * - exportVoxelWebApp：把当前体素世界导出为 3D 查看器
 * - exportCubeWebApp：导出 3×3 魔方网页应用骨架（旋转 / 层转按钮 / 求解播放接口）
 */
import { VoxelWorld, BLOCK_COLORS } from './world.js'

export function exportVoxelWebApp(world: VoxelWorld, title = 'Voxel Viewer'): string {
  const blocks: Array<{ x: number; y: number; z: number; c: string }> = []
  for (const [x, y, z] of world.coords()) {
    const t = world.get(x, y, z) ?? 'stone'
    blocks.push({ x, y, z, c: BLOCK_COLORS[t] ?? BLOCK_COLORS.default })
  }
  const data = JSON.stringify(blocks)
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>${title}</title>
<style>body{margin:0;overflow:hidden;background:#141a2a;color:#eee;font-family:ui-sans-serif,system-ui,sans-serif} #info{position:absolute;top:12px;left:12px;background:rgba(0,0,0,.5);padding:8px 12px;border-radius:8px;font-size:13px} canvas{display:block}</style>
</head>
<body>
<div id="info">🧊 ${title} · 鼠标拖拽旋转 / 滚轮缩放</div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"><\/script>
<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js"><\/script>
<script>
const BLOCKS = ${data};
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x141a2a);
const camera = new THREE.PerspectiveCamera(45, innerWidth/innerHeight, 0.1, 100);
camera.position.set(10, 8, 12);
const renderer = new THREE.WebGLRenderer({antialias:true});
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(devicePixelRatio);
document.body.appendChild(renderer.domElement);
scene.add(new THREE.HemisphereLight(0xfff2dd, 0x443322, 1.2));
scene.add(new THREE.DirectionalLight(0xffeedd, 1.4));
const controls = new THREE.OrbitControls(camera, renderer.domElement);
const group = new THREE.Group();
scene.add(group);
const geo = new THREE.BoxGeometry(0.96,0.96,0.96);
for (const b of BLOCKS) {
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({color:b.c, roughness:.6}));
  m.position.set(b.x, b.y, b.z);
  group.add(m);
}
const grid = new THREE.GridHelper(20, 20, 0x666666, 0x333333);
grid.position.y = -0.5;
scene.add(grid);
function animate(){ requestAnimationFrame(animate); controls.update(); renderer.render(scene,camera); }
animate();
addEventListener('resize', ()=>{ camera.aspect=innerWidth/innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth,innerHeight); });
</script>
</body>
</html>`
}

export function exportCubeWebApp(title = 'Rubik Cube 3x3'): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>${title}</title>
<style>body{margin:0;overflow:hidden;background:#10131a;color:#eee;font-family:ui-sans-serif,system-ui,sans-serif} #ui{position:absolute;top:12px;left:12px;background:rgba(0,0,0,.55);padding:10px 14px;border-radius:10px;font-size:13px;max-width:260px} #ui button{margin:3px;padding:5px 10px;border-radius:6px;border:1px solid rgba(255,255,255,.25);background:#1d2433;color:#fff;cursor:pointer} #ui button:hover{background:#2a3450} #log{margin-top:8px;opacity:.85;font-family:monospace;white-space:pre-wrap;max-height:120px;overflow:auto} canvas{display:block}</style>
</head>
<body>
<div id="ui">
  <b>🧩 ${title}</b>
  <div style="margin-top:8px">
    <button onclick="doMove('U')">U</button><button onclick="doMove('U\\'')">U'</button>
    <button onclick="doMove('D')">D</button><button onclick="doMove('D\\'')">D'</button>
    <button onclick="doMove('L')">L</button><button onclick="doMove('L\\'')">L'</button>
    <button onclick="doMove('R')">R</button><button onclick="doMove('R\\'')">R'</button>
    <button onclick="doMove('F')">F</button><button onclick="doMove('F\\'')">F'</button>
    <button onclick="doMove('B')">B</button><button onclick="doMove('B\\'')">B'</button>
  </div>
  <div style="margin-top:8px">
    <button onclick="scramble()">🎲 打乱</button>
    <button onclick="solve()">▶ 求解播放</button>
    <button onclick="resetCube()">↺ 重置</button>
  </div>
  <div id="log">就绪</div>
</div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"><\/script>
<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js"><\/script>
<script>
// ── 3x3 魔方骨架：自由旋转 + 层转按钮 + 求解播放接口 ──
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x10131a);
const camera = new THREE.PerspectiveCamera(45, innerWidth/innerHeight, 0.1, 100);
camera.position.set(6, 5, 8);
const renderer = new THREE.WebGLRenderer({antialias:true});
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(devicePixelRatio);
document.body.appendChild(renderer.domElement);
scene.add(new THREE.HemisphereLight(0xffffff, 0x404060, 1.1));
scene.add(new THREE.DirectionalLight(0xffffff, 1.3));
const controls = new THREE.OrbitControls(camera, renderer.domElement);
const group = new THREE.Group();
scene.add(group);

const C = {
  R: 0xe33b3b, L: 0xff8c1a, U: 0xf5f5f5, D: 0xffd500,
  F: 0x2e9e5b, B: 0x3b6fe0, I: 0x222222
};
const cubies = [];
for (let x=-1; x<=1; x++) for (let y=-1; y<=1; y++) for (let z=-1; z<=1; z++) {
  if (Math.abs(x)+Math.abs(y)+Math.abs(z) === 0) continue;
  const mats = [
    new THREE.MeshStandardMaterial({color: x===1 ? C.R : C.I}),
    new THREE.MeshStandardMaterial({color: x===-1 ? C.L : C.I}),
    new THREE.MeshStandardMaterial({color: y===1 ? C.U : C.I}),
    new THREE.MeshStandardMaterial({color: y===-1 ? C.D : C.I}),
    new THREE.MeshStandardMaterial({color: z===1 ? C.F : C.I}),
    new THREE.MeshStandardMaterial({color: z===-1 ? C.B : C.I})
  ];
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.94,0.94,0.94), mats);
  mesh.position.set(x,y,z);
  group.add(mesh);
  cubies.push({mesh, x, y, z});
}
group.scale.setScalar(1.2);
group.position.y = 0;

let queue = [];
let playing = false;
const logEl = document.getElementById('log');
function log(s){ logEl.textContent = s; }

function rotateLayer(axis, layer, angle) {
  const affected = cubies.filter(c => axis==='x' ? c.x===layer : axis==='y' ? c.y===layer : c.z===layer);
  const pivot = new THREE.Group();
  group.add(pivot);
  affected.forEach(c => pivot.attach(c.mesh));
  const q = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(axis==='x'?1:0, axis==='y'?1:0, axis==='z'?1:0),
    angle
  );
  pivot.quaternion.multiply(q);
  pivot.updateMatrixWorld();
  affected.forEach(c => {
    group.attach(c.mesh);
    const p = c.mesh.position;
    c.x = Math.round(p.x); c.y = Math.round(p.y); c.z = Math.round(p.z);
  });
  group.remove(pivot);
}

function doMove(name) {
  const prime = name.endsWith("'");
  const m = prime ? name.slice(0,1) : name;
  const angle = (Math.PI/2) * (prime ? -1 : 1);
  const axis = m==='U'||m==='D' ? 'y' : m==='L'||m==='R' ? 'x' : 'z';
  const layer = m==='U'||m==='R'||m==='F' ? 1 : m==='D'||m==='L'||m==='B' ? -1 : 0;
  rotateLayer(axis, layer, angle);
  log('执行 ' + name);
}
const MOVES = ['U',"U'",'D',"D'",'L',"L'",'R',"R'",'F',"F'",'B',"B'"];
function scramble(){ const seq=[]; for(let i=0;i<20;i++) seq.push(MOVES[Math.floor(Math.random()*MOVES.length)]); playSeq(seq,'打乱'); }
function solve(){ const seq=['R',"U'",'R','U','R','U','R',"U'"]; playSeq(seq,'求解播放（骨架示例序列）'); }
function resetCube(){ location.reload(); }
function playSeq(seq, label){
  if (playing) return;
  playing = true;
  log(label + ': ' + seq.join(' '));
  let i = 0;
  const timer = setInterval(()=>{
    if (i >= seq.length) { clearInterval(timer); playing=false; log(label + ' 完成'); return; }
    doMove(seq[i]); i++;
  }, 300);
}
function animate(){ requestAnimationFrame(animate); controls.update(); renderer.render(scene,camera); }
animate();
addEventListener('resize', ()=>{ camera.aspect=innerWidth/innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth,innerHeight); });
</script>
</body>
</html>`
}

export function exportPbrWaterWebApp(title = 'PBR Water Scene'): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>${title}</title>
<style>body{margin:0;overflow:hidden;background:#0b0e14;color:#fff;font-family:ui-sans-serif,system-ui,sans-serif} #info{position:absolute;top:12px;left:12px;background:rgba(0,0,0,.5);padding:8px 12px;border-radius:8px;font-size:13px} canvas{display:block}</style>
</head>
<body>
<div id="info">🌊 ${title} · PBR 光照 / 水面反射 / 自由视角</div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"><\/script>
<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js"><\/script>
<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/objects/Reflector.js"><\/script>
<script>
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0e14);
scene.fog = new THREE.Fog(0x0b0e14, 30, 80);
const camera = new THREE.PerspectiveCamera(50, innerWidth/innerHeight, 0.1, 200);
camera.position.set(14, 8, 16);
camera.lookAt(0, 1, 0);
const renderer = new THREE.WebGLRenderer({antialias:true});
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

// ── 灯光 ──
const hemi = new THREE.HemisphereLight(0xbfd9ff, 0x2a3a4a, 1.1);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff2d0, 2.2);
sun.position.set(12, 20, 8);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
scene.add(sun);
const fill = new THREE.PointLight(0x88ccff, 0.8, 40);
fill.position.set(-8, 6, -6);
scene.add(fill);

// ── 水面反射（Reflector 做平面反射，近似 SSR） ──
const waterGeo = new THREE.PlaneGeometry(40, 40);
const water = new THREE.Reflector(waterGeo, {
  clipBias: 0.003,
  textureWidth: 1024,
  textureHeight: 1024,
  color: 0x2a6f8f
});
water.rotation.x = -Math.PI / 2;
water.position.y = 0;
scene.add(water);

// ── PBR 物体 ──
const addPbr = (geo, color, metalness, roughness, x, y, z, scale=1) => {
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({color, metalness, roughness, envMapIntensity:1}));
  m.position.set(x, y, z);
  m.scale.setScalar(scale);
  m.castShadow = true;
  m.receiveShadow = true;
  scene.add(m);
  return m;
};
addPbr(new THREE.SphereGeometry(1.2, 64, 64), 0x8a7f6a, 0.1, 0.85, -4, 1.2, -3, 1.4);
addPbr(new THREE.CylinderGeometry(1.4, 1.8, 2.4, 32), 0x6b5e4a, 0.05, 0.9, 0, 1.2, 0, 1);
addPbr(new THREE.TorusKnotGeometry(0.9, 0.3, 128, 16), 0xc9a86a, 1.0, 0.25, 4, 2.2, 2, 0.8);
addPbr(new THREE.BoxGeometry(1.6, 1.6, 1.6), 0x4a6fa5, 0.35, 0.6, 6, 0.8, -4, 1);

// 水底网格/地面
const ground = new THREE.Mesh(
  new THREE.CircleGeometry(30, 48),
  new THREE.MeshStandardMaterial({color:0x1a2b33, roughness:0.95, metalness:0})
);
ground.rotation.x = -Math.PI/2;
ground.position.y = -0.05;
ground.receiveShadow = true;
scene.add(ground);

const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1, 0);
controls.maxPolarAngle = Math.PI * 0.48;
controls.enableDamping = true;
controls.update();

function animate(){
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();
addEventListener('resize', ()=>{
  camera.aspect = innerWidth/innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
</script>
</body>
</html>`
}
