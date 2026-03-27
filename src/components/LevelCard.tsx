import { useEffect, useRef, useState } from 'react';
import { Level } from 'elmajs';
import { fetchLevelData, type LevelSearchResult } from '@/api/levelApi';
import { levelToSvg } from '@/utils/levelToSvg';

// Module-level cache for SVG previews
const svgCache = new Map<number, string>();

function formatTime(ms: number | null): string {
  if (ms == null) return '--';
  const min = Math.floor(ms / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  const hun = Math.floor((ms % 1000) / 10);
  return `${min}:${String(sec).padStart(2, '0')}.${String(hun).padStart(2, '0')}`;
}

export function LevelCard({
  result,
  onSelect,
  loading,
}: {
  result: LevelSearchResult;
  onSelect: () => void;
  loading: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string | null>(() => svgCache.get(result.LevelIndex) ?? null);
  const [error, setError] = useState(false);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (svg || fetchedRef.current) return;

    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !fetchedRef.current) {
          fetchedRef.current = true;
          observer.disconnect();
          fetchLevelData(result.LevelIndex)
            .then((buf) => {
              const level = Level.from(buf);
              const svgStr = levelToSvg(level);
              svgCache.set(result.LevelIndex, svgStr);
              setSvg(svgStr);
            })
            .catch(() => setError(true));
        }
      },
      { threshold: 0 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [result.LevelIndex, svg]);

  return (
    <div
      ref={ref}
      className={`level-card${loading ? ' level-card--loading' : ''}`}
      onClick={onSelect}
    >
      <div className="level-card__preview">
        {svg ? (
          <div dangerouslySetInnerHTML={{ __html: svg }} />
        ) : error ? (
          <div className="level-card__placeholder">!</div>
        ) : (
          <div className="level-card__placeholder" />
        )}
      </div>
      <div className="level-card__info">
        <div className="level-card__name" title={result.LongName}>{result.LevelName}</div>
        <div className="level-card__meta">
          <span>{result.KuskiData?.Kuski ?? '--'}</span>
          <span>{formatTime(result.Besttime)}</span>
        </div>
        <div className="level-card__meta">
          <span>{result.Apples} apples</span>
          <span>{result.Killers} killers</span>
        </div>
      </div>
    </div>
  );
}
