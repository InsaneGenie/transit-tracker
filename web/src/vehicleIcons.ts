import type { Mode } from './api';

/**
 * Each kind of vehicle gets its own outline and picture, so a bus, a subway train and a commuter train
 * can be told apart even where they share a color: subway trains are circles (like the line bullets),
 * buses rounded squares and commuter trains diamonds. Shared by the site's map and the app, whose
 * pictures are rendered from these paths by mobile/scripts/vehicle-icons.mjs.
 */
export type IconShape = 'circle' | 'square' | 'diamond';

export const MODE_SHAPES: Record<Mode, IconShape> = { subway: 'circle', bus: 'square', rail: 'diamond' };

/** Pictures on a 24×24 grid, filled with the even-odd rule so windows and lights are cut out. */
export const MODE_GLYPHS: Record<Mode, string> = {
  // A bus from the front: windshield, headlights and wheels.
  bus:
    'M6 2.5h12a2.5 2.5 0 0 1 2.5 2.5v12.5a1 1 0 0 1-1 1h-1.5v2a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-2h-8v2a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-2H4.5a1 1 0 0 1-1-1V5A2.5 2.5 0 0 1 6 2.5z' +
    'M6 7h12v5H6z' +
    'M9 4h6v1.5H9z' +
    'M7.5 13.5a1.5 1.5 0 1 0 0.01 0z' +
    'M16.5 13.5a1.5 1.5 0 1 0 0.01 0z',
  // A subway train from the front, rounded on top, with two windows, standing on its rails.
  subway:
    'M12 1.5c4.5 0 7.5 1.2 7.5 4.5v10a2.5 2.5 0 0 1-2.5 2.5H7A2.5 2.5 0 0 1 4.5 16V6c0-3.3 3-4.5 7.5-4.5z' +
    'M6.5 6.5h4.5v4.5H6.5z' +
    'M13 6.5h4.5v4.5H13z' +
    'M8 13.5a1.25 1.25 0 1 0 0.01 0z' +
    'M16 13.5a1.25 1.25 0 1 0 0.01 0z' +
    'M7.5 19h2.4l-2 3.5H5.5z' +
    'M14.1 19h2.4l2 3.5h-2.4z',
  // A commuter train from the side: a long car with a row of windows and a sloped cab.
  rail:
    'M2.5 6h14.5l4.5 5.5v5a1.5 1.5 0 0 1-1.5 1.5H2.5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z' +
    'M3.5 8h3.5v3.5H3.5z' +
    'M8.5 8h3.5v3.5H8.5z' +
    'M13.5 8h3l2.9 3.5h-5.9z' +
    'M6 18.2a1.6 1.6 0 1 0 0.01 0z' +
    'M17 18.2a1.6 1.6 0 1 0 0.01 0z' +
    'M1 21.5h22v1H1z',
};

/** How much of the icon's width the picture takes, so it sits inside the outline with some room. */
export const GLYPH_SCALE: Record<IconShape, number> = { circle: 0.6, square: 0.62, diamond: 0.56 };

/** The outline as an SVG path in a `size`-wide box, inset by `inset` for its border. */
export function shapePath(shape: IconShape, size: number, inset = 0): string {
  const c = size / 2;
  const r = c - inset;
  if (shape === 'circle') return `M${c - r} ${c}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0z`;
  if (shape === 'square') {
    const s = r * 0.92;
    const k = s * 0.42;
    return (
      `M${c - s + k} ${c - s}h${2 * (s - k)}a${k} ${k} 0 0 1 ${k} ${k}v${2 * (s - k)}a${k} ${k} 0 0 1 ${-k} ${k}` +
      `h${-2 * (s - k)}a${k} ${k} 0 0 1 ${-k} ${-k}v${-2 * (s - k)}a${k} ${k} 0 0 1 ${k} ${-k}z`
    );
  }
  // A diamond with softened corners.
  const d = r * 0.12;
  return (
    `M${c - d} ${c - r + d}Q${c} ${c - r} ${c + d} ${c - r + d}L${c + r - d} ${c - d}Q${c + r} ${c} ${c + r - d} ${c + d}` +
    `L${c + d} ${c + r - d}Q${c} ${c + r} ${c - d} ${c + r - d}L${c - r + d} ${c + d}Q${c - r} ${c} ${c - r + d} ${c - d}z`
  );
}

/** A whole icon as SVG markup: the outline filled with `color`, bordered by `outline`, and the picture in `ink`. */
export function iconSvg(mode: Mode, size: number, color: string, ink: string, outline?: string): string {
  const shape = MODE_SHAPES[mode];
  const border = outline ? Math.max(1, size / 14) : 0;
  const g = size * GLYPH_SCALE[shape];
  const at = (size - g) / 2;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<path d="${shapePath(shape, size, border / 2)}" fill="${color}"` +
    (outline ? ` stroke="${outline}" stroke-width="${border}"` : '') +
    ` stroke-linejoin="round"/>` +
    `<path d="${MODE_GLYPHS[mode]}" fill="${ink}" fill-rule="evenodd" transform="translate(${at} ${at}) scale(${g / 24})"/>` +
    `</svg>`
  );
}
