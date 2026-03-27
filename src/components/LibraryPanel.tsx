import { useState, useRef, useEffect, useCallback } from 'react';
import { TrashIcon } from '@phosphor-icons/react';
import { useLibraryStore, type LibraryItem } from '@/state/libraryStore';
import { useEditorStore } from '@/state/editorStore';
import { renderLibraryPreview } from '@/canvas/renderLibraryPreview';
import './LibraryPanel.css';

const PREVIEW_W = 216;
const PREVIEW_H = 90;

function PreviewCanvas({ item }: { item: LibraryItem }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    renderLibraryPreview(ctx, PREVIEW_W, PREVIEW_H, item);
  }, [item]);

  return (
    <canvas
      ref={canvasRef}
      className="library-panel__preview"
      width={PREVIEW_W}
      height={PREVIEW_H}
    />
  );
}

export function LibraryPanel() {
  const items = useLibraryStore((s) => s.items);
  const removeItem = useLibraryStore((s) => s.removeItem);
  const placeFromLibrary = useEditorStore((s) => s.placeFromLibrary);
  const setShowLibraryPanel = useLibraryStore((s) => s.setShowLibraryPanel);

  const [search, setSearch] = useState('');

  const filtered = search
    ? items.filter((i) => i.name.toLowerCase().includes(search.toLowerCase()))
    : items;

  const handlePlace = useCallback((item: LibraryItem) => {
    placeFromLibrary(item);
    setShowLibraryPanel(false);
  }, [placeFromLibrary, setShowLibraryPanel]);

  const handleDelete = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    removeItem(id);
  }, [removeItem]);

  return (
    <>
      <div className="library-panel__search">
        <input
          className="input"
          placeholder="Search..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      {filtered.length === 0 ? (
        <div className="library-panel__empty">
          {items.length === 0 ? 'No saved templates' : 'No matches'}
        </div>
      ) : (
        <div className="library-panel__items">
          {filtered.map((item) => (
            <div
              key={item.id}
              className="library-panel__item"
              onClick={() => handlePlace(item)}
            >
              <PreviewCanvas item={item} />
              <div className="library-panel__name">{item.name}</div>
              <button
                className="library-panel__delete"
                onClick={(e) => handleDelete(e, item.id)}
                title="Delete"
              >
                <TrashIcon size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
