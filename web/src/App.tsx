import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchArrivals, fetchRouteLines, fetchRoutes, fetchVehicleDetail, type ArrivalDirection, type Mode, type RouteInfo, type RouteLine, type UpcomingStop, type VehicleDetail } from './api';
import { Legend } from './Legend';
import { LinePanel } from './LinePanel';
import { MapView, SELECTED_POLL_MS, type MapInfo, type Station } from './MapView';
import { themeFor, type Theme } from './theme';
import { VehiclePanel } from './VehiclePanel';
import { displayName, facingWay, MODE_LABELS, routeKey, sameStation, transferLines } from './vehicles';

const ALL_MODES: Mode[] = ['subway', 'rail', 'bus'];
const LINES_KEY = 'transit-tracker:lines';
/** The server draws at most this many lines per request. */
const MAX_DRAWN_LINES = 60;

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

/**
 * A line opened from a station's transfers or one of its stations on the map. `back` is the vehicle and
 * station it was opened from; `atStation` keeps the map on the tapped station instead of the whole line.
 */
type ViewLine = {
  key: string;
  back?: { vehicleId: string; label: string; station: Station | null };
  atStation?: boolean;
  /** The stops ahead of the vehicle it was opened from, so its stations read in that vehicle's direction. */
  ahead?: UpcomingStop[];
};

