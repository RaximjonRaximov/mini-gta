import { Player, sanitizeName, type UwsSocket } from './types.js';
import { World } from './World.js';
import { Vehicle, getVehicleChanged } from './Vehicle.js';
import { encodeSnapshot, encodeVehicleEvent, encodeKillEvent, ChangedField, InputKey, TICK_RATE, WORLD_SIZE, PLAYER_COLORS, WEAPONS, wrapAngle, type Snapshot, type EntityDelta } from '@mini-gta/shared';

export interface RoomData {
  id: string;
  joinCode: string;
  mapName: string;
  seed: string;
  maxPlayers: number;
  hasPassword: boolean;
  hostName: string;
  players: number;
}

function pickColor(id: number): number {
  return id % PLAYER_COLORS.length;
}

export class Room {
  id: string;
  joinCode: string;
  mapName: string;
  seed: string;
  maxPlayers: number;
  passwordHash: string | null;
  hostId: number | null = null;
  createdAt = Date.now();
  lastActivity = Date.now();
  players = new Map<number, Player>();
  nextPlayerId = 1;
  tick = 0;
  tickAcc = 0;
  running = true;

  // previous states for delta snapshots
  prevStates = new Map<number, { x: number; y: number; angle: number; hp: number; vx: number; vy: number }>();
  vehiclePrevStates = new Map<number, { x: number; y: number; angle: number; hp: number; vx: number; vy: number }>();
  private deltaPool: EntityDelta[] = [];
  world: World;
  vehicles = new Map<number, Vehicle>();
  nextVehicleId = 1000;

  constructor(id: string, joinCode: string, mapName: string, seed: string, maxPlayers: number, password?: string) {
    this.id = id;
    this.joinCode = joinCode;
    this.mapName = mapName;
    this.seed = seed;
    this.maxPlayers = maxPlayers;
    this.passwordHash = password || null;
    this.world = new World(seed);
    this.spawnTraffic(20);
  }

  publicInfo(): RoomData {
    const p = this.players.values().next().value as Player | undefined;
    return {
      id: this.id,
      joinCode: this.joinCode,
      mapName: this.mapName,
      seed: this.seed,
      maxPlayers: this.maxPlayers,
      hasPassword: !!this.passwordHash,
      hostName: this.hostId ? (this.players.get(this.hostId)?.name ?? '') : (p?.name ?? ''),
      players: this.players.size,
    };
  }

  spawnTraffic(count: number): void {
    const roads = this.world.city.roads;
    for (let i = 0; i < count && roads.length; i++) {
      this.spawnOneVehicle(i % 5);
    }
  }

  private spawnOneVehicle(type = 0): Vehicle | null {
    const roads = this.world.city.roads;
    if (!roads.length) return null;
    for (let attempts = 0; attempts < 10; attempts++) {
      const road = roads[Math.floor(Math.random() * roads.length)];
      const x = road.x + Math.random() * road.w;
      const y = road.y + Math.random() * road.h;
      const horizontal = road.w > road.h;
      const angle = horizontal ? (Math.random() < 0.5 ? 0 : Math.PI) : (Math.random() < 0.5 ? Math.PI / 2 : -Math.PI / 2);
      if (!this.world.collides(x, y, 16)) {
        const v = new Vehicle(this.nextVehicleId++, x, y, angle, type);
        this.vehicles.set(v.id, v);
        this.vehiclePrevStates.set(v.id, { x: -1, y: -1, angle: -1, hp: 0, vx: 0, vy: 0 });
        return v;
      }
    }
    return null;
  }

  respawnVehicle(v: Vehicle): void {
    if (v.driverId != null) {
      const p = this.players.get(v.driverId);
      if (p) { p.vehicleId = null; p.x = v.x; p.y = v.y; p.vx = 0; p.vy = 0; }
      v.driverId = null;
    }
    v.vx = 0; v.vy = 0; v.hp = 100;
    const roads = this.world.city.roads;
    if (!roads.length) return;
    for (let attempts = 0; attempts < 10; attempts++) {
      const road = roads[Math.floor(Math.random() * roads.length)];
      const x = road.x + Math.random() * road.w;
      const y = road.y + Math.random() * road.h;
      if (!this.world.collides(x, y, v.radius)) { v.x = x; v.y = y; v.angle = road.w > road.h ? 0 : Math.PI / 2; return; }
    }
  }

  addPlayer(name: string, ws: UwsSocket | null): Player | null {
    if (this.players.size >= this.maxPlayers) return null;
    const id = this.nextPlayerId++;
    const safe = sanitizeName(name) || `Player${id}`;
    const finalName = this.uniqueName(safe);
    let x = 100 + Math.random() * (WORLD_SIZE - 200);
    let y = 100 + Math.random() * (WORLD_SIZE - 200);
    for (let i = 0; i < 20 && this.world.collides(x, y, 10); i++) {
      x = 100 + Math.random() * (WORLD_SIZE - 200);
      y = 100 + Math.random() * (WORLD_SIZE - 200);
    }
    const p = new Player(id, finalName, pickColor(id), this.id, x, y);
    p.ws = ws;
    this.players.set(id, p);
    this.prevStates.set(id, { x: -1, y: -1, angle: -1, hp: 0, vx: 0, vy: 0 });
    if (this.hostId === null) this.hostId = id;
    this.lastActivity = Date.now();
    return p;
  }

