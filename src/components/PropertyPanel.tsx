import { useState, useEffect, useCallback, useRef, useMemo, type ReactNode } from 'react';
import { useEditorStore } from '@/state/editorStore';
import { ObjectType, Gravity, Clip } from 'elmajs';
import { ToolId, type ShapeType } from '@/types';
import { getEditorLgr } from '@/canvas/lgrCache';
import { traceImage } from '@/utils/imageTrace';
import { textToPolygons, loadGoogleFont, loadGoogleFontPreview, SYSTEM_FONTS, GOOGLE_FONTS } from '@/utils/textTrace';
import { CaretUpDown, FlowerIcon, AppleLogoIcon, SkullIcon, FlagIcon, ArrowDownIcon, ArrowUpIcon, ArrowLeftIcon, ArrowRightIcon, DotOutlineIcon, PolygonIcon, PlantIcon, TriangleIcon, SquareIcon, RectangleIcon, DiamondIcon, ParallelogramIcon, CircleIcon, PentagonIcon, StarIcon, ShuffleIcon } from '@phosphor-icons/react';

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
};

/* Section IDs that are tool-specific (conditionally rendered) */
const TOOL_ONLY_SECTIONS = new Set(['pipe', 'shape', 'imageImport', 'text', 'maskPlacement', 'objectPlacement']);

/* ── Picture thumbnail (renders ImageBitmap to a tiny canvas) ── */
function PictureThumbnail({ bitmap, size = 40 }: { bitmap: ImageBitmap; size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Fit bitmap into the square, preserving aspect ratio
    const scale = Math.min((size * dpr) / bitmap.width, (size * dpr) / bitmap.height);
    const w = bitmap.width * scale;
    const h = bitmap.height * scale;
    ctx.drawImage(bitmap, (size * dpr - w) / 2, (size * dpr - h) / 2, w, h);
  }, [bitmap, size]);
  return <canvas ref={canvasRef} style={{ width: size, height: size, display: 'block' }} />;
}

/* ── Generic bitmap picker grid with search ── */
function BitmapPicker({
  items,
  selected,
  onSelect,
  placeholder = 'Filter…',
}: {
  items: Map<string, { bitmap: ImageBitmap }> | Map<string, ImageBitmap> | undefined;
  selected: string;
  onSelect: (name: string) => void;
  placeholder?: string;
}) {
  const [filter, setFilter] = useState('');
  const allNames = useMemo(() => [...(items?.keys() ?? [])].sort(), [items]);
  const filtered = useMemo(
    () => filter ? allNames.filter((n) => n.includes(filter.toLowerCase())) : allNames,
    [allNames, filter],
  );

  return (
    <div className="picture-picker">
      <input
        type="text"
        className="input picture-picker__search"
        placeholder={placeholder}
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <div className="picture-picker__grid">
        {filtered.map((name) => {
          const entry = items?.get(name);
          const bitmap = entry instanceof ImageBitmap ? entry : entry?.bitmap;
          return (
            <button
              key={name}
              className={`picture-picker__item${name === selected ? ' picture-picker__item--active' : ''}`}
              onClick={() => onSelect(name)}
              title={name}
            >
              {bitmap && <PictureThumbnail bitmap={bitmap} size={40} />}
              <span className="picture-picker__name">{name}</span>
            </button>
          );
        })}
        {filtered.length === 0 && (
          <div className="picture-picker__empty">No matches</div>
        )}
      </div>
    </div>
  );
}

/* ── Font picker with search + live preview ── */

interface FontEntry { name: string; source: 'system' | 'google' }

const ALL_FONTS: FontEntry[] = [
  ...SYSTEM_FONTS.map((name): FontEntry => ({ name, source: 'system' })),
  ...GOOGLE_FONTS.map((name): FontEntry => ({ name, source: 'google' })),
];

