import type { UpcomingStop } from './api';
import { ACCESS_BLUE, accessLabel, WHEELCHAIR_GLYPH } from './accessibility';

/** The wheelchair symbol, shown beside an accessible station's name. Nothing for other stations. */
export function AccessIcon({ stop, size = 14 }: { stop: Pick<UpcomingStop, 'access' | 'accessNote'>; size?: number }) {
  const label = accessLabel(stop);
  if (!label) return null;
  const g = size * 0.76;
  const at = (size - g) / 2;
  return (
    <svg className="access-icon" width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label}>
      <title>{label}</title>
      <rect width={size} height={size} rx={size * 0.22} fill={ACCESS_BLUE} />
      <path d={WHEELCHAIR_GLYPH} fill="#fff" transform={`translate(${at} ${at}) scale(${g / 24})`} />
    </svg>
  );
}

/** The symbol with what it means, for a picked station's card. */
export function AccessLine({ stop }: { stop: Pick<UpcomingStop, 'access' | 'accessNote'> }) {
  const label = accessLabel(stop);
  if (!label) return null;
  return (
    <span className="access-line small">
      <AccessIcon stop={stop} />
      {label}
    </span>
  );
}
