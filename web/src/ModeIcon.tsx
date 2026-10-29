import type { Mode } from './api';
import { GLYPH_SCALE, MODE_GLYPHS, MODE_SHAPES, shapePath } from './vehicleIcons';

/** The same icon vehicles have on the map, so the mode buttons show what to look for. */
export function ModeIcon({ mode, size = 16 }: { mode: Mode; size?: number }) {
  const shape = MODE_SHAPES[mode];
  const g = size * GLYPH_SCALE[shape];
  const at = (size - g) / 2;
  return (
    <svg className="mode-icon" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <path className="mode-icon-shape" d={shapePath(shape, size, 0.75)} strokeWidth={1.5} strokeLinejoin="round" />
      <path
        className="mode-icon-glyph"
        d={MODE_GLYPHS[mode]}
        fillRule="evenodd"
        transform={`translate(${at} ${at}) scale(${g / 24})`}
      />
    </svg>
  );
}
