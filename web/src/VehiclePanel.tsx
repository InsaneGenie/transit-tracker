import type { CSSProperties, Ref } from 'react';
import type { RouteInfo, UpcomingStop, VehicleDetail } from './api';
import { CloseButton } from './CloseButton';
import { colorFor, displayName, formatEta, MODE_LABELS, textColorFor, tidyStopName, transferLines } from './vehicles';

const MAX_STOPS = 12;

interface Props {
  detail: VehicleDetail;
  /** Every line by key, to show transfers with their colors. */
  routes: Map<string, RouteInfo>;
  following: boolean;
  onFollow: () => void;
  /** Tapping a stop in the list brings it into view. */
  onStop: (stop: UpcomingStop) => void;
  onClose: () => void;
  ref?: Ref<HTMLElement>;
}

function Transfers({ lines }: { lines: RouteInfo[] }) {
  if (!lines.length) return null;
  return (
    <span className="transfers" aria-label={`Transfer to ${lines.map((r) => r.name).join(', ')}`}>
      {lines.map((r) => {
        const color = colorFor({ routeColor: r.color, mode: r.mode });
        return r.mode === 'subway' ? (
          <span key={r.key} className="transfer" style={{ background: color, color: textColorFor(color) }}>
            {r.name}
          </span>
        ) : (
          <span key={r.key} className="transfer transfer-named">
            <span className="swatch" style={{ background: color }} />
            {r.name}
          </span>
        );
      })}
    </span>
  );
}

export function VehiclePanel({ detail, routes, following, onFollow, onStop, onClose, ref }: Props) {
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
        <button className={`chip follow${following ? ' chip-active' : ''}`} aria-pressed={following} onClick={onFollow}>
          {following ? 'Following' : 'Follow'}
        </button>
      </div>

      {upcoming.length > 0 ? (
        <ol className="stops">
          {upcoming.slice(0, MAX_STOPS).map((s) => (
            <li key={s.stopId}>
              <button className="stop" disabled={s.lat === undefined || s.lon === undefined} onClick={() => onStop(s)}>
                <span className="stop-dot" />
                <span className="stop-text">
                  <span className="stop-name">{s.name ? tidyStopName(s.name) : s.stopId}</span>
                  <Transfers lines={transferLines(s.transfers, routes)} />
                </span>
                <span className="eta">{formatEta(s.time)}</span>
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted small">No upcoming stops reported for this vehicle.</p>
      )}
    </aside>
  );
}
