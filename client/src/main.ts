import { decodeSnapshot, decodeInput, encodeInput, decodeSeed, generateCity, InputKey, Op, WORLD_SIZE, playerColor, type EntityDelta, type Snapshot, type City, type RoomInfo, type CreateRoomRequest, type JoinRoomRequest, type Rect } from '@mini-gta/shared';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

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

const keys: Record<string, boolean> = {};
let mouseX = 0;
let mouseY = 0;
let canvasRect = { left: 0, top: 0 };

window.addEventListener('keydown', (e) => { keys[e.code] = true; });
window.addEventListener('keyup', (e) => { keys[e.code] = false; });
window.addEventListener('mousemove', (e) => {
  mouseX = e.clientX - canvasRect.left;
  mouseY = e.clientY - canvasRect.top;
});
window.addEventListener('resize', resize);

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  canvasRect = canvas.getBoundingClientRect();
}
resize();

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
  angle: number;
  hp: number;
  color: number;
  lastUpdated: number;
  prevX: number;
  prevY: number;
  prevTime: number;
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

function buildInputPacket(): ArrayBuffer {
  let k = 0;
  if (keys['KeyW'] || keys['ArrowUp']) k |= InputKey.Up;
  if (keys['KeyS'] || keys['ArrowDown']) k |= InputKey.Down;
  if (keys['KeyA'] || keys['ArrowLeft']) k |= InputKey.Left;
  if (keys['KeyD'] || keys['ArrowRight']) k |= InputKey.Right;
  if (keys['ShiftLeft'] || keys['ShiftRight']) k |= InputKey.Sprint;
  if (keys['Space']) k |= InputKey.Fire;
  if (keys['KeyE']) k |= InputKey.Interact;
  const angle = Math.atan2(mouseY - canvas.height / 2, mouseX - canvas.width / 2);
  inputSeq = (inputSeq + 1) % 65536;
  return encodeInput(inputSeq, k, 0, angle);
}

function applyLocalInput(dt: number, keys: number, angle: number): void {
  const speed = (keys & InputKey.Sprint) ? 450 : 250;
  let ax = 0, ay = 0;
  if (keys & InputKey.Up) ay -= 1;
  if (keys & InputKey.Down) ay += 1;
  if (keys & InputKey.Left) ax -= 1;
  if (keys & InputKey.Right) ax += 1;
  if (ax !== 0 || ay !== 0) {
    const len = Math.hypot(ax, ay);
    ax /= len; ay /= len;
    localState.angle = angle;
  }
  localState.vx += ax * speed * 10 * dt;
  localState.vy += ay * speed * 10 * dt;
  localState.vx *= 0.85;
  localState.vy *= 0.85;
  localState.x += localState.vx * dt;
  localState.y += localState.vy * dt;
  localState.x = Math.max(16, Math.min(WORLD_SIZE - 16, localState.x));
  localState.y = Math.max(16, Math.min(WORLD_SIZE - 16, localState.y));
}

function reconcile(): void {
  // simplest reconciliation: find last processed input by ack and replay
  const idx = pendingInputs.findIndex(i => i.seq === receivedAck);
  if (idx < 0) {
    // no ack; snap gently to server state
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
  // prediction error small: keep predicted state but adjust
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
    const now = performance.now();
    const ex = entities.get(e.id);
    if (ex) {
      ex.prevX = ex.x; ex.prevY = ex.y; ex.prevTime = ex.lastUpdated;
      ex.x = e.x ?? ex.x; ex.y = e.y ?? ex.y; ex.angle = e.angle ?? ex.angle;
      ex.hp = e.hp ?? ex.hp; ex.color = e.color ?? ex.color;
      ex.lastUpdated = now;
    } else {
      entities.set(e.id, {
        id: e.id, x: e.x ?? 0, y: e.y ?? 0, angle: e.angle ?? 0,
        hp: e.hp ?? 100, color: e.color ?? 0x22c55e,
        lastUpdated: now, prevX: e.x ?? 0, prevY: e.y ?? 0, prevTime: now
      });
    }
  }
  if (foundLocal) reconcile();
  playersEl.textContent = `Players: ${snap.entities.length}`;
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
    // identify as local; server will not send local id explicitly in v1, we infer by matching snapshot ack
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
      } else if (op === Op.Event) {
        const sub = v.getUint8(1);
        if (sub === 0x01) {
          const seed = decodeSeed(ev.data);
          city = generateCity(seed);
        }
      }
    }
  };
  ws.onclose = () => {
    hud.classList.add('hidden');
    help.classList.add('hidden');
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

// --- rendering ---
function onScreen(r: Rect, camX: number, camY: number): boolean {
  return r.x < camX + canvas.width && r.x + r.w > camX && r.y < camY + canvas.height && r.y + r.h > camY;
}

function drawWorld(camX: number, camY: number): void {
  ctx.fillStyle = '#0b0f19';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (city) {
    ctx.fillStyle = '#1f2937';
    for (const r of city.roads) {
      if (onScreen(r, camX, camY)) ctx.fillRect(r.x - camX, r.y - camY, r.w, r.h);
    }
    ctx.fillStyle = '#374151';
    for (const b of city.buildings) {
      if (onScreen(b, camX, camY)) ctx.fillRect(b.x - camX, b.y - camY, b.w, b.h);
    }
  } else {
    ctx.strokeStyle = '#1f2937';
    ctx.lineWidth = 2;
    const grid = 512;
    const startX = Math.floor(camX / grid) * grid - camX;
    const startY = Math.floor(camY / grid) * grid - camY;
    for (let x = startX; x < canvas.width; x += grid) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
    }
    for (let y = startY; y < canvas.height; y += grid) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
    }
  }
  // bounds
  ctx.strokeStyle = '#ef4444';
  ctx.lineWidth = 4;
  ctx.strokeRect(-camX, -camY, WORLD_SIZE, WORLD_SIZE);
}

function drawEntity(e: RemoteEntity, now: number, interpMs = 100): void {
  // interpolate from prev to current
  const t = Math.min(1, Math.max(0, (now - e.lastUpdated + interpMs) / interpMs));
  const x = e.prevX + (e.x - e.prevX) * t;
  const y = e.prevY + (e.y - e.prevY) * t;
  const cx = x - (localState.x - canvas.width / 2);
  const cy = y - (localState.y - canvas.height / 2);
  ctx.fillStyle = '#' + (playerColor(e.color ?? 0)).toString(16).padStart(6, '0');
  ctx.beginPath(); ctx.arc(cx, cy, 10, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(e.angle) * 18, cy + Math.sin(e.angle) * 18); ctx.stroke();
}

function drawLocalPlayer(): void {
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  // white outline so the local player is always visible on any background
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(cx, cy, 15, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#4ade80';
  ctx.beginPath(); ctx.arc(cx, cy, 12, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(localState.angle) * 24, cy + Math.sin(localState.angle) * 24); ctx.stroke();
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
    // local prediction at render rate
    const packet = buildInputPacket();
    const { seq, keys: k, angle } = decodeInput(packet);
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

  const camX = localState.x - canvas.width / 2;
  const camY = localState.y - canvas.height / 2;
  drawWorld(camX, camY);
  for (const e of entities.values()) drawEntity(e, now);
  drawLocalPlayer();

  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
