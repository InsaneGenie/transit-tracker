import { useMemo, useState } from 'react';
import type { AlertSeverity, Mode, RouteInfo } from './api';
import { CloseButton } from './CloseButton';
import { LineBadge } from './LineBadge';
import { lineStatus, vehicleCount } from './lines';
import { legendGroups, MODE_LABELS } from './vehicles';

const BROWSE_MODES: Mode[] = ['subway', 'rail', 'bus'];

interface Props {
  routes: RouteInfo[];
  /** The lines starred as theirs; the map shows only these when there are any. */
  chosen: string[];
  /** The most serious alert on now, by line key. */
  alertSummary: Record<string, AlertSeverity>;
  /** How many vehicles are out on each line; null until loaded. */
  counts: Record<string, number> | null;
  onChange: (chosen: string[]) => void;
  onOpen: (key: string) => void;
  onClose: () => void;
}

/** The Lines panel: your lines with how they're running, and every other line to browse and star. */
export function LinesScreen({ routes, chosen, alertSummary, counts, onChange, onOpen, onClose }: Props) {
  const [mode, setMode] = useState<Mode>('subway');
  const [search, setSearch] = useState('');
  const q = search.trim().toLowerCase();
  const chosenSet = useMemo(() => new Set(chosen), [chosen]);
  const byKey = useMemo(() => new Map(routes.map((r) => [r.key, r])), [routes]);
  const toggle = (key: string) => onChange(chosenSet.has(key) ? chosen.filter((k) => k !== key) : [...chosen, key]);

  // While searching, every matching line of every kind; otherwise the picked kind, in its groups.
  const groups = useMemo(() => {
    if (q) {
      const matches = (r: RouteInfo) => r.name.toLowerCase().startsWith(q) || r.longName?.toLowerCase().includes(q);
      return BROWSE_MODES.map((m) => ({ title: MODE_LABELS[m], routes: legendGroups(routes, m).flatMap((g) => g.routes.filter(matches)) })).filter(
        (g) => g.routes.length,
      );
    }
    const of = legendGroups(routes, mode);
    // The subway is one list; rail lines go by railroad, buses by borough.
    return mode === 'subway' ? [{ title: '', routes: of.flatMap((g) => g.routes) }] : of;
  }, [q, routes, mode]);

  const row = (r: RouteInfo, mine: boolean) => {
    const count = counts?.[r.key];
    const s = lineStatus(alertSummary[r.key], counts ? (count ?? 0) : undefined);
    const on = chosenSet.has(r.key);
    const name = r.mode === 'rail' ? r.name : (r.longName ?? `${MODE_LABELS[r.mode]} ${r.name}`);
    return (
      <li key={r.key} className={mine ? 'line-card' : 'line-item'}>
        <button className="line-open" onClick={() => onOpen(r.key)}>
          <LineBadge route={r} />
          <span className="line-open-text">
            <span className="line-open-name">{name}</span>
            <span className="line-open-status muted">
              <span style={{ color: s.color }}>
                {mine && s.color ? '● ' : ''}
                {s.text}
              </span>
              {mine && count ? ` · ${vehicleCount(count, r.mode)} running` : ''}
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

  const mine = chosen.flatMap((k) => byKey.get(k) ?? []);

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
              <button className="link" onClick={() => onChange([])}>
                Clear
              </button>
            )}
          </div>
          {mine.length ? (
            <ul className="line-cards">{mine.map((r) => row(r, true))}</ul>
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
          </>
        )}
        {q && groups.length === 0 && <p className="muted lines-empty">No line matches.</p>}
        {groups.map((g) => (
          <div key={g.title || 'all'}>
            {g.title && <h4 className={q ? 'lines-group lines-group-mode' : 'lines-group'}>{g.title}</h4>}
            <ul className="line-items">{g.routes.map((r) => row(r, false))}</ul>
          </div>
        ))}
      </section>
    </div>
  );
}
