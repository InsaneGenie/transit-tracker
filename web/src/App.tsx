import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchRouteLines, fetchRoutes, fetchVehicleDetail, type Mode, type RouteInfo, type RouteLine, type VehicleDetail } from './api';
import { Legend } from './Legend';
import { MapView, SELECTED_POLL_MS, type MapInfo, type Station } from './MapView';
import { themeFor, type Theme } from './theme';
import { VehiclePanel } from './VehiclePanel';
import { MODE_LABELS, routeKey, sameStation, transferLines } from './vehicles';

const ALL_MODES: Mode[] = ['subway', 'rail', 'bus'];
const LINES_KEY = 'transit-tracker:lines';

/** The line filter is remembered between visits, when the browser allows it. */
function savedLines(): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(LINES_KEY) ?? '[]');
    return Array.isArray(saved) ? saved.filter((k) => typeof k === 'string') : [];
  } catch {
    return [];
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
  const [routeLine, setRouteLine] = useState<RouteLine | null>(null);
  const [routes, setRoutes] = useState<RouteInfo[]>([]);
  const [legendOpen, setLegendOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [following, setFollowing] = useState(false);
  const [detail, setDetail] = useState<VehicleDetail | null>(null);
  const [info, setInfo] = useState<MapInfo>({ count: 0 });
  // The station picked from the stop list or the map, shown and brought to the middle of the map.
  const [station, setStation] = useState<Station | null>(null);
  const [showTransfers, setShowTransfers] = useState(false);
  const [transferRoutes, setTransferRoutes] = useState<RouteLine[]>([]);
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

  // The whole route of the tapped vehicle's line, with its stations. Retry while the server may still be starting.
  const selectedLine = detail ? routeKey(detail.vehicle) : null;
  useEffect(() => {
    setRouteLine(null);
    if (!selectedLine) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const load = () =>
      fetchRouteLines([selectedLine], controller.signal)
        .then((r) => {
          setRouteLine(r.lines[0] ?? null);
          if (!r.lines.length) timer = setTimeout(load, 15_000);
        })
        .catch((err: Error) => {
          if (err.name !== 'AbortError') timer = setTimeout(load, 5_000);
        });
    void load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [selectedLine]);

  // A picked station belongs to the vehicle it was picked for.
  useEffect(() => {
    setStation(null);
    setShowTransfers(false);
  }, [selectedId]);

  // The lines you can change to at the picked station, without express twins (7X beside the 7).
  const stationTransfers = useMemo(
    () => transferLines(station?.transfers, routesByKey).map((r) => r.key),
    [station, routesByKey],
  );

  // Their whole routes, when asked for.
  useEffect(() => {
    setTransferRoutes([]);
    if (!showTransfers || !stationTransfers.length) return;
    const controller = new AbortController();
    fetchRouteLines(stationTransfers, controller.signal)
      .then((r) => setTransferRoutes(r.lines))
      .catch(() => {});
    return () => controller.abort();
  }, [showTransfers, stationTransfers]);

  // Stations tapped on the map arrive without their transfers; the line or the stop list knows them.
  const pickStation = (stop: Omit<Station, 'at' | 'transfers'>) => {
    const known = [...(routeLine?.stops ?? []), ...(detail?.upcoming ?? [])].find(
      (s) => s.transfers && sameStation(s, stop),
    );
    setFollowing(false);
    setStation({ ...stop, transfers: known?.transfers, at: Date.now() });
  };

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
        routeLine={routeLine}
        transferLines={transferRoutes}
        station={station}
        onStation={pickStation}
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
          station={station}
          stationTransfers={stationTransfers}
          showTransfers={showTransfers}
          onShowTransfers={setShowTransfers}
          onStop={(stop) => pickStation({ stopId: stop.stopId, name: stop.name, lon: stop.lon!, lat: stop.lat! })}
          onClose={() => select(null)}
        />
      )}
    </div>
  );
}
