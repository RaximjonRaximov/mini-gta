import { generateCity, type City, type Rect } from '@mini-gta/shared';

const CELL = 256;
const PLAYER_RADIUS = 10;

export class World {
  city: City;
  cells: Rect[][];
  cols: number;
  rows: number;

  constructor(seed: string) {
    this.city = generateCity(seed);
    this.cols = Math.ceil(this.city.worldSize / CELL);
    this.rows = Math.ceil(this.city.worldSize / CELL);
    this.cells = Array.from({ length: this.cols * this.rows }, () => []);
    for (const b of this.city.buildings) {
      const minX = Math.max(0, Math.floor(b.x / CELL));
      const maxX = Math.min(this.cols - 1, Math.floor((b.x + b.w) / CELL));
      const minY = Math.max(0, Math.floor(b.y / CELL));
      const maxY = Math.min(this.rows - 1, Math.floor((b.y + b.h) / CELL));
      for (let x = minX; x <= maxX; x++) {
        for (let y = minY; y <= maxY; y++) {
          this.cells[y * this.cols + x].push(b);
        }
      }
    }
  }

  private inBounds(x: number, y: number, r: number): boolean {
    return x >= r && x <= this.city.worldSize - r && y >= r && y <= this.city.worldSize - r;
  }

  collides(x: number, y: number, r = PLAYER_RADIUS): boolean {
    if (!this.inBounds(x, y, r)) return true;
    const cx = Math.floor(x / CELL);
    const cy = Math.floor(y / CELL);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= this.cols || ny >= this.rows) continue;
        for (const b of this.cells[ny * this.cols + nx]) {
          if (x > b.x - r && x < b.x + b.w + r && y > b.y - r && y < b.y + b.h + r) return true;
        }
      }
    }
    return false;
  }

  resolve(p: { x: number; y: number; vx: number; vy: number }, oldX: number, oldY: number, r = PLAYER_RADIUS): void {
    if (!this.collides(p.x, p.y, r)) return;
    if (!this.collides(oldX, p.y, r)) { p.x = oldX; p.vx = 0; }
    else if (!this.collides(p.x, oldY, r)) { p.y = oldY; p.vy = 0; }
    else { p.x = oldX; p.y = oldY; p.vx = 0; p.vy = 0; }
  }
}
