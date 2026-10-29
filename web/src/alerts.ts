import type { AlertSeverity, ServiceAlert } from './api';

/** Shared by the site and the app, so both describe alerts the same way. */

export const SEVERITY_COLORS: Record<AlertSeverity, string> = {
  suspended: '#dc2626',
  delays: '#ea580c',
  changes: '#ca8a04',
  info: '#64748b',
};

export const SEVERITY_LABELS: Record<AlertSeverity, string> = {
  suspended: 'Suspended',
  delays: 'Delays',
  changes: 'Service change',
  info: 'Notice',
};

/** The MTA's kind, shorter: "Planned - Stops Skipped" reads "Stops skipped (planned)". */
export function alertTitle(a: Pick<ServiceAlert, 'type'>): string {
  const planned = /^planned\s*-\s*/i.test(a.type);
  const kind = a.type.replace(/^planned\s*-\s*/i, '');
  const sentence = kind.charAt(0).toUpperCase() + kind.slice(1).toLowerCase();
  return planned ? `${sentence} (planned)` : sentence;
}

function clock(t: number): string {
  return new Date(t * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function day(t: number, now: number): string {
  const d = new Date(t * 1000);
  const today = new Date(now * 1000);
  if (d.toDateString() === today.toDateString()) return 'today';
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  if (d.toDateString() === tomorrow.toDateString()) return 'tomorrow';
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

/** When it applies: "Now", "Now, until 8:00 PM", or "Starts tomorrow 9:45 PM". */
export function alertWhen(a: Pick<ServiceAlert, 'active' | 'start' | 'end'>, now = Date.now() / 1000): string {
  if (!a.active) return `Starts ${day(a.start, now)} ${clock(a.start)}`;
  // An end months away is just "until further notice".
  if (a.end === undefined || a.end - now > 7 * 24 * 3600) return 'Now';
  return a.end - now < 20 * 3600 ? `Now, until ${clock(a.end)}` : `Now, until ${day(a.end, now)} ${clock(a.end)}`;
}

/** Pieces of an alert's text: plain words, a line like `[A]`, or one of the MTA's icons. */
export type AlertPart = { text: string } | { line: string } | { icon: string };

const ICONS: Record<string, string> = {
  'accessibility icon': '♿',
  'shuttle bus icon': '🚌',
  'airplane icon': '✈︎',
};

/** Splits "[A] trains run local" so the `[A]` can be drawn as the line's badge. */
export function alertParts(text: string): AlertPart[] {
  const parts: AlertPart[] = [];
  let last = 0;
  for (const m of text.matchAll(/\[([^\]\n]{1,24})\]/g)) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index) });
    const inner = m[1].trim();
    const icon = ICONS[inner.toLowerCase()];
    if (icon) parts.push({ icon });
    else if (/\bicon$/i.test(inner)) parts.push({ text: '' });
    else parts.push({ line: inner });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts.filter((p) => !('text' in p) || p.text);
}

/** The subway line key an `[X]` in an alert stands for. The Staten Island Railway is written `[SIR]`. */
export const alertLineKey = (name: string) => `mta-subway:${name === 'SIR' ? 'SI' : name}`;

/** The most serious of these, or undefined when there are none. */
export function worstSeverity(severities: (AlertSeverity | undefined)[]): AlertSeverity | undefined {
  const order: AlertSeverity[] = ['suspended', 'delays', 'changes', 'info'];
  return order.find((s) => severities.includes(s));
}
