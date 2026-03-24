import type { CollabClient } from './CollabClient';
import type { Vec2, SelectionState } from '@/types';

let lastSentTime = 0;
const THROTTLE_MS = 50;

/**
 * Throttled awareness broadcast. Sends cursor position, selection, and active tool
 * to the collaboration server at most every THROTTLE_MS milliseconds.
 */
export function broadcastAwareness(
  client: CollabClient | null,
  cursor: Vec2 | null,
  selection: SelectionState,
  activeTool: string,
): void {
  if (!client || !client.connected) return;

  const now = Date.now();
  if (now - lastSentTime < THROTTLE_MS) return;
  lastSentTime = now;

  client.sendAwareness(
    cursor,
    [...selection.polygonIds],
    [...selection.objectIds],
    activeTool,
  );
}
