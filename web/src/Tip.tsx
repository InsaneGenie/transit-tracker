import { useSyncExternalStore } from 'react';
import { parseSeen, serializeSeen, TIPS_SEEN_KEY, tipText, type TipId } from './tips';

let seen: Set<TipId> | null = null;
const listeners = new Set<() => void>();

function load(): Set<TipId> {
  if (!seen) {
    try {
      seen = parseSeen(localStorage.getItem(TIPS_SEEN_KEY));
    } catch {
      seen = new Set();
    }
  }
  return seen;
}

function dismiss(id: TipId) {
  seen = new Set(load()).add(id);
  try {
    localStorage.setItem(TIPS_SEEN_KEY, serializeSeen(seen));
  } catch {
    // Private browsing: the tip stays away for this visit only.
  }
  listeners.forEach((l) => l());
}

/** Brings every tip back, from the guide's "Show tips again". */
export function resetTips() {
  seen = new Set();
  try {
    localStorage.removeItem(TIPS_SEEN_KEY);
  } catch {
    // Nothing saved to clear.
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

const touch = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;

/** Whether tip `id` is still up, so the button it's about can pulse. */
export function useTipOpen(id: TipId): boolean {
  return !useSyncExternalStore(subscribe, () => load().has(id));
}

/** A one-time tip shown where a feature lives, until it's dismissed. */
export function Tip({ id, noun }: { id: TipId; noun?: string }) {
  if (!useTipOpen(id)) return null;
  return (
    <div className="tip" role="note">
      <span className="tip-icon" aria-hidden="true">💡</span>
      <p>{tipText(id, { noun, touch })}</p>
      <button className="link tip-ok" onClick={() => dismiss(id)}>
        Got it
      </button>
    </div>
  );
}
