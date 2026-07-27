import { InputKey, clamp, WORLD_SIZE } from '@mini-gta/shared';
import type { WebSocket } from 'uWebSockets.js';
import type { UserData } from './types.js';

export interface InputFrame {
  seq: number;
  keys: number;
  actions: number;
  angle: number;
  time: number;
}

export class Player {
  id: number;
  name: string;
  color: number;
  roomId: string;
  ws: WebSocket<UserData> | null = null;
  lastSeq = 0;
  sendBuf = new ArrayBuffer(2048);

  x: number;
  y: number;
  vx = 0;
  vy = 0;
  angle = 0;
  hp = 100;
  money = 0;
  vehicleId: number | null = null;
  lastEnterExit = false;
  weapon = 'pistol';
  lastFireTick = -999;
  dead = false;
  respawnTick = 0;
  kills = 0;
  deaths = 0;
  wanted = 0;

  lastInput: InputFrame = { seq: 0, keys: 0, actions: 0, angle: 0, time: 0 };

  constructor(id: number, name: string, color: number, roomId: string, x: number, y: number) {
    this.id = id;
    this.name = name;
    this.color = color;
    this.roomId = roomId;
    this.x = x;
    this.y = y;
  }

  applyInput(dt: number): void {
    if (this.dead) { this.vx = 0; this.vy = 0; return; }
    const keys = this.lastInput.keys;
    const speed = (keys & InputKey.Sprint) ? 450 : 250; // px/s
    let nx = 0;
    let ny = 0;
    if (keys & InputKey.Up) ny += 1;
    if (keys & InputKey.Down) ny -= 1;
    if (keys & InputKey.Left) nx -= 1;
    if (keys & InputKey.Right) nx += 1;
    this.angle = this.lastInput.angle;
    if (nx !== 0 || ny !== 0) {
      const len = Math.hypot(nx, ny);
      nx /= len; ny /= len;
      const fx = Math.cos(this.angle);
      const fy = Math.sin(this.angle);
      const rx = Math.sin(this.angle);
      const ry = -Math.cos(this.angle);
      const ax = ny * fx + nx * rx;
      const ay = ny * fy + nx * ry;
      this.vx += ax * speed * 10 * dt;
      this.vy += ay * speed * 10 * dt;
    }
    this.vx *= 0.85;
    this.vy *= 0.85;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.x = clamp(this.x, 16, WORLD_SIZE - 16);
    this.y = clamp(this.y, 16, WORLD_SIZE - 16);
  }

  getChanged(prev: { x: number; y: number; angle: number; hp: number; vx: number; vy: number }): number {
    let changed = 0;
    if (Math.abs(this.x - prev.x) > 0.5 / 8) changed |= 0x01;
    if (Math.abs(this.y - prev.y) > 0.5 / 8) changed |= 0x02;
    if (Math.abs(this.angle - prev.angle) > 0.01) changed |= 0x04;
    if (this.hp !== prev.hp) changed |= 0x08;
    if (Math.abs(this.vx - prev.vx) > 0.01 || Math.abs(this.vy - prev.vy) > 0.01) changed |= 0x20;
    return changed;
  }
}

export function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9\u0400-\u04FF\u0600-\u06FF]/g, '').slice(0, 16);
}