  removePlayer(id: number): void {
    this.players.delete(id);
    this.prevStates.delete(id);
    if (this.hostId === id) {
      // migrate to longest connected (lowest id)
      let oldest: number | null = null;
      for (const pid of this.players.keys()) {
        if (oldest === null || pid < oldest) oldest = pid;
      }
      this.hostId = oldest;
    }
    this.lastActivity = Date.now();
  }

  uniqueName(name: string): string {
    const names = new Set([...this.players.values()].map(p => p.name));
    if (!names.has(name)) return name;
    let i = 2;
    while (names.has(`${name}#${i}`)) i++;
    return `${name}#${i}`;
  }

  checkPassword(password?: string): boolean {
    if (!this.passwordHash) return true;
    return password === this.passwordHash;
  }

  update(dt: number): void {
    this.tickAcc += dt;
    if (this.tickAcc < 1 / TICK_RATE) return;
    this.tickAcc -= 1 / TICK_RATE;
    this.tick++;
    for (const p of this.players.values()) {
      if (p.dead) {
        if (this.tick >= p.respawnTick) this.respawnPlayer(p);
        continue;
      }
      if (p.vehicleId) {
        const v = this.vehicles.get(p.vehicleId);
        if (v) {
          const tdt = 1 / TICK_RATE;
          const keys = p.lastInput.keys;
          let throttle = 0;
          let steer = 0;
          if (keys & InputKey.Up) throttle += 1;
          if (keys & InputKey.Down) throttle -= 1;
          if (keys & InputKey.Left) steer -= 1;
          if (keys & InputKey.Right) steer += 1;
          const oldX = v.x;
          const oldY = v.y;
          const speed = Math.hypot(v.vx, v.vy);
          if (speed < v.maxSpeed) {
            v.vx += Math.cos(v.angle) * v.accel * throttle * tdt;
            v.vy += Math.sin(v.angle) * v.accel * throttle * tdt;
          }
          if (speed > 10) v.angle += steer * v.turn * (speed / v.maxSpeed) * tdt;
          v.vx *= 0.95;
          v.vy *= 0.95;
          v.x += v.vx * tdt;
          v.y += v.vy * tdt;
          this.world.resolve(v, oldX, oldY, v.radius);
          if (v.x === oldX && v.y === oldY && speed > 400) {
            v.hp -= Math.floor(speed / 10);
            if (v.hp <= 0) { this.respawnVehicle(v); p.vehicleId = null; p.dead = true; p.respawnTick = this.tick + 80; p.deaths++; }
          }
          p.x = v.x; p.y = v.y; p.angle = v.angle; p.vx = v.vx; p.vy = v.vy;
        }
      } else {
        const oldX = p.x;
        const oldY = p.y;
        p.applyInput(1 / TICK_RATE);
        this.world.resolve(p, oldX, oldY);
      }
      if (p.lastInput.keys & InputKey.Fire) this.fireWeapon(p);
    }
    for (const v of this.vehicles.values()) {
      if (v.driverId != null) continue;
      const oldX = v.x;
      const oldY = v.y;
      const speed = Math.hypot(v.vx, v.vy);
      if (speed < v.maxSpeed) {
        v.vx += Math.cos(v.angle) * v.accel * (1 / TICK_RATE);
        v.vy += Math.sin(v.angle) * v.accel * (1 / TICK_RATE);
      }
      v.angle += (Math.random() - 0.5) * v.turn * (1 / TICK_RATE);
      v.vx *= 0.96;
      v.vy *= 0.96;
      v.x += v.vx * (1 / TICK_RATE);
      v.y += v.vy * (1 / TICK_RATE);
      this.world.resolve(v, oldX, oldY, v.radius);
      if (v.x === oldX && v.y === oldY && speed > 400) {
        v.hp -= Math.floor(speed / 10);
        if (v.hp <= 0) this.respawnVehicle(v);
      }
      if (Math.hypot(v.vx, v.vy) < 20) {
        v.angle = Math.random() * Math.PI * 2;
      }
    }
  }

