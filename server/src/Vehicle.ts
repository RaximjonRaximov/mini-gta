import { clamp, WORLD_SIZE } from '@mini-gta/shared';

export class Vehicle {
  id: number;
  x: number;
  y: number;
  vx = 0;
  vy = 0;
  angle = 0;
  hp = 100;
  type = 0;
  radius = 16;
  accel = 400;
  maxSpeed = 480;
  turn = 1.2;
  driverId: number | null = null;

  constructor(id: number, x: number, y: number, angle = 0, type = 0) {
    this.id = id;
    this.x = x;
    this.y = y;
    this.angle = angle;
    this.type = type;
  }
}

export function getVehicleChanged(
  v: Vehicle,
  prev: { x: number; y: number; angle: number; hp: number; vx: number; vy: number },
): number {
  let changed = 0;
  if (Math.abs(v.x - prev.x) > 0.5 / 8) changed |= 0x01;
  if (Math.abs(v.y - prev.y) > 0.5 / 8) changed |= 0x02;
  if (Math.abs(v.angle - prev.angle) > 0.01) changed |= 0x04;
  if (v.hp !== prev.hp) changed |= 0x08;
  if (Math.abs(v.vx - prev.vx) > 0.01 || Math.abs(v.vy - prev.vy) > 0.01) changed |= 0x20;
  return changed;
}
