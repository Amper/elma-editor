import { useState, useRef, useCallback, useMemo, type ReactNode } from 'react';
import { useEditorStore } from '@/state/editorStore';
import { COMMANDS, getShortcut, type CommandCategory } from '@/commands/commandRegistry';
import { fuzzyMatch } from '@/commands/fuzzyMatch';
import './HotkeysPanel.css';

/* ────────────────────────────────────────────────────────────
   Content data
   ──────────────────────────────────────────────────────────── */

const isMac = navigator.platform.includes('Mac');
const mod = isMac ? '\u2318' : 'Ctrl+';

interface DocSection {
  id: string;
  title: string;
  children?: { id: string; title: string }[];
}

const NAV_SECTIONS: DocSection[] = [
  { id: 'getting-started', title: 'Getting Started' },
  {
    id: 'tools', title: 'Tools', children: [
      { id: 'tool-select', title: 'Select' },
      { id: 'tool-polygon', title: 'Polygon' },
      { id: 'tool-grass', title: 'Grass' },
      { id: 'tool-vertex', title: 'Vertex' },
      { id: 'tool-object', title: 'Object' },
      { id: 'tool-shape', title: 'Shape' },
      { id: 'tool-picture', title: 'Picture' },
      { id: 'tool-mask', title: 'Mask' },
      { id: 'tool-pipe', title: 'Pipe' },
      { id: 'tool-pan', title: 'Pan' },
      { id: 'tool-image', title: 'Image Import' },
      { id: 'tool-text', title: 'Text' },
    ],
  },
  { id: 'polygon-ops', title: 'Polygon Operations' },
  { id: 'navigation', title: 'Navigation & Viewport' },
  { id: 'file-management', title: 'File Management' },
  { id: 'editing', title: 'Editing' },
  { id: 'testing', title: 'Testing' },
  { id: 'collaboration', title: 'Collaboration' },
  { id: 'shortcuts', title: 'Keyboard Shortcuts' },
];

interface ToolInfo {
  id: string;
  name: string;
  key: string;
  description: string;
  mouse: string[];
  keyboard: string[];
  tips?: string[];
}

