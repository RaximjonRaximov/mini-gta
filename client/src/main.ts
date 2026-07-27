import * as THREE from 'three';
import { decodeSnapshot, encodeInput, decodeSeed, decodeVehicleEvent, decodeKillEvent, decodeWantedEvent, decodeMoneyEvent, generateCity, InputKey, Op, WORLD_SIZE, playerColor, vehicleColor, type EntityDelta, type Snapshot, type City, type RoomInfo, type CreateRoomRequest, type JoinRoomRequest } from '@mini-gta/shared';
import { playShoot, playExplosion, setMuted, isMuted } from './audio.js';
import { t, setLang, getLang, type Lang } from './i18n.js';

const canvas = document.getElementById('game') as HTMLCanvasElement;

const lobby = document.getElementById('lobby') as HTMLDivElement;
const hud = document.getElementById('hud') as HTMLDivElement;
const help = document.getElementById('help') as HTMLDivElement;

const playerNameEl = document.getElementById('player-name') as HTMLInputElement;
const btnHost = document.getElementById('btn-host') as HTMLButtonElement;
const btnJoin = document.getElementById('btn-join') as HTMLButtonElement;
const hostPanel = document.getElementById('host-panel') as HTMLDivElement;
const joinPanel = document.getElementById('join-panel') as HTMLDivElement;
const mapNameEl = document.getElementById('map-name') as HTMLInputElement;
const maxPlayersEl = document.getElementById('max-players') as HTMLSelectElement;
const roomPasswordEl = document.getElementById('room-password') as HTMLInputElement;
const btnCreate = document.getElementById('btn-create') as HTMLButtonElement;
const joinCodeEl = document.getElementById('join-code') as HTMLInputElement;
const btnJoinCode = document.getElementById('btn-join-code') as HTMLButtonElement;
const roomListEl = document.getElementById('room-list') as HTMLDivElement;

const fpsEl = document.getElementById('fps') as HTMLDivElement;
const pingEl = document.getElementById('ping') as HTMLDivElement;
const playersEl = document.getElementById('players') as HTMLDivElement;
const wantedEl = document.getElementById('wanted') as HTMLDivElement;
const moneyEl = document.getElementById('money') as HTMLDivElement;
const killFeedEl = document.getElementById('kill-feed') as HTMLDivElement;
const muteBtn = document.getElementById('mute-btn') as HTMLButtonElement;
const langBtn = document.getElementById('lang-btn') as HTMLButtonElement;
const touchControls = document.getElementById('touch-controls') as HTMLDivElement;
const joystick = document.getElementById('joystick') as HTMLDivElement;
const joystickKnob = document.getElementById('joystick-knob') as HTMLDivElement;
const touchFire = document.getElementById('touch-fire') as HTMLDivElement;
const touchEnter = document.getElementById('touch-enter') as HTMLDivElement;

const keys: Record<string, boolean> = {};
let mouseX = 0;
let mouseY = 0;
let firing = false;
let wasFiring = false;

muteBtn.addEventListener('click', () => {
  setMuted(!isMuted());
  muteBtn.textContent = isMuted() ? '🔇' : '🔊';
});

function applyLang(): void {
  langBtn.textContent = getLang().toUpperCase();
  help.textContent = t('help');
  btnHost.textContent = t('host');
  btnJoin.textContent = t('join');
  btnCreate.textContent = t('create');
  btnJoinCode.textContent = t('joinCode');
  playerNameEl.placeholder = t('namePlaceholder');
  mapNameEl.placeholder = t('mapPlaceholder');
}

langBtn.addEventListener('click', () => {
  const next: Lang = getLang() === 'uz' ? 'en' : 'uz';
  setLang(next);
  applyLang();
});

