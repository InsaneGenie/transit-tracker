import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchRouteLines, fetchRoutes, fetchVehicleDetail, type Mode, type RouteInfo, type RouteLine, type VehicleDetail } from './api';
import { Legend } from './Legend';
import { MapView, SELECTED_POLL_MS, type MapInfo } from './MapView';
import { themeFor, type Theme } from './theme';
import { VehiclePanel } from './VehiclePanel';
import { MODE_LABELS } from './vehicles';

const ALL_MODES: Mode[] = ['subway', 'rail', 'bus'];
const LINES_KEY = 'transit-tracker:lines';
const DRAW_ROUTES_KEY = 'transit-tracker:draw-routes';

/** The line filter is remembered between visits, when the browser allows it. */
function savedLines(): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(LINES_KEY) ?? '[]');
    return Array.isArray(saved) ? saved.filter((k) => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

function savedDrawRoutes(): boolean {
  try {
    return localStorage.getItem(DRAW_ROUTES_KEY) === 'true';
  } catch {
    return false;
  }
}

function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private browsing or storage turned off; the setting just won't be remembered.
  }
}

export function App() {
  const [modes, setModes] = useState<Mode[]>(ALL_MODES);
  const [lines, setLines] = useState<string[]>(savedLines);
  const [drawRoutes, setDrawRoutes] = useState(savedDrawRoutes);
  const [routeLines, setRouteLines] = useState<RouteLine[]>([]);
  const [routes, setRoutes] = useState<RouteInfo[]>([]);
  const [legendOpen, setLegendOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [following, setFollowing] = useState(false);
  const [detail, setDetail] = useState<VehicleDetail | null>(null);
  const [info, setInfo] = useState<MapInfo>({ count: 0 });
  // A stop to bring to the middle of the map; `at` makes tapping the same stop twice work.
  const [focus, setFocus] = useState<{ lon: number; lat: number; at: number } | null>(null);
  const [theme, setTheme] = useState<Theme>(() => themeFor(new Date()));
  const panelRef = useRef<HTMLElement>(null);
  const routesByKey = useMemo(() => new Map(routes.map((r) => [r.key, r])), [routes]);

  // Follow sunrise and sunset.
  useEffect(() => {
    const timer = setInterval(() => setTheme(themeFor(new Date())), 60_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => save(LINES_KEY, JSON.stringify(lines)), [lines]);
  useEffect(() => save(DRAW_ROUTES_KEY, String(drawRoutes)), [drawRoutes]);

  // The whole route of each chosen line, when asked for. Retry while the server may still be starting.
  useEffect(() => {
    setRouteLines([]);
    if (!drawRoutes || !lines.length) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const load = () =>
      fetchRouteLines(lines, controller.signal)
        .then((r) => {
          setRouteLines(r.lines);
          if (r.lines.length < lines.length) timer = setTimeout(load, 15_000);
        })
        .catch((err: Error) => {
          if (err.name !== 'AbortError') timer = setTimeout(load, 5_000);
        });
    void load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [drawRoutes, lines]);

  // The legend's list of lines. Retry until the server is up, since it may still be starting.
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const load = () =>
      fetchRoutes(controller.signal)
        .then(({ routes }) => {
          setRoutes(routes);
          // Schedules can still be loading; ask again until every mode has its lines.
          if (new Set(routes.map((r) => r.mode)).size < ALL_MODES.length) timer = setTimeout(load, 15_000);
        })
        .catch((err: Error) => {
          if (err.name !== 'AbortError') timer = setTimeout(load, 5_000);
        });
    void load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, []);

  // Tapping a vehicle follows it; on small screens it also closes the legend to make room.
  const select = (id: string | null) => {
    setSelectedId(id);
    setFollowing(id !== null);
    if (id && window.matchMedia('(max-width: 640px)').matches) setLegendOpen(false);
  };

  // Keep the open vehicle's position, stops and arrival times fresh.
  useEffect(() => {
    setDetail(null);
    if (!selectedId) return;
    const controller = new AbortController();
    const load = () =>
      fetchVehicleDetail(selectedId, controller.signal)
        .then(setDetail)
        .catch((err: Error) => {
          // The trip ended or left the feed.
          if (err.name !== 'AbortError' && err.message.endsWith('404')) select(null);
        });
    void load();
    const timer = setInterval(load, SELECTED_POLL_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [selectedId]);

  const toggle = (mode: Mode) =>
    setModes((m) => (m.includes(mode) ? m.filter((x) => x !== mode) : [...m, mode]));

  return (
    <div className="app">
      <MapView
        theme={theme}
        modes={modes}
        lines={lines}
        routeLines={routeLines}
        focus={focus}
        selectedId={selectedId}
        detail={detail}
        following={following}
        onSelect={select}
        onFollowChange={setFollowing}
        onUpdate={setInfo}
        panelRef={panelRef}
      />

      <div className="toolbar">
        <h1>
          <span className="brand-dot" aria-hidden="true" />
          NY Transit Live
        </h1>
        <div className="filters" role="group" aria-label="Show">
          {ALL_MODES.map((mode) => (
            <button
              key={mode}
              className={`chip chip-${mode}`}
              aria-pressed={modes.includes(mode)}
              onClick={() => toggle(mode)}
            >
              <span className="chip-dot" aria-hidden="true" />
              {MODE_LABELS[mode]}
            </button>
          ))}
          <button
            className={`chip chip-lines${lines.length ? ' chip-active' : ''}`}
            aria-expanded={legendOpen}
            onClick={() => setLegendOpen((o) => !o)}
          >
            {lines.length ? `Lines (${lines.length})` : 'Lines'}
          </button>
        </div>
      </div>

      {legendOpen && (
        <Legend
          routes={routes}
          modes={modes}
          chosen={lines}
          onChange={setLines}
          drawRoutes={drawRoutes}
          onDrawRoutesChange={setDrawRoutes}
          onClose={() => setLegendOpen(false)}
        />
      )}

      <div className={`status${info.error ? ' status-error' : info.zoomedOut ? '' : ' status-live'}`} role="status">
        {info.error ?? (info.zoomedOut ? 'Zoom in to see vehicles' : `${info.count.toLocaleString()} vehicles in view`)}
      </div>

      {detail && (
        <VehiclePanel
          ref={panelRef}
          detail={detail}
          routes={routesByKey}
          following={following}
          onFollow={() => setFollowing((f) => !f)}
          onStop={(stop) => {
            setFollowing(false);
            setFocus({ lon: stop.lon!, lat: stop.lat!, at: Date.now() });
          }}
          onClose={() => select(null)}
        />
      )}
    </div>
  );
}
