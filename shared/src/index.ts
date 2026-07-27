// @mini-gta/shared — protocol, math, and constants used by both client and server

export const WORLD_SIZE = 8192;
export const TICK_RATE = 20; // Hz
export const SNAP_RATE = 20; // Hz
export const INPUT_RATE = 30; // Hz
export const RENDER_RATE = 60; // Hz

export const POS_SCALE = 8; // 1/8 pixel resolution
export const MAX_PLAYERS = 100;

export enum Op {
  Input = 0x01,
  Snapshot = 0x02,
  Event = 0x03,
  Ping = 0x04,
  Pong = 0x05,
  AssignId = 0x06,
}

export enum InputKey {
  Up = 0x01,
  Down = 0x02,
  Left = 0x04,
  Right = 0x08,
  Sprint = 0x10,
  Fire = 0x20,
  Interact = 0x40,
  EnterExit = 0x80,
}

export const enum ChangedField {
  X = 0x01,
  Y = 0x02,
  Angle = 0x04,
  Hp = 0x08,
  Money = 0x10,
  Vel = 0x20,
}

export interface Vec2 {
  x: number;
  y: number;
}

export interface PlayerState {
  id: number;
  x: number;
  y: number;
  angle: number; // radians
  hp: number;
  color: number; // u8 palette index
  name: string;
}

export const PLAYER_COLORS = [
  0x22c55e, 0xef4444, 0x3b82f6, 0xeab308, 0xa855f7,
  0xf97316, 0xec4899, 0x14b8a6, 0x6366f1, 0x84cc16,
];

export const VEHICLE_COLORS = [
  0xef4444, 0x3b82f6, 0xeab308, 0xa855f7, 0x14b8a6,
];

export function playerColor(index: number): number {
  return PLAYER_COLORS[index % PLAYER_COLORS.length];
}

export function vehicleColor(index: number): number {
  return VEHICLE_COLORS[index % VEHICLE_COLORS.length];
}

export interface Weapon {
  name: string;
  damage: number;
  fireRateTicks: number; // at 20 Hz
  range: number;
  spread: number; // perpendicular half-width at range, px
}

export const WEAPONS: Record<string, Weapon> = {
  pistol: { name: 'pistol', damage: 25, fireRateTicks: 8, range: 900, spread: 64 },
};

export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export interface SnapshotHeader {
  tick: number;
  ackSeq: number;
  entityCount: number;
}

export interface EntityDelta {
  id: number;
  changed: number;
  x?: number;
  y?: number;
  angle?: number;
  hp?: number;
  color?: number;
  vx?: number;
  vy?: number;
}

export interface Snapshot {
  tick: number;
  ackSeq: number;
  entities: EntityDelta[];
}

export interface RoomInfo {
  id: string;
  joinCode: string;
  mapName: string;
  hostName: string;
  players: number;
  maxPlayers: number;
  hasPassword: boolean;
}

export interface CreateRoomRequest {
  playerName: string;
  mapName: string;
  maxPlayers?: number;
  seed?: string;
  password?: string;
}

export interface JoinRoomRequest {
  playerName: string;
  password?: string;
}

export interface CreateRoomResponse {
  roomId: string;
  joinCode: string;
}

export interface JoinRoomResponse {
  roomId: string;
  wsUrl: string;
}

// --- encoding / decoding ---

export function encodeInput(seq: number, keys: number, actions: number, angle: number): ArrayBuffer {
  const buf = new ArrayBuffer(8);
  const v = new DataView(buf);
  v.setUint16(0, seq, true);
  v.setUint8(2, keys);
  v.setUint8(3, actions);
  const a = Math.floor(((angle % (Math.PI * 2)) + (Math.PI * 2)) % (Math.PI * 2) / (Math.PI * 2) * 65535);
  v.setUint16(4, a, true);
  v.setUint16(6, 0, true); // reserved
  return buf;
}

export function decodeInput(buf: ArrayBuffer): { seq: number; keys: number; actions: number; angle: number } {
  const v = new DataView(buf);
  const seq = v.getUint16(0, true);
  const keys = v.getUint8(2);
  const actions = v.getUint8(3);
  const a = v.getUint16(4, true);
  const angle = a / 65535 * Math.PI * 2;
  return { seq, keys, actions, angle };
}

