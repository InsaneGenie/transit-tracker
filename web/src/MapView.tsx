import {
  GeolocateControl,
  Map as MapLibreMap,
  NavigationControl,
  type ExpressionSpecification,
  setWorkerUrl,
  type GeoJSONSource,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { useEffect, useRef, type RefObject } from 'react';
import { fetchVehicles, type Bounds, type Mode, type RouteLine, type UpcomingStop, type Vehicle, type VehicleDetail } from './api';
import type { Theme } from './theme';
import { colorFor, interpolate, routeKey, tidyStopName, toFeatureCollection } from './vehicles';

// MapLibre finds its worker next to its own file, which bundlers move; point it at the bundled copy.
setWorkerUrl(workerUrl);

const STYLES: Record<Theme, string> = {
  light: import.meta.env.VITE_MAP_STYLE || 'https://tiles.openfreemap.org/styles/positron',
  dark: import.meta.env.VITE_MAP_STYLE_DARK || 'https://tiles.openfreemap.org/styles/dark',
};
/** Stations that can be tapped: those still ahead of the tapped vehicle first, then the rest of its line. */
const STATION_LAYERS = ['selected-stops', 'route-stops'];
/** Below this zoom (about the size of New York City on screen) vehicles are hidden and not fetched. */
export const VEHICLE_MIN_ZOOM = 10;
/** How often the tapped vehicle is refreshed; it glides across each interval so it never stops. */
export const SELECTED_POLL_MS = 3000;
/** Gliding is only visible up close; further out, dots jump once per update, which costs far less. */
const GLIDE_MIN_ZOOM = 13;
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

/** Closer in, there are fewer vehicles on screen and each one's movement is visible, so update more often. */
export function pollMsFor(zoom: number): number {
  return zoom >= 15 ? 2000 : zoom >= GLIDE_MIN_ZOOM ? 3000 : 5000;
}

/** Redrawing every vehicle is the expensive part, so the glide frame rate rises only as the count falls. */
function glideFrameMsFor(zoom: number): number {
  return zoom >= 15 ? 33 : 66;
}

export type MapInfo = { count: number; error?: string; zoomedOut?: boolean };

/** A station picked on the map or in the stop list; `at` makes picking the same one twice re-center it. */
export type Station = { stopId: string; name?: string; lon: number; lat: number; transfers?: string[]; at: number };

interface Props {
  theme: Theme;
  modes: Mode[];
  /** Line keys to show; empty shows every line. */
  lines: string[];
  /** The tapped vehicle's whole line, drawn under the vehicles with its stations. */
  routeLine: RouteLine | null;
  /** A line opened on its own; the map zooms out to fit it when it arrives. */
  focusLine: RouteLine | null;
  /** Routes drawn under the tapped vehicle's line: lines picked in the Lines tab and the picked station's transfers. */
  otherLines: RouteLine[];
  /** The picked station, marked on the map and brought to the middle. */
  station: Station | null;
  onStation: (station: Omit<Station, 'at'>) => void;
  /** A station of one of `otherLines` was tapped. */
  onLineStation: (line: string, station: Omit<Station, 'at' | 'transfers'>) => void;
  selectedId: string | null;
  detail: VehicleDetail | null;
  following: boolean;
  onSelect: (id: string | null) => void;
  onFollowChange: (following: boolean) => void;
  onUpdate: (info: MapInfo) => void;
  /** The vehicle panel, so a followed vehicle is kept in the part of the map it doesn't cover. */
  panelRef: RefObject<HTMLElement | null>;
}

/** A small arrow drawn once and tinted per vehicle, pointing the way it is heading. */
function arrowImage(): ImageData {
  const size = 64;
  const ctx = document.createElement('canvas').getContext('2d')!;
  ctx.canvas.width = ctx.canvas.height = size;
  ctx.beginPath();
  ctx.moveTo(32, 2);
  ctx.lineTo(44, 22);
  ctx.lineTo(20, 22);
  ctx.closePath();
  ctx.fillStyle = '#000';
  ctx.fill();
  return ctx.getImageData(0, 0, size, size);
}

function boundsOf(map: MapLibreMap): Bounds {
  const b = map.getBounds();
  return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
}

/** Which dots the main layers draw: the chosen modes and lines, minus the tapped vehicle (drawn on its own). */
function vehicleFilter(modes: Mode[], lines: string[], selectedId: string | null): ExpressionSpecification {
  const parts: ExpressionSpecification[] = [['in', ['get', 'mode'], ['literal', modes]]];
  if (lines.length) parts.push(['in', ['get', 'routeKey'], ['literal', lines]]);
  if (selectedId) parts.push(['!=', ['get', 'id'], selectedId]);
  return ['all', ...parts];
}

function linesData(lines: RouteLine[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: lines.map((l) => ({
      type: 'Feature',
      geometry: { type: 'MultiLineString', coordinates: l.paths },
      properties: { color: colorFor({ routeColor: l.color, mode: l.mode }) },
    })),
  };
}

function routeLineData(line: RouteLine | null): { path: GeoJSON.FeatureCollection; stops: GeoJSON.FeatureCollection } {
  if (!line) return { path: EMPTY, stops: EMPTY };
  return {
    path: linesData([line]),
    stops: stopFeatures(line.stops, colorFor({ routeColor: line.color, mode: line.mode })),
  };
}

function stopFeatures(stops: UpcomingStop[], color: string): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: stops
      .filter((s) => s.lat !== undefined && s.lon !== undefined)
      .map((s) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [s.lon!, s.lat!] },
        properties: { color, stopId: s.stopId, name: s.name ? tidyStopName(s.name) : '' },
      })),
  };
}

