import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useEditorStore } from '@/state/editorStore';
import { COMMANDS, getShortcut, type Command, type CommandCategory } from '@/commands/commandRegistry';
import { fuzzyMatch, type FuzzyResult } from '@/commands/fuzzyMatch';
import { readLevelFile } from '@/io/fileIO';
import { fitLevel } from '@/canvas/viewport';
import './CommandPalette.css';

interface MatchedCommand {
  command: Command;
  result: FuzzyResult;
}

const CATEGORY_ORDER: CommandCategory[] = ['File', 'Edit', 'Selection', 'Tools', 'Polygon', 'View', 'Testing'];

function highlightLabel(label: string, matchIndices: number[]): React.ReactNode {
  if (matchIndices.length === 0) return label;
  const set = new Set(matchIndices);
  const parts: React.ReactNode[] = [];
  let i = 0;
  while (i < label.length) {
    if (set.has(i)) {
      let end = i;
      while (end < label.length && set.has(end)) end++;
      parts.push(<mark key={i}>{label.slice(i, end)}</mark>);
      i = end;
    } else {
      let end = i;
      while (end < label.length && !set.has(end)) end++;
      parts.push(label.slice(i, end));
      i = end;
    }
  }
  return parts;
}

export function CommandPalette() {
  const open = useEditorStore((s) => s.commandPaletteOpen);
  const close = useEditorStore((s) => s.setCommandPaletteOpen);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset state when opening
  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      // Focus after render
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Filter and sort commands
  const filtered = useMemo(() => {
    if (!query.trim()) {
      // Show all commands grouped by category order
      return COMMANDS.map((command) => ({
        command,
        result: { score: 0, matchIndices: [] as number[] },
      }));
    }
    const matches: MatchedCommand[] = [];
    for (const command of COMMANDS) {
      const result = fuzzyMatch(query, command.label) ?? fuzzyMatch(query, `${command.category} ${command.label}`);
      if (result) {
        // If matched on "category label", adjust indices to be label-only
        const labelResult = fuzzyMatch(query, command.label);
        matches.push({ command, result: labelResult ?? { score: result.score, matchIndices: [] } });
      }
    }
    matches.sort((a, b) => b.result.score - a.result.score);
    return matches;
  }, [query]);

  // Group by category for display
  const grouped = useMemo(() => {
    const groups = new Map<CommandCategory, MatchedCommand[]>();
    for (const m of filtered) {
      const cat = m.command.category;
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat)!.push(m);
    }
    // Maintain category order
    const result: Array<{ category: CommandCategory; items: MatchedCommand[] }> = [];
    for (const cat of CATEGORY_ORDER) {
      const items = groups.get(cat);
      if (items && items.length > 0) result.push({ category: cat, items });
    }
    return result;
  }, [filtered]);

  // Flat list for keyboard navigation
  const flatItems = useMemo(() => grouped.flatMap((g) => g.items), [grouped]);

  // Clamp selected index
  useEffect(() => {
    setSelectedIndex((prev) => Math.min(prev, Math.max(0, flatItems.length - 1)));
  }, [flatItems.length]);

  const executeCommand = useCallback((cmd: Command) => {
    if (!cmd.isEnabled()) return;
    close(false);
    if (cmd.id === 'file.open') {
      fileInputRef.current?.click();
      return;
    }
    cmd.execute();
  }, [close]);

  const handleFileOpen = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const { level, fileName } = await readLevelFile(file);
      const store = useEditorStore.getState();
      store.loadLevel(level, fileName);
      const vp = fitLevel(level.polygons, window.innerWidth, window.innerHeight);
      store.setViewport(vp);
    } catch {
      // ignore invalid files
    }
    e.target.value = '';
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Stop ALL keystrokes from reaching the global handler in EditorCanvas
    e.nativeEvent.stopImmediatePropagation();

    if (e.key === 'Escape') {
      close(false);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % Math.max(1, flatItems.length));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + flatItems.length) % Math.max(1, flatItems.length));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const item = flatItems[selectedIndex];
      if (item) executeCommand(item.command);
      return;
    }
  }, [flatItems, selectedIndex, executeCommand, close]);

  // Scroll selected item into view
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const el = list.querySelector('.command-palette__item--selected');
    if (el) (el as HTMLElement).scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (!open) return null;

  let flatIndex = 0;

  return (
    <>
      <div className="command-palette-backdrop" onClick={() => close(false)} />
      <div className="command-palette" onKeyDown={handleKeyDown}>
        <input
          ref={inputRef}
          className="command-palette__input"
          type="text"
          placeholder="Type a command..."
          value={query}
          onChange={(e) => { setQuery(e.target.value); setSelectedIndex(0); }}
        />
        <div className="command-palette__list" ref={listRef}>
          {flatItems.length === 0 && (
            <div className="command-palette__empty">No matching commands</div>
          )}
          {grouped.map(({ category, items }) => (
            <div key={category}>
              <div className="command-palette__category">{category}</div>
              {items.map((m) => {
                const idx = flatIndex++;
                const enabled = m.command.isEnabled();
                const cls = [
                  'command-palette__item',
                  idx === selectedIndex ? 'command-palette__item--selected' : '',
                  !enabled ? 'command-palette__item--disabled' : '',
                ].filter(Boolean).join(' ');
                return (
                  <div
                    key={m.command.id}
                    className={cls}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    onClick={() => executeCommand(m.command)}
                  >
                    <span className="command-palette__item-label">
                      {highlightLabel(m.command.label, m.result.matchIndices)}
                    </span>
                    {m.command.shortcut && (
                      <span className="command-palette__shortcut">{getShortcut(m.command)}</span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".lev,.LEV"
        style={{ display: 'none' }}
        onChange={handleFileOpen}
      />
    </>
  );
}
