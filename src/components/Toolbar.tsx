import { useEditorStore } from '@/state/editorStore';
import { ToolId } from '@/types';
import {ReactNode} from "react";
import {
  ArrowsOutCardinalIcon,
  CirclesThreePlusIcon,
  FlowerIcon, ImageIcon, ImageSquareIcon, SquareHalfBottomIcon,
  PipeIcon,
  PolygonIcon,
  SelectionIcon,
  ShapesIcon,
  TextTIcon
} from "@phosphor-icons/react";

const TOOLS: Array<{ id: ToolId; label: string; shortcut: string; desc: string; icon?: ReactNode }> = [
  { id: ToolId.Select, label: 'Select', shortcut: 'S', desc: 'Click to select polygons and objects', icon: <SelectionIcon size={24} /> },
  { id: ToolId.DrawPolygon, label: 'Polygon', shortcut: 'D', desc: 'Draw polygons by placing vertices', icon: <PolygonIcon size={24} /> },
  { id: ToolId.Vertex, label: 'Vertex', shortcut: 'V', desc: 'Add, move and delete vertices', icon: <CirclesThreePlusIcon size={24} /> },
  { id: ToolId.DrawObject, label: 'Object', shortcut: 'O', desc: 'Place flowers, apples, killers and starts', icon: <FlowerIcon size={24} /> },
  { id: ToolId.Shape, label: 'Shape', shortcut: 'R', desc: 'Draw regular shapes (circle, hexagon...)', icon: <ShapesIcon size={24} /> },
  { id: ToolId.DrawPicture, label: 'Picture', shortcut: 'Q', desc: 'Place LGR picture sprites', icon: <ImageSquareIcon size={24} /> },
  { id: ToolId.DrawMask, label: 'Mask', shortcut: 'M', desc: 'Place textured mask pictures', icon: <SquareHalfBottomIcon size={24} /> },
  { id: ToolId.Pipe, label: 'Pipe', shortcut: 'P', desc: 'Draw pipes along a spine path', icon: <PipeIcon size={24} /> },
  { id: ToolId.Pan, label: 'Move', shortcut: 'H', desc: 'Pan the canvas view', icon: <ArrowsOutCardinalIcon size={24} /> },
  { id: ToolId.ImageImport, label: 'Image', shortcut: 'I', desc: 'Import image contours as polygons', icon: <ImageIcon size={24} /> },
  { id: ToolId.Text, label: 'Text', shortcut: 'X', desc: 'Convert text to polygons', icon: <TextTIcon size={24} /> },
];

export function Toolbar() {
  const level = useEditorStore((s) => s.level);
  const activeTool = useEditorStore((s) => s.activeTool);
  const setActiveTool = useEditorStore((s) => s.setActiveTool);

  return (
    <>
      {TOOLS.map((t) => (
        <button
          key={t.id}
          onClick={() => setActiveTool(t.id)}
          disabled={!level}
          title={`${t.label} (${t.shortcut}) \u2014 ${t.desc}`}
          className={`btn btn--icon${activeTool === t.id ? ' btn--active' : ''}`}
        >
          {t.icon}
          <span className="btn--icon-label">{t.label}</span>
        </button>
      ))}
    </>
  );
}
