import { useState, type CSSProperties } from 'react';
import type { LineService, LineVehicle } from './api';
import { ghostSummary, headwayFor, missingTripText, spacingSummary, stripMarks } from './ghosts';

/** Shown at first; the rest wait behind "Show all". */
const SHOWN = 3;

/**
 * A bus line's service against its schedule: ghost buses (scheduled trips with no bus) and, for the way the
 * page shows, how bunched up its buses are.
 */
export function ServiceCheck({ service, going, heading }: { service: LineService; going: LineVehicle[]; heading: 1 | -1 }) {
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const ghosts = ghostSummary(service);
  const spacing = spacingSummary(going, headwayFor(service, heading));
  const missing = service.missing;
  const now = Date.now() / 1000;
  return (
    <section className={`service-check${open ? ' service-open' : ''}`} aria-label="Ghost buses and bunching">
      <button className="service-row" aria-expanded={missing.length ? open : undefined} disabled={!missing.length} onClick={() => setOpen((o) => !o)}>
        <span className="service-dot" style={{ '--dot': ghosts.color ?? 'var(--muted)' } as CSSProperties} aria-hidden="true" />
        <span className="service-text">
          <strong>{ghosts.text}</strong>
          {missing.length > 0 && <span className="muted small">Ghost buses: on the schedule, but no bus is running them</span>}
        </span>
        {missing.length > 0 && <span className="alert-chevron" aria-hidden="true" />}
      </button>
      {open && missing.length > 0 && (
        <ul className="service-missing">
          {(all ? missing : missing.slice(0, SHOWN)).map((trip) => {
            const { title, when } = missingTripText(trip, now);
            return (
              <li key={trip.tripId}>
                <span>{title}</span>
                <span className="muted small">{when}</span>
              </li>
            );
          })}
          {!all && missing.length > SHOWN && (
            <li>
              <button className="link" onClick={() => setAll(true)}>
                Show all {missing.length}
              </button>
            </li>
          )}
        </ul>
      )}
      {spacing && (
        <div className="service-row">
          <span className="service-dot" style={{ '--dot': spacing.color ?? 'var(--muted)' } as CSSProperties} aria-hidden="true" />
          <span className="service-text">
            <strong>{spacing.text}</strong>
            <span className="muted small">This way, from where the buses are now</span>
          </span>
        </div>
      )}
    </section>
  );
}

/** Bunched buses and long gaps marked along the line's strip, beside its track. */
export function StripMarks({ going, place, row }: { going: LineVehicle[]; place: (v: LineVehicle) => number; row: number }) {
  return (
    <>
      {stripMarks(going, place).map((m) => (
        <span
          key={m.key}
          className={`strip-mark strip-mark-${m.kind}`}
          style={{ top: m.from * row + row / 2, height: Math.max((m.to - m.from) * row, 0) }}
        >
          <span className="strip-mark-label">{m.label}</span>
        </span>
      ))}
    </>
  );
}
