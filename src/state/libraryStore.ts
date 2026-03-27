import { create } from 'zustand';
import type { Vec2 } from '@/types';
import type { ObjectType, Gravity, Clip } from 'elmajs';
import { generateId } from '@/utils/generateId';

export interface LibraryItem {
  id: string;
  name: string;
  createdAt: number;
  polygons: Array<{ grass: boolean; vertices: Vec2[] }>;
  objects: Array<{ x: number; y: number; type: ObjectType; gravity: Gravity; animation: number }>;
  pictures: Array<{ x: number; y: number; name: string; texture: string; mask: string; clip: Clip; distance: number }>;
}

interface LibraryState {
  items: LibraryItem[];
  showLibraryPanel: boolean;

  setShowLibraryPanel: (show: boolean) => void;
  addItem: (item: Omit<LibraryItem, 'id' | 'createdAt'>) => void;
  removeItem: (id: string) => void;
  renameItem: (id: string, name: string) => void;
}

const STORAGE_KEY = 'eled_library';

function loadItems(): LibraryItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as LibraryItem[];
  } catch {
    return [];
  }
}

function saveItems(items: LibraryItem[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // quota exceeded — silently ignore
  }
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  items: loadItems(),
  showLibraryPanel: false,

  setShowLibraryPanel: (show) => set({ showLibraryPanel: show }),

  addItem: (data) => {
    const item: LibraryItem = {
      ...data,
      id: generateId(),
      createdAt: Date.now(),
    };
    const items = [...get().items, item];
    saveItems(items);
    set({ items });
  },

  removeItem: (id) => {
    const items = get().items.filter((i) => i.id !== id);
    saveItems(items);
    set({ items });
  },

  renameItem: (id, name) => {
    const items = get().items.map((i) => (i.id === id ? { ...i, name } : i));
    saveItems(items);
    set({ items });
  },
}));
