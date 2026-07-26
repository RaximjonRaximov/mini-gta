import { clamp, WORLD_SIZE } from '@mini-gta/shared';

export const NPC_TYPE_CHICKEN = 0;
export const NPC_TYPE_PED = 1;
export const NPC_TYPE_POLICE = 2;

export class Npc {
  id: number;
  x: number;
  y: number;
  vx = 0;
  vy = 0;
  angle = 0;
  hp = 30;
  type = 0;
  radius = 6;
  panic = 0;
  targetAngle = 0;
  accel = 120;
  maxSpeed = 80;

  constructor(id: number, x: number, y: number, type = 0) {
    this.id = id;
    this.x = x;
    this.y = y;
    this.type = type;
    this.targetAngle = Math.random() * Math.PI * 2;
    if (type === NPC_TYPE_CHICKEN) { this.radius = 4; this.maxSpeed = 60; this.hp = 10; }
    if (type === NPC_TYPE_POLICE) { this.radius = 8; this.maxSpeed = 160; this.hp = 60; }
  }
}

export function getNpcChanged(
  n: Npc,
  prev: { x: number; y: number; angle: number; hp: number; vx: number; vy: number },
): number {
  let changed = 0;
  if (Math.abs(n.x - prev.x) > 0.5 / 8) changed |= 0x01;
  if (Math.abs(n.y - prev.y) > 0.5 / 8) changed |= 0x02;
  if (Math.abs(n.angle - prev.angle) > 0.01) changed |= 0x04;
  if (n.hp !== prev.hp) changed |= 0x08;
  if (Math.abs(n.vx - prev.vx) > 0.01 || Math.abs(n.vy - prev.vy) > 0.01) changed |= 0x20;
  return changed;
}
