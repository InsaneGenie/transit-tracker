/**
 * One-time tips, shown where a feature lives the first time someone gets there, so the app
 * explains itself without a long guide. Shared by the website and the app.
 */
export type TipId = 'vehicle' | 'station' | 'line' | 'myLines';

export const TIPS_SEEN_KEY = 'transit-tracker:tips-seen';

/** The tip's words. `noun` is what runs on the line, such as "trains" or "buses". */
export function tipText(id: TipId, opts: { noun?: string; touch?: boolean } = {}): string {
  switch (id) {
    case 'vehicle':
      return 'Follow keeps it on screen. In Your transfers, green has time to change and orange is tight.';
    case 'station':
      return 'Tap Alert me and pick your walk time. You’ll get a heads-up when it’s time to leave.';
    case 'line':
      return `The ${opts.noun ?? 'trains'} move down the strip of stations as they go. Tap one to find it on the map.`;
    case 'myLines':
      return opts.touch
        ? 'Tap a badge to open the line or hide its route. Press and hold one to drag it into your order.'
        : 'Click a badge to open the line or hide its route. Drag one to put your lines in order.';
  }
}

/** Reads the saved list of dismissed tips, ignoring anything that isn't one. */
export function parseSeen(raw: string | null): Set<TipId> {
  try {
    const list: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(list) ? list.filter((x): x is TipId => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

export function serializeSeen(seen: Set<TipId>): string {
  return JSON.stringify([...seen]);
}