/** The stations of every picked line, each knowing which line it belongs to. */
function otherStopsData(lines: RouteLine[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: lines.flatMap((l) =>
      stopFeatures(l.stops, colorFor({ routeColor: l.color, mode: l.mode })).features.map((f) => ({
        ...f,
        properties: { ...f.properties, line: l.key },
      })),
    ),
  };
}

function stationData(station: Station | null, color: string): GeoJSON.FeatureCollection {
  if (!station) return EMPTY;
  return stopFeatures([station], color);
}

function selectionData(detail: VehicleDetail | null): {
  path: GeoJSON.FeatureCollection;
  stops: GeoJSON.FeatureCollection;
} {
  if (!detail) return { path: EMPTY, stops: EMPTY };
  const color = colorFor(detail.vehicle);
  return {
    path:
      detail.path.length > 1
        ? {
            type: 'FeatureCollection',
            features: [
              { type: 'Feature', geometry: { type: 'LineString', coordinates: detail.path }, properties: { color } },
            ],
          }
        : EMPTY,
    stops: stopFeatures(detail.upcoming, color),
  };
}

/** Arrow, dot and line label for every vehicle in `source`. */
function addVehicleLayers(
  map: MapLibreMap,
  prefix: string,
  source: string,
  outline: string,
  filter: ExpressionSpecification,
  minzoom: number,
) {
  map.addLayer({
    id: `${prefix}-arrows`,
    type: 'symbol',
    source,
    minzoom: 13,
    filter: ['all', ['get', 'hasBearing'], filter],
    layout: {
      'icon-image': 'arrow',
      'icon-rotate': ['get', 'bearing'],
      'icon-rotation-alignment': 'map',
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'icon-size': ['interpolate', ['linear'], ['zoom'], 13, 0.45, 16, 0.85],
    },
    paint: { 'icon-color': ['get', 'color'] },
  });
  map.addLayer({
    id: `${prefix}-dots`,
    type: 'circle',
    source,
    minzoom,
    filter,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], VEHICLE_MIN_ZOOM, 2.5, 11, 3.5, 13, 6, 16, 13],
      'circle-color': ['get', 'color'],
      'circle-stroke-color': outline,
      'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 10, 0.5, 13, 1.5],
    },
  });
  map.addLayer({
    id: `${prefix}-labels`,
    type: 'symbol',
    source,
    minzoom: 14,
    filter,
    layout: {
      'text-field': ['get', 'label'],
      'text-font': ['Noto Sans Bold'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 14, 9, 16, 13],
      'text-allow-overlap': true,
      'text-ignore-placement': true,
    },
    paint: { 'text-color': ['get', 'textColor'] },
  });
}

