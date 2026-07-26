import { App, DISABLED, type HttpResponse, type HttpRequest } from 'uWebSockets.js';
import { decodeInput, Op, type CreateRoomRequest, type JoinRoomRequest, type RoomInfo } from '@mini-gta/shared';
import { Room } from './Room.js';
import type { UserData } from './types.js';

const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || '0.0.0.0';

const rooms = new Map<string, Room>();
const joinCodeToRoom = new Map<string, string>();
const tokenToRoom = new Map<string, { roomId: string; playerId: number }>();

function makeId(len = 6): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

const STATUS_TEXT: Record<number, string> = { 200: 'OK', 400: 'Bad Request', 403: 'Forbidden', 404: 'Not Found' };

function json(res: HttpResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeStatus(`${status} ${STATUS_TEXT[status] ?? ''}`);
  res.writeHeader('Content-Type', 'application/json');
  res.writeHeader('Access-Control-Allow-Origin', '*');
  res.end(body);
}

function readBody(res: HttpResponse, req: HttpRequest, cb: (body: string) => void): void {
  let buffer = '';
  res.onData((chunk: ArrayBuffer, isLast: boolean) => {
    buffer += Buffer.from(chunk).toString();
    if (isLast) cb(buffer);
  });
  res.onAborted(() => {});
}

const app = App();

app.get('/api/rooms', (res) => {
  const list: RoomInfo[] = [...rooms.values()].map(r => r.publicInfo());
  json(res, 200, list);
});

app.post('/api/rooms', (res, req) => {
  readBody(res, req, (body) => {
    try {
      const data = JSON.parse(body) as CreateRoomRequest;
      const id = makeId(8);
      const joinCode = makeId(6);
      const seed = data.seed || makeId(12);
      const max = Math.min(100, Math.max(2, data.maxPlayers ?? 100));
      const room = new Room(id, joinCode, (data.mapName || 'Liberty Bean').slice(0, 24), seed, max, data.password);
      rooms.set(id, room);
      joinCodeToRoom.set(joinCode, id);
      json(res, 200, { roomId: id, joinCode });
    } catch (e) {
      json(res, 400, { error: 'bad request' });
    }
  });
});

app.post('/api/rooms/:id/join', (res, req) => {
  const id = req.getParameter(0) || '';
  readBody(res, req, (body) => {
    try {
      const room = rooms.get(id);
      if (!room) { json(res, 404, { error: 'not found' }); return; }
      const data = JSON.parse(body) as JoinRoomRequest;
      if (!room.checkPassword(data.password)) { json(res, 403, { error: 'wrong password' }); return; }
      const proto = req.getHeader('x-forwarded-proto') === 'https' ? 'wss' : 'ws';
      const host = req.getHeader('host') || `${HOST}:${PORT}`;
      json(res, 200, { roomId: id, wsUrl: `${proto}://${host}/ws?roomId=${id}` });
    } catch (e) {
      json(res, 400, { error: 'bad request' });
    }
  });
});

app.get('/api/rooms/:id', (res, req) => {
  const room = rooms.get(req.getParameter(0) || '');
  if (!room) { json(res, 404, { error: 'not found' }); return; }
  json(res, 200, room.publicInfo());
});

app.get('/health', (res) => {
  json(res, 200, { ok: true, rooms: rooms.size });
});

app.get('/metrics', (res) => {
  let players = 0;
  for (const r of rooms.values()) players += r.players.size;
  const usage = process.cpuUsage();
  json(res, 200, {
    rooms: rooms.size,
    players,
    lastTickMs,
    cpuUser: usage.user,
    cpuSystem: usage.system,
  });
});

app.ws<UserData>('/ws', {
  compression: DISABLED,
  maxPayloadLength: 64,
  idleTimeout: 120,
  upgrade: (res, req, context) => {
    // copy query strings; uWebSockets may reuse the underlying buffer
    const roomId = (req.getQuery('roomId') || '').slice().replace(/\0/g, '').trim();
    const name = (req.getQuery('name') || 'Player').slice(0, 16).replace(/\0/g, '').trim();
    const room = rooms.get(roomId);
    if (!room) { res.writeStatus('404 Not Found'); res.end(); return; }
    const secKey = req.getHeader('sec-websocket-key') || '';
    const secProto = req.getHeader('sec-websocket-protocol') || '';
    const secExt = req.getHeader('sec-websocket-extensions') || '';
    res.upgrade({ roomId, name }, secKey, secProto, secExt, context);
  },
  open: (ws) => {
    const data = ws.getUserData();
    const room = rooms.get(data.roomId);
    if (!room) { ws.close(); return; }
    const p = room.addPlayer(data.name, ws);
    if (!p) { ws.close(); return; }
    data.playerId = p.id;
    // tell client its own id
    const assign = new ArrayBuffer(3);
    const v = new DataView(assign);
    v.setUint8(0, Op.AssignId);
    v.setUint16(1, p.id, true);
    ws.send(assign, true);
    ws.subscribe(`room:${room.id}`);
  },
  message: (ws, message) => {
    const data = ws.getUserData();
    const room = rooms.get(data.roomId);
    const p = room?.players.get(data.playerId ?? -1);
    if (!p) return;
    const arr = new Uint8Array(message);
    if (arr.length < 1) return;
    const op = arr[0];
    if (op === Op.Input && arr.length >= 8) {
      const { seq, keys, actions, angle } = decodeInput(arr.buffer.slice(arr.byteOffset, arr.byteOffset + 8));
      p.lastInput = { seq, keys, actions, angle, time: Date.now() };
      p.lastSeq = Math.max(p.lastSeq, seq);
    } else if (op === Op.Ping) {
      const pong = new ArrayBuffer(1);
      new Uint8Array(pong)[0] = Op.Pong;
      ws.send(pong, true);
    }
  },
  close: (ws) => {
    const data = ws.getUserData();
    const room = rooms.get(data.roomId);
    if (room && data.playerId) {
      room.removePlayer(data.playerId);
      if (room.players.size === 0) {
        // garbage collect after 60s
        setTimeout(() => {
          if (room.players.size === 0) {
            rooms.delete(room.id);
            joinCodeToRoom.delete(room.joinCode);
          }
        }, 60000);
      }
    }
  },
});

let lastTickMs = 0;

// Simulation loop
function tickAll(): void {
  const t0 = process.hrtime.bigint();
  for (const room of rooms.values()) {
    room.update(1 / 20);
    room.broadcastSnapshot();
  }
  const t1 = process.hrtime.bigint();
  lastTickMs = Number(t1 - t0) / 1_000_000;
}

app.listen(HOST, PORT, (listenSocket) => {
  if (listenSocket) {
    console.log(`Mikro GTA server listening on http://${HOST}:${PORT}`);
    setInterval(tickAll, 1000 / 20);
  } else {
    console.error('Failed to listen');
    process.exit(1);
  }
});

// expose metrics every 10s for load test
setInterval(() => {
  let players = 0;
  for (const r of rooms.values()) players += r.players.size;
  console.log(`metrics rooms=${rooms.size} players=${players}`);
}, 10000);
