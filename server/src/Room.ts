import { Player, sanitizeName, type UwsSocket } from './types.js';
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

  constructor(id: string, joinCode: string, mapName: string, seed: string, maxPlayers: number, password?: string) {
    this.id = id;
    this.joinCode = joinCode;
    this.mapName = mapName;
    this.seed = seed;
    this.maxPlayers = maxPlayers;
    this.passwordHash = password || null;
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
    const x = 100 + Math.random() * (WORLD_SIZE - 200);
    const y = 100 + Math.random() * (WORLD_SIZE - 200);
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
      p.applyInput(1 / TICK_RATE);
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
    for (const p of this.players.values()) {
      const prev = this.prevStates.get(p.id)!;
      const changed = p.getChanged(prev);
      const e: EntityDelta = { id: p.id, changed };
      if (changed & ChangedField.X) e.x = p.x;
      if (changed & ChangedField.Y) e.y = p.y;
      if (changed & ChangedField.Angle) e.angle = p.angle;
      if (changed & ChangedField.Hp) e.hp = p.hp;
      if (changed & ChangedField.Vel) { e.vx = p.vx; e.vy = p.vy; }
      e.color = p.color;
      entities.push(e);
      if (changed) {
        this.prevStates.set(p.id, { x: p.x, y: p.y, angle: p.angle, hp: p.hp, vx: p.vx, vy: p.vy });
      }
    }
    return entities;
  }

  broadcastSnapshot(): void {
    const deltas = this.computeDeltas();
    const visible: EntityDelta[] = [];
    for (const p of this.players.values()) {
      if (!p.ws) continue;
      visible.length = 0;
      for (const e of deltas) {
        if (this.inInterest(p, e)) visible.push(e);
      }
      const snap: Snapshot = { tick: this.tick, ackSeq: p.lastSeq, entities: visible };
      p.ws.send(encodeSnapshot(snap), true);
    }
  }
}
