import { iconSvg } from './vehicleIcons';
import type { Mode } from './api';

/**
 * Small pictures for the guide's pages, drawn as SVG so they match the map's own icons. The site
 * shows them inline (the tap rings pulse there); the app shows PNGs rendered from these by
 * mobile/scripts/guide-art.mjs, so run that again after changing a picture.
 */
export const ART_W = 300;
export const ART_H = 160;

type Theme = { bg: string; street: string; card: string; ink: string; muted: string; line: string; accent: string; green: string };
const LIGHT: Theme = { bg: '#e8edf3', street: '#ffffff', card: '#ffffff', ink: '#0f172a', muted: '#64748b', line: '#e2e8f0', accent: '#2563eb', green: '#16a34a' };
const DARK: Theme = { bg: '#1b2230', street: '#2a3445', card: '#232a37', ink: '#f1f5f9', muted: '#94a3b8', line: '#334155', accent: '#60a5fa', green: '#4ade80' };

const FONT = `font-family="-apple-system, system-ui, 'Segoe UI', Roboto, sans-serif"`;

const text = (x: number, y: number, s: string, size: number, fill: string, weight = 400, anchor = 'start') =>
  `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}" ${FONT}>${s}</text>`;

/** One of the map's own vehicle icons, centered on x, y. */
const vehicle = (mode: Mode, x: number, y: number, size: number, color: string, ink = '#fff') =>
  `<g transform="translate(${x - size / 2} ${y - size / 2})">${iconSvg(mode, size, color, ink, '#fff')}</g>`;

/** Rings where a finger taps; they pulse on the site. */
const tap = (x: number, y: number, t: Theme) =>
  `<g class="guide-tap" style="transform-origin:${x}px ${y}px">` +
  `<circle cx="${x}" cy="${y}" r="15" fill="${t.accent}" fill-opacity="0.18"/>` +
  `<circle cx="${x}" cy="${y}" r="22" fill="none" stroke="${t.accent}" stroke-opacity="0.45" stroke-width="2"/></g>`;

const streets = (t: Theme) =>
  `<rect width="${ART_W}" height="${ART_H}" rx="14" fill="${t.bg}"/>` +
  `<path d="M-10 52L310 30M-10 118L310 96M70 -10L96 170M196 -10L222 170" stroke="${t.street}" stroke-width="9" fill="none"/>`;

const card = (x: number, y: number, w: number, h: number, t: Theme) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${t.card}" stroke="${t.line}"/>`;

const badge = (x: number, y: number, label: string, color: string, ink = '#fff', r = 9) =>
  `<circle cx="${x}" cy="${y}" r="${r}" fill="${color}"/>` + text(x, y + r * 0.42, label, r * 1.15, ink, 700, 'middle');

const pill = (x: number, y: number, w: number, label: string, color: string, solid = false) =>
  `<rect x="${x}" y="${y}" width="${w}" height="20" rx="10" fill="${color}" fill-opacity="${solid ? 1 : 0.15}"/>` +
  text(x + w / 2, y + 14, label, 10.5, solid ? '#fff' : color, 600, 'middle');