const TOOLS: ToolInfo[] = [
  {
    id: 'tool-select', name: 'Select', key: 'S',
    description: 'Select, move, and transform polygons, objects, and pictures.',
    mouse: [
      'Click an element to select it',
      'Shift+click to add/remove from selection',
      'Click and drag empty space for rubber-band selection',
      'Click and drag selected elements to move them',
      'Double-click a polygon to enter vertex editing mode',
      'Drag resize handles on the transform frame to scale',
      'Drag the rotation handle (above frame) to rotate',
    ],
    keyboard: [
      'Arrow keys \u2014 nudge selection by grid size',
      'Shift+Arrow \u2014 nudge by 5\u00d7 grid size',
      'Delete / Backspace \u2014 remove selected elements',
      'M \u2014 merge selected polygons',
      'X \u2014 split selected polygon(s)',
    ],
    tips: [
      'The transform frame appears when items are selected, with 8 resize handles and a rotation handle.',
      'In vertex editing mode (double-click), you can select and move individual vertices within a polygon. Press Escape to exit.',
    ],
  },
  {
    id: 'tool-polygon', name: 'Polygon', key: 'D',
    description: 'Draw ground polygons by placing vertices one at a time.',
    mouse: [
      'Click to place a vertex',
      'Right-click to commit the polygon',
      'Click on an existing polygon edge to continue drawing from it',
    ],
    keyboard: [
      'Enter \u2014 commit polygon',
      'Escape \u2014 cancel and discard vertices',
      'Backspace \u2014 undo last vertex',
      'Space \u2014 reverse drawing direction',
    ],
    tips: [
      'Continuation mode: click on an existing polygon edge before placing any new vertices to extend that polygon.',
    ],
  },
  {
    id: 'tool-grass', name: 'Grass', key: 'G',
    description: 'Draw grass polygons. Same workflow as the Polygon tool, but the polygon is marked as grass (decorative, no collision).',
    mouse: [
      'Click to place a vertex',
      'Right-click to commit the polygon',
      'Click on an existing polygon edge to continue from it',
    ],
    keyboard: [
      'Enter \u2014 commit polygon',
      'Escape \u2014 cancel and discard vertices',
      'Backspace \u2014 undo last vertex',
      'Space \u2014 reverse drawing direction',
    ],
  },
  {
    id: 'tool-vertex', name: 'Vertex', key: 'V',
    description: 'Edit vertices on existing polygons: select, move, insert, or delete.',
    mouse: [
      'Click a vertex to select it',
      'Shift+click to toggle vertex selection',
      'Click on a polygon edge to insert a new vertex',
      'Click and drag empty space for rubber-band selection',
      'Click and drag selected vertices to move them',
    ],
    keyboard: [
      'Delete / Backspace \u2014 remove selected vertices (min 3 per polygon)',
      'Arrow keys \u2014 nudge selected vertices by grid size',
      'Shift+Arrow \u2014 nudge by 5\u00d7 grid size',
    ],
  },
  {
    id: 'tool-object', name: 'Object', key: 'O',
    description: 'Place game objects: Start, Exit (flower), Apple, or Killer.',
    mouse: [
      'Click to place the configured object',
    ],
    keyboard: [],
    tips: [
      'Configure the object type, gravity direction, and animation frame in the Property Panel.',
      'Only one Start object is allowed per level.',
    ],
  },
  {
    id: 'tool-shape', name: 'Shape', key: 'R',
    description: 'Draw regular shapes with configurable parameters.',
    mouse: [
      'Rubber-band shapes (rectangle, trapezoid, parallelogram, ellipse): click start corner, drag to opposite corner',
      'Center-radius shapes (triangle, square, circle, polygon, star, random): click center, drag to set radius',
    ],
    keyboard: [
      'Enter \u2014 commit shape',
      'Escape \u2014 cancel shape',
      'Space \u2014 regenerate random polygon (when shape type is "random")',
    ],
    tips: [
      'Shape parameters (sides, star depth, segments, etc.) are configurable in the Property Panel.',
    ],
  },
  {
    id: 'tool-picture', name: 'Picture', key: 'Q',
    description: 'Place LGR picture sprites as level decorations.',
    mouse: [
      'Click to place the selected picture',
    ],
    keyboard: [
      'C \u2014 cycle clip mode (Unclipped \u2192 Ground \u2192 Sky)',
    ],
    tips: [
      'Select the picture name, clip mode, and distance in the Property Panel. Requires an LGR to be loaded.',
    ],
  },
  {
    id: 'tool-mask', name: 'Mask', key: 'M',
    description: 'Place texture+mask composite pictures for patterned backgrounds.',
    mouse: [
      'Click to place the texture/mask pair',
    ],
    keyboard: [
      'C \u2014 cycle clip mode (Unclipped \u2192 Ground \u2192 Sky)',
    ],
    tips: [
      'Configure the texture name, mask name, clip mode, and distance in the Property Panel.',
    ],
  },
  {
    id: 'tool-pipe', name: 'Pipe', key: 'P',
    description: 'Draw pipes by placing spine (centerline) points. Parallel walls are generated automatically on both sides.',
    mouse: [
      'Click to place a spine point',
      'Right-click to commit the pipe polygon',
    ],
    keyboard: [
      'Enter \u2014 commit pipe',
      'Escape \u2014 cancel and discard points',
      'Backspace \u2014 undo last spine point',
    ],
    tips: [
      'Configure pipe radius and rounded vs. mitered corners in the Property Panel.',
    ],
  },
  {
    id: 'tool-pan', name: 'Pan', key: 'H',
    description: 'Pan the canvas view by dragging.',
    mouse: [
      'Click and drag to pan the viewport',
    ],
    keyboard: [],
    tips: [
      'You can also hold Space with any tool for temporary panning, or use the middle mouse button.',
    ],
  },
  {
    id: 'tool-image', name: 'Image Import', key: 'I',
    description: 'Import an image and trace its contours into polygons.',
    mouse: [
      'Click to place the traced polygons at cursor position',
      'Right-click to clear loaded polygons',
    ],
    keyboard: [
      'Escape \u2014 clear loaded polygons',
    ],
    tips: [
      'Load an image and configure tracing parameters (threshold, simplify tolerance, scale, invert) in the Property Panel.',
    ],
  },
  {
    id: 'tool-text', name: 'Text', key: 'X',
    description: 'Convert text into polygon outlines and place them in the level.',
    mouse: [
      'Click to place the text polygons at cursor position',
      'Right-click to clear loaded text',
    ],
    keyboard: [
      'Escape \u2014 clear loaded text polygons',
    ],
    tips: [
      'Enter text, select font family/size/style in the Property Panel. Supports system and Google Fonts.',
    ],
  },
];

