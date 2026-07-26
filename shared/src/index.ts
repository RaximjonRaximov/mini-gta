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

export function playerColor(index: number): number {
  return PLAYER_COLORS[index % PLAYER_COLORS.length];
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

export function encodeSnapshot(snap: Snapshot): ArrayBuffer {
  // estimate size: header 9 + per entity up to 18 bytes (color always included)
  const maxSize = 9 + snap.entities.length * 18;
  const buf = new ArrayBuffer(maxSize);
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
    if (e.changed & ChangedField.Vel) {
      v.setInt16(off, Math.max(-32767, Math.min(32767, Math.round(e.vx! * 64))), true); off += 2;
      v.setInt16(off, Math.max(-32767, Math.min(32767, Math.round(e.vy! * 64))), true); off += 2;
    }
  }
  return buf.slice(0, off);
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