function entitySize(changed: number): number {
  let n = 4; // id + changed + color + (id takes 2, changed 1, color 1)
  if (changed & ChangedField.X) n += 2;
  if (changed & ChangedField.Y) n += 2;
  if (changed & ChangedField.Angle) n += 1;
  if (changed & ChangedField.Hp) n += 1;
  if (changed & ChangedField.Vel) n += 4;
  return n;
}

export function encodeSnapshot(snap: Snapshot, outBuf?: ArrayBuffer): ArrayBuffer | Uint8Array {
  let size = 9;
  for (const e of snap.entities) size += entitySize(e.changed);
  const buf = outBuf && outBuf.byteLength >= size ? outBuf : new ArrayBuffer(size);
  const v = new DataView(buf);
  let off = 0;
  v.setUint8(off++, Op.Snapshot);
  v.setUint32(off, snap.tick, true); off += 4;
  v.setUint16(off, snap.ackSeq, true); off += 2;
  v.setUint16(off, snap.entities.length, true); off += 2;
  for (const e of snap.entities) {
    v.setUint16(off, e.id, true); off += 2;
    v.setUint8(off++, e.changed);
    // color is always sent so clients can draw new entities immediately
    v.setUint8(off++, e.color ?? 0);
    if (e.changed & ChangedField.X) { v.setUint16(off, Math.max(0, Math.min(65535, Math.round(e.x! * POS_SCALE))), true); off += 2; }
    if (e.changed & ChangedField.Y) { v.setUint16(off, Math.max(0, Math.min(65535, Math.round(e.y! * POS_SCALE))), true); off += 2; }
    if (e.changed & ChangedField.Angle) { v.setUint8(off++, Math.max(0, Math.min(255, Math.round(e.angle! / (Math.PI * 2) * 255)))); }
    if (e.changed & ChangedField.Hp) { v.setUint8(off++, Math.max(0, Math.min(255, e.hp!))); }
    if (ChangedField.Vel & e.changed) {
      v.setInt16(off, Math.max(-32767, Math.min(32767, Math.round(e.vx! * 64))), true); off += 2;
      v.setInt16(off, Math.max(-32767, Math.min(32767, Math.round(e.vy! * 64))), true); off += 2;
    }
  }
  if (outBuf) return new Uint8Array(buf, 0, off);
  return buf;
}

export function decodeSnapshot(buf: ArrayBuffer): Snapshot {
  const v = new DataView(buf);
  let off = 1; // skip op
  const tick = v.getUint32(off, true); off += 4;
  const ackSeq = v.getUint16(off, true); off += 2;
  const entityCount = v.getUint16(off, true); off += 2;
  const entities: EntityDelta[] = [];
  for (let i = 0; i < entityCount; i++) {
    const id = v.getUint16(off, true); off += 2;
    const changed = v.getUint8(off++);
    const color = v.getUint8(off++);
    const e: EntityDelta = { id, changed, color };
    if (changed & ChangedField.X) { e.x = v.getUint16(off, true) / POS_SCALE; off += 2; }
    if (changed & ChangedField.Y) { e.y = v.getUint16(off, true) / POS_SCALE; off += 2; }
    if (changed & ChangedField.Angle) { e.angle = v.getUint8(off++) / 255 * Math.PI * 2; }
    if (changed & ChangedField.Hp) { e.hp = v.getUint8(off++); }
    if (changed & ChangedField.Vel) { e.vx = v.getInt16(off, true) / 64; off += 2; e.vy = v.getInt16(off, true) / 64; off += 2; }
    entities.push(e);
  }
  return { tick, ackSeq, entities };
}

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function quantizeAngle255(angle: number): number {
  return Math.round((((angle % (Math.PI * 2)) + (Math.PI * 2)) % (Math.PI * 2)) / (Math.PI * 2) * 255) % 256;
}

export function angleFrom255(b: number): number {
  return (b / 255) * Math.PI * 2;
}

// --- Seeded random number generator ---
export type Rng = () => number;

export function createRng(seed: string): Rng {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
    h = Math.imul(h ^ (h >>> 16), 2246822507) ^ Math.imul(h, 3266489909);
  }
  let s = h >>> 0;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- Seed packet helpers ---
export function encodeSeed(seed: string): ArrayBuffer {
  const bytes = new TextEncoder().encode(seed);
  const buf = new ArrayBuffer(2 + bytes.length);
  const v = new DataView(buf);
  v.setUint8(0, Op.Event);
  v.setUint8(1, 0x01); // seed sub-op
  new Uint8Array(buf, 2).set(bytes);
  return buf;
}

