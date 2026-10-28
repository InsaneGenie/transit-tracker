import type { VehicleDetail } from './api';
import { colorFor, formatEta, MODE_LABELS, textColorFor, tidyStopName } from './vehicles';

const MAX_STOPS = 12;

export function VehiclePanel({ detail, onClose }: { detail: VehicleDetail; onClose: () => void }) {
  const { vehicle, upcoming, routeLongName } = detail;
  const color = colorFor(vehicle);
  const name = (vehicle.routeName ?? vehicle.routeId ?? '?').replace(/^MTA\s*\w*_/, '');
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
      <p className="muted small">
        {vehicle.source === 'gps' ? 'Live GPS position' : 'Position estimated from arrival times'}
      </p>

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
