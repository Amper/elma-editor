import { useEditorStore } from '@/state/editorStore';
import { COMMANDS, getShortcut, type CommandCategory } from '@/commands/commandRegistry';
import './HotkeysPanel.css';

const CATEGORY_ORDER: CommandCategory[] = ['File', 'Edit', 'Selection', 'Tools', 'Polygon', 'View', 'Testing'];

const isMac = navigator.platform.includes('Mac');
const mod = isMac ? '\u2318' : 'Ctrl+';

interface ExtraShortcut {
  label: string;
  shortcut: string;
}

const EXTRA_SHORTCUTS: { category: string; items: ExtraShortcut[] }[] = [
  {
    category: 'General',
    items: [
      { label: 'Hotkeys', shortcut: 'F1' },
      { label: 'Command Palette', shortcut: `${mod}K` },
      { label: 'Temporary Pan', shortcut: 'Space (hold)' },
    ],
  },
];

export function HotkeysPanel() {
  const open = useEditorStore((s) => s.showHotkeysPanel);
  const close = useEditorStore((s) => s.setShowHotkeysPanel);

  if (!open) return null;

  // Group commands by category, only those with shortcuts
  const grouped = new Map<CommandCategory, { label: string; shortcut: string }[]>();
  for (const cmd of COMMANDS) {
    const shortcut = getShortcut(cmd);
    if (!shortcut) continue;
    if (!grouped.has(cmd.category)) grouped.set(cmd.category, []);
    grouped.get(cmd.category)!.push({ label: cmd.label, shortcut });
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.nativeEvent.stopImmediatePropagation();
    if (e.key === 'Escape' || e.key === 'F1') {
      close(false);
    }
  };

  return (
    <>
      <div className="hotkeys-backdrop" onClick={() => close(false)} />
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div className="hotkeys-panel" onKeyDown={handleKeyDown} tabIndex={-1} ref={(el) => el?.focus()}>
        <div className="hotkeys-panel__header">
          <span className="hotkeys-panel__title">Keyboard Shortcuts</span>
          <button className="hotkeys-panel__close" onClick={() => close(false)}>&times;</button>
        </div>
        <div className="hotkeys-panel__body">
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
          {CATEGORY_ORDER.map((cat) => {
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
        </div>
      </div>
    </>
  );
}
