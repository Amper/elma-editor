import { ReactNode } from 'react';
import './Tooltip.css';

interface TooltipProps {
  label: string;
  shortcut?: string;
  desc?: string;
  side?: 'right' | 'top';
  children: ReactNode;
}

export function Tooltip({ label, shortcut, desc, side = 'right', children }: TooltipProps) {
  return (
    <div className={`tooltip-wrap tooltip-wrap--${side}`}>
      {children}
      <div className="tooltip" role="tooltip">
        <div className="tooltip__header">
          <span className="tooltip__label">{label}</span>
          {shortcut && <kbd className="tooltip__kbd">{shortcut}</kbd>}
        </div>
        {desc && <div className="tooltip__desc">{desc}</div>}
      </div>
    </div>
  );
}