let joyTouchId: number | null = null;
function updateJoystick(touch: Touch): void {
  const rect = joystick.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const dx = touch.clientX - cx;
  const dy = touch.clientY - cy;
  const dist = Math.hypot(dx, dy);
  const max = rect.width / 2 - 20;
  const scale = dist > max ? max / dist : 1;
  joystickKnob.style.transform = `translate(${dx * scale}px, ${dy * scale}px)`;
  keys['KeyW'] = dy < -10; keys['KeyS'] = dy > 10; keys['KeyA'] = dx < -10; keys['KeyD'] = dx > 10;
}
function resetJoystick(): void {
  joystickKnob.style.transform = '';
  keys['KeyW'] = false; keys['KeyS'] = false; keys['KeyA'] = false; keys['KeyD'] = false;
  joyTouchId = null;
}
joystick.addEventListener('touchstart', (e) => {
  e.preventDefault();
  const t = e.changedTouches[0]; joyTouchId = t.identifier; updateJoystick(t);
}, { passive: false });
joystick.addEventListener('touchmove', (e) => {
  e.preventDefault();
  for (const t of e.changedTouches) if (t.identifier === joyTouchId) updateJoystick(t);
}, { passive: false });
joystick.addEventListener('touchend', (e) => {
  e.preventDefault();
  for (const t of e.changedTouches) if (t.identifier === joyTouchId) resetJoystick();
}, { passive: false });
joystick.addEventListener('touchcancel', (e) => { e.preventDefault(); resetJoystick(); }, { passive: false });

touchFire.addEventListener('touchstart', (e) => { e.preventDefault(); firing = true; }, { passive: false });
touchFire.addEventListener('touchend', (e) => { e.preventDefault(); firing = false; }, { passive: false });
touchFire.addEventListener('touchcancel', (e) => { e.preventDefault(); firing = false; }, { passive: false });

touchEnter.addEventListener('touchstart', (e) => { e.preventDefault(); keys['Space'] = true; }, { passive: false });
touchEnter.addEventListener('touchend', (e) => { e.preventDefault(); keys['Space'] = false; }, { passive: false });
touchEnter.addEventListener('touchcancel', (e) => { e.preventDefault(); keys['Space'] = false; }, { passive: false });

window.addEventListener('touchstart', (e) => {
  for (const t of e.changedTouches) {
    if (t.target === touchFire || t.target === touchEnter || t.target === joystick || t.target === joystickKnob) continue;
    mouseX = t.clientX; mouseY = t.clientY;
  }
}, { passive: true });
window.addEventListener('touchmove', (e) => {
  for (const t of e.changedTouches) {
    if (t.target === touchFire || t.target === touchEnter || t.target === joystick || t.target === joystickKnob) continue;
    mouseX = t.clientX; mouseY = t.clientY;
  }
}, { passive: true });

window.addEventListener('keydown', (e) => { keys[e.code] = true; });
window.addEventListener('keyup', (e) => { keys[e.code] = false; });
window.addEventListener('mousedown', () => { firing = true; });
window.addEventListener('mouseup', () => { firing = false; });
window.addEventListener('mousemove', (e) => { mouseX = e.clientX; mouseY = e.clientY; });

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}

// --- Three.js scene ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 1500, 6000);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 1, 20000);
camera.position.set(0, 300, -300);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
window.addEventListener('resize', resize);
resize();

const ambient = new THREE.AmbientLight(0xffffff, 0.55);
scene.add(ambient);
const sun = new THREE.DirectionalLight(0xffffff, 1.1);
sun.position.set(2000, 2500, 1000);
scene.add(sun.target);
sun.castShadow = true;
sun.shadow.mapSize.width = 2048;
sun.shadow.mapSize.height = 2048;
sun.shadow.camera.left = -500;
sun.shadow.camera.right = 500;
sun.shadow.camera.top = 500;
sun.shadow.camera.bottom = -500;
sun.shadow.camera.far = 5000;
scene.add(sun);

const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const aimTarget = new THREE.Vector3();

let cityGroup: THREE.Group | null = null;

