import type { Operation } from './operations';
import type { Vec2 } from '@/types';

// ── User info ────────────────────────────────────────────────────────────────

export interface UserInfo {
  userId: string;
  userName: string;
  color: string;
}

// ── Client → Server ──────────────────────────────────────────────────────────

/** Compact bike state for network sync (~60 bytes). */
export interface BikeSnapshot {
  bikeX: number; bikeY: number; bikeRot: number;
  lwX: number; lwY: number; lwRot: number;
  rwX: number; rwY: number; rwRot: number;
  bodyX: number; bodyY: number;
  headX: number; headY: number;
  flipped: boolean;
  alive: boolean;
}

export type ClientMessage =
  | { type: 'join'; roomId: string; userName: string; level?: string }
  | { type: 'operation'; op: Operation; clientSeq: number }
  | { type: 'awareness'; cursor: Vec2 | null; selectedPolygonIds: string[]; selectedObjectIds: string[]; activeTool: string }
  | { type: 'bikeState'; bike: BikeSnapshot }
  | { type: 'testingStarted' }
  | { type: 'testingStopped' }
  | { type: 'undo'; clientSeq: number }
  | { type: 'redo'; clientSeq: number };

// ── Server → Client ──────────────────────────────────────────────────────────

export type ServerMessage =
  | { type: 'welcome'; userId: string; level: string; users: UserInfo[]; serverSeq: number }
  | { type: 'operation'; op: Operation; userId: string; serverSeq: number }
  | { type: 'ack'; clientSeq: number; serverSeq: number }
  | { type: 'awareness'; userId: string; cursor: Vec2 | null; selectedPolygonIds: string[]; selectedObjectIds: string[]; activeTool: string }
  | { type: 'userJoined'; user: UserInfo }
  | { type: 'userLeft'; userId: string }
  | { type: 'bikeState'; userId: string; bike: BikeSnapshot }
  | { type: 'testingStarted'; userId: string }
  | { type: 'testingStopped'; userId: string }
  | { type: 'sync'; level: string; serverSeq: number }
  | { type: 'error'; message: string };

// ── Color palette for remote users ───────────────────────────────────────────

export const USER_COLORS = [
  '#e06c75', // red
  '#61afef', // blue
  '#98c379', // green
  '#e5c07b', // yellow
  '#c678dd', // purple
  '#56b6c2', // cyan
  '#d19a66', // orange
  '#be5046', // dark red
];
