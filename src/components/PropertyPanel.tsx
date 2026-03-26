import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { useEditorStore } from '@/state/editorStore';
import { ObjectType, Gravity, Clip } from 'elmajs';
import { ToolId } from '@/types';
import { getEditorLgr } from '@/canvas/lgrCache';
import { traceImage } from '@/utils/imageTrace';
import { textToPolygons, loadGoogleFont, loadGoogleFontPreview, SYSTEM_FONTS, GOOGLE_FONTS } from '@/utils/textTrace';
import type { AutoGrassConfig } from '@/utils/autoGrass';

/** Display a keyboard code as a readable label. */
function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Arrow')) return code.slice(5);
  const map: Record<string, string> = {
    Space: 'Space', Escape: 'Esc', Enter: 'Enter', Tab: 'Tab',
    ShiftLeft: 'L-Shift', ShiftRight: 'R-Shift',
    ControlLeft: 'L-Ctrl', ControlRight: 'R-Ctrl',
    AltLeft: 'L-Alt', AltRight: 'R-Alt',
    Backspace: 'Backspace', Delete: 'Delete',
    Equal: '=', Minus: '-', BracketLeft: '[', BracketRight: ']',
    Semicolon: ';', Quote: "'", Backquote: '`', Backslash: '\\',
    Comma: ',', Period: '.', Slash: '/',
  };
  return map[code] ?? code;
}