function buildCity(city: City): void {
  if (cityGroup) { scene.remove(cityGroup); cityGroup = null; }
  cityGroup = new THREE.Group();
  const half = city.worldSize / 2;

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(city.worldSize, city.worldSize),
    new THREE.MeshLambertMaterial({ color: 0x14261f }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(half, 0, half);
  ground.receiveShadow = true;
  cityGroup.add(ground);

  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const matrix = new THREE.Matrix4();

  const roadMat = new THREE.MeshLambertMaterial({ color: 0x334155 });
  const roads = new THREE.InstancedMesh(boxGeo, roadMat, city.roads.length);
  roads.receiveShadow = true;
  for (let i = 0; i < city.roads.length; i++) {
    const r = city.roads[i];
    matrix.makeTranslation(r.x + r.w / 2, 0.5, r.y + r.h / 2).scale(new THREE.Vector3(r.w, 1, r.h));
    roads.setMatrixAt(i, matrix);
  }
  roads.instanceMatrix.needsUpdate = true;
  cityGroup.add(roads);

  const buildingMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const buildings = new THREE.InstancedMesh(boxGeo, buildingMat, city.buildings.length);
  buildings.castShadow = true;
  buildings.receiveShadow = true;
  for (let i = 0; i < city.buildings.length; i++) {
    const b = city.buildings[i];
    const h = b.height ?? 60;
    const c = b.color ?? 0x475569;
    matrix.makeTranslation(b.x + b.w / 2, h / 2, b.y + b.h / 2).scale(new THREE.Vector3(b.w, h, b.h));
    buildings.setMatrixAt(i, matrix);
    buildings.setColorAt(i, new THREE.Color(c));
  }
  buildings.instanceMatrix.needsUpdate = true;
  if (buildings.instanceColor) buildings.instanceColor.needsUpdate = true;
  cityGroup.add(buildings);

  scene.add(cityGroup);
}

// --- procedural character models ---
const sharedGeometries = {
  wheel: new THREE.CylinderGeometry(3, 3, 2, 14),
  beak: new THREE.ConeGeometry(1, 2, 8),
};
sharedGeometries.wheel.rotateZ(Math.PI / 2);

function createHumanoidMesh(skinColor: number, shirtColor: number, pantsColor: number, isPolice = false): THREE.Group {
  const g = new THREE.Group();
  const skin = new THREE.MeshLambertMaterial({ color: skinColor });
  const shirt = new THREE.MeshLambertMaterial({ color: shirtColor });
  const pants = new THREE.MeshLambertMaterial({ color: pantsColor });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(10, 14, 6), shirt);
  torso.position.y = 18;
  torso.castShadow = false;
  g.add(torso);

  const head = new THREE.Mesh(new THREE.SphereGeometry(4.5, 14, 14), skin);
  head.position.y = 28;
  g.add(head);

  const makeLimb = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Group => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, z);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.y = -h / 2;
    mesh.castShadow = false;
    pivot.add(mesh);
    return pivot;
  };

  const leftLeg = makeLimb(3.5, 12, 4, pants, -2.5, 12, 0);
  const rightLeg = makeLimb(3.5, 12, 4, pants, 2.5, 12, 0);
  const leftArm = makeLimb(3, 12, 3, shirt, -6, 24, 0);
  const rightArm = makeLimb(3, 12, 3, shirt, 6, 24, 0);

  // weapon / barrel in right hand
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 16), new THREE.MeshLambertMaterial({ color: 0x111827 }));
  barrel.position.set(0, -10, 8);
  rightArm.children[0].add(barrel);

  g.add(leftLeg, rightLeg, leftArm, rightArm);

  if (isPolice) {
    const hat = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 3, 14), new THREE.MeshLambertMaterial({ color: 0x1f2937 }));
    hat.position.y = 33;
    g.add(hat);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(2, 4, 8), new THREE.MeshLambertMaterial({ color: 0xef4444 }));
    cone.position.y = 36;
    g.add(cone);
  }

  g.userData = { isHumanoid: true, baseY: 0, walkPhase: 0, leftLeg, rightLeg, leftArm, rightArm, head, torso };
  return g;
}

function createVehicleMesh(color: number): THREE.Group {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color });
  const body = new THREE.Mesh(new THREE.BoxGeometry(38, 12, 20), bodyMat);
  body.name = 'body';
  body.position.y = 10;
  body.castShadow = false;
  g.add(body);

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(20, 8, 18), new THREE.MeshLambertMaterial({ color: 0x87ceeb, transparent: true, opacity: 0.45, depthWrite: false }));
  cabin.position.set(0, 20, -2);
  g.add(cabin);

  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x111827 });
  const wheels: THREE.Mesh[] = [];
  const positions = [[-12, 3, -8], [12, 3, -8], [-12, 3, 8], [12, 3, 8]];
  for (const [wx, wy, wz] of positions) {
    const w = new THREE.Mesh(sharedGeometries.wheel, wheelMat);
    w.position.set(wx, wy, wz);
    w.castShadow = false;
    g.add(w);
    wheels.push(w);
  }
  g.userData = { isVehicle: true, baseY: 0, wheels };
  return g;
}

