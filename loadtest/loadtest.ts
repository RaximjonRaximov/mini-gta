import WebSocket from 'ws';
import { encodeInput, Op, InputKey } from '@mini-gta/shared';

const SERVER = process.env.SERVER || 'ws://localhost:3001';
const HTTP = SERVER.replace(/^ws/, 'http');
const BOT_COUNT = Number(process.env.BOTS || 100);
const DURATION_MS = Number(process.env.DURATION || 30000);

interface Bot {
  ws: WebSocket;
  seq: number;
  bytesIn: number;
  lastInputSend: number;
  latencies: number[];
  acks: Map<number, number>;
  connectedAt: number;
}

async function createRoom(): Promise<string> {
  const res = await fetch(`${HTTP}/api/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerName: 'Host', mapName: 'LoadTest', maxPlayers: 100 }),
  });
  const data = (await res.json()) as { roomId: string };
  return data.roomId;
}

function randomKeys(): number {
  let k = 0;
  if (Math.random() < 0.5) k |= InputKey.Up;
  if (Math.random() < 0.5) k |= InputKey.Down;
  if (Math.random() < 0.5) k |= InputKey.Left;
  if (Math.random() < 0.5) k |= InputKey.Right;
  if (Math.random() < 0.2) k |= InputKey.Sprint;
  return k;
}

function connectBot(roomId: string, name: string): Promise<Bot> {
  return new Promise((resolve, reject) => {
    const url = `${SERVER}/ws?roomId=${roomId}&name=${encodeURIComponent(name)}`;
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    const bot: Bot = { ws, seq: 0, bytesIn: 0, lastInputSend: 0, latencies: [], acks: new Map(), connectedAt: Date.now() };
    ws.on('open', () => resolve(bot));
    ws.on('error', reject);
    ws.on('message', (data: ArrayBuffer) => {
      bot.bytesIn += data.byteLength;
      const op = new Uint8Array(data)[0];
      if (op === Op.Snapshot) {
        // ackSeq is at byte offset 5 (op=1, tick=4)
        const ackSeq = new DataView(data).getUint16(5, true);
        const sent = bot.acks.get(ackSeq);
        if (sent) {
          bot.latencies.push(Date.now() - sent);
          bot.acks.delete(ackSeq);
        }
      }
    });
  });
}

async function main(): Promise<void> {
  const roomId = await createRoom();
  console.log(`Room ${roomId} created, spawning ${BOT_COUNT} bots...`);
  const bots: Bot[] = [];
  const startConnect = Date.now();
  for (let i = 0; i < BOT_COUNT; i++) {
    try {
      const b = await connectBot(roomId, `Bot${i}`);
      bots.push(b);
    } catch (e) {
      console.error('connect failed', e);
    }
    if (i % 10 === 0) await new Promise(r => setTimeout(r, 50));
  }
  console.log(`${bots.length} bots connected in ${Date.now() - startConnect}ms`);

  const inputInterval = setInterval(() => {
    const now = Date.now();
    for (const b of bots) {
      if (b.ws.readyState !== WebSocket.OPEN) continue;
      if (now - b.lastInputSend < 1000 / 30) continue;
      b.seq = (b.seq + 1) % 65536;
      const keys = randomKeys();
      const angle = Math.random() * Math.PI * 2;
      const buf = encodeInput(b.seq, keys, 0, angle);
      b.acks.set(b.seq, now);
      b.ws.send(buf);
      b.lastInputSend = now;
    }
  }, 1000 / 30);

  const metrics: number[] = [];
  const metricInterval = setInterval(async () => {
    try {
      const res = await fetch(`${HTTP}/metrics`);
      const m = (await res.json()) as { lastTickMs: number; tickP99: number; updateMs: number; snapshotMs: number; players: number };
      metrics.push(m.tickP99 ?? m.lastTickMs);
      console.log(`tick=${m.lastTickMs.toFixed(2)}ms update=${m.updateMs.toFixed(2)}ms snapshot=${m.snapshotMs.toFixed(2)}ms p99=${(m.tickP99 ?? 0).toFixed(2)}ms players=${m.players}`);
    } catch { /* ignore */ }
  }, 1000);

  await new Promise(r => setTimeout(r, DURATION_MS));
  clearInterval(inputInterval);
  clearInterval(metricInterval);

  // summary
  const totalBytes = bots.reduce((s, b) => s + b.bytesIn, 0);
  const totalLat = bots.flatMap(b => b.latencies);
  totalLat.sort((a, b) => a - b);
  const p99 = totalLat[Math.floor(totalLat.length * 0.99)] ?? 0;
  const avg = totalLat.length ? totalLat.reduce((a, b) => a + b, 0) / totalLat.length : 0;
  const avgBw = (totalBytes / (DURATION_MS / 1000)) / bots.length;
  metrics.sort((a, b) => a - b);
  const tickP99 = metrics.length ? metrics[Math.floor(metrics.length * 0.99)] : 0;
  const cpu = process.cpuUsage();
  console.log('\n--- Load Test Summary ---');
  console.log(`Bots: ${bots.length}`);
  console.log(`Avg downstream: ${avgBw.toFixed(1)} bytes/s per bot`);
  console.log(`Latency avg: ${avg.toFixed(1)}ms p99: ${p99}ms`);
  console.log(`Server tick p99: ${tickP99.toFixed(3)}ms`);
  console.log(`Client CPU user: ${(cpu.user / 1000).toFixed(1)}ms system: ${(cpu.system / 1000).toFixed(1)}ms`);
  for (const b of bots) b.ws.close();
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
