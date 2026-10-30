import { Fragment, type CSSProperties, type Ref } from 'react';
import { AccessIcon, AccessLine } from './AccessIcon';
import { AlertList } from './AlertList';
import type { ArrivalDirection, RouteInfo, ServiceAlert, UpcomingStop, VehicleDetail } from './api';
import { CloseButton } from './CloseButton';
import type { Station } from './MapView';
import { colorFor, displayName, formatEta, MODE_LABELS, sameStation, textColorFor, tidyStopName, transferLines } from './vehicles';

const MAX_STOPS = 12;

interface Props {
  detail: VehicleDetail;
  /** Every line by key, to show transfers with their colors. */
  routes: Map<string, RouteInfo>;
  following: boolean;
  /** The station picked on the map or in this list, highlighted here. */
  station: Station | null;
  /** Lines you can transfer to at that station, as route keys. */
  stationTransfers: string[];
  showTransfers: boolean;
  onShowTransfers: (show: boolean) => void;
  /** The line's vehicles on their way to the picked station, both ways; null while loading. */
  arrivals: ArrivalDirection[] | null;
  /** Delays and service changes on the vehicle's line; null while loading. */
  alerts: ServiceAlert[] | null;
  /** Tapping one of them opens it. */
  onArrival: (vehicleId: string) => void;
  /** Tapping a transfer line at the station shows that whole line. */
  onLine: (key: string) => void;
  onFollow: () => void;
  /** Show every station on the vehicle's line, not just the ones ahead. */
  onAllStations: () => void;
  /** Tapping a stop in the list brings it into view. */
  onStop: (stop: UpcomingStop) => void;
  onClose: () => void;
  ref?: Ref<HTMLElement>;
}

/** The lines you can change to. With `onPick`, each one is a button that opens that line. */
export function Transfers({ lines, onPick }: { lines: RouteInfo[]; onPick?: (key: string) => void }) {
  if (!lines.length) return null;
  return (
    <span
      className={`transfers${onPick ? ' transfers-pick' : ''}`}
      aria-label={onPick ? undefined : `Transfer to ${lines.map((r) => r.name).join(', ')}`}
    >
      {lines.map((r) => {
        const color = colorFor({ routeColor: r.color, mode: r.mode });
        const badge =
          r.mode === 'subway' ? (
            <span className="transfer" style={{ background: color, color: textColorFor(color) }}>
              {r.name}
            </span>
          ) : (
            <span className="transfer transfer-named">
              <span className="swatch" style={{ background: color }} />
              {r.name}
            </span>
          );
        return onPick ? (
          <button key={r.key} className="transfer-button" onClick={() => onPick(r.key)} aria-label={`Show the ${r.name} line`}>
            {badge}
          </button>
        ) : (
          <Fragment key={r.key}>{badge}</Fragment>
        );
      })}
    </span>
  );
}

