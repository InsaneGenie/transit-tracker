import { useMemo, useState } from 'react';
import type { AlertSeverity, Mode, RouteInfo } from './api';
import { CloseButton } from './CloseButton';
import { LineBadge } from './LineBadge';
import { boroughLabel, lineStatus, vehicleCount } from './lines';
import { useDragOrder } from './useDragOrder';
import { legendGroups, MODE_LABELS } from './vehicles';

const BROWSE_MODES: Mode[] = ['subway', 'rail', 'bus'];
const BOROUGH_KEY = 'transit-tracker:borough';

/** The borough whose buses were last shown, when the browser allows remembering it. */
function savedBorough(): string {
  try {
    return localStorage.getItem(BOROUGH_KEY) ?? 'Manhattan';
  } catch {
    return 'Manhattan';
  }
}

interface Props {
  routes: RouteInfo[];
  /** The lines starred as theirs; the map shows only these when there are any. */
  chosen: string[];
  /** Your lines whose routes are not drawn on the map. */
  hiddenRoutes: string[];
  /** The most serious alert on now, by line key. */
  alertSummary: Record<string, AlertSeverity>;
  /** How many vehicles are out on each line; null until loaded. */
  counts: Record<string, number> | null;
  onChange: (chosen: string[]) => void;
  /** Sets which of your lines' routes are not drawn. */
  onHiddenRoutesChange: (hidden: string[]) => void;
  onOpen: (key: string) => void;
  onClose: () => void;
}