/** A line's whole route with its stations. Retries while the server may still be starting. */
function useRouteLine(key: string | null): RouteLine | null {
  const [line, setLine] = useState<RouteLine | null>(null);
  useEffect(() => {
    setLine(null);
    if (!key) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const load = () =>
      fetchRouteLines([key], controller.signal)
        .then((r) => {
          setLine(r.lines[0] ?? null);
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
  }, [key]);
  return line;
}

export function App() {
  const [modes, setModes] = useState<Mode[]>(ALL_MODES);
  const [lines, setLines] = useState<string[]>(savedLines);
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
  const [filterRoutes, setFilterRoutes] = useState<RouteLine[]>([]);
  const [arrivals, setArrivals] = useState<ArrivalDirection[] | null>(null);
  // Set when a vehicle is picked from the station's arrivals, so the station stays picked.
  const keepStation = useRef(false);
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

  // The whole route of the tapped vehicle's line, with its stations.
  const selectedLine = detail ? routeKey(detail.vehicle) : null;
  const routeLine = useRouteLine(selectedLine);
  // A line opened from a station's transfers, and where Back returns to.
  const [viewLine, setViewLine] = useState<ViewLine | null>(null);
  const viewRoute = useRouteLine(viewLine?.key ?? null);
  // Its stations listed the way the vehicle it was opened from is going.
  const listedRoute = useMemo(
    () => (viewRoute && viewLine?.ahead ? { ...viewRoute, stops: facingWay(viewRoute.stops, viewLine.ahead) } : viewRoute),
    [viewRoute, viewLine?.ahead],
  );

  // A picked station belongs to the vehicle it was picked for, or to the line when one of its arrivals is picked.
  useEffect(() => {
    if (keepStation.current) {
      keepStation.current = false;
      return;
    }
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

  // Every vehicle of the line on its way to the picked station, both ways, kept fresh.
  useEffect(() => {
    setArrivals(null);
    const line = selectedLine ?? viewLine?.key;
    if (!station || !line) return;
    const controller = new AbortController();
    const load = () =>
      fetchArrivals(line, station, controller.signal)
        .then((r) => setArrivals(r.directions))
        .catch(() => {});
    void load();
    const timer = setInterval(load, SELECTED_POLL_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [station?.lat, station?.lon, selectedLine, viewLine?.key]);

  // The lines picked in the Lines tab are drawn as soon as they're picked.
  useEffect(() => {
    setFilterRoutes([]);
    if (!lines.length) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const load = () =>
      fetchRouteLines(lines.slice(0, MAX_DRAWN_LINES), controller.signal)
        .then((r) => {
          setFilterRoutes(r.lines);
          // Schedules can still be loading; ask again for the lines not found yet.
          if (r.lines.length < Math.min(lines.length, MAX_DRAWN_LINES)) timer = setTimeout(load, 15_000);
        })
        .catch((err: Error) => {
          if (err.name !== 'AbortError') timer = setTimeout(load, 5_000);
        });
    void load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [lines]);

  // Lines drawn under the tapped vehicle's own: the picked lines and the picked station's transfers.
  const otherLines = useMemo(() => {
    // A line opened on its own is shown alone.
    if (viewLine && !detail) return [];
    const byKey = new Map([...filterRoutes, ...transferRoutes].map((l) => [l.key, l]));
    return [...byKey.values()];
  }, [filterRoutes, transferRoutes, viewLine, detail]);

  // Stations tapped on the map arrive without their transfers; the line or the stop list knows them.
  const pickStation = (stop: Omit<Station, 'at' | 'transfers'>) => {
    const known = [...(routeLine?.stops ?? []), ...(viewRoute?.stops ?? []), ...(detail?.upcoming ?? [])].find(
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

  // Show a transfer line on its own. Back returns to the vehicle and station it was opened from.
  const openLine = (key: string, at?: Station, ahead?: UpcomingStop[]) => {
    const back = detail
      ? {
          vehicleId: detail.vehicle.id,
          label: `the ${displayName(detail.vehicle.routeName ?? detail.vehicle.routeId ?? '')} ${detail.vehicle.mode === 'bus' ? 'bus' : 'train'}`,
          station,
        }
      : viewLine?.back;
    setViewLine({ key, back, atStation: Boolean(at), ahead });
    setStation(at ?? null);
    setShowTransfers(false);
    // Closing the vehicle would otherwise drop the station just picked.
    if (at && selectedId) keepStation.current = true;
    select(null);
  };

  // Every station on the open vehicle's line, from its drawn route or the panel.
  const openOwnLine = () => {
    if (selectedLine) openLine(selectedLine, undefined, detail?.upcoming);
  };

  // A station of a picked line, tapped on the map, opens that line there.
  const openLineStation = (key: string, stop: Omit<Station, 'at' | 'transfers'>) => {
    const known = otherLines.find((l) => l.key === key)?.stops.find((s) => s.stopId === stop.stopId);
    openLine(key, { ...stop, transfers: known?.transfers, at: Date.now() });
  };

  const closeLine = () => {
    const back = viewLine?.back;
    setViewLine(null);
    setStation(null);
    if (back) {
      select(back.vehicleId);
      // Show the station it was opened from, not the vehicle; with no station, follow the vehicle again.
      if (back.station) {
        setFollowing(false);
        setRestoreStation(back.station);
      }
    }
  };

  // Once the vehicle's panel is back, pick its station again, so the map centers it beside the panel.
  const [restoreStation, setRestoreStation] = useState<Station | null>(null);
  useEffect(() => {
    if (!restoreStation || !detail) return;
    setStation({ ...restoreStation, at: Date.now() });
    setRestoreStation(null);
  }, [detail, restoreStation]);

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
        modes={viewLine && viewRoute && !modes.includes(viewRoute.mode) ? [...modes, viewRoute.mode] : modes}
        lines={viewLine ? [viewLine.key] : lines}
        routeLine={detail ? routeLine : viewRoute}
        focusLine={viewLine?.atStation ? null : viewRoute}
        otherLines={otherLines}
        station={station}
        onStation={pickStation}
        onLineStation={openLineStation}
        onRouteLine={openOwnLine}
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

      {!detail && viewLine && (
        <LinePanel
          ref={panelRef}
          info={routesByKey.get(viewLine.key)}
          line={listedRoute}
          routes={routesByKey}
          station={station}
          arrivals={arrivals}
          backLabel={viewLine.back?.label}
          onBack={closeLine}
          onStop={(stop) => pickStation({ stopId: stop.stopId, name: stop.name, lon: stop.lon!, lat: stop.lat! })}
          onArrival={(id) => {
            keepStation.current = true;
            select(id);
          }}
          onLine={(key) => openLine(key)}
          onClose={() => {
            setViewLine(null);
            setStation(null);
          }}
        />
      )}

      {detail && (
        <VehiclePanel
          ref={panelRef}
          detail={detail}
          routes={routesByKey}
          following={following}
          onFollow={() => setFollowing((f) => !f)}
          onAllStations={openOwnLine}
          station={station}
          stationTransfers={stationTransfers}
          showTransfers={showTransfers}
          arrivals={arrivals}
          onArrival={(id) => {
            if (id === selectedId) return;
            keepStation.current = true;
            select(id);
          }}
          onLine={(key) => openLine(key)}
          onShowTransfers={setShowTransfers}
          onStop={(stop) => pickStation({ stopId: stop.stopId, name: stop.name, lon: stop.lon!, lat: stop.lat! })}
          onClose={() => select(null)}
        />
      )}
    </div>
  );
}