  tryEnterExit(p: Player): void {
    if (p.vehicleId) {
      const v = this.vehicles.get(p.vehicleId);
      if (v) v.driverId = null;
      p.vehicleId = null;
      if (v) {
        p.x = v.x - Math.cos(v.angle) * 30;
        p.y = v.y - Math.sin(v.angle) * 30;
        p.vx = 0; p.vy = 0;
      }
      if (p.ws) p.ws.send(encodeVehicleEvent(0), true);
      return;
    }
    let best: Vehicle | null = null;
    let bestDist = 100 * 100;
    for (const v of this.vehicles.values()) {
      if (v.driverId != null) continue;
      const dx = p.x - v.x;
      const dy = p.y - v.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestDist) { bestDist = d2; best = v; }
    }
    if (best) {
      best.driverId = p.id;
      p.vehicleId = best.id;
      p.x = best.x; p.y = best.y; p.angle = best.angle;
      if (p.ws) p.ws.send(encodeVehicleEvent(best.id), true);
    }
  }

  respawnPlayer(p: Player): void {
    p.dead = false;
    p.hp = 100;
    p.vx = 0; p.vy = 0;
    let x = 100 + Math.random() * (WORLD_SIZE - 200);
    let y = 100 + Math.random() * (WORLD_SIZE - 200);
    for (let i = 0; i < 20 && this.world.collides(x, y, 10); i++) {
      x = 100 + Math.random() * (WORLD_SIZE - 200);
      y = 100 + Math.random() * (WORLD_SIZE - 200);
    }
    p.x = x; p.y = y;
  }

  fireWeapon(p: Player): void {
    const weapon = WEAPONS[p.weapon];
    if (!weapon || this.tick - p.lastFireTick < weapon.fireRateTicks) return;
    p.lastFireTick = this.tick;
    const aim = p.vehicleId ? p.lastInput.angle : p.angle;
    let best: Player | null = null;
    let bestDist = weapon.range;
    for (const q of this.players.values()) {
      if (q.id === p.id || q.dead) continue;
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const dist = Math.hypot(dx, dy);
      if (dist > weapon.range) continue;
      const angleTo = Math.atan2(dy, dx);
      const perp = Math.abs(Math.sin(wrapAngle(aim - angleTo))) * dist;
      if (perp > weapon.spread) continue;
      if (dist < bestDist) { bestDist = dist; best = q; }
    }
    if (!best) return;
    best.hp -= weapon.damage;
    if (best.hp <= 0) this.killPlayer(p, best);
  }

  killPlayer(killer: Player, victim: Player): void {
    victim.hp = 0;
    victim.dead = true;
    victim.respawnTick = this.tick + 80; // 4 s at 20 Hz
    victim.deaths++;
    killer.kills++;
    if (victim.vehicleId) {
      const v = this.vehicles.get(victim.vehicleId);
      if (v) v.driverId = null;
      victim.vehicleId = null;
    }
    const buf = encodeKillEvent(killer.id, victim.id);
    for (const rp of this.players.values()) {
      if (rp.ws) rp.ws.send(buf, true);
    }
  }

  private inInterest(p: Player, e: EntityDelta): boolean {
    // always include self; include others within 1000 px (~one screen)
    if (e.id === p.id) return true;
    const dx = p.x - (e.x ?? 0);
    const dy = p.y - (e.y ?? 0);
    return dx * dx + dy * dy < 1000 * 1000;
  }

  private pushDelta(e: EntityDelta, id: number, changed: number, color: number, source: { x: number; y: number; angle: number; hp: number; vx: number; vy: number }): void {
    e.id = id;
    e.changed = changed;
    e.color = color;
    e.x = source.x;
    e.y = source.y;
    e.angle = source.angle;
    e.hp = source.hp;
    e.vx = source.vx;
    e.vy = source.vy;
  }

  computeDeltas(): EntityDelta[] {
    const entities: EntityDelta[] = [];
    let i = 0;
    for (const p of this.players.values()) {
      let e = this.deltaPool[i];
      if (!e) { e = { id: p.id, changed: 0 }; this.deltaPool[i] = e; }
      i++;
      const prev = this.prevStates.get(p.id)!;
      const changed = p.getChanged(prev);
      this.pushDelta(e, p.id, changed, p.color, p);
      entities.push(e);
      if (changed) {
        prev.x = p.x; prev.y = p.y; prev.angle = p.angle; prev.hp = p.hp; prev.vx = p.vx; prev.vy = p.vy;
      }
    }
    for (const v of this.vehicles.values()) {
      let e = this.deltaPool[i];
      if (!e) { e = { id: v.id, changed: 0 }; this.deltaPool[i] = e; }
      i++;
      const prev = this.vehiclePrevStates.get(v.id)!;
      const changed = getVehicleChanged(v, prev);
      this.pushDelta(e, v.id, changed, 100 + v.type, v);
      entities.push(e);
      if (changed) {
        prev.x = v.x; prev.y = v.y; prev.angle = v.angle; prev.hp = v.hp; prev.vx = v.vx; prev.vy = v.vy;
      }
    }
    return entities;
  }

  broadcastSnapshot(): void {
    const deltas = this.computeDeltas();
    const visible: EntityDelta[] = [];
    for (const p of this.players.values()) {
      const ws = p.ws;
      if (!ws) continue;
      visible.length = 0;
      for (const e of deltas) {
        if (this.inInterest(p, e)) visible.push(e);
      }
      const snap: Snapshot = { tick: this.tick, ackSeq: p.lastSeq, entities: visible };
      const data = encodeSnapshot(snap, p.sendBuf);
      ws.send(data, true);
    }
  }
}