interface LayerState {
  vehicles: GeoJSON.FeatureCollection;
  routeLine: RouteLine | null;
  otherLines: RouteLine[];
  station: Station | null;
  selected: GeoJSON.FeatureCollection;
  modes: Mode[];
  lines: string[];
  selectedId: string | null;
  detail: VehicleDetail | null;
}

/** Adds our sources and layers. Runs again whenever the base map style is swapped for the other theme. */
function installLayers(map: MapLibreMap, theme: Theme, state: LayerState) {
  const outline = theme === 'dark' ? '#111827' : '#ffffff';
  const ring = theme === 'dark' ? '#f9fafb' : '#111827';
  const selection = selectionData(state.detail);

  if (!map.hasImage('arrow')) map.addImage('arrow', arrowImage(), { sdf: true });
  // Points don't need detailed tiles, so tile only up to zoom 12 and let MapLibre overzoom from there.
  map.addSource('vehicles', { type: 'geojson', data: state.vehicles, maxzoom: 12, buffer: 32 });
  map.addSource('selected-vehicle', { type: 'geojson', data: state.selected });
  const line = routeLineData(state.routeLine);
  map.addSource('other-lines', { type: 'geojson', data: linesData(state.otherLines) });
  map.addSource('other-stops', { type: 'geojson', data: otherStopsData(state.otherLines) });
  map.addSource('route-lines', { type: 'geojson', data: line.path });
  map.addSource('route-stops', { type: 'geojson', data: line.stops });
  map.addSource('chosen-station', { type: 'geojson', data: stationData(state.station, stationColor(state)) });
  map.addSource('selected-path', { type: 'geojson', data: selection.path });
  map.addSource('selected-stops', { type: 'geojson', data: selection.stops });

  // Picked lines and the picked station's transfers, under the tapped vehicle's own line.
  map.addLayer({
    id: 'other-lines',
    type: 'line',
    source: 'other-lines',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.5, 15, 4], 'line-opacity': 0.7 },
  });
  // Their stations, once zoomed in enough to tell them apart.
  map.addLayer({
    id: 'other-stops',
    type: 'circle',
    source: 'other-stops',
    minzoom: 11,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2, 15, 4],
      'circle-color': outline,
      'circle-stroke-color': ['get', 'color'],
      'circle-stroke-width': 1.5,
    },
  });
  // The tapped vehicle's whole line, thinner and fainter than its path ahead.
  map.addLayer({
    id: 'route-lines-casing',
    type: 'line',
    source: 'route-lines',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': outline, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 4, 15, 8], 'line-opacity': 0.8 },
  });
  map.addLayer({
    id: 'route-lines',
    type: 'line',
    source: 'route-lines',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['get', 'color'],
      'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2, 15, 5],
      'line-opacity': routeLineOpacity(state.detail),
    },
  });
  map.addLayer({
    id: 'selected-path',
    type: 'line',
    source: 'selected-path',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': ['get', 'color'], 'line-width': 5, 'line-opacity': 0.75 },
  });
  // Every station on the line, behind the stops still ahead.
  map.addLayer({
    id: 'route-stops',
    type: 'circle',
    source: 'route-stops',
    minzoom: 10,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 2, 11, 2.5, 15, 4],
      'circle-color': outline,
      'circle-stroke-color': ['get', 'color'],
      'circle-stroke-width': 1.5,
      'circle-stroke-opacity': 0.7,
    },
  });
  map.addLayer({
    id: 'selected-stops',
    type: 'circle',
    source: 'selected-stops',
    paint: {
      'circle-radius': 4,
      'circle-color': outline,
      'circle-stroke-color': ['get', 'color'],
      'circle-stroke-width': 2,
    },
  });
  addVehicleLayers(map, 'vehicle', 'vehicles', outline, vehicleFilter(state.modes, state.lines, state.selectedId), VEHICLE_MIN_ZOOM);
  // The tapped vehicle has its own source so it can glide smoothly every frame, which redrawing every
  // vehicle can't afford.
  addVehicleLayers(map, 'selected', 'selected-vehicle', outline, ['literal', true], 0);
  map.addLayer({
    id: 'selected-ring',
    type: 'circle',
    source: 'selected-vehicle',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], VEHICLE_MIN_ZOOM, 7, 13, 11, 16, 19],
      'circle-color': 'transparent',
      'circle-stroke-color': ring,
      'circle-stroke-width': 2.5,
    },
  });
  // The picked station: a filled stop inside a ring, with its name.
  map.addLayer({
    id: 'chosen-station',
    type: 'circle',
    source: 'chosen-station',
    paint: {
      'circle-radius': 7,
      'circle-color': ['get', 'color'],
      'circle-stroke-color': outline,
      'circle-stroke-width': 3,
    },
  });
  map.addLayer({
    id: 'chosen-station-ring',
    type: 'circle',
    source: 'chosen-station',
    paint: {
      'circle-radius': 14,
      'circle-color': 'transparent',
      'circle-stroke-color': ['get', 'color'],
      'circle-stroke-width': 2.5,
    },
  });
  map.addLayer({
    id: 'chosen-station-name',
    type: 'symbol',
    source: 'chosen-station',
    layout: {
      'text-field': ['get', 'name'],
      'text-font': ['Noto Sans Bold'],
      'text-size': 13,
      'text-anchor': 'top',
      'text-offset': [0, 1.4],
      'text-allow-overlap': true,
      'text-ignore-placement': true,
    },
    paint: { 'text-color': ring, 'text-halo-color': outline, 'text-halo-width': 2 },
  });
}

