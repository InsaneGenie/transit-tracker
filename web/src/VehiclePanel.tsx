import { Fragment, useState, type CSSProperties, type ReactNode, type Ref } from 'react';
import { AccessIcon, AccessLine } from './AccessIcon';
import { AlertList } from './AlertList';
import type { ArrivalDirection, RouteInfo, ServiceAlert, UpcomingStop, VehicleDetail } from './api';
import { BackButton } from './BackButton';
import { sameDirection, WALK_CHOICES, type LeaveControls } from './leaveAlert';
import { CloseButton } from './CloseButton';
import type { Station } from './MapView';
import { shareTitle, shareUrl } from './share';
import { ShareButton } from './ShareButton';
import { colorFor, displayName, formatEta, MODE_LABELS, routeKey, sameStation, sourceText, textColorFor, tidyStopName, transferLines, vehicleNoun } from './vehicles';

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
  /** "Should I run?" alerts for the picked station. */
  leave?: LeaveControls;
  /** Tapping a transfer line at the station shows that whole line. */
  onLine: (key: string) => void;
  onFollow: () => void;
  /** Show every station on the vehicle's line, not just the ones ahead. */
  onAllStations: () => void;
  /** Tapping a stop in the list brings it into view. */
  onStop: (stop: UpcomingStop) => void;
  /** Where Back goes, e.g. "the 5 line"; no Back button without it. */
  backLabel?: string;
  onBack: () => void;
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

function BellIcon() {
  return (
    <svg className="bell-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M8 1.75a4 4 0 0 0-4 4v2.6L2.75 10.6v.9h10.5v-.9L12 8.35v-2.6a4 4 0 0 0-4-4Z" />
      <path d="M6.4 12.75a1.65 1.65 0 0 0 3.2 0" />
    </svg>
  );
}

/** A direction's heading with its bell, and the walk times to pick from once the bell is tapped. */
function DirectionHeading({ heading, destinations, leave }: { heading: ReactNode; destinations: string[]; leave?: LeaveControls }) {
  const [asking, setAsking] = useState(false);
  const on = leave?.watching != null && sameDirection(destinations, leave.watching);
  return (
    <>
      <div className="arrivals-top">
        {heading}
        {leave && !on && !asking && (
          <button className="leave-bell" onClick={() => setAsking(true)} title="Tell me when to leave for one of these">
            <BellIcon />
            Alert me
          </button>
        )}
      </div>
      {leave && on && (
        <div className="leave-on" role="status">
          <span className="leave-on-text">
            <BellIcon />
            {leave.status ?? 'Alert on'}
          </span>
          <button className="leave-link" onClick={leave.onStop}>
            Stop alert
          </button>
        </div>
      )}
      {leave && !on && asking && (
        <div className="leave-ask" role="group" aria-label="Your walk to the station">
          <span className="leave-ask-label">How long is your walk here? You'll be told when to leave.</span>
          <div className="leave-choices">
            {WALK_CHOICES.map((m) => (
              <button
                key={m}
                className={`leave-choice${m === leave.walk ? ' leave-choice-last' : ''}`}
                onClick={() => {
                  setAsking(false);
                  leave.onStart(destinations, m);
                }}
              >
                {m} min
              </button>
            ))}
            <button className="leave-link" onClick={() => setAsking(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export function Arrivals({
  directions,
  selectedId,
  noun,
  leave,
  onPick,
}: {
  directions: ArrivalDirection[] | null;
  /** The open vehicle, marked in the list. */
  selectedId?: string;
  noun: string;
  /** Lets each direction set a "should I run?" alert. */
  leave?: LeaveControls;
  onPick: (vehicleId: string) => void;
}) {
  const nouns = noun === 'bus' ? 'buses' : noun === 'ferry' ? 'ferries' : `${noun}s`;
  if (!directions) return <p className="muted small">Finding the {nouns} on the way…</p>;
  if (!directions.length) return <p className="muted small">No {nouns} on the way here right now.</p>;
  return (
    <div className="arrivals">
      {directions.map((d) => (
        <section key={d.destinations.join('|') || d.arrivals[0].vehicle.id} aria-label={`To ${d.destinations.join(', ')}`}>
          <DirectionHeading
            destinations={d.destinations}
            leave={leave}
            heading={
              <h3 className="arrivals-heading">
                {d.destinations.length ? `To ${d.destinations.map(tidyStopName).join(' / ')}` : 'On the way'}
              </h3>
            }
          />
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
  leave,
  onLine,
  onFollow,
  onAllStations,
  onStop,
  backLabel,
  onBack,
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
  const last = upcoming[upcoming.length - 1]?.name;
  const title = shareTitle({ vehicle: { name, mode: vehicle.mode, to: last && tidyStopName(last) } });

  return (
    <aside ref={ref} className="panel" aria-label="Vehicle details" style={{ '--route': color } as CSSProperties}>
      <div className="sheet-handle" aria-hidden="true" />
      {backLabel && <BackButton label={backLabel} onClick={onBack} />}
      <header className="panel-header">
        <span className="badge" style={{ background: color, color: textColorFor(color) }}>
          {name}
        </span>
        <div className="panel-title">
          <strong>{routeLongName || `${MODE_LABELS[vehicle.mode]} ${name}`}</strong>
          <span className="muted">{vehicle.agency}</span>
        </div>
        <ShareButton url={shareUrl(location.origin, { vehicle: vehicle.id, line: vehicle.routeId ? routeKey(vehicle) : undefined })} title={title} />
        <CloseButton onClick={onClose} />
      </header>

      {where && <p className="where">{where}</p>}
      <div className="panel-meta">
        <p className="muted small source">
          <span className={`source-dot source-${vehicle.source}`} aria-hidden="true" />
          {sourceText(vehicle)}
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
            noun={vehicleNoun(vehicle.mode)}
            leave={leave}
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
