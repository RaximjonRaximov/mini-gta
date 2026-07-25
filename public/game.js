const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

const WORLD_W = 2400;
const WORLD_H = 2400;
const BLOCK_SIZE = 300;
const ROAD = 120;
const BUILDING_COLOR = '#334155';
const ROAD_COLOR = '#1f2937';
const ROAD_LINE = '#475569';

const keys = {};

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

window.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'KeyE') tryEnterExit();
});
window.addEventListener('keyup', (e) => keys[e.code] = false);

const buildings = [];
const ped = [];
let police = [];
const missionMarkers = [];
let currentMission = 0;
let wanted = 0;
let wantedTimer = 0;
let score = 0;

function createCity() {
  const cols = Math.floor(WORLD_W / (BLOCK_SIZE + ROAD));
  const rows = Math.floor(WORLD_H / (BLOCK_SIZE + ROAD));
  const offsetX = (WORLD_W - (cols * BLOCK_SIZE + (cols - 1) * ROAD)) / 2;
  const offsetY = (WORLD_H - (rows * BLOCK_SIZE + (rows - 1) * ROAD)) / 2;
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const x = offsetX + i * (BLOCK_SIZE + ROAD);
      const y = offsetY + j * (BLOCK_SIZE + ROAD);
      buildings.push({ x: x + 8, y: y + 8, w: BLOCK_SIZE - 16, h: BLOCK_SIZE - 16 });
    }
  }
  for (let k = 0; k < 30; k++) {
    const b = buildings[Math.floor(Math.random() * buildings.length)];
    ped.push({
      x: b.x + Math.random() * b.w,
      y: b.y + Math.random() * b.h,
      vx: (Math.random() - 0.5) * 2,
      vy: (Math.random() - 0.5) * 2,
      w: 14,
      h: 14,
      alive: true,
      color: `hsl(${Math.random()*360},60%,60%)`
    });
  }
}

function roadPoint() {
  const cols = Math.floor(WORLD_W / (BLOCK_SIZE + ROAD));
  const rows = Math.floor(WORLD_H / (BLOCK_SIZE + ROAD));
  const offsetX = (WORLD_W - (cols * BLOCK_SIZE + (cols - 1) * ROAD)) / 2;
  const offsetY = (WORLD_H - (rows * BLOCK_SIZE + (rows - 1) * ROAD)) / 2;
  const i = Math.floor(Math.random() * cols);
  const j = Math.floor(Math.random() * rows);
  const x = offsetX + i * (BLOCK_SIZE + ROAD) + BLOCK_SIZE / 2;
  const y = offsetY + j * (BLOCK_SIZE + ROAD) + BLOCK_SIZE / 2;
  return { x, y };
}

const player = {
  x: WORLD_W / 2,
  y: WORLD_H / 2,
  w: 16,
  h: 16,
  vx: 0,
  vy: 0,
  angle: 0,
  inCar: false,
  color: '#4ade80'
};

const car = {
  x: WORLD_W / 2 + 200,
  y: WORLD_H / 2,
  w: 34,
  h: 60,
  vx: 0,
  vy: 0,
  angle: 0,
  speed: 0,
  maxSpeed: 14,
  accel: 0.25,
  friction: 0.96,
  turnSpeed: 0.05,
  color: '#ef4444',
  occupied: false
};

let missionTarget = null;
function nextMission() {
  const p = roadPoint();
  missionTarget = { x: p.x, y: p.y, r: 40 };
  document.getElementById('mission-text').textContent = player.inCar && car.occupied ? 'Drive to the green marker' : 'Find the car (E to enter)';
}

function tryEnterExit() {
  if (player.inCar) {
    player.inCar = false;
    car.occupied = false;
    player.x = car.x + Math.cos(car.angle) * 40;
    player.y = car.y + Math.sin(car.angle) * 40;
    player.vx = 0;
    player.vy = 0;
  } else {
    const dx = player.x - car.x;
    const dy = player.y - car.y;
    if (Math.hypot(dx, dy) < 60) {
      player.inCar = true;
      car.occupied = true;
    }
  }
  nextMission();
}

