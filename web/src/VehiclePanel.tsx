import type { VehicleDetail } from './api';
import { colorFor, displayName, formatEta, MODE_LABELS, textColorFor, tidyStopName } from './vehicles';

const MAX_STOPS = 12;

interface Props {
  detail: VehicleDetail;
  following: boolean;
  onFollow: () => void;
  onClose: () => void;
}

export function VehiclePanel({ detail, following, onFollow, onClose }: Props) {
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
    <aside className="panel" aria-label="Vehicle details">
      <header className="panel-header">
        <span className="badge" style={{ background: color, color: textColorFor(color) }}>
          {name}
        </span>
        <div className="panel-title">
          <strong>{routeLongName || `${MODE_LABELS[vehicle.mode]} ${name}`}</strong>
          <span className="muted">{vehicle.agency}</span>
        </div>
        <button className="close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </header>

      {where && <p className="where">{where}</p>}
      <div className="panel-meta">
        <p className="muted small">
          {vehicle.source === 'gps' ? 'Live GPS position' : 'Position estimated from arrival times'}
        </p>
        <button className={`chip follow${following ? ' chip-active' : ''}`} aria-pressed={following} onClick={onFollow}>
          {following ? 'Following' : 'Follow'}
        </button>
      </div>

      {upcoming.length > 0 ? (
        <ol className="stops">
          {upcoming.slice(0, MAX_STOPS).map((s) => (
            <li key={s.stopId}>
              <span className="stop-dot" style={{ borderColor: color }} />
              <span className="stop-name">{s.name ? tidyStopName(s.name) : s.stopId}</span>
              <span className="eta">{formatEta(s.time)}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted small">No upcoming stops reported for this vehicle.</p>
      )}
    </aside>
  );
}
