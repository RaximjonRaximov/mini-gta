# Mikro GTA

Browser-only top-down 2D multiplayer comedy GTA (GTA 1/2 style). Phases 1-7 are implemented as a runnable prototype: netcode, deterministic city, vehicles, combat, NPCs, economy (money/wanted), and polish (audio, i18n, mobile controls, settings mute).

## Quick start

```bash
npm install
npm run build
npm start
```

Open `http://localhost:5173` for the client (or use `npm run dev` and Vite will proxy the server).

## Load test

```bash
BOTS=100 DURATION=15000 npx tsx loadtest/loadtest.ts
```

Acceptance (local, 100 bots + 300 NPCs):
- 100 bots connect to one room
- Server tick p99 < 10 ms
- Avg downstream per bot ~3.5 KB/s (target 10 KB/s normal, 60 KB/s peak)

## Controls

- `WASD` / arrows — move / drive
- `Shift` — sprint
- `Mouse` — aim / left click to shoot
- `Space` — enter/exit vehicle
- `E` — interact
- `Mute button` — toggle synthesized audio
- `Language button` — toggle `uz` / `en`
- Touch devices: left virtual joystick, right FIRE / CAR buttons, tap/drag elsewhere to aim

## Architecture

- TypeScript strict monorepo (`shared/`, `server/`, `client/`, `loadtest/`)
- Vite + Canvas 2D client
- Node + uWebSockets.js server
- Binary `ArrayBuffer` protocol with quantized positions/angles/velocities
- Server-authoritative, client prediction + server reconciliation + remote interpolation
- 20 Hz server tick, 20 Hz snapshots, 30 Hz input, 60 Hz render
- Spatial interest management (≈1000 px radius)
- Seeded deterministic 8192×8192 city; server only sends the seed
- Synthesized audio via Web Audio API, no external assets
