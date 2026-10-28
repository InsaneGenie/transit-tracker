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
import { useEffect, useRef } from 'react';
import { fetchVehicles, type Bounds, type Mode, type Vehicle, type VehicleDetail } from './api';
import type { Theme } from './theme';
import { colorFor, interpolate, routeKey, toFeatureCollection } from './vehicles';

// MapLibre finds its worker next to its own file, which bundlers move; point it at the bundled copy.
setWorkerUrl(workerUrl);

const STYLES: Record<Theme, string> = {
  light: import.meta.env.VITE_MAP_STYLE || 'https://tiles.openfreemap.org/styles/positron',
  dark: import.meta.env.VITE_MAP_STYLE_DARK || 'https://tiles.openfreemap.org/styles/dark',
};
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

interface Props {
  theme: Theme;
  modes: Mode[];
  /** Line keys to show; empty shows every line. */
  lines: string[];
  selectedId: string | null;
  detail: VehicleDetail | null;
  following: boolean;
  onSelect: (id: string | null) => void;
  onFollowChange: (following: boolean) => void;
  onUpdate: (info: MapInfo) => void;
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
    stops: {
      type: 'FeatureCollection',
      features: detail.upcoming
        .filter((s) => s.lat !== undefined && s.lon !== undefined)
        .map((s) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [s.lon!, s.lat!] },
          properties: { color, name: s.name ?? '' },
        })),
    },
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
  map.addSource('selected-path', { type: 'geojson', data: selection.path });
  map.addSource('selected-stops', { type: 'geojson', data: selection.stops });

  map.addLayer({
    id: 'selected-path',
    type: 'line',
    source: 'selected-path',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': ['get', 'color'], 'line-width': 5, 'line-opacity': 0.75 },
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
}

export function MapView(props: Props) {
  const { theme, modes, lines, selectedId, detail, following } = props;
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const callbacks = useRef(props);
  callbacks.current = props;
  // Everything the layers need, kept here so they can be rebuilt after a style swap.
  const state = useRef<LayerState & { theme: Theme; following: boolean; latest: Vehicle[]; easeUntil: number }>({
    theme,
    vehicles: EMPTY,
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
        if (state.current.following && !map.isZooming() && performance.now() > state.current.easeUntil) map.setCenter([pos.lon, pos.lat]);
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
      const hit = map.queryRenderedFeatures(
        [
          [e.point.x - pad, e.point.y - pad],
          [e.point.x + pad, e.point.y + pad],
        ],
        { layers: clickable },
      )[0];
      callbacks.current.onSelect(hit ? String(hit.properties.id) : null);
    });
    for (const layer of clickable) {
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
      map.easeTo({ center: [pos.lon, pos.lat], duration: 600 });
    }
  }, [following, selectedId]);

  return <div ref={container} className="map" />;
}

