import { useState, useCallback, useEffect, useRef } from 'react';
import { Level } from 'elmajs';
import {
  FloppyDiskIcon,
  PencilSimpleIcon,
  FilePlusIcon,
  FileArrowUpIcon,
} from '@phosphor-icons/react';
import { useEditorStore } from '@/state/editorStore';
import { getEditorLgr } from '@/canvas/lgrCache';
import { readLevelFile, downloadLevel } from '@/io/fileIO';
import { fitLevel } from '@/canvas/viewport';
import { renderFrame } from '@/canvas/renderer';
import { ToolId } from '@/types';
import { searchLevels, fetchLevelByIndex, type LevelSearchResult } from '@/api/levelApi';
import { LevelCard } from './LevelCard';
import './LevelScreen.css';

export function LevelScreen() {
  const level = useEditorStore((s) => s.level);
  const fileName = useEditorStore((s) => s.fileName);
  const setFileName = useEditorStore((s) => s.setFileName);
  const setLevelName = useEditorStore((s) => s.setLevelName);
  const setLevelGround = useEditorStore((s) => s.setLevelGround);
  const setLevelSky = useEditorStore((s) => s.setLevelSky);
  const setLevelLgr = useEditorStore((s) => s.setLevelLgr);
  const setShowLevelScreen = useEditorStore((s) => s.setShowLevelScreen);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Render full-level preview on an offscreen canvas
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!level) return;
    const dpr = window.devicePixelRatio || 1;
    const w = 600;
    const h = 400;
    const offscreen = document.createElement('canvas');
    offscreen.width = w * dpr;
    offscreen.height = h * dpr;
    const ctx = offscreen.getContext('2d');
    if (!ctx) return;
    const vp = fitLevel(level.polygons, w, h);
    const emptySelection = { polygonIndices: new Set<number>(), vertexIndices: new Map(), objectIndices: new Set<number>(), pictureIndices: new Set<number>() };
    renderFrame(ctx, offscreen.width, offscreen.height, {
      level,
      viewport: vp,
      selection: emptySelection,
      grid: { visible: false, enabled: false, size: 1 },
      topologyErrors: [],
      activeTool: ToolId.Select,
      showGrass: true,
      showPictures: true,
      showTextures: true,
      showObjects: true,
      objectsAnimation: false,
    });
    setPreview(offscreen.toDataURL('image/png'));
  }, [level]); // eslint-disable-line react-hooks/exhaustive-deps

  // Search state
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<LevelSearchResult[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [downloadingIndex, setDownloadingIndex] = useState<number | null>(null);

  // Debounced search
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setTotalCount(0);
      setSearchError(null);
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      setSearchError(null);
      try {
        const res = await searchLevels(query.trim());
        setResults(res.rows);
        setTotalCount(res.count);
      } catch (err) {
        setSearchError(err instanceof Error ? err.message : 'Search failed');
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const close = useCallback(() => setShowLevelScreen(false), [setShowLevelScreen]);

  // Escape to close (only if a level is loaded — otherwise must pick one)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && level) {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [close, level]);

  const handleNew = useCallback(() => {
    useEditorStore.getState().newLevel();
    close();
  }, [close]);

  const handleOpen = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const result = await readLevelFile(file);
    const store = useEditorStore.getState();
    store.loadLevel(result.level, result.fileName);
    const vp = fitLevel(result.level.polygons, window.innerWidth, window.innerHeight);
    store.setViewport(vp);
    e.target.value = '';
    close();
  }, [close]);

  const handleSave = useCallback(() => {
    if (level && fileName) {
      downloadLevel(level, fileName);
    }
  }, [level, fileName]);

  const handleRowClick = useCallback(async (row: LevelSearchResult) => {
    if (downloadingIndex !== null) return;
    setDownloadingIndex(row.LevelIndex);
    try {
      const buffer = await fetchLevelByIndex(row.LevelIndex);
      const lev = Level.from(buffer);
      const name = `${row.LevelName}.lev`;
      const store = useEditorStore.getState();
      store.loadLevel(lev, name);
      const vp = fitLevel(lev.polygons, window.innerWidth, window.innerHeight);
      store.setViewport(vp);
      close();
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setDownloadingIndex(null);
    }
  }, [downloadingIndex, close]);

  const textureNames = [...(getEditorLgr()?.texturePatterns.keys() ?? [])].sort();

  return (
    <div className="level-screen">
      <div className="level-screen__body">
        {/* Left section: Save Level */}
        {level && (
          <div className="level-screen__save">
            <h4 className="level-screen__section-title">Save Level</h4>

            {preview && (
              <img
                className="level-screen__preview"
                src={preview}
                alt="Level preview"
                onClick={close}
                title="Continue editing"
              />
            )}

            <label className="form-label">
              File Name (.lev)
              <input
                type="text"
                value={(fileName ?? 'untitled.lev').replace(/\.lev$/i, '')}
                onChange={(e) => setFileName(e.target.value + '.lev')}
                className="input"
              />
            </label>
            <label className="form-label">
              Level Name
              <input
                type="text"
                value={level.name}
                onChange={(e) => setLevelName(e.target.value)}
                maxLength={50}
                className="input"
              />
            </label>
            <label className="form-label">
              Ground Texture
              <select
                value={level.ground}
                onChange={(e) => setLevelGround(e.target.value)}
                className="select"
              >
                {textureNames.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </label>
            <label className="form-label">
              Sky Texture
              <select
                value={level.sky}
                onChange={(e) => setLevelSky(e.target.value)}
                className="select"
              >
                {textureNames.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </label>
            <label className="form-label">
              LGR
              <input
                type="text"
                value={level.lgr}
                onChange={(e) => setLevelLgr(e.target.value)}
                className="input"
              />
            </label>

            <div className="level-screen__actions">
              <button className="level-screen__btn level-screen__btn--primary" onClick={handleSave}>
                <FloppyDiskIcon size={18} /> Save
              </button>
              <button className="level-screen__btn level-screen__btn--primary" onClick={close}>
                <PencilSimpleIcon size={18} /> Continue edit
              </button>
            </div>
          </div>
        )}

        {/* Right section: New Level */}
        <div className="level-screen__new">
          <h4 className="level-screen__section-title">New Level</h4>

          <div className="level-screen__actions">
            <button className="level-screen__btn level-screen__btn--primary" onClick={handleNew}>
              <FilePlusIcon size={18} /> Create new
            </button>
            <button className="level-screen__btn level-screen__btn--primary" onClick={handleOpen}>
              <FileArrowUpIcon size={18} /> Load from file
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".lev"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />

          <h4 className="level-screen__section-title">Load from elma.online</h4>
          <div className="level-screen__search-bar">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search levels..."
              className="input"
            />
          </div>

          {searchError && <div className="level-screen__error">{searchError}</div>}

          {results.length > 0 && (
            <>
              <div className="level-screen__grid">
                {results.map((row) => (
                  <LevelCard
                    key={row.LevelIndex}
                    result={row}
                    onSelect={() => handleRowClick(row)}
                    loading={downloadingIndex === row.LevelIndex}
                  />
                ))}
              </div>
              {totalCount > results.length && (
                <div className="level-screen__info">
                  Showing {results.length} of {totalCount} results
                </div>
              )}
            </>
          )}

          {!searching && !searchError && query.trim() && results.length === 0 && (
            <div className="level-screen__empty">No levels found</div>
          )}

          {searching && <div className="level-screen__empty">Searching...</div>}

          {!query.trim() && (
            <div className="level-screen__empty">Type to search levels on elma.online</div>
          )}
        </div>
      </div>
    </div>
  );
}
