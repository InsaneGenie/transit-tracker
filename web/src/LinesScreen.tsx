import { useMemo, useState } from 'react';
import type { AlertSeverity, Mode, RouteInfo } from './api';
import { CloseButton } from './CloseButton';
import { LineBadge } from './LineBadge';
import { boroughLabel, lineStatus, vehicleCount } from './lines';
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
  const [editing, setEditing] = useState(false);

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
  const edit = editing && mine.length > 0;
  const anyDrawn = chosen.some((k) => !hiddenRoutes.includes(k));
  const toggleAllRoutes = () =>
    onHiddenRoutesChange(anyDrawn ? [...new Set([...hiddenRoutes, ...chosen])] : hiddenRoutes.filter((k) => !chosenSet.has(k)));
  // Moves one of your lines up or down a place; the map and the app keep this order.
  const move = (i: number, by: -1 | 1) => {
    const order = mine.map((r) => r.key);
    [order[i], order[i + by]] = [order[i + by], order[i]];
    onChange([...order, ...chosen.filter((k) => !byKey.has(k))]);
  };

  // Your lines at a glance: a badge each, with how it's running. Tap one to open its page.
  const tile = (r: RouteInfo) => {
    const count = counts?.[r.key];
    const s = lineStatus(alertSummary[r.key], counts ? (count ?? 0) : undefined);
    const hidden = hiddenRoutes.includes(r.key);
    const caption = r.mode === 'rail' ? r.name : count ? vehicleCount(count, r.mode) : counts ? 'Not running' : '\u00a0';
    return (
      <li key={r.key}>
        <button
          className={`line-tile${hidden ? ' line-tile-hidden' : ''}`}
          onClick={() => onOpen(r.key)}
          title={`${r.longName ?? r.name}: ${s.text}${count ? `, ${vehicleCount(count, r.mode)} running` : ''}${hidden ? '. Route hidden on the map' : ''}`}
        >
          <span className="line-tile-badge">
            <LineBadge route={r} size={36} />
            {s.color && <span className="line-tile-dot" style={{ background: s.color }} aria-label={s.text} />}
          </span>
          <span className="line-tile-caption">{caption}</span>
        </button>
      </li>
    );
  };

  // While editing: each of your lines on one row, to move, hide its route or remove.
  const editRow = (r: RouteInfo, i: number) => {
    const drawn = !hiddenRoutes.includes(r.key);
    return (
      <li key={r.key} className="line-edit">
        <div className="line-move">
          <button aria-label={`Move ${r.name} up`} title="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
            ↑
          </button>
          <button aria-label={`Move ${r.name} down`} title="Move down" disabled={i === mine.length - 1} onClick={() => move(i, 1)}>
            ↓
          </button>
        </div>
        <LineBadge route={r} size={28} />
        <span className="line-edit-name">{r.mode === 'rail' ? r.name : (r.longName ?? `${MODE_LABELS[r.mode]} ${r.name}`)}</span>
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
        <button className="line-remove" aria-label={`Remove ${r.name} from my lines`} title="Remove from my lines" onClick={() => toggle(r.key)}>
          ×
        </button>
      </li>
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
                {edit && (
                  <button className="link" onClick={() => onChange([])}>
                    Clear
                  </button>
                )}
                <button className={`link${edit ? ' link-strong' : ''}`} aria-pressed={edit} onClick={() => setEditing(!edit)}>
                  {edit ? 'Done' : 'Edit'}
                </button>
              </div>
            )}
          </div>
          {mine.length ? (
            edit ? (
              <ul className="line-edits">{mine.map(editRow)}</ul>
            ) : (
              <ul className="line-tiles">{mine.map(tile)}</ul>
            )
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