/** The Lines panel: your lines with how they're running, and every other line to browse and star. */
export function LinesScreen({ routes, chosen, hiddenRoutes, alertSummary, counts, onChange, onHiddenRoutesChange, onOpen, onClose }: Props) {
  const [mode, setMode] = useState<Mode>('subway');
  const [search, setSearch] = useState('');
  // The bus list is long, so it shows one borough at a time.
  const [saved, setBorough] = useState(savedBorough);
  const pickBorough = (b: string) => {
    setBorough(b);
    try {
      localStorage.setItem(BOROUGH_KEY, b);
    } catch {
      // Not remembered; the pick still applies.
    }
  };
  const boroughs = useMemo(() => legendGroups(routes, 'bus').map((g) => g.title), [routes]);
  const borough = boroughs.includes(saved) ? saved : (boroughs[0] ?? saved);
  const q = search.trim().toLowerCase();
  const chosenSet = useMemo(() => new Set(chosen), [chosen]);
  const byKey = useMemo(() => new Map(routes.map((r) => [r.key, r])), [routes]);
  const toggle = (key: string) => onChange(chosenSet.has(key) ? chosen.filter((k) => k !== key) : [...chosen, key]);
  const toggleRoute = (key: string) =>
    onHiddenRoutesChange(hiddenRoutes.includes(key) ? hiddenRoutes.filter((k) => k !== key) : [...hiddenRoutes, key]);

  // While searching, every matching line of every kind; otherwise the picked kind, in its groups.
  const groups = useMemo(() => {
    if (q) {
      const matches = (r: RouteInfo) => r.name.toLowerCase().startsWith(q) || r.longName?.toLowerCase().includes(q);
      return BROWSE_MODES.map((m) => ({ title: MODE_LABELS[m], routes: legendGroups(routes, m).flatMap((g) => g.routes.filter(matches)) })).filter(
        (g) => g.routes.length,
      );
    }
    const of = legendGroups(routes, mode);
    // The subway is one list; rail lines go by railroad; buses show the picked borough's.
    if (mode === 'subway') return [{ title: '', routes: of.flatMap((g) => g.routes) }];
    if (mode === 'bus') return of.filter((g) => g.title === borough).map((g) => ({ ...g, title: '' }));
    return of;
  }, [q, routes, mode, borough]);

  const mine = chosen.flatMap((k) => byKey.get(k) ?? []);
  const anyDrawn = chosen.some((k) => !hiddenRoutes.includes(k));
  const toggleAllRoutes = () =>
    onHiddenRoutesChange(anyDrawn ? [...new Set([...hiddenRoutes, ...chosen])] : hiddenRoutes.filter((k) => !chosenSet.has(k)));
  // Dragging your lines reorders them; the map and the app keep this order.
  const drag = useDragOrder(
    mine.map((r) => r.key),
    (order) => onChange([...order, ...chosen.filter((k) => !byKey.has(k))]),
  );

  // The line whose details are open under the badges.
  const [picked, setPicked] = useState<string | null>(null);
  const pickedLine = picked && chosenSet.has(picked) ? byKey.get(picked) : undefined;

  // Your lines as a row of badges, like a station sign. A faded badge has its route switched off.
  // Tap one for its details, or drag it to a new place.
  const chip = (r: RouteInfo) => {
    const count = counts?.[r.key];
    const s = lineStatus(alertSummary[r.key], counts ? (count ?? 0) : undefined);
    const hidden = hiddenRoutes.includes(r.key);
    return (
      <li
        key={r.key}
        data-drag-key={r.key}
        className={`line-chip${hidden ? ' line-chip-hidden' : ''}${drag.dragging === r.key ? ' dragging' : ''}`}
        onPointerDown={(e) => drag.onPointerDown(e, r.key)}
        onContextMenu={(e) => drag.dragging && e.preventDefault()}
      >
        <button
          className="line-chip-button"
          aria-expanded={pickedLine?.key === r.key}
          aria-label={`${r.name}: ${s.text}${hidden ? ', route hidden' : ''}`}
          title={`${r.longName ?? r.name}: ${s.text}${count ? `, ${vehicleCount(count, r.mode)} running` : ''}${hidden ? '. Route hidden on the map' : ''}`}
          onClick={() => !drag.justDropped() && setPicked(pickedLine?.key === r.key ? null : r.key)}
        >
          <LineBadge route={r} size={34} />
          {s.color && <span className="line-chip-dot" style={{ background: s.color }} />}
        </button>
      </li>
    );
  };

  // The picked line's name, how it's running, and what you can do with it.
  const details = (r: RouteInfo) => {
    const count = counts?.[r.key];
    const s = lineStatus(alertSummary[r.key], counts ? (count ?? 0) : undefined);
    const drawn = !hiddenRoutes.includes(r.key);
    return (
      <div className="line-chip-details">
        <div className="line-chip-details-head">
          <span className="line-open-text">
            <span className="line-open-name">{r.mode === 'rail' ? r.name : (r.longName ?? `${MODE_LABELS[r.mode]} ${r.name}`)}</span>
            <span className="line-open-status muted">
              <span style={{ color: s.color }}>{s.text}</span>
              {count ? ` · ${vehicleCount(count, r.mode)} running` : ''}
            </span>
          </span>
          <button
            className="route-toggle"
            role="switch"
            aria-checked={drawn}
            aria-label={`Draw the ${r.name} route on the map`}
            title={drawn ? 'Route drawn on the map' : 'Route hidden on the map'}
            onClick={() => toggleRoute(r.key)}
          >
            <span className="route-toggle-label">Route</span>
            <span className="switch" aria-hidden="true" />
          </button>
        </div>
        <div className="line-chip-actions">
          <button className="button button-primary" onClick={() => onOpen(r.key)}>
            Open line
          </button>
          <button
            className="button"
            onClick={() => {
              setPicked(null);
              toggle(r.key);
            }}
          >
            Remove
          </button>
        </div>
      </div>
    );
  };

  const row = (r: RouteInfo) => {
    const s = lineStatus(alertSummary[r.key], counts ? (counts[r.key] ?? 0) : undefined);
    const on = chosenSet.has(r.key);
    const name = r.mode === 'rail' ? r.name : (r.longName ?? `${MODE_LABELS[r.mode]} ${r.name}`);
    return (
      <li key={r.key} className="line-item">
        <button className="line-open" onClick={() => onOpen(r.key)}>
          <LineBadge route={r} />
          <span className="line-open-text">
            <span className="line-open-name">{name}</span>
            <span className="line-open-status muted">
              <span style={{ color: s.color }}>{s.text}</span>
            </span>
          </span>
        </button>
        <button
          className={`star${on ? ' star-on' : ''}`}
          aria-pressed={on}
          aria-label={on ? `Remove ${r.name} from my lines` : `Add ${r.name} to my lines`}
          title={on ? 'Remove from my lines' : 'Add to my lines'}
          onClick={() => toggle(r.key)}
        >
          {on ? '★' : '☆'}
        </button>
      </li>
    );
  };

  return (
    <div className="lines-panel-inner">
      <header className="lines-panel-header">
        <h2>Lines</h2>
        <CloseButton onClick={onClose} />
      </header>
      <input
        className="search lines-search"
        type="search"
        placeholder="Search lines and bus routes"
        aria-label="Search lines and bus routes"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {!q && (
        <section>
          <div className="lines-heading">
            <h3>My lines</h3>
            {chosen.length > 0 && (
              <div className="lines-heading-actions">
                <button className="link" onClick={toggleAllRoutes}>
                  {anyDrawn ? 'Hide all routes' : 'Show all routes'}
                </button>
                <button className="link" onClick={() => onChange([])}>
                  Clear
                </button>
              </div>
            )}
          </div>
          {mine.length ? (
            <>
              <ul className="line-chips">{mine.map(chip)}</ul>
              {pickedLine && details(pickedLine)}
            </>
          ) : (
            <p className="muted lines-empty">
              {routes.length
                ? 'Tap ☆ on the lines you ride to keep them here. The map then shows only those.'
                : 'The list of lines loads once the server answers.'}
            </p>
          )}
        </section>
      )}

      <section>
        {!q && (
          <>
            <h3 className="lines-all">All lines</h3>
            <div className="segment" role="tablist">
              {BROWSE_MODES.map((m) => (
                <button key={m} role="tab" aria-selected={m === mode} onClick={() => setMode(m)}>
                  {MODE_LABELS[m]}
                </button>
              ))}
            </div>
            {mode === 'bus' && (
              <div className="boroughs" role="tablist" aria-label="Borough">
                {boroughs.map((b) => (
                  <button key={b} role="tab" className="chip" aria-selected={b === borough} onClick={() => pickBorough(b)}>
                    {boroughLabel(b)}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
        {q && groups.length === 0 && <p className="muted lines-empty">No line matches.</p>}
        {groups.map((g) => (
          <div key={g.title || 'all'}>
            {g.title && <h4 className={q ? 'lines-group lines-group-mode' : 'lines-group'}>{g.title}</h4>}
            <ul className="line-items">{g.routes.map(row)}</ul>
          </div>
        ))}
      </section>
    </div>
  );
}