/* ────────────────────────────────────────────────────────────
   Section renderers
   ──────────────────────────────────────────────────────────── */

function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="hotkeys-panel__kbd">{children}</kbd>;
}

function Tip({ children }: { children: ReactNode }) {
  return <div className="hotkeys-panel__tip">{children}</div>;
}

function ToolCard({ tool, defaultOpen }: { tool: ToolInfo; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="hotkeys-panel__tool-card" id={tool.id}>
      <div className="hotkeys-panel__tool-header" onClick={() => setOpen(!open)}>
        <span className="hotkeys-panel__tool-name">{tool.name}</span>
        <Kbd>{tool.key}</Kbd>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>{open ? '\u25B2' : '\u25BC'}</span>
      </div>
      {open && (
        <div className="hotkeys-panel__tool-body">
          <p className="hotkeys-panel__tool-desc">{tool.description}</p>
          <h4>Mouse</h4>
          <ul>{tool.mouse.map((m, i) => <li key={i}>{m}</li>)}</ul>
          {tool.keyboard.length > 0 && (
            <>
              <h4>Keyboard</h4>
              <ul>{tool.keyboard.map((k, i) => <li key={i}>{k}</li>)}</ul>
            </>
          )}
          {tool.tips && tool.tips.length > 0 && (
            <>
              <h4>Tips</h4>
              {tool.tips.map((t, i) => <Tip key={i}>{t}</Tip>)}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Keyboard Shortcuts section (preserves original dynamic rendering) ── */

const SHORTCUT_CATEGORY_ORDER: CommandCategory[] = ['File', 'Edit', 'Selection', 'Tools', 'Polygon', 'View', 'Testing'];

const EXTRA_SHORTCUTS: { category: string; items: { label: string; shortcut: string }[] }[] = [
  {
    category: 'General',
    items: [
      { label: 'Help / Documentation', shortcut: 'F1' },
      { label: 'Command Palette', shortcut: `${mod}K` },
      { label: 'Temporary Pan', shortcut: 'Space (hold)' },
    ],
  },
  {
    category: 'Tool-Specific',
    items: [
      { label: 'Commit polygon / pipe / shape', shortcut: 'Enter' },
      { label: 'Cancel drawing', shortcut: 'Escape' },
      { label: 'Undo last vertex / point', shortcut: 'Backspace' },
      { label: 'Reverse polygon direction', shortcut: 'Space' },
      { label: 'Cycle clip mode (Picture / Mask)', shortcut: 'C' },
      { label: 'Merge polygons (Select tool)', shortcut: 'M' },
      { label: 'Split polygon (Select tool)', shortcut: 'X' },
      { label: 'Nudge selection / vertices', shortcut: 'Arrow keys' },
      { label: 'Nudge 5\u00d7', shortcut: 'Shift+Arrow' },
      { label: 'Regenerate random shape', shortcut: 'Space' },
    ],
  },
];

function ShortcutsSection() {
  const grouped = new Map<CommandCategory, { label: string; shortcut: string }[]>();
  for (const cmd of COMMANDS) {
    const shortcut = getShortcut(cmd);
    if (!shortcut) continue;
    if (!grouped.has(cmd.category)) grouped.set(cmd.category, []);
    grouped.get(cmd.category)!.push({ label: cmd.label, shortcut });
  }

  return (
    <>
      {EXTRA_SHORTCUTS.map(({ category, items }) => (
        <div key={category}>
          <div className="hotkeys-panel__category">{category}</div>
          {items.map((item) => (
            <div key={item.label} className="hotkeys-panel__item">
              <span className="hotkeys-panel__label">{item.label}</span>
              <kbd className="hotkeys-panel__kbd">{item.shortcut}</kbd>
            </div>
          ))}
        </div>
      ))}
      {SHORTCUT_CATEGORY_ORDER.map((cat) => {
        const items = grouped.get(cat);
        if (!items || items.length === 0) return null;
        return (
          <div key={cat}>
            <div className="hotkeys-panel__category">{cat}</div>
            {items.map((item) => (
              <div key={item.label} className="hotkeys-panel__item">
                <span className="hotkeys-panel__label">{item.label}</span>
                <kbd className="hotkeys-panel__kbd">{item.shortcut}</kbd>
              </div>
            ))}
          </div>
        );
      })}
    </>
  );
}

/* ────────────────────────────────────────────────────────────
   Searchable content definitions
   ──────────────────────────────────────────────────────────── */

interface ContentBlock {
  sectionId: string;
  searchText: string;
  render: (expandTools: boolean) => ReactNode;
}

function buildContent(): ContentBlock[] {
  const blocks: ContentBlock[] = [];

  // ── Getting Started ──
  blocks.push({
    sectionId: 'getting-started',
    searchText: 'getting started overview interface toolbar canvas property panel status bar polygon ground grass objects start exit apple killer pictures masks lgr level editor elastomania elma',
    render: () => (
      <div className="hotkeys-panel__section" id="getting-started">
        <h3 className="hotkeys-panel__section-title">Getting Started</h3>
        <p className="hotkeys-panel__paragraph">
          eled is a browser-based level editor for Elastomania (Elma). Create and edit .lev files
          entirely in the browser with drawing tools, real-time validation, and built-in playtesting.
        </p>
        <p className="hotkeys-panel__paragraph">
          <strong>Interface overview:</strong> The Toolbar on the left provides access to all drawing
          and editing tools. The Canvas in the center is your editing area. The Property Panel on the
          right auto-appears with options for the active tool or selection. The Menu Bar at the top
          has edit actions, polygon operations, and test controls. The Status Bar at the bottom shows
          coordinates, element counts, and topology errors.
        </p>
        <p className="hotkeys-panel__paragraph">
          <strong>Key concepts:</strong>
        </p>
        <dl className="hotkeys-panel__dl">
          <dt>Polygons</dt>
          <dd>Ground polygons define the terrain. Grass polygons are decorative overlays with no collision.</dd>
          <dt>Objects</dt>
          <dd>Start (bike spawn), Exit / Flower (finish), Apple (collectible), Killer (obstacle).</dd>
          <dt>Pictures &amp; Masks</dt>
          <dd>Decorative sprites and texture/mask composites from LGR graphics files.</dd>
          <dt>LGR</dt>
          <dd>Graphics pack that provides ground/sky textures, object sprites, and picture assets.</dd>
        </dl>
        <Tip>Press <strong>{mod}K</strong> to open the Command Palette and quickly find any action.</Tip>
      </div>
    ),
  });

  // ── Tools ──
  blocks.push({
    sectionId: 'tools',
    searchText: TOOLS.map(t => `${t.name} ${t.key} ${t.description} ${t.mouse.join(' ')} ${t.keyboard.join(' ')} ${(t.tips || []).join(' ')}`).join(' '),
    render: (expandTools: boolean) => (
      <div className="hotkeys-panel__section" id="tools">
        <h3 className="hotkeys-panel__section-title">Tools</h3>
        <p className="hotkeys-panel__paragraph">
          Activate tools via the toolbar or keyboard shortcut. Each tool provides specific mouse and
          keyboard interactions. The Property Panel shows options relevant to the active tool.
        </p>
        {TOOLS.map((tool) => (
          <ToolCard key={tool.id} tool={tool} defaultOpen={expandTools} />
        ))}
      </div>
    ),
  });

  // ── Polygon Operations ──
  blocks.push({
    sectionId: 'polygon-ops',
    searchText: 'polygon operations merge split auto grass mirror horizontal vertical smooth simplify boolean union divide cut reduce vertices',
    render: () => (
      <div className="hotkeys-panel__section" id="polygon-ops">
        <h3 className="hotkeys-panel__section-title">Polygon Operations</h3>
        <p className="hotkeys-panel__paragraph">
          These operations are available from the Menu Bar, context menu, or keyboard shortcuts when
          polygons are selected.
        </p>
        <dl className="hotkeys-panel__dl">
          <dt>Merge</dt>
          <dd>Boolean union of 2 or more selected overlapping polygons into one. Available when 2+ polygons are selected.</dd>
          <dt>Split</dt>
          <dd>Divide a self-intersecting polygon at its crossing points, or split two overlapping polygons.</dd>
          <dt>Auto Grass <Kbd>T</Kbd></dt>
          <dd>Automatically generate grass strips on floor-facing edges of selected ground polygons. Thickness and angle are configurable in Settings.</dd>
          <dt>Mirror Horizontally</dt>
          <dd>Flip selected polygons, objects, and pictures around their vertical center axis.</dd>
          <dt>Mirror Vertically</dt>
          <dd>Flip selected elements around their horizontal center axis.</dd>
          <dt>Smooth</dt>
          <dd>Apply a smoothing filter to selected polygon vertices for rounder shapes.</dd>
          <dt>Simplify</dt>
          <dd>Reduce vertex count using the Ramer-Douglas-Peucker algorithm while preserving the overall shape.</dd>
        </dl>
      </div>
    ),
  });

  // ── Navigation & Viewport ──
  blocks.push({
    sectionId: 'navigation',
    searchText: 'navigation viewport pan zoom scroll wheel middle mouse space minimap grid snapping pinch gesture two finger',
    render: () => (
      <div className="hotkeys-panel__section" id="navigation">
        <h3 className="hotkeys-panel__section-title">Navigation &amp; Viewport</h3>
        <dl className="hotkeys-panel__dl">
          <dt>Pan</dt>
          <dd>Hold <Kbd>Space</Kbd> and drag with any tool, use the <Kbd>H</Kbd> Pan tool, drag with middle mouse button, or drag the minimap viewport.</dd>
          <dt>Zoom</dt>
          <dd>Scroll wheel zooms at cursor position. On touch devices, pinch to zoom.</dd>
          <dt>Grid</dt>
          <dd>Toggle grid visibility from the command palette or settings. When grid snapping is enabled, tools snap positions to grid intersections. Grid size is configurable in Settings.</dd>
          <dt>Minimap</dt>
          <dd>The minimap in the bottom-right corner shows the entire level. Click or drag to navigate. Toggle visibility and adjust opacity in Settings.</dd>
        </dl>
        <Tip>On mobile: two-finger pan and pinch-to-zoom work in the canvas area.</Tip>
      </div>
    ),
  });

  // ── File Management ──
  blocks.push({
    sectionId: 'file-management',
    searchText: 'file management new level open save download drag drop import lev elma online search browse lgr graphics',
    render: () => (
      <div className="hotkeys-panel__section" id="file-management">
        <h3 className="hotkeys-panel__section-title">File Management</h3>
        <dl className="hotkeys-panel__dl">
          <dt>New Level <Kbd>{mod}N</Kbd></dt>
          <dd>Create a new level with a default polygon, start object, and exit object.</dd>
          <dt>Open Level <Kbd>{mod}O</Kbd></dt>
          <dd>Open a .lev file from your device. You can also drag-and-drop .lev files onto the editor.</dd>
          <dt>Save Level <Kbd>{mod}S</Kbd></dt>
          <dd>Download the current level as a .lev binary file. Polygon winding order is corrected automatically.</dd>
          <dt>Level Screen</dt>
          <dd>Click the Level button in the toolbar to access the level screen. From here you can edit level properties (name, ground/sky textures) and search for levels on elma.online.</dd>
          <dt>LGR Selection</dt>
          <dd>Load LGR graphics files to display textures, sprites, and object graphics in the editor. Available in Settings.</dd>
        </dl>
      </div>
    ),
  });

  // ── Editing ──
  blocks.push({
    sectionId: 'editing',
    searchText: 'editing undo redo copy cut paste select all delete clipboard library save load template reuse',
    render: () => (
      <div className="hotkeys-panel__section" id="editing">
        <h3 className="hotkeys-panel__section-title">Editing</h3>
        <dl className="hotkeys-panel__dl">
          <dt>Undo <Kbd>{mod}Z</Kbd> / Redo <Kbd>{mod}Y</Kbd></dt>
          <dd>Undo and redo level changes. Related edits (e.g., moving multiple items) are grouped into a single undo step.</dd>
          <dt>Copy <Kbd>{mod}C</Kbd> / Cut <Kbd>{mod}X</Kbd> / Paste <Kbd>{mod}V</Kbd></dt>
          <dd>Copy or cut selected polygons and objects to the clipboard, then paste them. Each paste offsets slightly from the previous.</dd>
          <dt>Select All <Kbd>{mod}A</Kbd></dt>
          <dd>Select all visible polygons and objects. Respects visibility toggles (hidden grass, objects, etc. are excluded).</dd>
          <dt>Delete <Kbd>Del</Kbd></dt>
          <dd>Remove selected polygons, objects, and pictures.</dd>
          <dt>Library</dt>
          <dd>Save selections as reusable templates. Open the Library panel from the toolbar to browse, search, and place saved templates. Stored in browser localStorage.</dd>
        </dl>
      </div>
    ),
  });

  // ── Testing ──
  blocks.push({
    sectionId: 'testing',
    searchText: 'testing playtest test mode f5 debug start normal physics engine webgl key bindings trajectory recording bike gas brake turn volt',
    render: () => (
      <div className="hotkeys-panel__section" id="testing">
        <h3 className="hotkeys-panel__section-title">Testing</h3>
        <p className="hotkeys-panel__paragraph">
          Test your level without leaving the editor using the built-in physics engine.
        </p>
        <dl className="hotkeys-panel__dl">
          <dt>Start Test <Kbd>F5</Kbd></dt>
          <dd>Launch the level in test mode. The physics engine runs in the canvas. Press F5 again or Escape to restart/exit. The key is configurable in Settings.</dd>
          <dt>Normal Mode</dt>
          <dd>Start from the level&apos;s Start object, just like in the game.</dd>
          <dt>Debug Mode</dt>
          <dd>Start from a custom debug start position with configurable direction, flip, angle, and speed. Place a debug start via the orange test button in the menu bar.</dd>
          <dt>Trajectory</dt>
          <dd>After testing, the bike trajectory is drawn on the canvas. Click a trajectory point in the Select tool to create a debug start at that position.</dd>
          <dt>Key Bindings</dt>
          <dd>Customize controls for gas, brake, turn, volt, and more in Settings.</dd>
        </dl>
      </div>
    ),
  });

  // ── Collaboration ──
  blocks.push({
    sectionId: 'collaboration',
    searchText: 'collaboration collab multiplayer real-time room share link cursor awareness users editing together',
    render: () => (
      <div className="hotkeys-panel__section" id="collaboration">
        <h3 className="hotkeys-panel__section-title">Collaboration</h3>
        <p className="hotkeys-panel__paragraph">
          Edit levels together in real time with other users.
        </p>
        <dl className="hotkeys-panel__dl">
          <dt>Create a Room</dt>
          <dd>Open the Collab panel (<Kbd>C</Kbd>) and create a new room. Share the room link or ID with collaborators.</dd>
          <dt>Join a Room</dt>
          <dd>Paste a room ID into the Collab panel, or open a shared link with a ?room= parameter to auto-join.</dd>
          <dt>Awareness</dt>
          <dd>See other users&apos; cursors, selections, active tools, and testing state in real time.</dd>
          <dt>Operations</dt>
          <dd>All level edits are broadcast to other users. Changes sync automatically with conflict resolution.</dd>
        </dl>
      </div>
    ),
  });

  // ── Keyboard Shortcuts ──
  blocks.push({
    sectionId: 'shortcuts',
    searchText: 'keyboard shortcuts hotkeys keybindings general tool-specific file edit selection tools polygon view testing command palette pan zoom undo redo copy cut paste delete select all',
    render: () => (
      <div className="hotkeys-panel__section" id="shortcuts">
        <h3 className="hotkeys-panel__section-title">Keyboard Shortcuts</h3>
        <ShortcutsSection />
      </div>
    ),
  });

  return blocks;
}

/* ────────────────────────────────────────────────────────────
   Component
   ──────────────────────────────────────────────────────────── */

export function HotkeysPanel() {
  const open = useEditorStore((s) => s.showHotkeysPanel);
  const close = useEditorStore((s) => s.setShowHotkeysPanel);

  const [activeSection, setActiveSection] = useState('getting-started');
  const [search, setSearch] = useState('');
  const contentRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const content = useMemo(() => buildContent(), []);

  const filteredIds = useMemo(() => {
    if (!search.trim()) return null; // null = show all
    const q = search.trim();
    const ids = new Set<string>();
    for (const block of content) {
      if (fuzzyMatch(q, block.searchText)) {
        ids.add(block.sectionId);
      }
    }
    return ids;
  }, [search, content]);

  const scrollTo = useCallback((id: string) => {
    setActiveSection(id);
    const el = contentRef.current?.querySelector(`#${id}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    e.nativeEvent.stopImmediatePropagation();
    if (e.key === 'Escape') {
      if (search) {
        setSearch('');
      } else {
        close(false);
      }
    } else if (e.key === 'F1') {
      close(false);
    }
  }, [search, close]);

  if (!open) return null;

  const isSearching = filteredIds !== null;
  const expandToolsInSearch = isSearching && filteredIds.has('tools');

  // Determine which nav sections are visible
  const navVisible = (id: string) => !isSearching || filteredIds.has(id);
  // For tool sub-items, visible if parent tools section matches
  const toolNavVisible = () => !isSearching || filteredIds.has('tools');

  const hasResults = !isSearching || filteredIds.size > 0;

  return (
    <>
      <div className="hotkeys-backdrop" onClick={() => close(false)} />
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div className="hotkeys-panel" onKeyDown={handleKeyDown} tabIndex={-1} ref={(el) => el?.focus()}>
        <div className="hotkeys-panel__header">
          <span className="hotkeys-panel__title">Help</span>
          <input
            ref={searchRef}
            className="hotkeys-panel__search"
            type="text"
            placeholder="Search documentation..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.nativeEvent.stopImmediatePropagation()}
          />
          <button className="hotkeys-panel__close" onClick={() => close(false)}>&times;</button>
        </div>
        <div className="hotkeys-panel__layout">
          <nav className="hotkeys-panel__sidebar">
            {NAV_SECTIONS.map((section) => (
              <div key={section.id} className="hotkeys-panel__nav-group">
                <button
                  className={`hotkeys-panel__nav-item${activeSection === section.id ? ' hotkeys-panel__nav-item--active' : ''}${!navVisible(section.id) ? ' hotkeys-panel__nav-item--hidden' : ''}`}
                  onClick={() => scrollTo(section.id)}
                >
                  {section.title}
                </button>
                {section.children?.map((child) => (
                  <button
                    key={child.id}
                    className={`hotkeys-panel__nav-item hotkeys-panel__nav-item--sub${activeSection === child.id ? ' hotkeys-panel__nav-item--active' : ''}${!toolNavVisible() ? ' hotkeys-panel__nav-item--hidden' : ''}`}
                    onClick={() => scrollTo(child.id)}
                  >
                    {child.title}
                  </button>
                ))}
              </div>
            ))}
          </nav>
          <div className="hotkeys-panel__content" ref={contentRef}>
            {hasResults ? (
              content.map((block) => {
                if (isSearching && !filteredIds.has(block.sectionId)) return null;
                return <div key={block.sectionId}>{block.render(expandToolsInSearch)}</div>;
              })
            ) : (
              <div className="hotkeys-panel__no-results">No results found for &ldquo;{search}&rdquo;</div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
