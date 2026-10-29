import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

/** How far a mouse moves before a press becomes a drag, and how long a finger holds still first. */
const DRAG_PX = 6;
const HOLD_MS = 300;

/**
 * Drag items into a new order, with a mouse or a finger. A mouse drags as soon as it moves; a finger
 * holds still for a moment first, so swiping still scrolls. Items mark themselves with `data-drag-key`
 * and take `onPointerDown`; the order changes live as the dragged item passes over the others. Controls inside an item marked `data-no-drag` keep their own presses.
 */
export function useDragOrder(keys: string[], onReorder: (keys: string[]) => void) {
  const [dragging, setDragging] = useState<string | null>(null);
  const latest = useRef({ keys, onReorder });
  latest.current = { keys, onReorder };
  // Set when a drag ends, so the click that follows it doesn't also open the item.
  const dropped = useRef(false);
  const stop = useRef<() => void>(() => {});
  useEffect(() => () => stop.current(), []);

  const onPointerDown = (e: ReactPointerEvent, key: string) => {
    if (e.button !== 0 || (e.target as Element).closest('[data-no-drag]')) return;
    stop.current();
    const start = { x: e.clientX, y: e.clientY };
    const touch = e.pointerType !== 'mouse';
    let started = false;

    const begin = () => {
      started = true;
      setDragging(key);
      navigator.vibrate?.(10);
    };
    const timer = touch ? setTimeout(begin, HOLD_MS) : undefined;

    const move = (ev: PointerEvent) => {
      if (!started) {
        if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < DRAG_PX) return;
        // A finger that moves before the hold is scrolling, not dragging.
        if (touch) return end();
        begin();
      }
      const over = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>('[data-drag-key]')?.dataset.dragKey;
      const { keys: order, onReorder: reorder } = latest.current;
      const from = order.indexOf(key);
      const to = over ? order.indexOf(over) : -1;
      if (from < 0 || to < 0 || from === to) return;
      const next = order.filter((k) => k !== key);
      next.splice(to, 0, key);
      reorder(next);
    };
    // Once dragging, a finger moves the item instead of scrolling the page.
    const holdScroll = (ev: TouchEvent) => {
      if (started) ev.preventDefault();
    };
    const up = () => {
      if (started) {
        dropped.current = true;
        setTimeout(() => (dropped.current = false), 0);
      }
      end();
    };
    const end = () => {
      clearTimeout(timer);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', end);
      window.removeEventListener('touchmove', holdScroll);
      stop.current = () => {};
      setDragging(null);
    };
    stop.current = end;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', end);
    window.addEventListener('touchmove', holdScroll, { passive: false });
  };

  return {
    dragging,
    /** True right after a drag, so the item's click can be ignored. */
    justDropped: () => dropped.current,
    onPointerDown,
  };
}