/** A vehicle's line sits faintly behind its path ahead; a line shown on its own is drawn solid. */
function routeLineOpacity(detail: VehicleDetail | null): number {
  return detail ? 0.5 : 0.9;
}

/** The picked station takes the color of the line it was picked on. */
function stationColor(state: Pick<LayerState, 'detail' | 'routeLine'>): string {
  if (state.detail) return colorFor(state.detail.vehicle);
  return state.routeLine ? colorFor({ routeColor: state.routeLine.color, mode: state.routeLine.mode }) : '#111827';
}

/**
 * How far the middle of the uncovered map sits from the middle of the whole map, in pixels: up when the
 * panel is a sheet along the bottom (phones), right when it sits on the left.
 */
function uncoveredOffset(map: MapLibreMap, panel: HTMLElement | null): [number, number] {
  if (!panel) return [0, 0];
  const c = map.getContainer().getBoundingClientRect();
  const p = panel.getBoundingClientRect();
  if (p.width >= c.width - 1) return [0, -Math.max(0, c.bottom - p.top) / 2];
  return [Math.max(0, p.right - c.left) / 2, 0];
}

export function MapView(props: Props) {
  const { theme, modes, lines, routeLine, focusLine, otherLines, station, selectedId, detail, following } = props;
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const callbacks = useRef(props);
  callbacks.current = props;
  // Everything the layers need, kept here so they can be rebuilt after a style swap.
  const state = useRef<LayerState & { theme: Theme; following: boolean; latest: Vehicle[]; easeUntil: number }>({
    theme,
    vehicles: EMPTY,
    routeLine,
    otherLines,
    station,
    selected: EMPTY,
    modes,
    lines,
    selectedId,
    detail,
    following,
    latest: [],
    easeUntil: 0,
  });
  // The tapped vehicle's glide: from where it was drawn to its newest reported position.
  const glide = useRef<{ from?: Vehicle; to?: Vehicle; start: number }>({ start: 0 });

  useEffect(() => {
    const map = new MapLibreMap({
      container: container.current!,
      style: STYLES[state.current.theme],
      center: [-73.97, 40.73],
      zoom: 11,
      minZoom: 5,
      fadeDuration: 0,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(new NavigationControl({ showCompass: true }), 'top-right');
    map.addControl(new GeolocateControl({ trackUserLocation: true }), 'top-right');

    let shown = new Map<string, Vehicle>();
    let target: Vehicle[] = [];
    let glideStart = 0;
    let glideMs = pollMsFor(map.getZoom());
    let lastFrame = 0;
    let frame = 0;
    let showing = false;
    let controller: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const setVehicles = (vehicles: Vehicle[]) => {
      state.current.vehicles = toFeatureCollection(vehicles);
      (map.getSource('vehicles') as GeoJSONSource | undefined)?.setData(state.current.vehicles);
    };

    const draw = (time: number) => {
      const t = (time - glideStart) / glideMs;
      // Hold still while the map is being moved, so the zoom or pan itself stays smooth.
      if (t >= 1 || (!map.isMoving() && time - lastFrame >= glideFrameMsFor(map.getZoom()))) {
        lastFrame = time;
        setVehicles(interpolate(shown, target, t));
      }
      if (t < 1) frame = requestAnimationFrame(draw);
      else shown = new Map(target.map((v) => [v.id, v]));
    };

    const refresh = async () => {
      clearTimeout(timer);
      controller?.abort();
      if (map.getZoom() < VEHICLE_MIN_ZOOM) {
        // Too far out to show vehicles: stop fetching until the user zooms in.
        showing = false;
        shown = new Map();
        target = [];
        cancelAnimationFrame(frame);
        setVehicles([]);
        callbacks.current.onSelect(null);
        callbacks.current.onUpdate({ count: 0, zoomedOut: true });
        return;
      }
      controller = new AbortController();
      const zoom = map.getZoom();
      try {
        // Only what's on screen; anything off screen is left alone until it scrolls into view.
        const { vehicles } = await fetchVehicles(boundsOf(map), controller.signal);
        showing = true;
        state.current.latest = vehicles;
        // Glide from wherever the dots are drawn right now.
        const now = performance.now();
        shown = new Map(interpolate(shown, target, (now - glideStart) / glideMs).map((v) => [v.id, v]));
        target = vehicles;
        glideStart = now;
        glideMs = pollMsFor(zoom);
        cancelAnimationFrame(frame);
        if (zoom >= GLIDE_MIN_ZOOM) frame = requestAnimationFrame(draw);
        else {
          glideStart = -Infinity;
          shown = new Map(vehicles.map((v) => [v.id, v]));
          setVehicles(vehicles);
        }
        const { modes, lines } = state.current;
        const shownCount = vehicles.filter(
          (v) => modes.includes(v.mode) && (!lines.length || lines.includes(routeKey(v))),
        ).length;
        callbacks.current.onUpdate({ count: shownCount });
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        callbacks.current.onUpdate({ count: target.length, error: "Can't reach the live data server" });
      }
      timer = setTimeout(refresh, pollMsFor(zoom));
    };

    // The tapped vehicle glides every frame, and the camera rides along with it when following.
    let selectedFrame = 0;
    const drawSelected = () => {
      const { from, to, start } = glide.current;
      if (to) {
        const [pos] = from ? interpolate(new Map([[to.id, from]]), [to], (performance.now() - start) / SELECTED_POLL_MS) : [to];
        state.current.selected = toFeatureCollection([pos]);
        (map.getSource('selected-vehicle') as GeoJSONSource | undefined)?.setData(state.current.selected);
        if (state.current.following && !map.isZooming() && performance.now() > state.current.easeUntil) {
          const [dx, dy] = uncoveredOffset(map, callbacks.current.panelRef.current);
          const at = map.project([pos.lon, pos.lat]);
          map.setCenter(dx || dy ? map.unproject([at.x - dx, at.y - dy]) : [pos.lon, pos.lat]);
        }
      }
      selectedFrame = requestAnimationFrame(drawSelected);
    };
    selectedFrame = requestAnimationFrame(drawSelected);

    let started = false;
    map.on('style.load', () => {
      installLayers(map, state.current.theme, state.current);
      if (!started) {
        started = true;
        void refresh();
      }
    });

    const clickable = ['vehicle-dots', 'vehicle-labels', 'vehicle-arrows', 'selected-dots'];
    map.on('click', (e) => {
      const pad = 8;
      const box: [[number, number], [number, number]] = [
        [e.point.x - pad, e.point.y - pad],
        [e.point.x + pad, e.point.y + pad],
      ];
      const hit = map.queryRenderedFeatures(box, { layers: clickable })[0];
      // A station on the tapped vehicle's line, unless a vehicle sits on top of it: pick it.
      const stop = hit ? undefined : map.queryRenderedFeatures(box, { layers: STATION_LAYERS })[0];
      if (stop?.geometry.type === 'Point') {
        const [lon, lat] = stop.geometry.coordinates;
        const { stopId, name } = stop.properties as { stopId: string; name: string };
        callbacks.current.onStation({ stopId, name: name || undefined, lon, lat });
        return;
      }
      // A station of a picked line: open that line at the station.
      const other = hit ? undefined : map.queryRenderedFeatures(box, { layers: ['other-stops'] })[0];
      if (other?.geometry.type === 'Point') {
        const [lon, lat] = other.geometry.coordinates;
        const { stopId, name, line } = other.properties as { stopId: string; name: string; line: string };
        callbacks.current.onLineStation(line, { stopId, name: name || undefined, lon, lat });
        return;
      }
      callbacks.current.onSelect(hit ? String(hit.properties.id) : null);
    });
    for (const layer of [...clickable, ...STATION_LAYERS, 'other-stops']) {
      map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''));
    }

    // Grabbing the map means the user wants to look elsewhere. (Waiting for 'dragstart' is too late:
    // re-centering on the vehicle every frame would cancel the drag before it starts.)
    const stopFollowing = () => {
      if (state.current.following) callbacks.current.onFollowChange(false);
    };
    map.on('mousedown', stopFollowing);
    map.on('touchstart', stopFollowing);

    // Load the new view once the user stops moving the map. Moves made by following are left to the
    // regular poll, or every animation frame would restart the wait.
    let moveTimer: ReturnType<typeof setTimeout> | undefined;
    map.on('moveend', (e) => {
      if (!('originalEvent' in e) || !e.originalEvent) return;
      clearTimeout(moveTimer);
      if (map.getZoom() < VEHICLE_MIN_ZOOM && !showing) return;
      moveTimer = setTimeout(refresh, 250);
    });
    // Zooming with the buttons has no original event but still needs a reload.
    map.on('zoomend', () => {
      clearTimeout(moveTimer);
      if (map.getZoom() < VEHICLE_MIN_ZOOM && !showing) return;
      moveTimer = setTimeout(refresh, 250);
    });

    return () => {
      clearTimeout(timer);
      clearTimeout(moveTimer);
      cancelAnimationFrame(frame);
      cancelAnimationFrame(selectedFrame);
      controller?.abort();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Swap the base map between light and dark; our layers are re-added on 'style.load'.
  useEffect(() => {
    if (state.current.theme === theme) return;
    state.current.theme = theme;
    mapRef.current?.setStyle(STYLES[theme], { diff: false });
  }, [theme]);

  // Show only the chosen kinds of vehicle and lines, leaving out the tapped one, which is drawn separately.
  useEffect(() => {
    Object.assign(state.current, { modes, lines, selectedId });
    const map = mapRef.current;
    if (!map?.getLayer('vehicle-dots')) return;
    const filter = vehicleFilter(modes, lines, selectedId);
    map.setFilter('vehicle-dots', filter);
    map.setFilter('vehicle-labels', filter);
    map.setFilter('vehicle-arrows', ['all', ['get', 'hasBearing'], filter]);
  }, [modes, lines, selectedId]);

  useEffect(() => {
    state.current.routeLine = routeLine;
    const line = routeLineData(routeLine);
    (mapRef.current?.getSource('route-lines') as GeoJSONSource | undefined)?.setData(line.path);
    (mapRef.current?.getSource('route-stops') as GeoJSONSource | undefined)?.setData(line.stops);
  }, [routeLine]);

  // Show the whole of a line opened on its own, in the part of the map the panel doesn't cover.
  useEffect(() => {
    const map = mapRef.current;
    const points = focusLine?.paths.flat() ?? [];
    if (!map || !points.length) return;
    const [west, south, east, north] = points.reduce(
      (b, [lon, lat]) => [Math.min(b[0], lon), Math.min(b[1], lat), Math.max(b[2], lon), Math.max(b[3], lat)],
      [Infinity, Infinity, -Infinity, -Infinity],
    );
    const c = map.getContainer().getBoundingClientRect();
    const p = props.panelRef.current?.getBoundingClientRect();
    const sheet = p && p.width >= c.width - 1;
    const camera = map.cameraForBounds(
      [
        [west, south],
        [east, north],
      ],
      {
        padding: {
          top: 80,
          right: 40,
          bottom: sheet ? Math.max(40, c.bottom - p.top + 20) : 40,
          left: p && !sheet ? Math.max(40, p.right - c.left + 20) : 40,
        },
        maxZoom: 14,
      },
    );
    // Long lines don't fit on a phone at a zoom where vehicles show; stay close enough to see them.
    if (camera) map.easeTo({ ...camera, zoom: Math.max(camera.zoom ?? VEHICLE_MIN_ZOOM, VEHICLE_MIN_ZOOM + 0.5), duration: 600 });
  }, [focusLine]);

  useEffect(() => {
    state.current.otherLines = otherLines;
    (mapRef.current?.getSource('other-lines') as GeoJSONSource | undefined)?.setData(linesData(otherLines));
    (mapRef.current?.getSource('other-stops') as GeoJSONSource | undefined)?.setData(otherStopsData(otherLines));
  }, [otherLines]);

  // Mark the picked station and bring it to the middle of the uncovered map.
  useEffect(() => {
    state.current.station = station;
    const map = mapRef.current;
    (map?.getSource('chosen-station') as GeoJSONSource | undefined)?.setData(stationData(station, stationColor(state.current)));
    if (!map || !station) return;
    map.easeTo({
      center: [station.lon, station.lat],
      zoom: Math.max(map.getZoom(), 14),
      offset: uncoveredOffset(map, props.panelRef.current),
      duration: 600,
    });
  }, [station]);

  // Start the tapped vehicle where its dot was, then glide toward each newer position.
  useEffect(() => {
    if (!selectedId) {
      glide.current = { start: 0 };
      state.current.selected = EMPTY;
      (mapRef.current?.getSource('selected-vehicle') as GeoJSONSource | undefined)?.setData(EMPTY);
      return;
    }
    const seen = state.current.latest.find((v) => v.id === selectedId);
    glide.current = { to: seen, start: performance.now() };
  }, [selectedId]);

  useEffect(() => {
    Object.assign(state.current, { detail });
    const map = mapRef.current;
    if (detail && detail.vehicle.id === selectedId) {
      const g = glide.current;
      const t = (performance.now() - g.start) / SELECTED_POLL_MS;
      const drawn = g.to && g.from ? interpolate(new Map([[g.to.id, g.from]]), [g.to], t)[0] : g.to;
      glide.current = { from: drawn, to: detail.vehicle, start: performance.now() };
    }
    if (!map?.getSource('selected-path')) return;
    map.setPaintProperty('route-lines', 'line-opacity', routeLineOpacity(detail));
    const selection = selectionData(detail);
    (map.getSource('selected-path') as GeoJSONSource).setData(selection.path);
    (map.getSource('selected-stops') as GeoJSONSource).setData(selection.stops);
  }, [detail, selectedId]);

  // While following, zoom around the vehicle rather than the pointer, and bring it to the middle.
  useEffect(() => {
    state.current.following = following;
    const map = mapRef.current;
    if (!map) return;
    const around = following ? { around: 'center' as const } : undefined;
    map.scrollZoom.enable(around);
    map.touchZoomRotate.enable(around);
    const pos = glide.current.to;
    if (following && pos) {
      state.current.easeUntil = performance.now() + 650;
      map.easeTo({ center: [pos.lon, pos.lat], offset: uncoveredOffset(map, props.panelRef.current), duration: 600 });
    }
  }, [following, selectedId]);

  return <div ref={container} className="map" />;
}

