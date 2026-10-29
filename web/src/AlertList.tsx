import { useState, type CSSProperties } from 'react';
import { alertLineKey, alertParts, alertTitle, alertWhen, SEVERITY_COLORS } from './alerts';
import type { RouteInfo, ServiceAlert } from './api';
import { colorFor, textColorFor } from './vehicles';

/** Collapsed, only this many show, so the stops stay in reach. */
const SHOWN = 2;

/** Alert text with each `[A]` drawn as the line's badge. */
function AlertText({ text, routes }: { text: string; routes: Map<string, RouteInfo> }) {
  return (
    <>
      {alertParts(text).map((p, i) => {
        if ('text' in p) return p.text;
        if ('icon' in p) return <span key={i} aria-hidden="true">{p.icon}</span>;
        const route = routes.get(alertLineKey(p.line));
        const color = route ? colorFor({ routeColor: route.color, mode: route.mode }) : '#64748b';
        return (
          <span key={i} className="transfer alert-line" style={{ background: color, color: textColorFor(color) }}>
            {p.line}
          </span>
        );
      })}
    </>
  );
}

function AlertItem({ alert, routes }: { alert: ServiceAlert; routes: Map<string, RouteInfo> }) {
  const [open, setOpen] = useState(false);
  const paragraphs = alert.description?.split(/\n{2,}/).filter((p) => p.trim()) ?? [];
  return (
    <li className={`alert${open ? ' alert-open' : ''}`} style={{ '--severity': SEVERITY_COLORS[alert.severity] } as CSSProperties}>
      <button className="alert-head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="alert-kind">
          <span className="alert-dot" aria-hidden="true" />
          <strong>{alertTitle(alert)}</strong>
          <span className="muted">· {alertWhen(alert)}</span>
          <span className="alert-chevron" aria-hidden="true" />
        </span>
        <span className="alert-text">
          <AlertText text={alert.header} routes={routes} />
        </span>
      </button>
      {open && (alert.when || paragraphs.length > 0) && (
        <div className="alert-body">
          {alert.when && <p className="alert-period">{alert.when}</p>}
          {paragraphs.map((p, i) => (
            <p key={i}>
              {p.split('\n').map((line, j) => (
                <span key={j}>
                  {j > 0 && <br />}
                  <AlertText text={line} routes={routes} />
                </span>
              ))}
            </p>
          ))}
        </div>
      )}
    </li>
  );
}

/** Delays, suspensions and planned changes on a line, from the MTA. Tap one for the details. */
export function AlertList({ alerts, routes, empty }: { alerts: ServiceAlert[] | null; routes: Map<string, RouteInfo>; empty?: string }) {
  const [all, setAll] = useState(false);
  if (!alerts?.length) return empty && alerts ? <p className="muted small alerts-empty">{empty}</p> : null;
  const shown = all ? alerts : alerts.slice(0, SHOWN);
  return (
    <section className="alerts" aria-label="Service alerts">
      <ul className="alert-list">
        {shown.map((a) => (
          <AlertItem key={a.id} alert={a} routes={routes} />
        ))}
      </ul>
      {alerts.length > SHOWN && (
        <button className="link alerts-more" onClick={() => setAll((x) => !x)}>
          {all ? 'Show fewer' : `${alerts.length - SHOWN} more alert${alerts.length - SHOWN > 1 ? 's' : ''}`}
        </button>
      )}
    </section>
  );
}
