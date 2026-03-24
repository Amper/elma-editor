import { useCallback, useRef } from 'react';
import { useEditorStore } from '@/state/editorStore';
import { readLevelFile, downloadLevel } from '@/io/fileIO';
import { fitLevel } from '@/canvas/viewport';
import {FileArrowDownIcon, FileArrowUpIcon, FilePlusIcon} from "@phosphor-icons/react";

export function FileControls() {
  const inputRef = useRef<HTMLInputElement>(null);
  const level = useEditorStore((s) => s.level);
  const fileName = useEditorStore((s) => s.fileName);

  const handleNew = useCallback(() => {
    useEditorStore.getState().newLevel();
  }, []);

  const handleOpen = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const result = await readLevelFile(file);
      const store = useEditorStore.getState();
      store.loadLevel(result.level, result.fileName);
      // Fit to a reasonable default viewport
      const vp = fitLevel(result.level.polygons, 800, 600);
      store.setViewport(vp);
      // Reset input so the same file can be re-selected
      e.target.value = '';
    },
    [],
  );

  const handleSave = useCallback(() => {
    if (level && fileName) {
      downloadLevel(level, fileName);
    }
  }, [level, fileName]);

  return (
    <>
      <button onClick={handleNew} title="New Level (Ctrl+N)" className="btn btn--text">
        <FilePlusIcon size={16} />
        <span className="btn--text-label">New</span>
      </button>
      <button onClick={handleOpen} title="Open Level (Ctrl+O)" className="btn btn--text">
        <FileArrowUpIcon size={16} />
        <span className="btn--text-label">Open</span>
      </button>
      <button onClick={handleSave} disabled={!level} title="Save Level (Ctrl+S)" className="btn btn--text">
        <FileArrowDownIcon size={16} />
        <span className="btn--text-label">Save</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".lev"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
    </>
  );
}