const ART: ((t: Theme) => string)[] = [
  // Zoom in: the four kinds of vehicle, as they look on the map.
  (t) =>
    streets(t) +
    ([
      ['subway', 52, '#EE352E', 'Subway'],
      ['bus', 118, '#0062CF', 'Bus'],
      ['rail', 184, '#00985F', 'Rail'],
      ['ferry', 250, '#0E7490', 'Ferry'],
    ] as const)
      .map(
        ([mode, x, color, label]) =>
          vehicle(mode, x, 70, 38, color) +
          `<rect x="${x - 27}" y="98" width="54" height="20" rx="10" fill="${t.card}"/>` +
          text(x, 112, label, 11.5, t.ink, 600, 'middle'),
      )
      .join(''),

  // Tap a train: its card, with next stops and a transfer that connects.
  (t) =>
    streets(t) +
    vehicle('subway', 58, 92, 30, '#FCCC0A', '#000') +
    tap(58, 92, t) +
    `<path d="M80 84L118 64" stroke="${t.muted}" stroke-width="1.5" stroke-dasharray="3 3"/>` +
    card(118, 14, 168, 132, t) +
    badge(136, 34, 'N', '#FCCC0A', '#000') +
    text(152, 38, 'To Astoria', 12.5, t.ink, 700) +
    [
      ['57 St', '2 min'],
      ['5 Av/59 St', '4 min'],
      ['Lexington Av', '6 min'],
    ]
      .map(
        ([name, eta], i) =>
          `<circle cx="134" cy="${60 + i * 20}" r="3.5" fill="#FCCC0A"/>` +
          text(144, 64 + i * 20, name, 11, t.ink) +
          text(274, 64 + i * 20, eta, 11, t.muted, 600, 'end'),
      )
      .join('') +
    pill(128, 116, 148, '✓ Q at 57 St · 3 min wait', t.green),

  // Tap a station: arrivals both ways, and Alert me to be told when to leave.
  (t) =>
    streets(t) +
    `<circle cx="56" cy="82" r="9" fill="#fff" stroke="#0f172a" stroke-width="3"/>` +
    tap(56, 82, t) +
    `<rect x="22" y="104" width="68" height="18" rx="9" fill="${t.card}"/>` +
    text(56, 117, 'Union Sq', 10.5, t.ink, 600, 'middle') +
    card(114, 14, 172, 132, t) +
    text(128, 36, 'Uptown', 11, t.muted, 700) +
    pill(198, 23, 78, '🔔 Alert me', t.accent, true) +
    tap(237, 33, t) +
    badge(136, 56, '4', '#00933C') +
    text(152, 60, '2 min · 9 min', 11.5, t.ink) +
    `<path d="M124 76H276" stroke="${t.line}"/>` +
    text(128, 96, 'Downtown', 11, t.muted, 700) +
    badge(136, 116, '6', '#00933C') +
    text(152, 120, '4 min · 11 min', 11.5, t.ink),

  // Star your lines: the map then shows only those.
  (t) =>
    streets(t) +
    card(14, 14, 272, 132, t) +
    (
      [
        ['A', '#0039A6', '#fff', '8 Av Express', false],
        ['L', '#A7A9AC', '#fff', '14 St–Canarsie', true],
        ['7', '#B933AD', '#fff', 'Flushing Local', false],
      ] as const
    )
      .map(
        ([name, color, ink, long, on], i) =>
          badge(40, 40 + i * 38, name, color, ink, 11) +
          text(60, 44 + i * 38, long, 12.5, t.ink, 600) +
          text(258, 47 + i * 38, on ? '★' : '☆', 20, on ? '#eab308' : t.muted, 400, 'middle') +
          (i < 2 ? `<path d="M28 ${59 + i * 38}H272" stroke="${t.line}"/>` : ''),
      )
      .join('') +
    tap(258, 78, t),

  // Open a line: its trains move down a strip of its stations.
  (t) =>
    `<rect width="${ART_W}" height="${ART_H}" rx="14" fill="${t.card}" stroke="${t.line}"/>` +
    badge(32, 30, 'L', '#A7A9AC', '#fff', 13) +
    text(54, 28, '14 St–Canarsie', 13, t.ink, 700) +
    text(54, 43, '12 trains running', 11, t.muted) +
    pill(200, 20, 86, 'On time today', t.green) +
    `<path d="M40 66V146" stroke="#A7A9AC" stroke-width="5" stroke-linecap="round"/>` +
    ['8 Av', '6 Av', 'Union Sq', '3 Av']
      .map((name, i) => `<circle cx="40" cy="${68 + i * 26}" r="5" fill="#fff" stroke="#A7A9AC" stroke-width="2.5"/>` + text(70, 72 + i * 26, name, 11.5, t.ink))
      .join('') +
    vehicle('subway', 40, 107, 22, '#A7A9AC') +
    tap(40, 107, t) +
    text(140, 111, '← tap a train to find it', 11, t.muted),
];

export const GUIDE_ART_COUNT = ART.length;

/** The picture for guide page `i`, as an SVG document. */
export function guideArt(i: number, dark: boolean): string {
  const t = dark ? DARK : LIGHT;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ART_W} ${ART_H}" width="${ART_W}" height="${ART_H}">${ART[i](t)}</svg>`;
}
