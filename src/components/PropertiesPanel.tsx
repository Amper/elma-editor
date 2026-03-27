import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { useEditorStore } from '@/state/editorStore';
import { switchLgr } from '@/canvas/lgrCache';
import { fetchLgrList, type LgrInfo } from '@/api/lgrApi';
import { LgrSelector } from './LgrSelector';
import type { ButtonViewMode, ButtonSize } from '@/types';

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

export function PropertiesPanel() {
  const level = useEditorStore((s) => s.level);
  const grid = useEditorStore((s) => s.grid);
  const setGrid = useEditorStore((s) => s.setGrid);
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
  const objectsAnimation = useEditorStore((s) => s.objectsAnimation);
  const setObjectsAnimation = useEditorStore((s) => s.setObjectsAnimation);

  const testConfig = useEditorStore((s) => s.testConfig);
  const setTestConfig = useEditorStore((s) => s.setTestConfig);

  const showActionsBar = useEditorStore((s) => s.showActionsBar);
  const setShowActionsBar = useEditorStore((s) => s.setShowActionsBar);
  const toolbarViewMode = useEditorStore((s) => s.toolbarViewMode);
  const setToolbarViewMode = useEditorStore((s) => s.setToolbarViewMode);
  const actionsBarViewMode = useEditorStore((s) => s.actionsBarViewMode);
  const setActionsBarViewMode = useEditorStore((s) => s.setActionsBarViewMode);
  const toolbarButtonSize = useEditorStore((s) => s.toolbarButtonSize);
  const setToolbarButtonSize = useEditorStore((s) => s.setToolbarButtonSize);
  const actionsBarButtonSize = useEditorStore((s) => s.actionsBarButtonSize);
  const setActionsBarButtonSize = useEditorStore((s) => s.setActionsBarButtonSize);
  const showStatusBar = useEditorStore((s) => s.showStatusBar);
  const setShowStatusBar = useEditorStore((s) => s.setShowStatusBar);
  const showMinimap = useEditorStore((s) => s.showMinimap);
  const setShowMinimap = useEditorStore((s) => s.setShowMinimap);
  const minimapOpacity = useEditorStore((s) => s.minimapOpacity);
  const setMinimapOpacity = useEditorStore((s) => s.setMinimapOpacity);

  const selectedLgr = useEditorStore((s) => s.selectedLgr);
  const setSelectedLgr = useEditorStore((s) => s.setSelectedLgr);
  const lgrLoading = useEditorStore((s) => s.lgrLoading);
  const setLgrLoading = useEditorStore((s) => s.setLgrLoading);

  const [lgrList, setLgrList] = useState<LgrInfo[]>([]);
  useEffect(() => { fetchLgrList().then(setLgrList); }, []);

  const handleLgrChange = useCallback(async (name: string) => {
    setSelectedLgr(name);
    setLgrLoading(true);
    try {
      if (name === 'Default') {
        await switchLgr('/lgr/Default.lgr');
      } else {
        await switchLgr(`https://api.elma.online/api/lgr/get/${name}`);
      }
    } catch (err) {
      console.warn('Failed to load LGR:', err);
    } finally {
      setLgrLoading(false);
    }
  }, [setSelectedLgr, setLgrLoading]);

  const [openSections, setOpenSections] = useState<Set<string>>(() => new Set());

  const toggleSection = useCallback((id: string) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  if (!level) return null;

  return (
    <>
      <Section id="interface" title="Interface" open={openSections.has('interface')} onToggle={toggleSection}>
        <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={showActionsBar} onChange={() => setShowActionsBar(!showActionsBar)} />
          Show actions bar
        </label>
        <LgrSelector
          items={lgrList}
          value={selectedLgr}
          loading={lgrLoading}
          onChange={handleLgrChange}
        />
        <label className="form-label">
          Toolbar buttons
          <select
            className="select"
            value={toolbarViewMode}
            onChange={(e) => setToolbarViewMode(e.target.value as ButtonViewMode)}
          >
            <option value="both">Icons + Text</option>
            <option value="icons">Icons only</option>
            <option value="text">Text only</option>
          </select>
        </label>
        <label className="form-label">
          Toolbar button size
          <select
            className="select"
            value={toolbarButtonSize}
            onChange={(e) => setToolbarButtonSize(e.target.value as ButtonSize)}
          >
            <option value="small">Small</option>
            <option value="medium">Medium</option>
            <option value="large">Large</option>
          </select>
        </label>
        <label className="form-label">
          Actions bar buttons
          <select
            className="select"
            value={actionsBarViewMode}
            onChange={(e) => setActionsBarViewMode(e.target.value as ButtonViewMode)}
          >
            <option value="both">Icons + Text</option>
            <option value="icons">Icons only</option>
            <option value="text">Text only</option>
          </select>
        </label>
        <label className="form-label">
          Actions bar button size
          <select
            className="select"
            value={actionsBarButtonSize}
            onChange={(e) => setActionsBarButtonSize(e.target.value as ButtonSize)}
          >
            <option value="small">Small</option>
            <option value="medium">Medium</option>
            <option value="large">Large</option>
          </select>
        </label>
        <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={showStatusBar} onChange={() => setShowStatusBar(!showStatusBar)} />
          Show statusbar
        </label>
        <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={showMinimap} onChange={() => setShowMinimap(!showMinimap)} />
          Show minimap
        </label>
        {showMinimap && (
          <label className="form-label">
            Minimap opacity
            <input
              type="range"
              min={10}
              max={100}
              step={5}
              value={minimapOpacity}
              onChange={(e) => setMinimapOpacity(parseInt(e.target.value, 10))}
              style={{ width: '100%' }}
            />
          </label>
        )}
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
        <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={objectsAnimation} onChange={() => setObjectsAnimation(!objectsAnimation)} />
          Objects animation
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
        <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={testConfig.objectsAnimation} onChange={() => setTestConfig({ objectsAnimation: !testConfig.objectsAnimation })} />
          Objects animation
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
      </Section>

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
    </>
  );
}
