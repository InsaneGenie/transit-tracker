import { useMemo, useState } from 'react';
import type { Mode, RouteInfo } from './api';
import { CloseButton } from './CloseButton';
import { colorFor, legendGroups, MODE_LABELS, textColorFor } from './vehicles';

interface Props {
  routes: RouteInfo[];
  modes: Mode[];
  /** Line keys shown; empty means every line. */
  chosen: string[];
  onChange: (chosen: string[]) => void;
  /** Whether the chosen lines' routes are drawn on the map. */
  drawRoutes: boolean;
  onDrawRoutesChange: (draw: boolean) => void;
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
export function Legend({ routes, modes, chosen, onChange, drawRoutes, onDrawRoutesChange, onClose }: Props) {
  const [busSearch, setBusSearch] = useState('');
  const chosenSet = useMemo(() => new Set(chosen), [chosen]);
  const isOn = (r: RouteInfo) => chosenSet.size === 0 || chosenSet.has(r.key);
  const toggle = (r: RouteInfo) =>
    onChange(chosenSet.has(r.key) ? chosen.filter((k) => k !== r.key) : [...chosen, r.key]);

  // Every bus route, by borough; typing narrows the lists down.
  const busGroups = useMemo(() => {
    const q = busSearch.trim().toLowerCase();
    const matches = (r: RouteInfo) => r.name.toLowerCase().startsWith(q) || r.longName?.toLowerCase().includes(q);
    return legendGroups(routes, 'bus')
      .map((g) => ({ ...g, routes: q ? g.routes.filter(matches) : g.routes }))
      .filter((g) => g.routes.length);
  }, [routes, busSearch]);

  return (
    <aside className="legend" aria-label="Lines">
      <div className="sheet-handle" aria-hidden="true" />
      <header className="legend-header">
        <strong>Lines</strong>
        {chosen.length > 0 && (
          <button className="link" onClick={() => onChange([])}>
            Show all
          </button>
        )}
        <CloseButton onClick={onClose} />
      </header>
      <p className="muted small legend-hint">
        {chosen.length ? `Showing ${chosen.length} chosen line${chosen.length > 1 ? 's' : ''}.` : 'Tap lines to show only those.'}
      </p>
      {chosen.length > 0 && (
        <label className="draw-toggle">
          <input type="checkbox" checked={drawRoutes} onChange={(e) => onDrawRoutesChange(e.target.checked)} />
          Draw their routes on the map
        </label>
      )}

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
              placeholder="Filter bus routes, e.g. M15"
              value={busSearch}
              onChange={(e) => setBusSearch(e.target.value)}
            />
            {busGroups.length === 0 && routes.some((r) => r.mode === 'bus') && (
              <p className="muted small">No bus route matches.</p>
            )}
            {busGroups.map((g) => (
              <div className="bus-group" key={g.title}>
                <h4>{g.title}</h4>
                <div className="line-row">
                  {g.routes.map((r) => (
                    <LineButton key={r.key} route={r} on={isOn(r)} onToggle={() => toggle(r)} />
                  ))}
                </div>
              </div>
            ))}
          </section>
        )}
      </div>
    </aside>
  );
}
