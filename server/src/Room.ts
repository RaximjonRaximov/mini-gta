import { Player, sanitizeName, type UwsSocket } from './types.js';
import { World } from './World.js';
import { encodeSnapshot, ChangedField, TICK_RATE, WORLD_SIZE, PLAYER_COLORS, type Snapshot, type EntityDelta } from '@mini-gta/shared';

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
  private deltaPool: EntityDelta[] = [];
  world: World;

  constructor(id: string, joinCode: string, mapName: string, seed: string, maxPlayers: number, password?: string) {
    this.id = id;
    this.joinCode = joinCode;
    this.mapName = mapName;
    this.seed = seed;
    this.maxPlayers = maxPlayers;
    this.passwordHash = password || null;
    this.world = new World(seed);
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
      const oldX = p.x;
      const oldY = p.y;
      p.applyInput(1 / TICK_RATE);
      this.world.resolve(p, oldX, oldY);
    }
  }

  private inInterest(p: Player, e: EntityDelta): boolean {
    // always include self; include others within 1500 px (~1.5 screens)
    if (e.id === p.id) return true;
    const ex = this.players.get(e.id);
    if (!ex) return false;
    const dx = p.x - ex.x;
    const dy = p.y - ex.y;
    return dx * dx + dy * dy < 1500 * 1500;
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
      e.id = p.id;
      e.changed = changed;
      e.color = p.color;
      if (changed & ChangedField.X) e.x = p.x; else e.x = undefined;
      if (changed & ChangedField.Y) e.y = p.y; else e.y = undefined;
      if (changed & ChangedField.Angle) e.angle = p.angle; else e.angle = undefined;
      if (changed & ChangedField.Hp) e.hp = p.hp; else e.hp = undefined;
      if (changed & ChangedField.Vel) { e.vx = p.vx; e.vy = p.vy; } else { e.vx = undefined; e.vy = undefined; }
      entities.push(e);
      if (changed) {
        prev.x = p.x; prev.y = p.y; prev.angle = p.angle; prev.hp = p.hp; prev.vx = p.vx; prev.vy = p.vy;
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
      ws.cork(() => {
        ws.send(encodeSnapshot(snap), true);
      });
    }
  }
}