export function decodeSeed(buf: ArrayBuffer): string {
  return new TextDecoder().decode(new Uint8Array(buf, 2));
}

// --- Vehicle enter/exit event helpers ---
export function encodeVehicleEvent(vehicleId: number): ArrayBuffer {
  const buf = new ArrayBuffer(4);
  const v = new DataView(buf);
  v.setUint8(0, Op.Event);
  v.setUint8(1, 0x02); // vehicle sub-op
  v.setUint16(2, vehicleId, true);
  return buf;
}

export function decodeVehicleEvent(buf: ArrayBuffer): number {
  return new DataView(buf).getUint16(2, true);
}

export function encodeKillEvent(killerId: number, victimId: number): ArrayBuffer {
  const buf = new ArrayBuffer(6);
  const v = new DataView(buf);
  v.setUint8(0, Op.Event);
  v.setUint8(1, 0x03);
  v.setUint16(2, killerId, true);
  v.setUint16(4, victimId, true);
  return buf;
}

export function decodeKillEvent(buf: ArrayBuffer): { killerId: number; victimId: number } {
  const v = new DataView(buf);
  return { killerId: v.getUint16(2, true), victimId: v.getUint16(4, true) };
}

export function encodeWantedEvent(level: number): ArrayBuffer {
  const buf = new ArrayBuffer(3);
  const v = new DataView(buf);
  v.setUint8(0, Op.Event);
  v.setUint8(1, 0x04);
  v.setUint8(2, level);
  return buf;
}

export function decodeWantedEvent(buf: ArrayBuffer): number {
  return new DataView(buf).getUint8(2);
}

export function encodeMoneyEvent(amount: number): ArrayBuffer {
  const buf = new ArrayBuffer(6);
  const v = new DataView(buf);
  v.setUint8(0, Op.Event);
  v.setUint8(1, 0x08);
  v.setUint32(2, amount >>> 0, true);
  return buf;
}

export function decodeMoneyEvent(buf: ArrayBuffer): number {
  return new DataView(buf).getUint32(2, true);
}

// --- City generation ---
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  height?: number;
  color?: number;
}

function hslToHex(h: number, s: number, l: number): number {
  // h in [0,360), s/l in [0,1]
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  const to255 = (v: number) => Math.round((v + m) * 255);
  return (to255(r) << 16) | (to255(g) << 8) | to255(b);
}

export interface City {
  worldSize: number;
  roadWidth: number;
  roadSpacing: number;
  roads: Rect[];
  buildings: Rect[];
}

export function generateCity(seed: string, worldSize = WORLD_SIZE): City {
  const rng = createRng(seed);
  const roadSpacing = 512;
  const roadWidth = 96;
  const halfRoad = roadWidth / 2;
  const roads: Rect[] = [];
  const buildings: Rect[] = [];

  for (let x = 0; x <= worldSize; x += roadSpacing) {
    roads.push({ x: x - halfRoad, y: 0, w: roadWidth, h: worldSize });
  }
  for (let y = 0; y <= worldSize; y += roadSpacing) {
    roads.push({ x: 0, y: y - halfRoad, w: worldSize, h: roadWidth });
  }

  const blockSize = roadSpacing - roadWidth;
  const cols = Math.floor(worldSize / roadSpacing);
  for (let bx = 0; bx < cols; bx++) {
    for (let by = 0; by < cols; by++) {
      const cx = bx * roadSpacing + halfRoad;
      const cy = by * roadSpacing + halfRoad;
      const count = Math.floor(rng() * 3); // 0-2 buildings per block
      for (let i = 0; i < count; i++) {
        const bw = 32 + rng() * (blockSize * 0.4 - 32);
        const bh = 32 + rng() * (blockSize * 0.4 - 32);
        const margin = 24;
        const x = cx + margin + rng() * (blockSize - bw - margin * 2);
        const y = cy + margin + rng() * (blockSize - bh - margin * 2);
        const height = 60 + rng() * 200;
        const color = hslToHex(200 + rng() * 60, 0.25 + rng() * 0.1, 0.35 + rng() * 0.25);
        buildings.push({ x, y, w: bw, h: bh, height, color });
      }
    }
  }

  return { worldSize, roadWidth, roadSpacing, roads, buildings };
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