function createChickenMesh(): THREE.Group {
  const g = new THREE.Group();
  const yellow = new THREE.MeshLambertMaterial({ color: 0xfacc15 });
  const orange = new THREE.MeshLambertMaterial({ color: 0xf97316 });

  const body = new THREE.Mesh(new THREE.SphereGeometry(5, 12, 12), yellow);
  body.position.y = 7;
  g.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(2.5, 10, 10), yellow);
  head.position.set(0, 11, 3);
  g.add(head);

  const beak = new THREE.Mesh(sharedGeometries.beak, orange);
  beak.rotation.x = Math.PI / 2;
  beak.position.set(0, 11, 5);
  g.add(beak);

  const legGeo = new THREE.CylinderGeometry(0.6, 0.6, 4, 8);
  const lLeg = new THREE.Mesh(legGeo, orange); lLeg.position.set(-1.5, 2, 0);
  const rLeg = new THREE.Mesh(legGeo, orange); rLeg.position.set(1.5, 2, 0);
  g.add(lLeg, rLeg);

  const wing = new THREE.Mesh(new THREE.BoxGeometry(0.8, 3, 4), yellow);
  wing.position.set(3.5, 7, 0);
  g.add(wing);
  const wing2 = wing.clone(); wing2.position.set(-3.5, 7, 0);
  g.add(wing2);

  g.userData = { isChicken: true, baseY: 0 };
  return g;
}

const localPlayerMesh = createHumanoidMesh(0xf5d0a9, 0x22c55e, 0x1e293b);
const localVehicleMesh = createVehicleMesh(0xef4444);
localPlayerMesh.visible = false;
localVehicleMesh.visible = false;
scene.add(localPlayerMesh, localVehicleMesh);

function animateHumanoid(mesh: THREE.Group, speed: number, dt: number): void {
  const u = mesh.userData as { baseY: number; walkPhase: number; leftLeg: THREE.Group; rightLeg: THREE.Group; leftArm: THREE.Group; rightArm: THREE.Group };
  if (speed > 5) u.walkPhase += speed * dt * 0.04;
  else u.walkPhase *= 0.85;
  const swing = Math.sin(u.walkPhase) * 0.55;
  u.leftLeg.rotation.x = swing;
  u.rightLeg.rotation.x = -swing;
  u.leftArm.rotation.x = -swing * 0.7;
  u.rightArm.rotation.x = swing * 0.7;
  const bob = Math.abs(Math.sin(u.walkPhase * 2)) * 1.2 * Math.min(speed / 200, 1);
  mesh.position.y = u.baseY + bob;
}

function animateVehicle(mesh: THREE.Group, speed: number, dt: number): void {
  const wheels = mesh.userData.wheels as THREE.Mesh[];
  const angular = (speed * dt) / 3;
  for (const w of wheels) w.rotation.x += angular;
}

// --- netcode state ---
let ws: WebSocket | null = null;
let localPlayerId = -1;
let inputSeq = 0;
let lastPingSent = 0;
let pingMs = 0;

interface RemoteEntity {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  hp: number;
  color: number;
  lastUpdated: number;
  prevX: number;
  prevY: number;
  prevTime: number;
  mesh?: THREE.Object3D;
}

const entities = new Map<number, RemoteEntity>();
const pendingInputs: { seq: number; keys: number; angle: number; x: number; y: number; vx: number; vy: number }[] = [];

let localState = { x: WORLD_SIZE / 2, y: WORLD_SIZE / 2, vx: 0, vy: 0, angle: 0, hp: 100 };
let serverState = { x: WORLD_SIZE / 2, y: WORLD_SIZE / 2, vx: 0, vy: 0, angle: 0, hp: 100 };
let receivedAck = 0;

let lastSnapshotTime = performance.now();
let lastRender = performance.now();
let fps = 0;
let city: City | null = null;
let localVehicleId = 0;
let localWanted = 0;
let localMoney = 0;
const idToName = new Map<number, string>();

function setWanted(level: number): void {
  localWanted = level;
  wantedEl.textContent = 'Wanted: ' + (level ? '★'.repeat(level) : '0');
}

function setMoney(amount: number): void {
  localMoney = amount;
  moneyEl.textContent = 'Money: $' + amount;
}

