import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { AlertList } from './AlertList';
import { fetchLineVehicles, type LineVehicle, type RouteInfo, type RouteLine, type ServiceAlert, type UpcomingStop } from './api';
import { CloseButton } from './CloseButton';
import { LineBadge } from './LineBadge';
import { towards, vehicleCount } from './lines';
import { colorFor, displayName, MODE_LABELS, tidyStopName, transferLines } from './vehicles';
import { Transfers } from './VehiclePanel';

/** Each station's row on the strip, in px; vehicles are placed by it, so every row is the same height. */
const ROW = 56;
const POLL_MS = 10_000;

interface Props {
  lineKey: string;
  info?: RouteInfo;
  /** Its route and stations; null while loading. */
  line: RouteLine | null;
  routes: Map<string, RouteInfo>;
  alerts: ServiceAlert[] | null;
  count?: number;
  starred: boolean;
  onBack: () => void;
  onClose: () => void;
  onStar: () => void;
  onShowOnMap: () => void;
  onStation: (stop: UpcomingStop) => void;
  onVehicle: (v: LineVehicle) => void;
}

/** The line's vehicles along its stations, kept fresh. Null until they first load, or if they can't be. */
function useLineVehicles(key: string): LineVehicle[] | null {
  const [vehicles, setVehicles] = useState<LineVehicle[] | null>(null);
  useEffect(() => {
    setVehicles(null);
    const controller = new AbortController();
    const load = () =>
      fetchLineVehicles(key, controller.signal)
        .then((r) => setVehicles(r.vehicles))
        .catch(() => {});
    void load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [key]);
  return vehicles;
}

/** A line's own page: its alerts, and its trains or buses moving down a strip of its stations. */
export function LinePage({ lineKey, info, line, routes, alerts, count, starred, onBack, onClose, onStar, onShowOnMap, onStation, onVehicle }: Props) {
  const vehicles = useLineVehicles(lineKey);
  const [heading, setHeading] = useState<1 | -1>(1);
  const mode = info?.mode ?? line?.mode ?? 'subway';
  const badge = { mode, name: displayName(info?.name ?? lineKey.split(':')[1] ?? '?'), color: info?.color ?? line?.color };
  const color = colorFor({ routeColor: badge.color, mode });
  const noun = mode === 'bus' ? 'buses' : 'trains';
  const stops = line?.stops ?? [];
  const ordered = heading === 1 ? stops : [...stops].reverse();
  const going = useMemo(() => (vehicles ?? []).filter((v) => v.heading === heading), [vehicles, heading]);
  const out = count ?? vehicles?.length;

  return (
    <div className="lines-panel-inner" style={{ '--route': color, '--row': `${ROW}px` } as CSSProperties}>
      <header className="lines-panel-header">
        <button className="link line-back" onClick={onBack}>
          ‹ Lines
        </button>
        <CloseButton onClick={onClose} />
      </header>

      <div className="line-hero">
        <LineBadge route={badge} size={52} />
        <div>
          <h2>{info?.longName || (mode === 'rail' ? badge.name : `${MODE_LABELS[mode]} ${badge.name}`)}</h2>
          <p className="muted">
            {out === undefined ? info?.agency : out ? `${vehicleCount(out, mode)} running` : `No ${noun} running now`}
          </p>
        </div>
      </div>

      <div className="line-actions">
        <button className="button button-primary" onClick={onShowOnMap}>
          Show on map
        </button>
        <button className={`button${starred ? ' button-starred' : ''}`} aria-pressed={starred} onClick={onStar}>
          {starred ? '★ My line' : '☆ Add to my lines'}
        </button>
      </div>

      <AlertList alerts={alerts} routes={routes} empty="No delays or service changes on this line right now." />

      {!line ? (
        <p className="muted">Loading the line…</p>
      ) : stops.length === 0 ? (
        <p className="muted">The schedule doesn't list this line's stops, but its route and {noun} are on the map.</p>
      ) : (
        <>
          <div className="segment" role="tablist" aria-label="Direction">
            {([1, -1] as const).map((h) => (
              <button key={h} role="tab" aria-selected={h === heading} onClick={() => setHeading(h)}>
                To {towards(vehicles ?? [], h, stops) ?? (h === 1 ? 'the end' : 'the start')}
              </button>
            ))}
          </div>
          {vehicles === null && <p className="muted small">Finding the {noun} on this line…</p>}

          <div className="strip" style={{ height: ordered.length * ROW }}>
            <span className="strip-track" style={{ height: Math.max(ordered.length - 1, 0) * ROW }} />
            <ol>
              {ordered.map((s, i) => (
                <li key={`${s.stopId}-${i}`}>
                  <button className="strip-station" disabled={s.lat === undefined || s.lon === undefined} onClick={() => onStation(s)}>
                    <span className="strip-dot" />
                    <span className="strip-text">
                      <span className="strip-name">{s.name ? tidyStopName(s.name) : s.stopId}</span>
                      <Transfers lines={transferLines(s.transfers, routes)} />
                    </span>
                  </button>
                </li>
              ))}
            </ol>
            {going.map((v) => {
              const place = heading === 1 ? v.at : stops.length - 1 - v.at;
              return (
                <button
                  key={v.vehicle.id}
                  className="strip-vehicle"
                  style={{ top: place * ROW + ROW / 2 }}
                  onClick={() => onVehicle(v)}
                  title={v.destination ? `To ${tidyStopName(v.destination)}` : undefined}
                  aria-label={`${badge.name} ${mode === 'bus' ? 'bus' : 'train'}${v.destination ? ` to ${tidyStopName(v.destination)}` : ''}`}
                >
                  <LineBadge route={badge} size={24} />
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
