import { WebSocket } from 'ws';
import { Level } from 'elmajs';
import type { Operation } from '../src/collab/operations.js';
import type { ClientMessage, ServerMessage, UserInfo } from '../src/collab/protocol.js';
import { USER_COLORS } from '../src/collab/protocol.js';
import { applyOperation } from '../src/collab/operationApplier.js';
import { levelToWire, levelFromWire } from '../src/collab/CollabClient.js';

const MAX_OP_LOG = 1000;

interface Client {
  ws: WebSocket;
  userId: string;
  userName: string;
  color: string;
}

export class Room {
  readonly roomId: string;
  private level: Level | null = null;
  private clients: Map<WebSocket, Client> = new Map();
  private opLog: Array<{ op: Operation; userId: string; serverSeq: number }> = [];
  private serverSeq = 0;
  private colorIndex = 0;

  constructor(roomId: string) {
    this.roomId = roomId;
  }

  get isEmpty(): boolean {
    return this.clients.size === 0;
  }

  join(ws: WebSocket, userName: string, levelBase64?: string): void {
    const userId = Math.random().toString(36).slice(2, 10);
    const color = USER_COLORS[this.colorIndex % USER_COLORS.length]!;
    this.colorIndex++;

    const client: Client = { ws, userId, userName, color };
    this.clients.set(ws, client);

    // First user provides the level
    if (this.level === null) {
      if (levelBase64) {
        try {
          this.level = levelFromWire(levelBase64);
        } catch (err) {
          console.error(`[Room ${this.roomId}] Failed to parse level from first user:`, err);
          this.level = new Level();
        }
      } else {
        this.level = new Level();
      }
    }

    // Send welcome to the new user
    const users: UserInfo[] = [];
    for (const c of this.clients.values()) {
      users.push({ userId: c.userId, userName: c.userName, color: c.color });
    }

    const welcomeMsg: ServerMessage = {
      type: 'welcome',
      userId,
      level: levelToWire(this.level),
      users,
      serverSeq: this.serverSeq,
    };
    this.send(ws, welcomeMsg);

    // Broadcast userJoined to others
    const joinMsg: ServerMessage = {
      type: 'userJoined',
      user: { userId, userName, color },
    };
    this.broadcastExcept(ws, joinMsg);

    console.log(`[Room ${this.roomId}] User "${userName}" (${userId}) joined. Total: ${this.clients.size}`);
  }

  handleOperation(ws: WebSocket, op: Operation, clientSeq: number): void {
    const client = this.clients.get(ws);
    if (!client || !this.level) return;

    try {
      this.level = applyOperation(this.level, op);
      this.serverSeq++;

      // Store in ring buffer
      this.opLog.push({ op, userId: client.userId, serverSeq: this.serverSeq });
      if (this.opLog.length > MAX_OP_LOG) {
        this.opLog.shift();
      }

      // Broadcast to others
      const broadcastMsg: ServerMessage = {
        type: 'operation',
        op,
        userId: client.userId,
        serverSeq: this.serverSeq,
      };
      this.broadcastExcept(ws, broadcastMsg);

      // Ack to sender
      const ackMsg: ServerMessage = {
        type: 'ack',
        clientSeq,
        serverSeq: this.serverSeq,
      };
      this.send(ws, ackMsg);
    } catch (err) {
      console.error(`[Room ${this.roomId}] Failed to apply operation:`, err);
      this.sendSync(ws);
    }
  }

  handleAwareness(ws: WebSocket, data: {
    cursor: { x: number; y: number } | null;
    selectedPolygonIds: string[];
    selectedObjectIds: string[];
    activeTool: string;
  }): void {
    const client = this.clients.get(ws);
    if (!client) return;

    const msg: ServerMessage = {
      type: 'awareness',
      userId: client.userId,
      cursor: data.cursor,
      selectedPolygonIds: data.selectedPolygonIds,
      selectedObjectIds: data.selectedObjectIds,
      activeTool: data.activeTool,
    };
    this.broadcastExcept(ws, msg);
  }

  leave(ws: WebSocket): void {
    const client = this.clients.get(ws);
    if (!client) return;

    this.clients.delete(ws);

    const leaveMsg: ServerMessage = {
      type: 'userLeft',
      userId: client.userId,
    };
    this.broadcastExcept(ws, leaveMsg);

    console.log(`[Room ${this.roomId}] User "${client.userName}" (${client.userId}) left. Remaining: ${this.clients.size}`);
  }

  /** Relay a client message to all other clients, injecting the sender's userId. */
  relay(ws: WebSocket, msg: any): void {
    const client = this.clients.get(ws);
    if (!client) return;
    const outMsg = { ...msg, userId: client.userId };
    this.broadcastExcept(ws, outMsg);
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private send(ws: WebSocket, msg: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  private broadcastExcept(exclude: WebSocket, msg: ServerMessage): void {
    const data = JSON.stringify(msg);
    for (const [clientWs] of this.clients) {
      if (clientWs !== exclude && clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(data);
      }
    }
  }

  private sendSync(ws: WebSocket): void {
    if (!this.level) return;
    const syncMsg: ServerMessage = {
      type: 'sync',
      level: levelToWire(this.level),
      serverSeq: this.serverSeq,
    };
    this.send(ws, syncMsg);
  }
}