export function Arrivals({
  directions,
  selectedId,
  noun,
  onPick,
}: {
  directions: ArrivalDirection[] | null;
  /** The open vehicle, marked in the list. */
  selectedId?: string;
  noun: string;
  onPick: (vehicleId: string) => void;
}) {
  const nouns = noun === 'bus' ? 'buses' : `${noun}s`;
  if (!directions) return <p className="muted small">Finding the {nouns} on the way…</p>;
  if (!directions.length) return <p className="muted small">No {nouns} on the way here right now.</p>;
  return (
    <div className="arrivals">
      {directions.map((d) => (
        <section key={d.arrivals[0].vehicle.id} aria-label={`To ${d.destinations.join(', ')}`}>
          <h3 className="arrivals-heading">
            {d.destinations.length ? `To ${d.destinations.map(tidyStopName).join(' / ')}` : 'On the way'}
          </h3>
          <ol className="arrival-list">
            {d.arrivals.map(({ vehicle: v, time, stopsAway }) => {
              const stop = v.stopName && tidyStopName(v.stopName);
              const where =
                v.status === 'STOPPED_AT' && stop ? `At ${stop}` : stop ? `Heading to ${stop}` : 'On the way';
              const away = stopsAway === 0 ? 'Next stop' : `${stopsAway} stop${stopsAway === 1 ? '' : 's'} away`;
              const current = v.id === selectedId;
              return (
                <li key={v.id}>
                  <button
                    className={`arrival${current ? ' arrival-current' : ''}`}
                    aria-current={current ? 'true' : undefined}
                    onClick={() => onPick(v.id)}
                  >
                    <span className={`source-dot source-${v.source}`} aria-hidden="true" />
                    <span className="arrival-text">
                      <span className="arrival-where">{where}</span>
                      <span className="muted small">{current ? `This ${noun} · ${away}` : away}</span>
                    </span>
                    <span className="eta">{formatEta(time)}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}

export function VehiclePanel({
  detail,
  routes,
  following,
  station,
  stationTransfers,
  showTransfers,
  onShowTransfers,
  arrivals,
  alerts,
  onArrival,
  onLine,
  onFollow,
  onAllStations,
  onStop,
  onClose,
  ref,
}: Props) {
  const { vehicle, upcoming, routeLongName } = detail;
  const color = colorFor(vehicle);
  const name = displayName(vehicle.routeName ?? vehicle.routeId ?? '?');
  const stopName = vehicle.stopName && tidyStopName(vehicle.stopName);
  const next = upcoming[0]?.name ? tidyStopName(upcoming[0].name) : stopName;
  const where =
    vehicle.status === 'STOPPED_AT' && stopName
      ? `At ${stopName}`
      : next
        ? `Next stop: ${next}`
        : undefined;

  return (
    <aside ref={ref} className="panel" aria-label="Vehicle details" style={{ '--route': color } as CSSProperties}>
      <div className="sheet-handle" aria-hidden="true" />
      <header className="panel-header">
        <span className="badge" style={{ background: color, color: textColorFor(color) }}>
          {name}
        </span>
        <div className="panel-title">
          <strong>{routeLongName || `${MODE_LABELS[vehicle.mode]} ${name}`}</strong>
          <span className="muted">{vehicle.agency}</span>
        </div>
        <CloseButton onClick={onClose} />
      </header>

      {where && <p className="where">{where}</p>}
      <div className="panel-meta">
        <p className="muted small source">
          <span className={`source-dot source-${vehicle.source}`} aria-hidden="true" />
          {vehicle.source === 'gps' ? 'Live GPS position' : 'Estimated from arrival times'}
        </p>
        <div className="panel-actions">
          <button className="chip follow" onClick={onAllStations}>
            All stations
          </button>
          <button className={`chip follow${following ? ' chip-active' : ''}`} aria-pressed={following} onClick={onFollow}>
            {following ? 'Following' : 'Follow'}
          </button>
        </div>
      </div>

      <AlertList alerts={alerts} routes={routes} />

      {station && (
        <section className="station-card" aria-label="Picked station">
          <div className="station-card-top">
            <div className="station-card-text">
              <strong>{station.name ? tidyStopName(station.name) : 'Station'}</strong>
              <AccessLine stop={station} />
              {stationTransfers.length > 0 ? (
                <Transfers lines={transferLines(stationTransfers, routes)} onPick={onLine} />
              ) : (
                <span className="muted small">No transfers here</span>
              )}
            </div>
            {stationTransfers.length > 0 && (
              <button
                className="chip follow"
                aria-pressed={showTransfers}
                onClick={() => onShowTransfers(!showTransfers)}
              >
                {showTransfers ? 'Hide transfer lines' : 'Show transfer lines'}
              </button>
            )}
          </div>
          <Arrivals
            directions={arrivals}
            selectedId={vehicle.id}
            noun={vehicle.mode === 'bus' ? 'bus' : 'train'}
            onPick={onArrival}
          />
        </section>
      )}

      {upcoming.length > 0 ? (
        <ol className="stops">
          {upcoming.slice(0, MAX_STOPS).map((s) => {
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
                    <span className="stop-title">
                      <span className="stop-name">{s.name ? tidyStopName(s.name) : s.stopId}</span>
                      <AccessIcon stop={s} />
                    </span>
                    <Transfers lines={transferLines(s.transfers, routes)} />
                  </span>
                  <span className="eta">{formatEta(s.time)}</span>
                </button>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="muted small">No upcoming stops reported for this vehicle.</p>
      )}
    </aside>
  );
}
