import type { Level } from 'elmajs';
import type { Operation } from './operations';
import { computeInverse } from './inverseOperation';

interface UndoEntry {
  op: Operation;
  levelBefore: Level;
}

/**
 * Local undo/redo stack for collaborative mode.
 * Tracks only the local user's operations (not remote ones).
 * Computes inverse operations at undo time using the pre-op level state.
 */
export class CollabUndoStack {
  private undoStack: UndoEntry[] = [];
  private redoStack: UndoEntry[] = [];
  private readonly limit: number;

  constructor(limit = 100) {
    this.limit = limit;
  }

  /** Record a local operation for future undo. Clears the redo stack. */
  push(op: Operation, levelBefore: Level): void {
    this.undoStack.push({ op, levelBefore });
    if (this.undoStack.length > this.limit) {
      this.undoStack.shift();
    }
    this.redoStack.length = 0;
  }

  /**
   * Pop the last local operation, compute its inverse, and move to redo stack.
   * Returns the inverse operation to apply and broadcast, or null if nothing to undo.
   */
  popUndo(): { inverseOp: Operation; entry: UndoEntry } | null {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    const inverseOp = computeInverse(entry.levelBefore, entry.op);
    this.redoStack.push(entry);
    return { inverseOp, entry };
  }

  /**
   * Pop the last undone operation for redo.
   * Returns the forward operation to re-apply and broadcast, or null if nothing to redo.
   */
  popRedo(): { op: Operation; entry: UndoEntry } | null {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    this.undoStack.push(entry);
    return { op: entry.op, entry };
  }

  /** Clear only the redo stack (called when remote operations arrive). */
  clearRedo(): void {
    this.redoStack.length = 0;
  }

  /** Clear both stacks (called on join/leave/sync). */
  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
}
