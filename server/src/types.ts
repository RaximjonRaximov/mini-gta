import type { WebSocket } from 'uWebSockets.js';

export interface UserData {
  roomId: string;
  name: string;
  playerId?: number;
}

export type UwsSocket = WebSocket<UserData>;

export * from '@mini-gta/shared';
export { Player, sanitizeName } from './Player.js';