/** Inline key-capture input: click to focus, press a key to rebind. */
function KeyInput({ value, onChange }: { value: string; onChange: (code: string) => void }) {
  const [listening, setListening] = useState(false);

  useEffect(() => {
    if (!listening) return;
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onChange(e.code);
      setListening(false);
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [listening, onChange]);

  return (
    <button
      className="input"
      style={{ minWidth: 60, textAlign: 'center', cursor: 'pointer' }}
      onClick={() => setListening(true)}
      onBlur={() => setListening(false)}
    >
      {listening ? '...' : keyLabel(value)}
    </button>
  );
}

/* ── Accordion section wrapper ── */
function Section({
  id,
  title,
  open,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  open: boolean;
  onToggle: (id: string) => void;
  children: ReactNode;
}) {
  return (
    <>
      <h3
        className={`section-header${open ? ' section-header--open' : ''}`}
        onClick={() => onToggle(id)}
      >
        {title}
      </h3>
      <div className={`accordion-body${open ? '' : ' accordion-body--closed'}`}>
        {children}
      </div>
    </>
  );
}

/* Sections to auto-open per tool (includes both tool-specific and relevant general sections) */
const TOOL_SECTIONS_MAP: Partial<Record<ToolId, string[]>> = {
  [ToolId.Pipe]: ['pipe'],
  [ToolId.Shape]: ['shape'],
  [ToolId.ImageImport]: ['imageImport'],
  [ToolId.Text]: ['text'],
  [ToolId.DrawObject]: ['objectPlacement'],
  [ToolId.DrawPicture]: ['picturePlacement'],
  [ToolId.DrawMask]: ['maskPlacement'],
  [ToolId.DrawPolygon]: ['polygon', 'grid'],
  [ToolId.Vertex]: ['grid'],
};

/* Section IDs that are tool-specific (conditionally rendered) */
const TOOL_ONLY_SECTIONS = new Set(['pipe', 'shape', 'imageImport', 'text', 'polygon', 'maskPlacement', 'objectPlacement']);

/* ── Font picker with search + live preview ── */

interface FontEntry { name: string; source: 'system' | 'google' }

const ALL_FONTS: FontEntry[] = [
  ...SYSTEM_FONTS.map((name): FontEntry => ({ name, source: 'system' })),
  ...GOOGLE_FONTS.map((name): FontEntry => ({ name, source: 'google' })),
];

function FontPicker({ value, onChange }: { value: string; onChange: (font: string, isGoogle: boolean) => void }) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = ALL_FONTS.filter((f) =>
    f.name.toLowerCase().includes(query.toLowerCase()),
  ).slice(0, 20);

  // Load Google Font previews for visible items
  useEffect(() => {
    if (!open) return;
    for (const f of filtered) {
      if (f.source === 'google') loadGoogleFontPreview(f.name);
    }
  }, [open, filtered]);

  // Keep query in sync if parent changes value
  useEffect(() => { setQuery(value); }, [value]);

  const select = useCallback((font: FontEntry) => {
    setQuery(font.name);
    setOpen(false);
    onChange(font.name, font.source === 'google');
  }, [onChange]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') { setOpen(true); setActiveIdx(0); e.preventDefault(); }
      return;
    }
    if (e.key === 'ArrowDown') { setActiveIdx((i) => Math.min(i + 1, filtered.length - 1)); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { setActiveIdx((i) => Math.max(i - 1, 0)); e.preventDefault(); }
    else if (e.key === 'Enter' && activeIdx >= 0 && filtered[activeIdx]) { select(filtered[activeIdx]); e.preventDefault(); }
    else if (e.key === 'Escape') { setOpen(false); e.preventDefault(); }
  };

  // Scroll active item into view
  useEffect(() => {
    if (!open || activeIdx < 0 || !listRef.current) return;
    const el = listRef.current.children[activeIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx, open]);

  return (
    <div style={{ position: 'relative' }}>
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); setActiveIdx(0); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={handleKeyDown}
        placeholder="Search fonts..."
        className="input"
      />
      {open && filtered.length > 0 && (
        <div
          ref={listRef}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: '100%',
            marginTop: 2,
            maxHeight: 220,
            overflowY: 'auto',
            background: 'var(--color-bg-input)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-sm)',
            zIndex: 100,
          }}
        >
          {filtered.map((f, i) => (
            <div
              key={`${f.source}-${f.name}`}
              onMouseDown={(e) => { e.preventDefault(); select(f); }}
              onMouseEnter={() => setActiveIdx(i)}
              style={{
                padding: '5px 8px',
                cursor: 'pointer',
                fontSize: 13,
                fontFamily: `"${f.name}", sans-serif`,
                background: i === activeIdx ? 'var(--color-bg-hover)' : 'transparent',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <span>{f.name}</span>
              <span style={{ fontSize: 9, color: 'var(--color-text-secondary)', fontFamily: 'inherit', marginLeft: 8, flexShrink: 0 }}>
                {f.source === 'google' ? 'Google' : 'System'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Text tool section (extracted for hooks) ── */

type TextConfigType = {
  text: string; fontFamily: string; fontSize: number;
  bold: boolean; italic: boolean; simplifyTolerance: number; useGoogleFonts: boolean;
};

function TextSection({
  openSections,
  toggleSection,
  textConfig,
  setTextConfig,
  textPolygons,
  setTextPolygons,
}: {
  openSections: Set<string>;
  toggleSection: (id: string) => void;
  textConfig: TextConfigType;
  setTextConfig: (config: Partial<TextConfigType>) => void;
  textPolygons: import('@/types').Vec2[][] | null;
  setTextPolygons: (polygons: import('@/types').Vec2[][] | null) => void;
}) {
  const [status, setStatus] = useState<string>('');

  // Debounced auto-preview
  useEffect(() => {
    if (!textConfig.text.trim()) {
      setTextPolygons(null);
      setStatus('');
      return;
    }

    setStatus(textConfig.useGoogleFonts ? 'Loading font...' : 'Generating...');
    const timer = setTimeout(async () => {
      try {
        if (textConfig.useGoogleFonts) {
          const ok = await loadGoogleFont(textConfig.fontFamily);
          if (!ok) {
            setStatus('Font not found on Google Fonts');
            return;
          }
        }
        const result = textToPolygons(textConfig);
        setTextPolygons(result.length > 0 ? result : null);
        if (result.length > 0) {
          const verts = result.reduce((s, p) => s + p.length, 0);
          setStatus(`${result.length} polygons, ${verts} vertices`);
        } else {
          setStatus('No contours traced');
        }
      } catch {
        setStatus('Generation failed');
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [textConfig.text, textConfig.fontFamily, textConfig.fontSize, textConfig.bold, textConfig.italic, textConfig.simplifyTolerance, textConfig.useGoogleFonts, setTextPolygons]);

  const handleFontChange = useCallback((font: string, isGoogle: boolean) => {
    setTextConfig({ fontFamily: font, useGoogleFonts: isGoogle });
  }, [setTextConfig]);

  return (
    <Section id="text" title="Text" open={openSections.has('text')} onToggle={toggleSection}>
      <label className="form-label">
        Text
        <input
          type="text"
          value={textConfig.text}
          onChange={(e) => setTextConfig({ text: e.target.value })}
          placeholder="Enter text..."
          className="input"
        />
      </label>
      <label className="form-label">
        Font
      </label>
      <FontPicker value={textConfig.fontFamily} onChange={handleFontChange} />
      <label className="form-label" style={{ marginTop: 8 }}>
        Size (world units)
        <input
          type="number"
          value={textConfig.fontSize}
          min={0.5}
          max={120}
          step={0.5}
          onChange={(e) => {
            const val = parseFloat(e.target.value);
            if (val > 0 && isFinite(val)) {
              setTextConfig({ fontSize: val });
            }
          }}
          className="input"
        />
      </label>
      <label
        className="form-label"
        style={{ display: 'flex', alignItems: 'center', gap: 6 }}
      >
        <input
          type="checkbox"
          checked={textConfig.bold}
          onChange={(e) => setTextConfig({ bold: e.target.checked })}
        />
        Bold
      </label>
      <label
        className="form-label"
        style={{ display: 'flex', alignItems: 'center', gap: 6 }}
      >
        <input
          type="checkbox"
          checked={textConfig.italic}
          onChange={(e) => setTextConfig({ italic: e.target.checked })}
        />
        Italic
      </label>
      <label className="form-label">
        Simplification
        <input
          type="number"
          value={textConfig.simplifyTolerance}
          min={0.1}
          max={10}
          step={0.1}
          onChange={(e) => {
            const val = parseFloat(e.target.value);
            if (val > 0 && isFinite(val)) {
              setTextConfig({ simplifyTolerance: val });
            }
          }}
          className="input"
        />
      </label>
      <div className="detail-text" style={{ marginTop: 8 }}>
        {status || 'Type text to generate preview.'}
        {textPolygons && (
          <>
            <br />
            Click on canvas to place. Right-click or Esc to clear.
          </>
        )}
      </div>
    </Section>
  );
}

export function PropertyPanel() {
  const level = useEditorStore((s) => s.level);
  const selection = useEditorStore((s) => s.selection);
  const objectConfig = useEditorStore((s) => s.objectConfig);
  const setObjectConfig = useEditorStore((s) => s.setObjectConfig);
  const setLevelName = useEditorStore((s) => s.setLevelName);
  const setLevelGround = useEditorStore((s) => s.setLevelGround);
  const setLevelSky = useEditorStore((s) => s.setLevelSky);
  const fileName = useEditorStore((s) => s.fileName);
  const setFileName = useEditorStore((s) => s.setFileName);

  const updateObjects = useEditorStore((s) => s.updateObjects);
  const grid = useEditorStore((s) => s.grid);
  const setGrid = useEditorStore((s) => s.setGrid);
  const activeTool = useEditorStore((s) => s.activeTool);
  const pipeRadius = useEditorStore((s) => s.pipeRadius);
  const setPipeRadius = useEditorStore((s) => s.setPipeRadius);
  const pipeRoundCorners = useEditorStore((s) => s.pipeRoundCorners);
  const setPipeRoundCorners = useEditorStore((s) => s.setPipeRoundCorners);
  const shapeSides = useEditorStore((s) => s.shapeSides);
  const setShapeSides = useEditorStore((s) => s.setShapeSides);
  const pictureConfig = useEditorStore((s) => s.pictureConfig);
  const setPictureConfig = useEditorStore((s) => s.setPictureConfig);
  const maskConfig = useEditorStore((s) => s.maskConfig);
  const setMaskConfig = useEditorStore((s) => s.setMaskConfig);
  const imageImportConfig = useEditorStore((s) => s.imageImportConfig);
  const setImageImportConfig = useEditorStore((s) => s.setImageImportConfig);
  const imageImportPolygons = useEditorStore((s) => s.imageImportPolygons);
  const setImageImportPolygons = useEditorStore((s) => s.setImageImportPolygons);
  const textConfig = useEditorStore((s) => s.textConfig);
  const setTextConfig = useEditorStore((s) => s.setTextConfig);
  const textPolygons = useEditorStore((s) => s.textPolygons);
  const setTextPolygons = useEditorStore((s) => s.setTextPolygons);
  const drawPolygonGrass = useEditorStore((s) => s.drawPolygonGrass);
  const setDrawPolygonGrass = useEditorStore((s) => s.setDrawPolygonGrass);
  const autoGrassConfig = useEditorStore((s) => s.autoGrassConfig);
  const setAutoGrassConfig = useEditorStore((s) => s.setAutoGrassConfig);
  const showGrass = useEditorStore((s) => s.showGrass);
  const setShowGrass = useEditorStore((s) => s.setShowGrass);
  const showPictures = useEditorStore((s) => s.showPictures);
  const setShowPictures = useEditorStore((s) => s.setShowPictures);
  const showTextures = useEditorStore((s) => s.showTextures);
  const setShowTextures = useEditorStore((s) => s.setShowTextures);
  const showObjects = useEditorStore((s) => s.showObjects);
  const setShowObjects = useEditorStore((s) => s.setShowObjects);
  const testConfig = useEditorStore((s) => s.testConfig);
  const setTestConfig = useEditorStore((s) => s.setTestConfig);

  // Accordion open state — set of open section IDs
  const [openSections, setOpenSections] = useState<Set<string>>(() => new Set(['level']));

  const hasSelection = selection.polygonIndices.size > 0 || selection.objectIndices.size > 0 || selection.pictureIndices.size > 0;

  // Auto-expand relevant sections when activeTool or selection changes
  useEffect(() => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      // Close all tool-only sections (pipe, shape, imageImport)
      for (const sectionId of TOOL_ONLY_SECTIONS) {
        next.delete(sectionId);
      }
      // Also close general sections that were auto-opened by previous tool
      for (const sections of Object.values(TOOL_SECTIONS_MAP)) {
        if (!sections) continue;
        for (const s of sections) {
          if (!TOOL_ONLY_SECTIONS.has(s)) next.delete(s);
        }
      }
      // Open sections relevant to the active tool
      const sections = TOOL_SECTIONS_MAP[activeTool];
      if (sections) {
        for (const s of sections) next.add(s);
      }
      // Open level section only when Select tool and nothing selected
      if (activeTool === ToolId.Select && !hasSelection) {
        next.add('level');
      } else {
        next.delete('level');
      }
      return next;
    });
  }, [activeTool, hasSelection]);

  const toggleSection = useCallback((id: string) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  if (!level) {
    return null;
  }

  const setPolygonsGrass = useEditorStore((s) => s.setPolygonsGrass);

  // Derive selection-panel data (rendered inline, no early return)
  const selectedPolyIndices = selection.polygonIndices.size >= 1 ? [...selection.polygonIndices] : null;
  const selectedPolys = selectedPolyIndices?.map((i) => level.polygons[i]).filter(Boolean) ?? [];
  const hasSelectedPolys = selectedPolys.length > 0;
  const allSameGrassState = hasSelectedPolys && selectedPolys.every((p) => p!.grass === selectedPolys[0]!.grass);
  const commonGrass = allSameGrassState ? selectedPolys[0]!.grass : undefined;

  const selectedObjIndices = selection.objectIndices.size >= 1 ? [...selection.objectIndices] : null;
  const selectedObjects = selectedObjIndices?.map((i) => level.objects[i]).filter(Boolean) ?? [];
  const hasSelectedObjects = selectedObjects.length > 0;
  const allSameType = hasSelectedObjects && selectedObjects.every((o) => o!.type === selectedObjects[0]!.type);
  const allSameGravity = hasSelectedObjects && selectedObjects.every((o) => o!.gravity === selectedObjects[0]!.gravity);
  const commonType = allSameType ? selectedObjects[0]!.type : undefined;
  const commonGravity = allSameGravity ? selectedObjects[0]!.gravity : undefined;
  const anyApple = hasSelectedObjects && selectedObjects.some((o) => o!.type === ObjectType.Apple);
  const hasStart = level.objects.some((o) => o.type === ObjectType.Start);

  const updatePictures = useEditorStore((s) => s.updatePictures);

  // Split selected pictures into regular pictures vs mask/texture pictures
  const allPicIndices = selection.pictureIndices.size >= 1 ? [...selection.pictureIndices] : [];
  const selRegularPicIndices = allPicIndices.filter((i) => { const p = level.pictures[i]; return p && !p.texture; });
  const selMaskPicIndices = allPicIndices.filter((i) => { const p = level.pictures[i]; return p && !!p.texture; });
  const selRegularPics = selRegularPicIndices.map((i) => level.pictures[i]!);
  const selMaskPics = selMaskPicIndices.map((i) => level.pictures[i]!);

  // Regular picture common props
  const commonPicName = selRegularPics.length > 0 && selRegularPics.every((p) => p.name === selRegularPics[0]!.name) ? selRegularPics[0]!.name : undefined;
  const commonPicClip = selRegularPics.length > 0 && selRegularPics.every((p) => p.clip === selRegularPics[0]!.clip) ? selRegularPics[0]!.clip : undefined;
  const commonPicDist = selRegularPics.length > 0 && selRegularPics.every((p) => p.distance === selRegularPics[0]!.distance) ? selRegularPics[0]!.distance : undefined;

  // Mask picture common props
  const commonTexture = selMaskPics.length > 0 && selMaskPics.every((p) => p.texture === selMaskPics[0]!.texture) ? selMaskPics[0]!.texture : undefined;
  const commonMask = selMaskPics.length > 0 && selMaskPics.every((p) => p.mask === selMaskPics[0]!.mask) ? selMaskPics[0]!.mask : undefined;
  const commonMaskClip = selMaskPics.length > 0 && selMaskPics.every((p) => p.clip === selMaskPics[0]!.clip) ? selMaskPics[0]!.clip : undefined;
  const commonMaskDist = selMaskPics.length > 0 && selMaskPics.every((p) => p.distance === selMaskPics[0]!.distance) ? selMaskPics[0]!.distance : undefined;

  return (
    <>
      {/* Selection properties (non-collapsible, shown above accordions) */}
      {hasSelectedPolys && (
        <>
          <h3 className="section-header section-header--open">
            {selectedPolys.length === 1 ? `Polygon #${selectedPolyIndices![0]}` : `${selectedPolys.length} Polygons`}
          </h3>
          <div className="accordion-body">
            <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="checkbox"
                checked={commonGrass ?? false}
                ref={(el) => { if (el) el.indeterminate = commonGrass === undefined; }}
                onChange={(e) => setPolygonsGrass(selectedPolyIndices!, e.target.checked)}
              />
              Grass
            </label>
            {selectedPolys.length === 1 && (
              <div className="detail-text">
                Vertices: {selectedPolys[0]!.vertices.length}
              </div>
            )}
          </div>
        </>
      )}

      {hasSelectedObjects && (
        <>
          <h3 className="section-header section-header--open">
            {selectedObjects.length === 1 ? `Object #${selectedObjIndices![0]}` : `${selectedObjects.length} Objects`}
          </h3>
          <div className="accordion-body">
            {selectedObjects.length === 1 && (
              <div className="detail-text" style={{ marginBottom: 8 }}>
                Position: ({selectedObjects[0]!.position.x.toFixed(2)}, {selectedObjects[0]!.position.y.toFixed(2)})
              </div>
            )}
            <label className="form-label">
              Type
              <select
                value={commonType ?? ''}
                onChange={(e) =>
                  updateObjects(selectedObjIndices!, { type: Number(e.target.value) as ObjectType })
                }
                className="select"
              >
                {commonType === undefined && <option value="">Mixed</option>}
                <option value={ObjectType.Exit}>Flower (Exit)</option>
                <option value={ObjectType.Apple}>Apple</option>
                <option value={ObjectType.Killer}>Killer</option>
                {(!hasStart || commonType === ObjectType.Start) && (
                  <option value={ObjectType.Start}>Start</option>
                )}
              </select>
            </label>
            {(commonType === ObjectType.Apple || (commonType === undefined && anyApple)) && (
              <label className="form-label">
                Gravity
                <select
                  value={commonGravity ?? ''}
                  onChange={(e) =>
                    updateObjects(selectedObjIndices!, { gravity: Number(e.target.value) as Gravity })
                  }
                  className="select"
                >
                  {commonGravity === undefined && <option value="">Mixed</option>}
                  <option value={Gravity.None}>Normal</option>
                  <option value={Gravity.Up}>Up</option>
                  <option value={Gravity.Down}>Down</option>
                  <option value={Gravity.Left}>Left</option>
                  <option value={Gravity.Right}>Right</option>
                </select>
              </label>
            )}
          </div>
        </>
      )}
      {selRegularPics.length > 0 && (
        <>
          <h3 className="section-header section-header--open">
            {selRegularPics.length === 1 ? `Picture #${selRegularPicIndices[0]}` : `${selRegularPics.length} Pictures`}
          </h3>
          <div className="accordion-body">
            {selRegularPics.length === 1 && (
              <div className="detail-text" style={{ marginBottom: 8 }}>
                Position: ({selRegularPics[0]!.position.x.toFixed(2)}, {selRegularPics[0]!.position.y.toFixed(2)})
              </div>
            )}
            <label className="form-label">
              Name
              <select
                value={commonPicName ?? ''}
                onChange={(e) => updatePictures(selRegularPicIndices, { name: e.target.value })}
                className="select"
              >
                {commonPicName === undefined && <option value="">Mixed</option>}
                {[...(getEditorLgr()?.pictures.keys() ?? [])].sort().map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </label>
            <label className="form-label">
              Clipping
              <select
                value={commonPicClip ?? ''}
                onChange={(e) => updatePictures(selRegularPicIndices, { clip: Number(e.target.value) as Clip })}
                className="select"
              >
                {commonPicClip === undefined && <option value="">Mixed</option>}
                <option value={Clip.Unclipped}>Unclipped</option>
                <option value={Clip.Ground}>Ground</option>
                <option value={Clip.Sky}>Sky</option>
              </select>
            </label>
            <label className="form-label">
              Distance
              <input
                type="number"
                value={commonPicDist ?? ''}
                onChange={(e) => updatePictures(selRegularPicIndices, { distance: Number(e.target.value) })}
                className="input"
                min={1}
                max={999}
              />
            </label>
          </div>
        </>
      )}
      {selMaskPics.length > 0 && (
        <>
          <h3 className="section-header section-header--open">
            {selMaskPics.length === 1 ? `Mask #${selMaskPicIndices[0]}` : `${selMaskPics.length} Masks`}
          </h3>
          <div className="accordion-body">
            {selMaskPics.length === 1 && (
              <div className="detail-text" style={{ marginBottom: 8 }}>
                Position: ({selMaskPics[0]!.position.x.toFixed(2)}, {selMaskPics[0]!.position.y.toFixed(2)})
              </div>
            )}
            <label className="form-label">
              Texture
              <select
                value={commonTexture ?? ''}
                onChange={(e) => updatePictures(selMaskPicIndices, { texture: e.target.value })}
                className="select"
              >
                {commonTexture === undefined && <option value="">Mixed</option>}
                {[...(getEditorLgr()?.texturePatterns.keys() ?? [])].sort().map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </label>
            <label className="form-label">
              Mask
              <select
                value={commonMask ?? ''}
                onChange={(e) => updatePictures(selMaskPicIndices, { mask: e.target.value })}
                className="select"
              >
                {commonMask === undefined && <option value="">Mixed</option>}
                {[...(getEditorLgr()?.masks.keys() ?? [])].sort().map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </label>
            <label className="form-label">
              Clipping
              <select
                value={commonMaskClip ?? ''}
                onChange={(e) => updatePictures(selMaskPicIndices, { clip: Number(e.target.value) as Clip })}
                className="select"
              >
                {commonMaskClip === undefined && <option value="">Mixed</option>}
                <option value={Clip.Unclipped}>Unclipped</option>
                <option value={Clip.Ground}>Ground</option>
                <option value={Clip.Sky}>Sky</option>
              </select>
            </label>
            <label className="form-label">
              Distance
              <input
                type="number"
                value={commonMaskDist ?? ''}
                onChange={(e) => updatePictures(selMaskPicIndices, { distance: Number(e.target.value) })}
                className="input"
                min={1}
                max={999}
              />
            </label>
          </div>
        </>
      )}

      <Section id="level" title="Level" open={openSections.has('level')} onToggle={toggleSection}>
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
            {[...(getEditorLgr()?.texturePatterns.keys() ?? [])].sort().map((name) => (
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
            {[...(getEditorLgr()?.texturePatterns.keys() ?? [])].sort().map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </label>
        <div className="detail-text">
          LGR: {level.lgr}
        </div>
      </Section>

      {activeTool === ToolId.DrawObject && (
      <Section id="objectPlacement" title="Object Placement" open={openSections.has('objectPlacement')} onToggle={toggleSection}>
        <label className="form-label">
          Type
          <select
            value={objectConfig.type}
            onChange={(e) =>
              setObjectConfig({ type: Number(e.target.value) as ObjectType })
            }
            className="select"
          >
            <option value={ObjectType.Exit}>Flower (Exit)</option>
            <option value={ObjectType.Apple}>Apple</option>
            <option value={ObjectType.Killer}>Killer</option>
            {!hasStart && <option value={ObjectType.Start}>Start</option>}
          </select>
        </label>
        {objectConfig.type === ObjectType.Apple && (
          <label className="form-label">
            Gravity
            <select
              value={objectConfig.gravity}
              onChange={(e) =>
                setObjectConfig({
                  gravity: Number(e.target.value) as Gravity,
                })
              }
              className="select"
            >
              <option value={Gravity.None}>Normal</option>
              <option value={Gravity.Up}>Up</option>
              <option value={Gravity.Down}>Down</option>
              <option value={Gravity.Left}>Left</option>
              <option value={Gravity.Right}>Right</option>
            </select>
          </label>
        )}
      </Section>
      )}

      {activeTool === ToolId.DrawPicture && (
        <Section id="picturePlacement" title="Picture" open={openSections.has('picturePlacement')} onToggle={toggleSection}>
          <label className="form-label">
            Name
            <select
              value={pictureConfig.name}
              onChange={(e) => setPictureConfig({ name: e.target.value })}
              className="select"
            >
              {[...(getEditorLgr()?.pictures.keys() ?? [])].sort().map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </label>
          <label className="form-label">
            Clipping
            <select
              value={pictureConfig.clip}
              onChange={(e) => setPictureConfig({ clip: Number(e.target.value) as Clip })}
              className="select"
            >
              <option value={Clip.Unclipped}>Unclipped</option>
              <option value={Clip.Ground}>Ground</option>
              <option value={Clip.Sky}>Sky</option>
            </select>
          </label>
          <label className="form-label">
            Distance
            <input
              type="number"
              value={pictureConfig.distance}
              onChange={(e) => setPictureConfig({ distance: Number(e.target.value) })}
              className="input"
              min={1}
              max={999}
            />
          </label>
        </Section>
      )}

      {activeTool === ToolId.DrawMask && (
        <Section id="maskPlacement" title="Mask / Texture" open={openSections.has('maskPlacement')} onToggle={toggleSection}>
          <label className="form-label">
            Texture
            <select
              value={maskConfig.texture}
              onChange={(e) => setMaskConfig({ texture: e.target.value })}
              className="select"
            >
              {[...(getEditorLgr()?.texturePatterns.keys() ?? [])].sort().map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </label>
          <label className="form-label">
            Mask
            <select
              value={maskConfig.mask}
              onChange={(e) => setMaskConfig({ mask: e.target.value })}
              className="select"
            >
              {[...(getEditorLgr()?.masks.keys() ?? [])].sort().map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </label>
          <label className="form-label">
            Clipping
            <select
              value={maskConfig.clip}
              onChange={(e) => setMaskConfig({ clip: Number(e.target.value) as Clip })}
              className="select"
            >
              <option value={Clip.Unclipped}>Unclipped</option>
              <option value={Clip.Ground}>Ground</option>
              <option value={Clip.Sky}>Sky</option>
            </select>
          </label>
          <label className="form-label">
            Distance
            <input
              type="number"
              value={maskConfig.distance}
              onChange={(e) => setMaskConfig({ distance: Number(e.target.value) })}
              className="input"
              min={1}
              max={999}
            />
          </label>
        </Section>
      )}

      {activeTool === ToolId.DrawPolygon && (
        <Section id="polygon" title="Polygon" open={openSections.has('polygon')} onToggle={toggleSection}>
          <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox"
              checked={drawPolygonGrass}
              onChange={(e) => setDrawPolygonGrass(e.target.checked)}
            />
            Grass
          </label>
        </Section>
      )}

      {activeTool === ToolId.Pipe && (
        <Section id="pipe" title="Pipe" open={openSections.has('pipe')} onToggle={toggleSection}>
          <label className="form-label">
            Width (diameter)
            <input
              type="number"
              value={pipeRadius * 2}
              min={0.1}
              max={100}
              step={0.1}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                if (val > 0 && isFinite(val)) {
                  setPipeRadius(val / 2);
                }
              }}
              className="input"
            />
          </label>
          <label className="form-label">
            Radius (half-width)
            <input
              type="number"
              value={pipeRadius}
              min={0.05}
              max={50}
              step={0.05}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                if (val > 0 && isFinite(val)) {
                  setPipeRadius(val);
                }
              }}
              className="input"
            />
          </label>
          <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox"
              checked={pipeRoundCorners}
              onChange={(e) => setPipeRoundCorners(e.target.checked)}
            />
            Round corners
          </label>
          <div className="detail-text" style={{ marginTop: 4 }}>
            Click to place spine points. Right-click or Enter to commit.
            Esc to cancel, Backspace to undo last point.
          </div>
        </Section>
      )}

      {activeTool === ToolId.Shape && (
        <Section id="shape" title="Shape" open={openSections.has('shape')} onToggle={toggleSection}>
          <label className="form-label">
            Sides
            <input
              type="number"
              value={shapeSides}
              min={3}
              max={1024}
              step={1}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10);
                if (val >= 3 && val <= 1024 && isFinite(val)) {
                  setShapeSides(val);
                }
              }}
              className="input"
            />
          </label>
          <div className="detail-text" style={{ marginTop: 4 }}>
            Click to place center, move to set size, click to confirm.
            Right-click or Esc to cancel.
          </div>
        </Section>
      )}

      {activeTool === ToolId.ImageImport && (
        <Section id="imageImport" title="Image Import" open={openSections.has('imageImport')} onToggle={toggleSection}>
          <label className="form-label">
            Threshold
            <input
              type="range"
              min={0}
              max={255}
              step={1}
              value={imageImportConfig.threshold}
              onChange={(e) =>
                setImageImportConfig({ threshold: Number(e.target.value) })
              }
              className="input"
            />
            <span className="detail-text">{imageImportConfig.threshold}</span>
          </label>
          <label className="form-label">
            Simplification
            <input
              type="number"
              value={imageImportConfig.simplifyTolerance}
              min={0.1}
              max={20}
              step={0.1}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                if (val > 0 && isFinite(val)) {
                  setImageImportConfig({ simplifyTolerance: val });
                }
              }}
              className="input"
            />
          </label>
          <label className="form-label">
            Scale (units/px)
            <input
              type="number"
              value={imageImportConfig.scale}
              min={0.01}
              max={1.0}
              step={0.01}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                if (val > 0 && isFinite(val)) {
                  setImageImportConfig({ scale: val });
                }
              }}
              className="input"
            />
          </label>
          <label
            className="form-label"
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <input
              type="checkbox"
              checked={imageImportConfig.invert}
              onChange={(e) =>
                setImageImportConfig({ invert: e.target.checked })
              }
            />
            Invert (trace light regions)
          </label>
          <button
            className="btn"
            onClick={async () => {
              const input = document.createElement('input');
              input.type = 'file';
              input.accept = 'image/*';
              input.onchange = async () => {
                const file = input.files?.[0];
                if (!file) return;
                try {
                  const result = await traceImage(file, imageImportConfig);
                  setImageImportPolygons(result.polygons);
                } catch (err) {
                  console.error('Image trace failed:', err);
                }
              };
              input.click();
            }}
            style={{ marginTop: 8 }}
          >
            {imageImportPolygons ? 'Re-trace Image...' : 'Load Image...'}
          </button>
          {imageImportPolygons && (
            <div className="detail-text" style={{ marginTop: 8 }}>
              {imageImportPolygons.length} polygons,{' '}
              {imageImportPolygons.reduce((s, p) => s + p.length, 0)} vertices.
              <br />
              Click on canvas to place. Right-click or Esc to clear.
            </div>
          )}
          {!imageImportPolygons && (
            <div className="detail-text" style={{ marginTop: 4 }}>
              Load a PNG/JPG image to trace its contours into polygons.
            </div>
          )}
        </Section>
      )}

      {activeTool === ToolId.Text && (
        <TextSection
          openSections={openSections}
          toggleSection={toggleSection}
          textConfig={textConfig}
          setTextConfig={setTextConfig}
          textPolygons={textPolygons}
          setTextPolygons={setTextPolygons}
        />
      )}

      {hasSelectedPolys && (
      <Section id="autoGrass" title="Auto Grass" open={openSections.has('autoGrass')} onToggle={toggleSection}>
        <label className="form-label">
          Thickness
          <input
            type="number"
            value={autoGrassConfig.thickness}
            min={0.1}
            max={10}
            step={0.1}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              if (val > 0 && isFinite(val)) {
                setAutoGrassConfig({ thickness: val });
              }
            }}
            className="input"
          />
        </label>
        <label className="form-label">
          Max angle
          <input
            type="number"
            value={autoGrassConfig.maxAngle}
            min={1}
            max={90}
            step={1}
            onChange={(e) => {
              const val = parseInt(e.target.value, 10);
              if (val >= 1 && val <= 90 && isFinite(val)) {
                setAutoGrassConfig({ maxAngle: val });
              }
            }}
            className="input"
          />
        </label>
        <div className="detail-text" style={{ marginTop: 4 }}>
          Select ground polygons and press T or click Auto Grass to generate grass.
        </div>
      </Section>
      )}

      <Section id="grid" title="Grid" open={openSections.has('grid')} onToggle={toggleSection}>
        <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            type="checkbox"
            checked={grid.visible}
            onChange={() => setGrid({ visible: !grid.visible })}
          />
          Show grid
        </label>
        <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            type="checkbox"
            checked={grid.enabled}
            onChange={() => setGrid({ enabled: !grid.enabled })}
          />
          Snap to grid
        </label>
        <label className="form-label">
          Step size
          <input
            type="number"
            value={grid.size}
            min={0.1}
            max={100}
            step={0.1}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              if (val > 0 && isFinite(val)) {
                setGrid({ size: val });
              }
            }}
            className="input"
          />
        </label>
      </Section>

      <Section id="editorProps" title="Editor Properties" open={openSections.has('editorProps')} onToggle={toggleSection}>
        <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={showGrass} onChange={() => setShowGrass(!showGrass)} />
          Show grass
        </label>
        <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={showPictures} onChange={() => setShowPictures(!showPictures)} />
          Show pictures
        </label>
        <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={showTextures} onChange={() => setShowTextures(!showTextures)} />
          Show textures
        </label>
        <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={showObjects} onChange={() => setShowObjects(!showObjects)} />
          Show objects
        </label>
      </Section>

      <Section id="testProps" title="Test Properties" open={openSections.has('testProps')} onToggle={toggleSection}>
        <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={testConfig.showGrass} onChange={() => setTestConfig({ showGrass: !testConfig.showGrass })} />
          Show grass
        </label>
        <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={testConfig.showPictures} onChange={() => setTestConfig({ showPictures: !testConfig.showPictures })} />
          Show pictures
        </label>
        <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={testConfig.showTextures} onChange={() => setTestConfig({ showTextures: !testConfig.showTextures })} />
          Show textures
        </label>
        <label className="form-label">
          Alovolt
          <KeyInput value={testConfig.alovoltKey} onChange={(code) => setTestConfig({ alovoltKey: code })} />
        </label>
        <label className="form-label">
          Left volt
          <KeyInput value={testConfig.leftVoltKey} onChange={(code) => setTestConfig({ leftVoltKey: code })} />
        </label>
        <label className="form-label">
          Right volt
          <KeyInput value={testConfig.rightVoltKey} onChange={(code) => setTestConfig({ rightVoltKey: code })} />
        </label>
        <label className="form-label">
          Gas
          <KeyInput value={testConfig.gasKey} onChange={(code) => setTestConfig({ gasKey: code })} />
        </label>
        <label className="form-label">
          Brake
          <KeyInput value={testConfig.brakeKey} onChange={(code) => setTestConfig({ brakeKey: code })} />
        </label>
        <label className="form-label">
          Turn
          <KeyInput value={testConfig.turnKey} onChange={(code) => setTestConfig({ turnKey: code })} />
        </label>
        <label className="form-label">
          Exit
          <KeyInput value={testConfig.exitKey} onChange={(code) => setTestConfig({ exitKey: code })} />
        </label>
        <label className="form-label">
          Restart
          <KeyInput value={testConfig.restartKey} onChange={(code) => setTestConfig({ restartKey: code })} />
        </label>
      </Section>
    </>
  );
}
