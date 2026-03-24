import { Level, Polygon, Position, ElmaObject, Picture } from 'elmajs';
import type { Operation } from './operations';
import type { ClientMessage, ServerMessage, UserInfo, BikeSnapshot } from './protocol';
import { applyOperation } from './operationApplier';
import type { Vec2 } from '@/types';

// ── Base64 helpers ────────────────────────────────────────────────────────────

/** Serialize a level to a JSON string with all data including IDs. */
export function levelToWire(level: Level): string {
  return JSON.stringify({
    name: level.name ?? '',
    ground: level.ground ?? '',
    sky: level.sky ?? '',
    polygons: level.polygons.map((p) => ({
      id: p.id,
      grass: p.grass,
      vertices: p.vertices.map((v) => ({ x: v.x, y: v.y })),
    })),
    objects: level.objects.map((o) => ({
      id: o.id,
      x: o.position.x,
      y: o.position.y,
      type: o.type,
      gravity: o.gravity,
      animation: o.animation,
    })),
    pictures: level.pictures.map((p) => ({
      id: p.id,
      name: p.name,
      texture: p.texture,
      mask: p.mask,
      x: p.position.x,
      y: p.position.y,
      clip: p.clip,
      distance: p.distance,
    })),
  });
}

/** Deserialize a level from the JSON wire format. */
export function levelFromWire(data: string): Level {
  const parsed = JSON.parse(data);
  const level = new Level();
  level.name = parsed.name ?? '';
  level.ground = parsed.ground ?? '';
  level.sky = parsed.sky ?? '';

  level.polygons = parsed.polygons.map((p: any) => {
    const poly = new Polygon();
    poly.id = p.id;
    poly.grass = p.grass;
    poly.vertices = p.vertices.map((v: any) => new Position(v.x, v.y));
    return poly;
  });

  level.objects = parsed.objects.map((o: any) => {
    const obj = new ElmaObject();
    obj.id = o.id;
    obj.position = new Position(o.x, o.y);
    obj.type = o.type;
    obj.gravity = o.gravity;
    obj.animation = o.animation;
    return obj;
  });

  level.pictures = parsed.pictures.map((p: any) => {
    const pic = new Picture();
    pic.id = p.id;
    pic.name = p.name;
    pic.texture = p.texture || '';
    pic.mask = p.mask || '';
    pic.position = new Position(p.x, p.y);
    pic.clip = p.clip;
    pic.distance = p.distance;
    return pic;
  });

  return level;
}

// ── CollabClient ──────────────────────────────────────────────────────────────

export class CollabClient {
  private ws: WebSocket | null = null;
  private userId: string = '';
  private clientSeq: number = 0;
  private roomId: string = '';
  private userName: string = '';
  private getStore: () => any;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 10;

  constructor(getStore: () => any) {
    this.getStore = getStore;
  }

  // ── Public API ────────────────────────────────────────────────────────────

  connect(roomId: string, userName: string): void {
    this.roomId = roomId;
    this.userName = userName;

    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${protocol}://${window.location.host}/ws`;

    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      const joinMsg: ClientMessage = { type: 'join', roomId, userName };

      const store = this.getStore();
      if (store.level) {
        joinMsg.level = levelToWire(store.level);
      }

      this.send(joinMsg);
    };

    this.ws.onmessage = (event: MessageEvent) => {
      const raw = JSON.parse(event.data as string);
      // Handle game-related messages inline to prevent bundler tree-shaking
      if (raw.type === 'bikeState') {
        this.getStore().setRemoteBikeState(raw.userId, raw.bike);
        return;
      }
      if (raw.type === 'testingStarted') {
        this.getStore().setRemoteTesting(raw.userId, true);
        return;
      }
      if (raw.type === 'testingStopped') {
        this.getStore().setRemoteTesting(raw.userId, false);
        return;
      }
      this.handleServerMessage(raw as ServerMessage);
    };

    this.ws.onclose = () => {
      this.attemptReconnect();
    };

    this.ws.onerror = (event: Event) => {
      console.error('[CollabClient] WebSocket error:', event);
    };
  }

  disconnect(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.onclose = null; // prevent reconnect on intentional close
      this.ws.close();
      this.ws = null;
    }

    this.reconnectAttempts = 0;
    this.userId = '';
    this.clientSeq = 0;
    this.roomId = '';
    this.userName = '';
  }

  sendOperation(op: Operation): void {
    if (!this.connected) return;
    this.clientSeq++;
    this.send({ type: 'operation', op, clientSeq: this.clientSeq });
  }

  sendAwareness(
    cursor: Vec2 | null,
    selectedPolygonIds: string[],
    selectedObjectIds: string[],
    activeTool: string,
  ): void {
    if (!this.connected) return;
    this.send({ type: 'awareness', cursor, selectedPolygonIds, selectedObjectIds, activeTool });
  }


  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  get currentUserId(): string {
    return this.userId;
  }

  // ── Server message handler ────────────────────────────────────────────────

  private handleServerMessage(msg: ServerMessage): void {
    const store = this.getStore();

    switch (msg.type) {
      case 'welcome': {
        this.userId = msg.userId;
        this.reconnectAttempts = 0;
        const level = levelFromWire(msg.level);
        store.loadCollabLevel(level, msg.users);
        break;
      }

      case 'operation': {
        if (msg.userId === this.userId) return;
        store.applyRemoteOperation(msg.op, msg.userId);
        break;
      }

      case 'ack': {
        break;
      }

      case 'awareness': {
        store.updateRemoteUser(msg.userId, {
          cursor: msg.cursor,
          selectedPolygonIds: msg.selectedPolygonIds,
          selectedObjectIds: msg.selectedObjectIds,
          activeTool: msg.activeTool,
        });
        break;
      }

      case 'userJoined': {
        store.addRemoteUser(msg.user);
        break;
      }

      case 'userLeft': {
        store.removeRemoteUser(msg.userId);
        break;
      }

      case 'sync': {
        const level = levelFromWire(msg.level);
        store.loadCollabLevel(level, []);
        break;
      }

      case 'error': {
        console.error('[CollabClient] Server error:', msg.message);
        break;
      }
    }
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  /** Send a message on the WebSocket. Public for direct use by game overlay. */
  send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.warn('[CollabClient] Max reconnect attempts reached, giving up');
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    console.info('[CollabClient] Reconnecting in %dms (attempt %d/%d)', delay, this.reconnectAttempts + 1, this.maxReconnectAttempts);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect(this.roomId, this.userName);
    }, delay);

    this.reconnectAttempts++;
  }
}