function FontPicker({ value, onChange }: { value: string; onChange: (font: string, isGoogle: boolean) => void }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = isSearching
    ? ALL_FONTS.filter((f) => f.name.toLowerCase().includes(query.toLowerCase())).slice(0, 20)
    : ALL_FONTS;

  // Load Google Font previews for visible items
  useEffect(() => {
    if (!open) return;
    const items = isSearching ? filtered : filtered.slice(Math.max(0, activeIdx - 5), activeIdx + 15);
    for (const f of items) {
      if (f.source === 'google') loadGoogleFontPreview(f.name);
    }
  }, [open, filtered, isSearching, activeIdx]);

  const select = useCallback((font: FontEntry) => {
    setOpen(false);
    setIsSearching(false);
    setQuery('');
    onChange(font.name, font.source === 'google');
  }, [onChange]);

  const toggleOpen = useCallback(() => {
    if (open) {
      setOpen(false);
      setIsSearching(false);
      setQuery('');
    } else {
      setOpen(true);
      setIsSearching(false);
      setQuery('');
      const idx = ALL_FONTS.findIndex((f) => f.name === value);
      setActiveIdx(idx >= 0 ? idx : 0);
    }
  }, [open, value]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        toggleOpen();
        e.preventDefault();
      }
      return;
    }
    if (e.key === 'ArrowDown') { setActiveIdx((i) => Math.min(i + 1, filtered.length - 1)); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { setActiveIdx((i) => Math.max(i - 1, 0)); e.preventDefault(); }
    else if (e.key === 'Enter' && activeIdx >= 0 && filtered[activeIdx]) { select(filtered[activeIdx]); e.preventDefault(); }
    else if (e.key === 'Escape') { setOpen(false); setIsSearching(false); setQuery(''); e.preventDefault(); }
  };

  // Scroll active item into view
  useEffect(() => {
    if (!open || activeIdx < 0 || !listRef.current) return;
    const el = listRef.current.children[activeIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx, open]);

  const displayValue = isSearching ? query : value;

  return (
    <div style={{ position: 'relative' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-sm)',
          background: 'var(--color-bg-input)',
          overflow: 'hidden',
        }}
      >
        <input
          ref={inputRef}
          type="text"
          value={displayValue}
          onChange={(e) => { setQuery(e.target.value); setIsSearching(true); setOpen(true); setActiveIdx(0); }}
          onFocus={() => { if (!open) toggleOpen(); }}
          onBlur={() => setTimeout(() => { setOpen(false); setIsSearching(false); setQuery(''); }, 150)}
          onKeyDown={handleKeyDown}
          placeholder="Search fonts..."
          style={{
            flex: 1,
            border: 'none',
            background: 'transparent',
            color: 'var(--color-text-primary)',
            padding: 'var(--space-sm) 6px',
            fontSize: 12,
            fontFamily: `"${value}", sans-serif`,
            outline: 'none',
            minWidth: 0,
          }}
        />
        <button
          type="button"
          onMouseDown={(e) => { e.preventDefault(); toggleOpen(); inputRef.current?.focus(); }}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--color-text-secondary)',
            padding: '2px 4px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            flexShrink: 0,
          }}
        >
          <CaretUpDown size={14} />
        </button>
      </div>
      {open && filtered.length > 0 && (
        <div
          ref={listRef}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: '100%',
            marginTop: 2,
            maxHeight: 260,
            overflowY: 'auto',
            background: 'var(--color-bg-input)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-sm)',
            zIndex: 100,
          }}
        >
          {filtered.map((f, i) => {
            const selected = f.name === value;
            return (
              <div
                key={`${f.source}-${f.name}`}
                onMouseDown={(e) => { e.preventDefault(); select(f); }}
                onMouseEnter={() => setActiveIdx(i)}
                style={{
                  padding: '5px 8px',
                  cursor: 'pointer',
                  fontSize: 13,
                  fontFamily: `"${f.name}", sans-serif`,
                  background: i === activeIdx
                    ? 'var(--color-bg-hover)'
                    : selected
                      ? 'var(--color-bg-active)'
                      : 'transparent',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span style={{ fontWeight: selected ? 600 : 400 }}>{f.name}</span>
                <span style={{ fontSize: 9, color: 'var(--color-text-secondary)', fontFamily: 'inherit', marginLeft: 8, flexShrink: 0 }}>
                  {f.source === 'google' ? 'Google' : 'System'}
                </span>
              </div>
            );
          })}
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
  const updateObjects = useEditorStore((s) => s.updateObjects);
  const activeTool = useEditorStore((s) => s.activeTool);
  const pipeRadius = useEditorStore((s) => s.pipeRadius);
  const setPipeRadius = useEditorStore((s) => s.setPipeRadius);
  const pipeRoundCorners = useEditorStore((s) => s.pipeRoundCorners);
  const setPipeRoundCorners = useEditorStore((s) => s.setPipeRoundCorners);
  const shapeConfig = useEditorStore((s) => s.shapeConfig);
  const setShapeConfig = useEditorStore((s) => s.setShapeConfig);
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
  // Accordion open state — set of open section IDs
  const [openSections, setOpenSections] = useState<Set<string>>(() => new Set());

  const hasSelection = selection.polygonIds.size > 0 || selection.objectIds.size > 0 || selection.pictureIds.size > 0;

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

  const hasToolSections = activeTool in TOOL_SECTIONS_MAP;

  if (!level || (!hasSelection && !hasToolSections)) {
    return null;
  }

  const setPolygonsGrass = useEditorStore((s) => s.setPolygonsGrass);

  // Derive selection-panel data (rendered inline, no early return)
  const selectedPolys = selection.polygonIds.size >= 1
    ? level.polygons.filter((p) => selection.polygonIds.has(p.id))
    : [];
  const selectedPolyIds = selectedPolys.length > 0 ? selectedPolys.map((p) => p.id) : null;
  const hasSelectedPolys = selectedPolys.length > 0;
  const allSameGrassState = hasSelectedPolys && selectedPolys.every((p) => p.grass === selectedPolys[0]!.grass);
  const commonGrass = allSameGrassState ? selectedPolys[0]!.grass : undefined;

  const selectedObjects = selection.objectIds.size >= 1
    ? level.objects.filter((o) => selection.objectIds.has(o.id))
    : [];
  const selectedObjIds = selectedObjects.length > 0 ? selectedObjects.map((o) => o.id) : null;
  const hasSelectedObjects = selectedObjects.length > 0;
  const allSameType = hasSelectedObjects && selectedObjects.every((o) => o!.type === selectedObjects[0]!.type);
  const allSameGravity = hasSelectedObjects && selectedObjects.every((o) => o!.gravity === selectedObjects[0]!.gravity);
  const commonType = allSameType ? selectedObjects[0]!.type : undefined;
  const commonGravity = allSameGravity ? selectedObjects[0]!.gravity : undefined;
  const anyApple = hasSelectedObjects && selectedObjects.some((o) => o!.type === ObjectType.Apple);
  const hasStart = level.objects.some((o) => o.type === ObjectType.Start);

  const updatePictures = useEditorStore((s) => s.updatePictures);

  // Split selected pictures into regular pictures vs mask/texture pictures
  const allSelectedPics = selection.pictureIds.size >= 1
    ? level.pictures.filter((p) => selection.pictureIds.has(p.id))
    : [];
  const selRegularPics = allSelectedPics.filter((p) => !p.texture);
  const selRegularPicIds = selRegularPics.map((p) => p.id);
  const selMaskPics = allSelectedPics.filter((p) => !!p.texture);
  const selMaskPicIds = selMaskPics.map((p) => p.id);

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
            {selectedPolys.length === 1 ? `Polygon ${selectedPolys[0]!.id.slice(0, 6)}` : `${selectedPolys.length} Polygons`}
          </h3>
          <div className="accordion-body">
            <div className="type-switch type-switch--vertical">
              <button
                className={`type-switch__option${commonGrass === false ? ' type-switch__option--active' : ''}`}
                onClick={() => setPolygonsGrass(selectedPolyIds!, false)}
              >
                <span className="type-switch__icon" style={{ color: '#2a5a8a' }}><PolygonIcon size={16} weight="fill" /></span> <span style={{ color: '#80b0e0' }}>Regular</span>
              </button>
              <button
                className={`type-switch__option${commonGrass === true ? ' type-switch__option--active' : ''}`}
                onClick={() => setPolygonsGrass(selectedPolyIds!, true)}
              >
                <span className="type-switch__icon" style={{ color: '#2a6a2a' }}><PlantIcon size={16} weight="fill" /></span> <span style={{ color: '#80c080' }}>Grass</span>
              </button>
            </div>
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
            {selectedObjects.length === 1 ? `Object ${selectedObjects[0]!.id.slice(0, 6)}` : `${selectedObjects.length} Objects`}
          </h3>
          <div className="accordion-body">
            {selectedObjects.length === 1 && (
              <div className="detail-text" style={{ marginBottom: 8 }}>
                Position: ({selectedObjects[0]!.position.x.toFixed(2)}, {selectedObjects[0]!.position.y.toFixed(2)})
              </div>
            )}
            <div className="type-switch type-switch--vertical">
              <button
                className={`type-switch__option${commonType === ObjectType.Exit ? ' type-switch__option--active' : ''}`}
                onClick={() => updateObjects(selectedObjIds!, { type: ObjectType.Exit })}
              >
                <span className="type-switch__icon" style={{ color: '#6a5a00' }}><FlowerIcon size={16} weight="fill" /></span> <span style={{ color: '#d0c860' }}>Flower (Exit)</span>
              </button>
              <button
                className={`type-switch__option${commonType === ObjectType.Apple ? ' type-switch__option--active' : ''}`}
                onClick={() => updateObjects(selectedObjIds!, { type: ObjectType.Apple })}
              >
                <span className="type-switch__icon" style={{ color: '#a02020' }}><AppleLogoIcon size={16} weight="fill" /></span> <span style={{ color: '#e08080' }}>Apple</span>
              </button>
              <button
                className={`type-switch__option${commonType === ObjectType.Killer ? ' type-switch__option--active' : ''}`}
                onClick={() => updateObjects(selectedObjIds!, { type: ObjectType.Killer })}
              >
                <span className="type-switch__icon" style={{ color: '#444' }}><SkullIcon size={16} weight="fill" /></span> <span style={{ color: '#909090' }}>Killer</span>
              </button>
              {(!hasStart || commonType === ObjectType.Start) && (
                <button
                  className={`type-switch__option${commonType === ObjectType.Start ? ' type-switch__option--active' : ''}`}
                  onClick={() => updateObjects(selectedObjIds!, { type: ObjectType.Start })}
                >
                  <span className="type-switch__icon" style={{ color: '#2a5a8a' }}><FlagIcon size={16} weight="fill" /></span> <span style={{ color: '#80b0e0' }}>Start</span>
                </button>
              )}
            </div>
            {(commonType === ObjectType.Apple || (commonType === undefined && anyApple)) && (
              <>
                <div style={{ marginTop: 'var(--space-md)', marginBottom: 'var(--space-xs)', fontSize: 11, color: 'var(--color-text-secondary)' }}>Gravity</div>
                <div className="type-switch type-switch--vertical">
                  <button
                    className={`type-switch__option${commonGravity === Gravity.None ? ' type-switch__option--active' : ''}`}
                    onClick={() => updateObjects(selectedObjIds!, { gravity: Gravity.None })}
                  >
                    <span className="type-switch__icon" style={{ color: '#333' }}><DotOutlineIcon size={16} weight="fill" /></span> <span style={{ color: '#aaa' }}>Normal</span>
                  </button>
                  <button
                    className={`type-switch__option${commonGravity === Gravity.Up ? ' type-switch__option--active' : ''}`}
                    onClick={() => updateObjects(selectedObjIds!, { gravity: Gravity.Up })}
                  >
                    <span className="type-switch__icon" style={{ color: '#222' }}><ArrowUpIcon size={16} weight="fill" /></span> <span style={{ color: '#aaa' }}>Up</span>
                  </button>
                  <button
                    className={`type-switch__option${commonGravity === Gravity.Down ? ' type-switch__option--active' : ''}`}
                    onClick={() => updateObjects(selectedObjIds!, { gravity: Gravity.Down })}
                  >
                    <span className="type-switch__icon" style={{ color: '#222' }}><ArrowDownIcon size={16} weight="fill" /></span> <span style={{ color: '#aaa' }}>Down</span>
                  </button>
                  <button
                    className={`type-switch__option${commonGravity === Gravity.Left ? ' type-switch__option--active' : ''}`}
                    onClick={() => updateObjects(selectedObjIds!, { gravity: Gravity.Left })}
                  >
                    <span className="type-switch__icon" style={{ color: '#222' }}><ArrowLeftIcon size={16} weight="fill" /></span> <span style={{ color: '#aaa' }}>Left</span>
                  </button>
                  <button
                    className={`type-switch__option${commonGravity === Gravity.Right ? ' type-switch__option--active' : ''}`}
                    onClick={() => updateObjects(selectedObjIds!, { gravity: Gravity.Right })}
                  >
                    <span className="type-switch__icon" style={{ color: '#222' }}><ArrowRightIcon size={16} weight="fill" /></span> <span style={{ color: '#aaa' }}>Right</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </>
      )}
      {selRegularPics.length > 0 && (
        <>
          <h3 className="section-header section-header--open">
            {selRegularPics.length === 1 ? `Picture ${selRegularPics[0]!.id.slice(0, 6)}` : `${selRegularPics.length} Pictures`}
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
                onChange={(e) => updatePictures(selRegularPicIds, { name: e.target.value })}
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
                onChange={(e) => updatePictures(selRegularPicIds, { clip: Number(e.target.value) as Clip })}
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
                onChange={(e) => updatePictures(selRegularPicIds, { distance: Number(e.target.value) })}
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
            {selMaskPics.length === 1 ? `Mask ${selMaskPics[0]!.id.slice(0, 6)}` : `${selMaskPics.length} Masks`}
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
                onChange={(e) => updatePictures(selMaskPicIds, { texture: e.target.value })}
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
                onChange={(e) => updatePictures(selMaskPicIds, { mask: e.target.value })}
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
                onChange={(e) => updatePictures(selMaskPicIds, { clip: Number(e.target.value) as Clip })}
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
                onChange={(e) => updatePictures(selMaskPicIds, { distance: Number(e.target.value) })}
                className="input"
                min={1}
                max={999}
              />
            </label>
          </div>
        </>
      )}

      {activeTool === ToolId.DrawObject && (
      <Section id="objectPlacement" title="Object" open={openSections.has('objectPlacement')} onToggle={toggleSection}>
        <div className="type-switch type-switch--vertical">
          <button
            className={`type-switch__option${objectConfig.type === ObjectType.Exit ? ' type-switch__option--active' : ''}`}
            onClick={() => setObjectConfig({ type: ObjectType.Exit })}
          >
            <span className="type-switch__icon" style={{ color: '#6a5a00' }}><FlowerIcon size={16} weight="fill" /></span> <span style={{ color: '#d0c860' }}>Flower (Exit)</span>
          </button>
          <button
            className={`type-switch__option${objectConfig.type === ObjectType.Apple ? ' type-switch__option--active' : ''}`}
            onClick={() => setObjectConfig({ type: ObjectType.Apple })}
          >
            <span className="type-switch__icon" style={{ color: '#a02020' }}><AppleLogoIcon size={16} weight="fill" /></span> <span style={{ color: '#e08080' }}>Apple</span>
          </button>
          <button
            className={`type-switch__option${objectConfig.type === ObjectType.Killer ? ' type-switch__option--active' : ''}`}
            onClick={() => setObjectConfig({ type: ObjectType.Killer })}
          >
            <span className="type-switch__icon" style={{ color: '#444' }}><SkullIcon size={16} weight="fill" /></span> <span style={{ color: '#909090' }}>Killer</span>
          </button>
          {!hasStart && (
            <button
              className={`type-switch__option${objectConfig.type === ObjectType.Start ? ' type-switch__option--active' : ''}`}
              onClick={() => setObjectConfig({ type: ObjectType.Start })}
            >
              <span className="type-switch__icon" style={{ color: '#2a5a8a' }}><FlagIcon size={16} weight="fill" /></span> <span style={{ color: '#80b0e0' }}>Start</span>
            </button>
          )}
        </div>
        {objectConfig.type === ObjectType.Apple && (
          <>
            <div style={{ marginTop: 'var(--space-md)', marginBottom: 'var(--space-xs)', fontSize: 11, color: 'var(--color-text-secondary)' }}>Gravity</div>
            <div className="type-switch type-switch--vertical">
              <button
                className={`type-switch__option${objectConfig.gravity === Gravity.None ? ' type-switch__option--active' : ''}`}
                onClick={() => setObjectConfig({ gravity: Gravity.None })}
              >
                <span className="type-switch__icon" style={{ color: '#333' }}><DotOutlineIcon size={16} weight="fill" /></span> <span style={{ color: '#aaa' }}>Normal</span>
              </button>
              <button
                className={`type-switch__option${objectConfig.gravity === Gravity.Up ? ' type-switch__option--active' : ''}`}
                onClick={() => setObjectConfig({ gravity: Gravity.Up })}
              >
                <span className="type-switch__icon" style={{ color: '#222' }}><ArrowUpIcon size={16} weight="fill" /></span> <span style={{ color: '#aaa' }}>Up</span>
              </button>
              <button
                className={`type-switch__option${objectConfig.gravity === Gravity.Down ? ' type-switch__option--active' : ''}`}
                onClick={() => setObjectConfig({ gravity: Gravity.Down })}
              >
                <span className="type-switch__icon" style={{ color: '#222' }}><ArrowDownIcon size={16} weight="fill" /></span> <span style={{ color: '#aaa' }}>Down</span>
              </button>
              <button
                className={`type-switch__option${objectConfig.gravity === Gravity.Left ? ' type-switch__option--active' : ''}`}
                onClick={() => setObjectConfig({ gravity: Gravity.Left })}
              >
                <span className="type-switch__icon" style={{ color: '#222' }}><ArrowLeftIcon size={16} weight="fill" /></span> <span style={{ color: '#aaa' }}>Left</span>
              </button>
              <button
                className={`type-switch__option${objectConfig.gravity === Gravity.Right ? ' type-switch__option--active' : ''}`}
                onClick={() => setObjectConfig({ gravity: Gravity.Right })}
              >
                <span className="type-switch__icon" style={{ color: '#222' }}><ArrowRightIcon size={16} weight="fill" /></span> <span style={{ color: '#aaa' }}>Right</span>
              </button>
            </div>
          </>
        )}
      </Section>
      )}

      {activeTool === ToolId.DrawPicture && (
        <Section id="picturePlacement" title="Picture" open={openSections.has('picturePlacement')} onToggle={toggleSection}>
          <BitmapPicker
            items={getEditorLgr()?.pictures}
            selected={pictureConfig.name}
            onSelect={(name) => setPictureConfig({ name })}
            placeholder="Filter pictures…"
          />
          <div style={{ marginBottom: 'var(--space-xs)', fontSize: 11, color: 'var(--color-text-secondary)' }}>Clipping</div>
          <div className="type-switch type-switch--vertical">
            <button
              className={`type-switch__option${pictureConfig.clip === Clip.Ground ? ' type-switch__option--active' : ''}`}
              onClick={() => setPictureConfig({ clip: Clip.Ground })}
            >
              <span className="type-switch__icon" style={{ color: '#5a3a1a' }}><PolygonIcon size={16} weight="fill" /></span> <span style={{ color: '#c0a060' }}>Ground</span>
            </button>
            <button
              className={`type-switch__option${pictureConfig.clip === Clip.Sky ? ' type-switch__option--active' : ''}`}
              onClick={() => setPictureConfig({ clip: Clip.Sky })}
            >
              <span className="type-switch__icon" style={{ color: '#2a4a6a' }}><CircleIcon size={16} weight="fill" /></span> <span style={{ color: '#80b0d0' }}>Sky</span>
            </button>
            <button
              className={`type-switch__option${pictureConfig.clip === Clip.Unclipped ? ' type-switch__option--active' : ''}`}
              onClick={() => setPictureConfig({ clip: Clip.Unclipped })}
            >
              <span className="type-switch__icon" style={{ color: '#444' }}><SquareIcon size={16} weight="fill" /></span> <span style={{ color: '#aaa' }}>Unclipped</span>
            </button>
          </div>
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
          <span className="form-label">Texture</span>
          <BitmapPicker
            items={getEditorLgr()?.textureBitmaps}
            selected={maskConfig.texture}
            onSelect={(name) => setMaskConfig({ texture: name })}
            placeholder="Filter textures…"
          />
          <span className="form-label">Mask</span>
          <BitmapPicker
            items={getEditorLgr()?.masks}
            selected={maskConfig.mask}
            onSelect={(name) => setMaskConfig({ mask: name })}
            placeholder="Filter masks…"
          />
          <div style={{ marginBottom: 'var(--space-xs)', fontSize: 11, color: 'var(--color-text-secondary)' }}>Clipping</div>
          <div className="type-switch type-switch--vertical">
            <button
              className={`type-switch__option${maskConfig.clip === Clip.Ground ? ' type-switch__option--active' : ''}`}
              onClick={() => setMaskConfig({ clip: Clip.Ground })}
            >
              <span className="type-switch__icon" style={{ color: '#5a3a1a' }}><PolygonIcon size={16} weight="fill" /></span> <span style={{ color: '#c0a060' }}>Ground</span>
            </button>
            <button
              className={`type-switch__option${maskConfig.clip === Clip.Sky ? ' type-switch__option--active' : ''}`}
              onClick={() => setMaskConfig({ clip: Clip.Sky })}
            >
              <span className="type-switch__icon" style={{ color: '#2a4a6a' }}><CircleIcon size={16} weight="fill" /></span> <span style={{ color: '#80b0d0' }}>Sky</span>
            </button>
            <button
              className={`type-switch__option${maskConfig.clip === Clip.Unclipped ? ' type-switch__option--active' : ''}`}
              onClick={() => setMaskConfig({ clip: Clip.Unclipped })}
            >
              <span className="type-switch__icon" style={{ color: '#444' }}><SquareIcon size={16} weight="fill" /></span> <span style={{ color: '#aaa' }}>Unclipped</span>
            </button>
          </div>
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
          <div className="type-switch type-switch--vertical">
            {([
              ['triangle', TriangleIcon, 'Triangle', '#6090c0'],
              ['square', SquareIcon, 'Square', '#6090c0'],
              ['rectangle', RectangleIcon, 'Rectangle', '#6090c0'],
              ['trapezoid', DiamondIcon, 'Trapezoid', '#6090c0'],
              ['parallelogram', ParallelogramIcon, 'Parallelogram', '#6090c0'],
              ['circle', CircleIcon, 'Circle', '#60a060'],
              ['ellipse', CircleIcon, 'Ellipse', '#60a060'],
              ['polygon', PentagonIcon, 'Polygon', '#c09060'],
              ['star', StarIcon, 'Star', '#c0a030'],
              ['random', ShuffleIcon, 'Random', '#a060c0'],
            ] as const).map(([type, Icon, label, color]) => (
              <button
                key={type}
                className={`type-switch__option${shapeConfig.type === type ? ' type-switch__option--active' : ''}`}
                onClick={() => setShapeConfig({ type: type as ShapeType })}
              >
                <span className="type-switch__icon" style={{ color }}><Icon size={16} weight="fill" /></span>
                <span style={{ color }}>{label}</span>
              </button>
            ))}
          </div>

          {shapeConfig.type === 'trapezoid' && (
            <label className="form-label" style={{ marginTop: 'var(--space-md)' }}>
              Top ratio %
              <input type="number" value={shapeConfig.topRatio} min={1} max={99} step={1}
                onChange={(e) => { const v = parseInt(e.target.value, 10); if (v >= 1 && v <= 99) setShapeConfig({ topRatio: v }); }}
                className="input" />
            </label>
          )}

          {shapeConfig.type === 'parallelogram' && (
            <label className="form-label" style={{ marginTop: 'var(--space-md)' }}>
              Tilt angle
              <input type="number" value={shapeConfig.tiltAngle} min={1} max={80} step={1}
                onChange={(e) => { const v = parseInt(e.target.value, 10); if (v >= 1 && v <= 80) setShapeConfig({ tiltAngle: v }); }}
                className="input" />
            </label>
          )}

          {shapeConfig.type === 'circle' && (
            <label className="form-label" style={{ marginTop: 'var(--space-md)' }}>
              Segments
              <input type="number" value={shapeConfig.segments} min={8} max={1024} step={1}
                onChange={(e) => { const v = parseInt(e.target.value, 10); if (v >= 8 && v <= 1024) setShapeConfig({ segments: v }); }}
                className="input" />
            </label>
          )}

          {shapeConfig.type === 'ellipse' && (
            <label className="form-label" style={{ marginTop: 'var(--space-md)' }}>
              Segments
              <input type="number" value={shapeConfig.segments} min={8} max={1024} step={1}
                onChange={(e) => { const v = parseInt(e.target.value, 10); if (v >= 8 && v <= 1024) setShapeConfig({ segments: v }); }}
                className="input" />
            </label>
          )}

          {shapeConfig.type === 'polygon' && (
            <label className="form-label" style={{ marginTop: 'var(--space-md)' }}>
              Sides
              <input type="number" value={shapeConfig.sides} min={3} max={1024} step={1}
                onChange={(e) => { const v = parseInt(e.target.value, 10); if (v >= 3 && v <= 1024) setShapeConfig({ sides: v }); }}
                className="input" />
            </label>
          )}

          {shapeConfig.type === 'star' && (
            <>
              <label className="form-label" style={{ marginTop: 'var(--space-md)' }}>
                Points
                <input type="number" value={shapeConfig.starPoints} min={3} max={64} step={1}
                  onChange={(e) => { const v = parseInt(e.target.value, 10); if (v >= 3 && v <= 64) setShapeConfig({ starPoints: v }); }}
                  className="input" />
              </label>
              <label className="form-label">
                Depth %
                <input type="number" value={shapeConfig.starDepth} min={1} max={99} step={1}
                  onChange={(e) => { const v = parseInt(e.target.value, 10); if (v >= 1 && v <= 99) setShapeConfig({ starDepth: v }); }}
                  className="input" />
              </label>
            </>
          )}

          {shapeConfig.type === 'random' && (
            <>
              <label className="form-label" style={{ marginTop: 'var(--space-md)' }}>
                Min vertices
                <input type="number" value={shapeConfig.randomMinVertices} min={3} max={64} step={1}
                  onChange={(e) => { const v = parseInt(e.target.value, 10); if (v >= 3 && v <= 64) setShapeConfig({ randomMinVertices: v, randomMaxVertices: Math.max(v, shapeConfig.randomMaxVertices) }); }}
                  className="input" />
              </label>
              <label className="form-label">
                Max vertices
                <input type="number" value={shapeConfig.randomMaxVertices} min={3} max={64} step={1}
                  onChange={(e) => { const v = parseInt(e.target.value, 10); if (v >= 3 && v <= 64) setShapeConfig({ randomMaxVertices: v, randomMinVertices: Math.min(v, shapeConfig.randomMinVertices) }); }}
                  className="input" />
              </label>
              <div className="hint-text">Press <kbd>Space</kbd> to generate a new random shape</div>
            </>
          )}
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


</>
  );
}