function rectIntersect(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function pushOut(rect, other) {
  const cx1 = rect.x + rect.w / 2;
  const cy1 = rect.y + rect.h / 2;
  const cx2 = other.x + other.w / 2;
  const cy2 = other.y + other.h / 2;
  const dx = cx1 - cx2;
  const dy = cy1 - cy2;
  const overlapX = (rect.w + other.w) / 2 - Math.abs(dx);
  const overlapY = (rect.h + other.h) / 2 - Math.abs(dy);
  if (overlapX < overlapY) {
    rect.x += dx > 0 ? overlapX : -overlapX;
  } else {
    rect.y += dy > 0 ? overlapY : -overlapY;
  }
}

function updatePlayer() {
  if (player.inCar) {
    updateCar();
    player.x = car.x;
    player.y = car.y;
    player.angle = car.angle;
    return;
  }
  const speed = 4;
  let dx = 0, dy = 0;
  if (keys['KeyW'] || keys['ArrowUp']) dy -= 1;
  if (keys['KeyS'] || keys['ArrowDown']) dy += 1;
  if (keys['KeyA'] || keys['ArrowLeft']) dx -= 1;
  if (keys['KeyD'] || keys['ArrowRight']) dx += 1;
  if (dx || dy) {
    const len = Math.hypot(dx, dy);
    player.vx = (dx / len) * speed;
    player.vy = (dy / len) * speed;
    player.angle = Math.atan2(player.vy, player.vx);
  } else {
    player.vx *= 0.8;
    player.vy *= 0.8;
  }
  player.x += player.vx;
  player.y += player.vy;
  player.x = Math.max(0, Math.min(WORLD_W, player.x));
  player.y = Math.max(0, Math.min(WORLD_H, player.y));
  for (const b of buildings) {
    const pb = { x: player.x - player.w / 2, y: player.y - player.h / 2, w: player.w, h: player.h };
    if (rectIntersect(pb, b)) pushOut(pb, b);
    player.x = pb.x + player.w / 2;
    player.y = pb.y + player.h / 2;
  }
}

function updateCar() {
  if (keys['KeyW'] || keys['ArrowUp']) car.speed += car.accel;
  if (keys['KeyS'] || keys['ArrowDown']) car.speed -= car.accel;
  if (Math.abs(car.speed) > 0.5 && (keys['KeyA'] || keys['ArrowLeft'])) car.angle -= car.turnSpeed * Math.sign(car.speed);
  if (Math.abs(car.speed) > 0.5 && (keys['KeyD'] || keys['ArrowRight'])) car.angle += car.turnSpeed * Math.sign(car.speed);
  if (keys['Space']) car.speed *= 0.92;
  car.speed *= car.friction;
  car.x += Math.cos(car.angle) * car.speed;
  car.y += Math.sin(car.angle) * car.speed;

  // bounds
  car.x = Math.max(car.w, Math.min(WORLD_W - car.w, car.x));
  car.y = Math.max(car.h, Math.min(WORLD_H - car.h, car.y));

  // building collisions
  const cb = { x: car.x - car.w / 2, y: car.y - car.h / 2, w: car.w, h: car.h };
  let collided = false;
  for (const b of buildings) {
    if (rectIntersect(cb, b)) {
      pushOut(cb, b);
      collided = true;
    }
  }
  if (collided) {
    car.speed *= -0.5;
    car.x = cb.x + car.w / 2;
    car.y = cb.y + car.h / 2;
  }

  // pedestrian hits
  for (const p of ped) {
    if (!p.alive) continue;
    const pb = { x: p.x - p.w / 2, y: p.y - p.h / 2, w: p.w, h: p.h };
    if (rectIntersect(cb, pb)) {
      p.alive = false;
      addWanted(1);
      score += 50;
    }
  }

  // mission target
  if (missionTarget) {
    const dist = Math.hypot(car.x - missionTarget.x, car.y - missionTarget.y);
    if (dist < missionTarget.r) {
      score += 200;
      nextMission();
    }
  }
}

function addWanted(n) {
  wanted = Math.min(5, wanted + n);
  wantedTimer = 600;
}

function updatePeds() {
  for (const p of ped) {
    if (!p.alive) continue;
    p.x += p.vx;
    p.y += p.vy;
    const pb = { x: p.x - p.w / 2, y: p.y - p.h / 2, w: p.w, h: p.h };
    let hit = false;
    for (const b of buildings) {
      if (rectIntersect(pb, b)) { hit = true; break; }
    }
    if (hit || p.x < 0 || p.x > WORLD_W || p.y < 0 || p.y > WORLD_H) {
      p.vx *= -1;
      p.vy *= -1;
      p.x += p.vx * 2;
      p.y += p.vy * 2;
    }
  }
}

function spawnPolice() {
  if (wanted > 0 && police.length < wanted * 2 && Math.random() < 0.02) {
    const side = Math.floor(Math.random() * 4);
    let x, y;
    if (side === 0) { x = Math.random() * WORLD_W; y = 0; }
    else if (side === 1) { x = WORLD_W; y = Math.random() * WORLD_H; }
    else if (side === 2) { x = Math.random() * WORLD_W; y = WORLD_H; }
    else { x = 0; y = Math.random() * WORLD_H; }
    police.push({ x, y, w: 32, h: 54, angle: 0, speed: 5, color: '#3b82f6' });
  }
}

function updatePolice() {
  spawnPolice();
  const target = player.inCar ? car : player;
  for (const c of police) {
    const dx = target.x - c.x;
    const dy = target.y - c.y;
    c.angle = Math.atan2(dy, dx);
    c.x += Math.cos(c.angle) * c.speed;
    c.y += Math.sin(c.angle) * c.speed;
    const cb = { x: c.x - c.w / 2, y: c.y - c.h / 2, w: c.w, h: c.h };
    for (const b of buildings) {
      if (rectIntersect(cb, b)) pushOut(cb, b);
    }
    c.x = cb.x + c.w / 2;
    c.y = cb.y + c.h / 2;
  }
  if (wantedTimer > 0) {
    wantedTimer--;
  } else if (wanted > 0 && Math.random() < 0.005) {
    wanted = Math.max(0, wanted - 1);
  }
}

function drawCity(camX, camY) {
  ctx.fillStyle = ROAD_COLOR;
  ctx.fillRect(0 - camX, 0 - camY, WORLD_W, WORLD_H);
  // road grid lines
  ctx.strokeStyle = ROAD_LINE;
  ctx.lineWidth = 2;
  const cols = Math.floor(WORLD_W / (BLOCK_SIZE + ROAD));
  const rows = Math.floor(WORLD_H / (BLOCK_SIZE + ROAD));
  const offsetX = (WORLD_W - (cols * BLOCK_SIZE + (cols - 1) * ROAD)) / 2;
  const offsetY = (WORLD_H - (rows * BLOCK_SIZE + (rows - 1) * ROAD)) / 2;
  for (let i = 0; i <= cols; i++) {
    const x = offsetX + i * (BLOCK_SIZE + ROAD) - ROAD / 2;
    ctx.beginPath(); ctx.moveTo(x - camX, 0 - camY); ctx.lineTo(x - camX, WORLD_H - camY); ctx.stroke();
  }
  for (let j = 0; j <= rows; j++) {
    const y = offsetY + j * (BLOCK_SIZE + ROAD) - ROAD / 2;
    ctx.beginPath(); ctx.moveTo(0 - camX, y - camY); ctx.lineTo(WORLD_W - camX, y - camY); ctx.stroke();
  }
  // buildings
  ctx.fillStyle = BUILDING_COLOR;
  for (const b of buildings) {
    ctx.fillRect(b.x - camX, b.y - camY, b.w, b.h);
    ctx.strokeStyle = '#475569';
    ctx.strokeRect(b.x - camX, b.y - camY, b.w, b.h);
  }
}

function drawMarker(camX, camY) {
  if (!missionTarget) return;
  const x = missionTarget.x - camX;
  const y = missionTarget.y - camY;
  const pulse = 1 + Math.sin(Date.now() / 200) * 0.2;
  ctx.fillStyle = 'rgba(74, 222, 128, 0.4)';
  ctx.beginPath();
  ctx.arc(x, y, missionTarget.r * pulse, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#4ade80';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(x, y, missionTarget.r * pulse, 0, Math.PI * 2);
  ctx.stroke();
}

function drawCarObj(c, camX, camY) {
  ctx.save();
  ctx.translate(c.x - camX, c.y - camY);
  ctx.rotate(c.angle + Math.PI / 2);
  ctx.fillStyle = c.color;
  ctx.fillRect(-c.w / 2, -c.h / 2, c.w, c.h);
  // roof
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(-c.w / 4, -c.h / 4, c.w / 2, c.h / 3);
  // lights
  ctx.fillStyle = '#facc15';
  ctx.fillRect(-c.w / 2 + 2, -c.h / 2, 6, 4);
  ctx.fillRect(c.w / 2 - 8, -c.h / 2, 6, 4);
  ctx.fillStyle = '#ef4444';
  ctx.fillRect(-c.w / 2 + 2, c.h / 2 - 4, 6, 4);
  ctx.fillRect(c.w / 2 - 8, c.h / 2 - 4, 6, 4);
  ctx.restore();
}

function drawPlayer(camX, camY) {
  if (player.inCar) return;
  const x = player.x - camX;
  const y = player.y - camY;
  ctx.fillStyle = player.color;
  ctx.beginPath();
  ctx.arc(x, y, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + Math.cos(player.angle) * 16, y + Math.sin(player.angle) * 16);
  ctx.stroke();
}

function drawPeds(camX, camY) {
  for (const p of ped) {
    if (!p.alive) continue;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x - camX, p.y - camY, 7, 0, Math.PI * 2);
    ctx.fill();
  }
}

function draw() {
  const target = player.inCar ? car : player;
  const camX = target.x - canvas.width / 2;
  const camY = target.y - canvas.height / 2;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawCity(camX, camY);
  drawMarker(camX, camY);
  drawPeds(camX, camY);
  drawCarObj(car, camX, camY);
  for (const c of police) drawCarObj(c, camX, camY);
  drawPlayer(camX, camY);
  updateHUD();
}

function updateHUD() {
  const speed = Math.round(Math.abs(car.speed) * 10);
  document.getElementById('speed').textContent = `${speed} km/h`;
  document.getElementById('wanted-level').textContent = '★'.repeat(wanted);
}

function loop() {
  updatePlayer();
  updatePeds();
  updatePolice();
  draw();
  requestAnimationFrame(loop);
}

createCity();
nextMission();
loop();
