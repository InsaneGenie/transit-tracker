import { useMemo, useState } from 'react';
import type { Mode, RouteInfo } from './api';
import { colorFor, legendGroups, MODE_LABELS, textColorFor } from './vehicles';

const MAX_BUSES = 60;

interface Props {
  routes: RouteInfo[];
  modes: Mode[];
  /** Line keys shown; empty means every line. */
  chosen: string[];
  onChange: (chosen: string[]) => void;
  onClose: () => void;
}

function LineButton({ route, on, onToggle }: { route: RouteInfo; on: boolean; onToggle: () => void }) {
  const color = colorFor({ routeColor: route.color, mode: route.mode });
  return (
    <button
      className={`line${on ? '' : ' line-off'}`}
      aria-pressed={on}
      title={route.longName ?? route.name}
      onClick={onToggle}
    >
      <span className="line-badge" style={{ background: color, color: textColorFor(color) }}>
        {route.mode === 'rail' ? '' : route.name}
      </span>
      {route.mode === 'rail' && <span className="line-name">{route.name}</span>}
    </button>
  );
}

/** What each dot color means, and a way to show only some lines. */
export function Legend({ routes, modes, chosen, onChange, onClose }: Props) {
  const [busSearch, setBusSearch] = useState('');
  const chosenSet = useMemo(() => new Set(chosen), [chosen]);
  const isOn = (r: RouteInfo) => chosenSet.size === 0 || chosenSet.has(r.key);
  const toggle = (r: RouteInfo) =>
    onChange(chosenSet.has(r.key) ? chosen.filter((k) => k !== r.key) : [...chosen, r.key]);

  const buses = useMemo(() => {
    const q = busSearch.trim().toLowerCase();
    const all = legendGroups(routes, 'bus')[0]?.routes ?? [];
    const matches = q
      ? all.filter((r) => r.name.toLowerCase().startsWith(q) || r.longName?.toLowerCase().includes(q))
      : all.filter((r) => chosenSet.has(r.key));
    return matches.slice(0, MAX_BUSES);
  }, [routes, busSearch, chosenSet]);

  return (
    <aside className="legend" aria-label="Lines">
      <header className="legend-header">
        <strong>Lines</strong>
        {chosen.length > 0 && (
          <button className="link" onClick={() => onChange([])}>
            Show all
          </button>
        )}
        <button className="close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </header>
      <p className="muted small">
        {chosen.length ? `Showing ${chosen.length} chosen line${chosen.length > 1 ? 's' : ''}.` : 'Tap lines to show only those.'}
      </p>

      <div className="legend-body">
        {routes.length === 0 && <p className="muted small">Line list loads once the server is running.</p>}

        {modes.includes('subway') && legendGroups(routes, 'subway').length > 0 && (
          <section>
            <h3>{MODE_LABELS.subway}</h3>
            <div className="line-rows">
              {legendGroups(routes, 'subway').map((g) => (
                <div className="line-row" key={g.color ?? g.routes[0].key}>
                  {g.routes.map((r) => (
                    <LineButton key={r.key} route={r} on={isOn(r)} onToggle={() => toggle(r)} />
                  ))}
                </div>
              ))}
            </div>
          </section>
        )}

        {modes.includes('rail') &&
          legendGroups(routes, 'rail').map((g) => (
            <section key={g.title}>
              <h3>{g.title}</h3>
              <div className="line-list">
                {g.routes.map((r) => (
                  <LineButton key={r.key} route={r} on={isOn(r)} onToggle={() => toggle(r)} />
                ))}
              </div>
            </section>
          ))}

        {modes.includes('bus') && (
          <section>
            <h3>{MODE_LABELS.bus}</h3>
            <p className="muted small legend-note">
              <span className="swatch" style={{ background: '#2563eb' }} /> Buses use their route's color.
            </p>
            <input
              className="search"
              type="search"
              placeholder="Find a bus route, e.g. M15"
              value={busSearch}
              onChange={(e) => setBusSearch(e.target.value)}
            />
            <div className="line-row">
              {buses.map((r) => (
                <LineButton key={r.key} route={r} on={isOn(r)} onToggle={() => toggle(r)} />
              ))}
            </div>
          </section>
        )}
      </div>
    </aside>
  );
}