function addKillFeed(killerId: number, victimId: string | number): void {
  killFeedEl.classList.remove('hidden');
  const row = document.createElement('div');
  row.className = 'row';
  const k = idToName.get(killerId) || `Player ${killerId}`;
  const v = typeof victimId === 'string' ? victimId : (idToName.get(victimId) || `Player ${victimId}`);
  row.textContent = `${k} → ${v}`;
  killFeedEl.appendChild(row);
  if (killFeedEl.children.length > 5) killFeedEl.removeChild(killFeedEl.firstChild!);
  setTimeout(() => { if (killFeedEl.contains(row)) killFeedEl.removeChild(row); }, 5000);
}

function currentAimAngle(): number {
  mouse.x = (mouseX / window.innerWidth) * 2 - 1;
  mouse.y = -(mouseY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  if (!raycaster.ray.intersectPlane(groundPlane, aimTarget)) return localState.angle;
  return Math.atan2(aimTarget.z - localState.y, aimTarget.x - localState.x);
}

function buildInputPacket(): ArrayBuffer {
  let k = 0;
  if (keys['KeyW'] || keys['ArrowUp']) k |= InputKey.Up;
  if (keys['KeyS'] || keys['ArrowDown']) k |= InputKey.Down;
  if (keys['KeyA'] || keys['ArrowLeft']) k |= InputKey.Left;
  if (keys['KeyD'] || keys['ArrowRight']) k |= InputKey.Right;
  if (keys['ShiftLeft'] || keys['ShiftRight']) k |= InputKey.Sprint;
  if (firing) k |= InputKey.Fire;
  if (keys['Space']) k |= InputKey.EnterExit;
  if (keys['KeyE']) k |= InputKey.Interact;
  if (firing && !wasFiring) playShoot();
  wasFiring = firing;
  const angle = currentAimAngle();
  inputSeq = (inputSeq + 1) % 65536;
  return encodeInput(inputSeq, k, 0, angle);
}

function applyLocalInput(dt: number, keys: number, angle: number): void {
  if (localState.hp <= 0) return;
  if (localVehicleId) {
    let throttle = 0, steer = 0;
    if (keys & InputKey.Up) throttle += 1;
    if (keys & InputKey.Down) throttle -= 1;
    if (keys & InputKey.Left) steer -= 1;
    if (keys & InputKey.Right) steer += 1;
    const speed = Math.hypot(localState.vx, localState.vy);
    if (speed < 500) {
      localState.vx += Math.cos(localState.angle) * 700 * throttle * dt;
      localState.vy += Math.sin(localState.angle) * 700 * throttle * dt;
    }
    if (speed > 10) localState.angle += steer * 1.6 * (speed / 500) * dt;
    localState.vx *= 0.95;
    localState.vy *= 0.95;
    localState.x += localState.vx * dt;
    localState.y += localState.vy * dt;
    localState.x = Math.max(16, Math.min(WORLD_SIZE - 16, localState.x));
    localState.y = Math.max(16, Math.min(WORLD_SIZE - 16, localState.y));
    return;
  }
  const speed = (keys & InputKey.Sprint) ? 450 : 250;
  let nx = 0, ny = 0;
  if (keys & InputKey.Up) ny += 1;
  if (keys & InputKey.Down) ny -= 1;
  if (keys & InputKey.Left) nx -= 1;
  if (keys & InputKey.Right) nx += 1;
  localState.angle = angle;
  if (nx !== 0 || ny !== 0) {
    const len = Math.hypot(nx, ny);
    nx /= len; ny /= len;
    const fx = Math.cos(localState.angle);
    const fy = Math.sin(localState.angle);
    const rx = Math.sin(localState.angle);
    const ry = -Math.cos(localState.angle);
    const ax = ny * fx + nx * rx;
    const ay = ny * fy + nx * ry;
    localState.vx += ax * speed * 10 * dt;
    localState.vy += ay * speed * 10 * dt;
  }
  localState.vx *= 0.85;
  localState.vy *= 0.85;
  localState.x += localState.vx * dt;
  localState.y += localState.vy * dt;
  localState.x = Math.max(16, Math.min(WORLD_SIZE - 16, localState.x));
  localState.y = Math.max(16, Math.min(WORLD_SIZE - 16, localState.y));
}

function reconcile(): void {
  const idx = pendingInputs.findIndex(i => i.seq === receivedAck);
  if (idx < 0) {
    localState.x += (serverState.x - localState.x) * 0.1;
    localState.y += (serverState.y - localState.y) * 0.1;
    return;
  }
  const last = pendingInputs[idx];
  const dx = serverState.x - last.x;
  const dy = serverState.y - last.y;
  const dvx = serverState.vx - last.vx;
  const dvy = serverState.vy - last.vy;
  if (Math.hypot(dx, dy) > 4 || Math.hypot(dvx, dvy) > 8) {
    localState.x = serverState.x;
    localState.y = serverState.y;
    localState.vx = serverState.vx;
    localState.vy = serverState.vy;
    pendingInputs.splice(0, idx + 1);
    return;
  }
  localState.x += dx;
  localState.y += dy;
  localState.vx += dvx;
  localState.vy += dvy;
  pendingInputs.splice(0, idx + 1);
}

function onSnapshot(buf: ArrayBuffer): void {
  const snap = decodeSnapshot(buf);
  receivedAck = snap.ackSeq;
  lastSnapshotTime = performance.now();

  let foundLocal = false;
  let playerCount = 0;
  for (const e of snap.entities) {
    if (e.id === localPlayerId) {
      foundLocal = true;
      serverState.x = e.x ?? serverState.x;
      serverState.y = e.y ?? serverState.y;
      serverState.vx = e.vx ?? serverState.vx;
      serverState.vy = e.vy ?? serverState.vy;
      serverState.angle = e.angle ?? serverState.angle;
      serverState.hp = e.hp ?? serverState.hp;
      continue;
    }
    if ((e.color ?? 0) < 100) playerCount++;
    const now = performance.now();
    const ex = entities.get(e.id);
    if (ex) {
      ex.prevX = ex.x; ex.prevY = ex.y; ex.prevTime = ex.lastUpdated;
      ex.x = e.x ?? ex.x; ex.y = e.y ?? ex.y; ex.angle = e.angle ?? ex.angle;
      ex.hp = e.hp ?? ex.hp; ex.color = e.color ?? ex.color;
      ex.vx = e.vx ?? ex.vx; ex.vy = e.vy ?? ex.vy;
      ex.lastUpdated = now;
    } else {
      entities.set(e.id, {
        id: e.id, x: e.x ?? 0, y: e.y ?? 0, angle: e.angle ?? 0,
        vx: e.vx ?? 0, vy: e.vy ?? 0,
        hp: e.hp ?? 100, color: e.color ?? 0x22c55e,
        lastUpdated: now, prevX: e.x ?? 0, prevY: e.y ?? 0, prevTime: now,
      });
    }
  }
  if (foundLocal) {
    const prevHp = localState.hp;
    localState.hp = serverState.hp;
    if (localState.hp <= 0 && prevHp > 0) playExplosion();
    reconcile();
  }
  if (foundLocal) playerCount++;
  playersEl.textContent = `Players: ${playerCount}`;
}

function connect(wsUrl: string, name: string, roomId: string): void {
  if (ws) ws.close();
  const url = `${wsUrl}&name=${encodeURIComponent(name)}`;
  ws = new WebSocket(url);
  ws.binaryType = 'arraybuffer';
  ws.onopen = () => {
    lobby.classList.add('hidden');
    hud.classList.remove('hidden');
    help.classList.remove('hidden');
    killFeedEl.classList.remove('hidden');
    muteBtn.classList.remove('hidden');
    langBtn.classList.remove('hidden');
    if ('ontouchstart' in window) touchControls.classList.remove('hidden');
    setWanted(0);
    setMoney(0);
    killFeedEl.innerHTML = '';
    lastPingSent = performance.now();
    const ping = new ArrayBuffer(1); new Uint8Array(ping)[0] = Op.Ping; ws!.send(ping);
  };
  ws.onmessage = (ev) => {
    if (ev.data instanceof ArrayBuffer) {
      const v = new DataView(ev.data);
      const op = v.getUint8(0);
      if (op === Op.Snapshot) onSnapshot(ev.data);
      else if (op === Op.Pong) {
        pingMs = performance.now() - lastPingSent;
        pingEl.textContent = `Ping: ${Math.round(pingMs)}ms`;
      } else if (op === Op.AssignId) {
        localPlayerId = v.getUint16(1, true);
        entities.delete(localPlayerId);
        localPlayerMesh.visible = true;
      } else if (op === Op.Event) {
        const sub = v.getUint8(1);
        if (sub === 0x01) {
          const seed = decodeSeed(ev.data);
          city = generateCity(seed);
          buildCity(city);
        } else if (sub === 0x02) {
          localVehicleId = decodeVehicleEvent(ev.data);
          const body = localVehicleMesh.getObjectByName('body') as THREE.Mesh | undefined;
          if (body && body.material) (body.material as THREE.MeshLambertMaterial).color.setHex(vehicleColor(localVehicleId % 5));
          localVehicleMesh.visible = localVehicleId !== 0;
          localPlayerMesh.visible = localVehicleId === 0;
        } else if (sub === 0x03) {
          const { killerId, victimId } = decodeKillEvent(ev.data);
          addKillFeed(killerId, victimId);
        } else if (sub === 0x04) {
          setWanted(decodeWantedEvent(ev.data));
        } else if (sub === 0x08) {
          setMoney(decodeMoneyEvent(ev.data));
        }
      }
    }
  };
  ws.onclose = () => {
    hud.classList.add('hidden');
    help.classList.add('hidden');
    killFeedEl.classList.add('hidden');
    muteBtn.classList.add('hidden');
    langBtn.classList.add('hidden');
    touchControls.classList.add('hidden');
    killFeedEl.innerHTML = '';
    setWanted(0);
    setMoney(0);
    localPlayerMesh.visible = false;
    localVehicleMesh.visible = false;
    localVehicleId = 0;
    if (cityGroup) { scene.remove(cityGroup); cityGroup = null; }
    for (const ex of entities.values()) if (ex.mesh) scene.remove(ex.mesh);
    entities.clear();
    lobby.classList.remove('hidden');
  };
}

// --- lobby ---
btnHost.addEventListener('click', () => { hostPanel.classList.remove('hidden'); joinPanel.classList.add('hidden'); });
btnJoin.addEventListener('click', () => { hostPanel.classList.add('hidden'); joinPanel.classList.remove('hidden'); loadRooms(); });

btnCreate.addEventListener('click', async () => {
  const body: CreateRoomRequest = {
    playerName: playerNameEl.value || 'Piyoz',
    mapName: mapNameEl.value || 'Liberty Bean',
    maxPlayers: Number(maxPlayersEl.value),
    password: roomPasswordEl.value || undefined,
  };
  const r = await fetch('/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await r.json() as { roomId: string; wsUrl?: string };
  if (!data.roomId) return alert('Xona yaratilmadi');
  const wsUrl = `/ws?roomId=${data.roomId}`;
  connect(wsUrl, body.playerName, data.roomId);
});

btnJoinCode.addEventListener('click', async () => {
  const code = joinCodeEl.value.trim().toUpperCase();
  const list = await (await fetch('/api/rooms')).json() as RoomInfo[];
  const room = list.find(r => r.joinCode === code);
  if (!room) { alert('Xona topilmadi'); return; }
  const body: JoinRoomRequest = { playerName: playerNameEl.value || 'Piyoz' };
  const r = await fetch(`/api/rooms/${room.id}/join`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await r.json() as { wsUrl: string; roomId: string };
  if (!data.wsUrl) { alert('Qoʻshilish rad etildi'); return; }
  connect(data.wsUrl, body.playerName, data.roomId);
});

async function loadRooms() {
  const list = await (await fetch('/api/rooms')).json() as RoomInfo[];
  roomListEl.innerHTML = '';
  for (const r of list) {
    const div = document.createElement('div');
    div.className = 'room-item';
    div.innerHTML = `<span>${r.mapName} <small>(${r.players}/${r.maxPlayers})</small></span><span>${r.hasPassword ? '🔒' : ''}</span>`;
    div.addEventListener('click', async () => {
      const body: JoinRoomRequest = { playerName: playerNameEl.value || 'Piyoz' };
      const res = await fetch(`/api/rooms/${r.id}/join`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json() as { wsUrl: string; roomId: string };
      if (!data.wsUrl) { alert('Qoʻshilish rad etildi'); return; }
      connect(data.wsUrl, body.playerName, data.roomId);
    });
    roomListEl.appendChild(div);
  }
}

// --- 3D scene updates ---
function ensureEntityMesh(e: RemoteEntity): void {
  if (e.mesh) return;
  if (e.color >= 200) {
    const type = e.color - 200;
    if (type === 0) e.mesh = createChickenMesh();
    else if (type === 1) e.mesh = createHumanoidMesh(0xf5d0a9, 0x3b82f6, 0x1e293b);
    else e.mesh = createHumanoidMesh(0xf5d0a9, 0x1f2937, 0x111827, true);
  } else if (e.color >= 100) {
    e.mesh = createVehicleMesh(vehicleColor(e.color - 100));
  } else {
    e.mesh = createHumanoidMesh(0xf5d0a9, playerColor(e.color), 0x1e293b);
  }
  e.mesh.visible = true;
  scene.add(e.mesh);
}

function updateEntityMesh(e: RemoteEntity, now: number, dt: number): void {
  if (e.id === localPlayerId || e.id === localVehicleId) return;
  ensureEntityMesh(e);
  const t = Math.min(1, Math.max(0, (now - e.lastUpdated + 100) / 100));
  const x = e.prevX + (e.x - e.prevX) * t;
  const z = e.prevY + (e.y - e.prevY) * t;
  const mesh = e.mesh as THREE.Group;
  mesh.position.x = x;
  mesh.position.z = z;
  mesh.rotation.y = -e.angle + Math.PI / 2;
  const speed = Math.hypot(e.vx, e.vy);
  if (mesh.userData.isHumanoid) animateHumanoid(mesh, speed, dt);
  else if (mesh.userData.isVehicle) animateVehicle(mesh, speed, dt);
}

function updateLocalMesh(dt: number): void {
  if (localVehicleId) {
    localVehicleMesh.position.set(localState.x, 0, localState.y);
    localVehicleMesh.rotation.y = -localState.angle + Math.PI / 2;
    animateVehicle(localVehicleMesh, Math.hypot(localState.vx, localState.vy), dt);
  } else {
    localPlayerMesh.position.set(localState.x, 0, localState.y);
    localPlayerMesh.rotation.y = -localState.angle + Math.PI / 2;
    animateHumanoid(localPlayerMesh, Math.hypot(localState.vx, localState.vy), dt);
  }
}

function updateCamera(): void {
  const target = new THREE.Vector3(localState.x, 17, localState.y);
  const forward = new THREE.Vector3(Math.cos(localState.angle), 0, Math.sin(localState.angle));
  const dist = localVehicleId ? 420 : 320;
  const height = localVehicleId ? 260 : 220;
  const desired = target.clone().addScaledVector(forward, -dist).add(new THREE.Vector3(0, height, 0));
  camera.position.lerp(desired, 0.1);
  camera.lookAt(target);
  sun.position.copy(target).add(new THREE.Vector3(2000, 2500, 1000));
  sun.target.position.copy(target);
  sun.target.updateMatrixWorld();
}

// --- main loop ---
let lastInputSend = 0;
let lastPing = 0;

function loop(): void {
  const now = performance.now();
  const dt = Math.min(0.05, (now - lastRender) / 1000);
  lastRender = now;
  fps = Math.round(1 / dt);
  fpsEl.textContent = `FPS: ${fps}`;

  if (ws && ws.readyState === WebSocket.OPEN) {
    const packet = buildInputPacket();
    const v = new DataView(packet);
    const seq = v.getUint16(0, true);
    const k = v.getUint8(2);
    const a = v.getUint16(4, true);
    const angle = a / 65535 * Math.PI * 2;
    applyLocalInput(dt, k, angle);
    pendingInputs.push({ seq, keys: k, angle, x: localState.x, y: localState.y, vx: localState.vx, vy: localState.vy });
    if (pendingInputs.length > 30) pendingInputs.shift();

    if (now - lastInputSend > 1000 / 30) {
      ws.send(packet);
      lastInputSend = now;
    }
    if (now - lastPing > 2000) {
      lastPing = now; lastPingSent = now;
      const ping = new ArrayBuffer(1); new Uint8Array(ping)[0] = Op.Ping; ws.send(ping);
    }
  }

  updateLocalMesh(dt);
  for (const e of entities.values()) updateEntityMesh(e, now, dt);
  if (localState.hp > 0) updateCamera();

  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
applyLang();
