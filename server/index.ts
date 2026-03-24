import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import type { ClientMessage } from '../src/collab/protocol.js';
import { Room } from './Room.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Express app ─────────────────────────────────────────────────────────────

const app = express();

// Serve production client build
const staticDir = path.resolve(__dirname, '..', 'dist');
app.use(express.static(staticDir));

// SPA fallback
app.get('*', (_req, res) => {
  res.sendFile(path.join(staticDir, 'index.html'));
});

// ── HTTP + WebSocket server ─────────────────────────────────────────────────

const server = createServer(app);

const wss = new WebSocketServer({ server, path: '/ws' });

// ── Room registry ───────────────────────────────────────────────────────────

const rooms: Map<string, Room> = new Map();

function getOrCreateRoom(roomId: string): Room {
  let room = rooms.get(roomId);
  if (!room) {
    room = new Room(roomId);
    rooms.set(roomId, room);
    console.log(`[Server] Room "${roomId}" created. Active rooms: ${rooms.size}`);
  }
  return room;
}

function removeRoomIfEmpty(roomId: string): void {
  const room = rooms.get(roomId);
  if (room && room.isEmpty) {
    rooms.delete(roomId);
    console.log(`[Server] Room "${roomId}" destroyed. Active rooms: ${rooms.size}`);
  }
}

// ── WebSocket connection handling ───────────────────────────────────────────

// Track which room each socket belongs to
const socketRoom: Map<WebSocket, string> = new Map();

wss.on('connection', (ws: WebSocket) => {
  console.log(`[Server] New WebSocket connection. Total connections: ${wss.clients.size}`);

  ws.on('message', (data) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(data.toString()) as ClientMessage;
    } catch (err) {
      console.error('[Server] Failed to parse message:', err);
      return;
    }

    switch (msg.type) {
      case 'join': {
        const roomId = msg.roomId || Math.random().toString(36).slice(2, 10);
        const room = getOrCreateRoom(roomId);
        socketRoom.set(ws, roomId);
        room.join(ws, msg.userName, msg.level);
        break;
      }

      case 'operation': {
        const roomId = socketRoom.get(ws);
        if (!roomId) return;
        const room = rooms.get(roomId);
        if (!room) return;
        room.handleOperation(ws, msg.op, msg.clientSeq);
        break;
      }

      case 'awareness': {
        const roomId = socketRoom.get(ws);
        if (!roomId) return;
        const room = rooms.get(roomId);
        if (!room) return;
        room.handleAwareness(ws, {
          cursor: msg.cursor,
          selectedPolygonIds: msg.selectedPolygonIds,
          selectedObjectIds: msg.selectedObjectIds,
          activeTool: msg.activeTool,
        });
        break;
      }

      case 'bikeState':
      case 'testingStarted':
      case 'testingStopped': {
        const roomId = socketRoom.get(ws);
        if (!roomId) return;
        const room = rooms.get(roomId);
        if (!room) return;
        if (msg.type !== 'bikeState') console.log(`[Server] Relaying ${msg.type} in room ${roomId}`);
        room.relay(ws, msg);
        break;
      }

      case 'undo':
      case 'redo': {
        break;
      }

      default: {
        console.warn('[Server] Unknown message type:', (msg as { type: string }).type);
      }
    }
  });

  ws.on('close', () => {
    const roomId = socketRoom.get(ws);
    if (roomId) {
      const room = rooms.get(roomId);
      if (room) {
        room.leave(ws);
        removeRoomIfEmpty(roomId);
      }
      socketRoom.delete(ws);
    }
    console.log(`[Server] WebSocket disconnected. Total connections: ${wss.clients.size}`);
  });

  ws.on('error', (err) => {
    console.error('[Server] WebSocket error:', err);
  });
});

// ── Start listening ─────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT || '8080', 10);

server.listen(PORT, () => {
  console.log(`[Server] Listening on http://localhost:${PORT}`);
  console.log(`[Server] WebSocket endpoint: ws://localhost:${PORT}/ws`);
  console.log(`[Server] Serving static files from: ${staticDir}`);
});
