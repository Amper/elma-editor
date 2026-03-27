import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { type LgrInfo, lgrPreviewUrl } from '@/api/lgrApi';
import './LgrSelector.css';

interface Props {
  items: LgrInfo[];
  value: string;
  loading: boolean;
  onChange: (name: string) => void;
}

export function LgrSelector({ items, value, loading, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [hovered, setHovered] = useState<LgrInfo | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Focus search when opened
  useEffect(() => {
    if (open) {
      setFilter('');
      setHovered(null);
      // Defer focus so the input is rendered
      requestAnimationFrame(() => searchRef.current?.focus());
    }
  }, [open]);

  const filtered = useMemo(() => {
    if (!filter) return items;
    const q = filter.toLowerCase();
    return items.filter((l) => l.LGRName.toLowerCase().includes(q));
  }, [items, filter]);

  const selectedInfo = useMemo(
    () => items.find((l) => l.LGRName === value) ?? null,
    [items, value],
  );

  const previewItem = hovered ?? selectedInfo;

  const handleSelect = useCallback(
    (name: string) => {
      onChange(name);
      setOpen(false);
    },
    [onChange],
  );

  return (
    <div className="lgr-selector" ref={rootRef}>
      <span className="lgr-selector__label">LGR</span>
      <button
        className="lgr-selector__trigger"
        onClick={() => setOpen(!open)}
        disabled={loading}
      >
        {selectedInfo && (
          <img
            className="lgr-selector__trigger-thumb"
            src={lgrPreviewUrl(selectedInfo)}
            alt=""
            loading="lazy"
          />
        )}
        <span className="lgr-selector__trigger-name">
          {loading ? 'Loading...' : value}
        </span>
        <span className="lgr-selector__trigger-arrow">&#9662;</span>
      </button>

      {open && (
        <div className="lgr-selector__dropdown">
          <div className="lgr-selector__search">
            <input
              ref={searchRef}
              className="lgr-selector__search-input"
              type="text"
              placeholder="Search LGR..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>

          <div className="lgr-selector__list">
            {(!filter || 'default'.includes(filter.toLowerCase())) && (
              <button
                className={`lgr-selector__item${value === 'Default' ? ' lgr-selector__item--active' : ''}`}
                onClick={() => handleSelect('Default')}
                onMouseEnter={() => setHovered(null)}
              >
                <span className="lgr-selector__item-name">Default</span>
              </button>
            )}
            {filtered.map((lgr) => (
              <button
                key={lgr.LGRIndex}
                className={`lgr-selector__item${value === lgr.LGRName ? ' lgr-selector__item--active' : ''}`}
                onClick={() => handleSelect(lgr.LGRName)}
                onMouseEnter={() => setHovered(lgr)}
                onMouseLeave={() => setHovered(null)}
              >
                <img
                  className="lgr-selector__item-thumb"
                  src={lgrPreviewUrl(lgr)}
                  alt=""
                  loading="lazy"
                />
                <span className="lgr-selector__item-name">{lgr.LGRName}</span>
              </button>
            ))}
            {filtered.length === 0 && filter && (
              <div className="lgr-selector__empty">No matches</div>
            )}
          </div>

          {previewItem && (
            <div className="lgr-selector__preview">
              <img
                className="lgr-selector__preview-img"
                src={lgrPreviewUrl(previewItem)}
                alt={previewItem.LGRName}
              />
              <div className="lgr-selector__preview-name">{previewItem.LGRName}</div>
              {previewItem.LGRDesc && (
                <div className="lgr-selector__preview-desc">{previewItem.LGRDesc}</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
