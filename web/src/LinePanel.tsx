import type { CSSProperties, Ref } from 'react';
import type { ArrivalDirection, RouteInfo, RouteLine, UpcomingStop } from './api';
import { CloseButton } from './CloseButton';
import type { Station } from './MapView';
import { colorFor, displayName, MODE_LABELS, sameStation, textColorFor, tidyStopName, transferLines } from './vehicles';
import { Arrivals, Transfers } from './VehiclePanel';

interface Props {
  /** The line being shown, from the legend's list. */
  info?: RouteInfo;
  /** Its route and stations; null while loading. */
  line: RouteLine | null;
  routes: Map<string, RouteInfo>;
  station: Station | null;
  /** The line's vehicles on their way to the picked station. */
  arrivals: ArrivalDirection[] | null;
  /** Where Back goes, e.g. "A train"; no Back button without it. */
  backLabel?: string;
  onBack: () => void;
  onStop: (stop: UpcomingStop) => void;
  onArrival: (vehicleId: string) => void;
  /** Tapping a transfer at the picked station shows that line instead. */
  onLine: (key: string) => void;
  onClose: () => void;
  ref?: Ref<HTMLElement>;
}

/** A whole line, opened from a station's transfers: its stations here, its route and vehicles on the map. */
export function LinePanel({ info, line, routes, station, arrivals, backLabel, onBack, onStop, onArrival, onLine, onClose, ref }: Props) {
  const mode = info?.mode ?? line?.mode ?? 'subway';
  const color = colorFor({ routeColor: info?.color ?? line?.color, mode });
  const name = displayName(info?.name ?? line?.key.split(':')[1] ?? '?');
  const noun = mode === 'bus' ? 'bus' : 'train';
  const stationTransfers = transferLines(station?.transfers, routes).filter((r) => r.key !== line?.key);

  return (
    <aside ref={ref} className="panel" aria-label={`${name} line`} style={{ '--route': color } as CSSProperties}>
      <div className="sheet-handle" aria-hidden="true" />
      <header className="panel-header">
        <span className="badge" style={{ background: color, color: textColorFor(color) }}>
          {name}
        </span>
        <div className="panel-title">
          <strong>{info?.longName || `${MODE_LABELS[mode]} ${name}`}</strong>
          <span className="muted">{info?.agency}</span>
        </div>
        <CloseButton onClick={onClose} />
      </header>

      <div className="panel-meta">
        <p className="muted small">Every station and {noun} on this line</p>
        {backLabel && (
          <button className="chip follow" onClick={onBack}>
            Back to {backLabel}
          </button>
        )}
      </div>

      {station && (
        <section className="station-card" aria-label="Picked station">
          <div className="station-card-top">
            <div className="station-card-text">
              <strong>{station.name ? tidyStopName(station.name) : 'Station'}</strong>
              {stationTransfers.length > 0 ? (
                <Transfers lines={stationTransfers} onPick={onLine} />
              ) : (
                <span className="muted small">No transfers here</span>
              )}
            </div>
          </div>
          <Arrivals directions={arrivals} noun={noun} onPick={onArrival} />
        </section>
      )}

      {!line ? (
        <p className="muted small">Loading the line…</p>
      ) : line.stops.length > 0 ? (
        <ol className="stops">
          {line.stops.map((s) => {
            const chosen = station !== null && sameStation(s, station);
            return (
              <li key={s.stopId}>
                <button
                  className={`stop${chosen ? ' stop-chosen' : ''}`}
                  aria-current={chosen ? 'location' : undefined}
                  disabled={s.lat === undefined || s.lon === undefined}
                  onClick={() => onStop(s)}
                >
                  <span className="stop-dot" />
                  <span className="stop-text">
                    <span className="stop-name">{s.name ? tidyStopName(s.name) : s.stopId}</span>
                    <Transfers lines={transferLines(s.transfers, routes)} />
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="muted small">The schedule doesn't list this line's stops, but its route and {noun === 'bus' ? 'buses' : 'trains'} are on the map.</p>
      )}
    </aside>
  );
}
