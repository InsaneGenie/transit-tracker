import { useEffect, useRef, useState } from 'react';
import type { LatLng } from 'react-native-maps';

/** How often gliding markers are moved. Each move redraws the marker, so not every screen frame. */
const FRAME_MS = 66;

/** A move this big is a new trip or bad data: jump there rather than sweep across the map (as on the site). */
const SNAP_DEG = 0.05;

// One timer moves every gliding marker, so their moves land in the same render.
const gliding = new Set<() => boolean>();
let timer: ReturnType<typeof setInterval> | undefined;

function tick() {
  for (const step of gliding) if (!step()) gliding.delete(step);
  if (!gliding.size) {
    clearInterval(timer);
    timer = undefined;
  }
}

/**
 * Where to draw a vehicle: it glides from where it is drawn to each newer position over `ms`, so it moves
 * steadily instead of jumping when an update comes in. With `ms` 0 it jumps.
 */
export function useGlide(latitude: number, longitude: number, ms: number): LatLng {
  const [drawn, setDrawn] = useState<LatLng>({ latitude, longitude });
  const at = useRef(drawn);
  useEffect(() => {
    const from = at.current;
    const to = { latitude, longitude };
    const dLat = latitude - from.latitude;
    const dLon = longitude - from.longitude;
    if (!dLat && !dLon) return;
    if (ms <= 0 || Math.abs(dLat) + Math.abs(dLon) > SNAP_DEG) {
      at.current = to;
      setDrawn(to);
      return;
    }
    const start = Date.now();
    const step = () => {
      const k = Math.min(1, (Date.now() - start) / ms);
      at.current = { latitude: from.latitude + dLat * k, longitude: from.longitude + dLon * k };
      setDrawn(at.current);
      return k < 1;
    };
    gliding.add(step);
    timer ??= setInterval(tick, FRAME_MS);
    return () => {
      gliding.delete(step);
    };
  }, [latitude, longitude, ms]);
  return drawn;
}
