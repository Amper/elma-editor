import { useMemo } from 'react';
import { ObjectType } from 'elmajs';
import { useEditorStore } from '@/state/editorStore';

export function StatusBar() {
  const activeTool = useEditorStore((s) => s.activeTool);
  const level = useEditorStore((s) => s.level);
  const cursorWorld = useEditorStore((s) => s.cursorWorld);
  const isDirty = useEditorStore((s) => s.isDirty);
  const fileName = useEditorStore((s) => s.fileName);
  const topologyErrors = useEditorStore((s) => s.topologyErrors);
  const showValidationPanel = useEditorStore((s) => s.showValidationPanel);
  const setShowValidationPanel = useEditorStore((s) => s.setShowValidationPanel);

  const polyCount = level?.polygons.length ?? 0;
  const objCount = level?.objects.length ?? 0;

  const { apples, killers, flowers, starts } = useMemo(() => {
    if (!level) return { apples: 0, killers: 0, flowers: 0, starts: 0 };
    let apples = 0, killers = 0, flowers = 0, starts = 0;
    for (const obj of level.objects) {
      switch (obj.type) {
        case ObjectType.Apple: apples++; break;
        case ObjectType.Killer: killers++; break;
        case ObjectType.Exit: flowers++; break;
        case ObjectType.Start: starts++; break;
      }
    }
    return { apples, killers, flowers, starts };
  }, [level]);


  const coords = cursorWorld
    ? `(${cursorWorld.x.toFixed(2)}, ${cursorWorld.y.toFixed(2)})`
    : '';

  const hasErrors = topologyErrors.length > 0;

  return (
    <>
      <span>{fileName ?? 'No file'}{isDirty ? ' *' : ''}</span>
      <span className="pill">{activeTool}</span>
      <span>Polys: {polyCount} · Objs: {objCount} · Apples: {apples} · Killers: {killers} · Flowers: {flowers} · Starts: {starts}</span>
      {hasErrors && (
        <span style={{ position: 'relative' }}>
          <button
            className="pill pill--error pill--clickable"
            onClick={() => setShowValidationPanel(!showValidationPanel)}
          >
            {topologyErrors.length} error{topologyErrors.length !== 1 ? 's' : ''}
          </button>
          {showValidationPanel && (
            <div className="validation-panel">
              <div className="validation-panel__header">
                <span>Level Errors</span>
                <button
                  className="validation-panel__close"
                  onClick={() => setShowValidationPanel(false)}
                >
                  &times;
                </button>
              </div>
              <ul className="validation-panel__list">
                {topologyErrors.map((err, i) => (
                  <li
                    key={i}
                    className={`validation-panel__item${err.position ? ' validation-panel__item--clickable' : ''}`}
                    onClick={() => {
                      if (err.position) {
                        useEditorStore.getState().setViewport({
                          centerX: err.position.x,
                          centerY: err.position.y,
                          zoom: 200,
                        });
                      }
                    }}
                  >
                    {err.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </span>
      )}
      <span className="status-bar__coords" style={{ marginLeft: 'auto' }}>{coords}</span>
    </>
  );
}
