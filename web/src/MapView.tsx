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
import { colorFor, interpolate, toFeatureCollection } from './vehicles';

// MapLibre finds its worker next to its own file, which bundlers move; point it at the bundled copy.
setWorkerUrl(workerUrl);

const STYLES: Record<Theme, string> = {
  light: import.meta.env.VITE_MAP_STYLE || 'https://tiles.openfreemap.org/styles/positron',
  dark: import.meta.env.VITE_MAP_STYLE_DARK || 'https://tiles.openfreemap.org/styles/dark',
};
/** Below this zoom (about the size of New York City on screen) vehicles are hidden and not fetched. */
export const VEHICLE_MIN_ZOOM = 10;
const POLL_MS = 5000;
const GLIDE_MS = 1000;
/** Redrawing every vehicle is the expensive part, so the glide runs at a modest frame rate. */
const GLIDE_FRAME_MS = 100;
/** Gliding is only visible up close; further out, dots jump once per update, which costs far less. */
const GLIDE_MIN_ZOOM = 13;
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

export type MapInfo = { count: number; error?: string; zoomedOut?: boolean };

interface Props {
  theme: Theme;
  modes: Mode[];
  selectedId: string | null;
  detail: VehicleDetail | null;
  onSelect: (id: string | null) => void;
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

function modeFilter(modes: Mode[]): ExpressionSpecification {
  return ['in', ['get', 'mode'], ['literal', modes]];
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

/** Adds our sources and layers. Runs again whenever the base map style is swapped for the other theme. */
function installLayers(
  map: MapLibreMap,
  theme: Theme,
  state: { vehicles: GeoJSON.FeatureCollection; modes: Mode[]; selectedId: string | null; detail: VehicleDetail | null },
) {
  const outline = theme === 'dark' ? '#111827' : '#ffffff';
  const ring = theme === 'dark' ? '#f9fafb' : '#111827';
  const filter = modeFilter(state.modes);
  const selection = selectionData(state.detail);

  if (!map.hasImage('arrow')) map.addImage('arrow', arrowImage(), { sdf: true });
  // Points don't need detailed tiles, so tile only up to zoom 12 and let MapLibre overzoom from there.
  // That keeps the work done on every update small, which is what made zooming laggy.
  map.addSource('vehicles', { type: 'geojson', data: state.vehicles, maxzoom: 12, buffer: 32 });
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
  map.addLayer({
    id: 'vehicle-arrows',
    type: 'symbol',
    source: 'vehicles',
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
    id: 'vehicle-dots',
    type: 'circle',
    source: 'vehicles',
    minzoom: VEHICLE_MIN_ZOOM,
    filter,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], VEHICLE_MIN_ZOOM, 2.5, 11, 3.5, 13, 6, 16, 13],
      'circle-color': ['get', 'color'],
      'circle-stroke-color': outline,
      'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 10, 0.5, 13, 1.5],
    },
  });
  map.addLayer({
    id: 'vehicle-labels',
    type: 'symbol',
    source: 'vehicles',
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
  map.addLayer({
    id: 'vehicle-selected',
    type: 'circle',
    source: 'vehicles',
    minzoom: VEHICLE_MIN_ZOOM,
    filter: ['==', ['get', 'id'], state.selectedId ?? ''],
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], VEHICLE_MIN_ZOOM, 7, 13, 11, 16, 19],
      'circle-color': 'transparent',
      'circle-stroke-color': ring,
      'circle-stroke-width': 2.5,
    },
  });
}

export function MapView({ theme, modes, selectedId, detail, onSelect, onUpdate }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const callbacks = useRef({ onSelect, onUpdate });
  callbacks.current = { onSelect, onUpdate };
  // Everything the layers need, kept here so they can be rebuilt after a style swap.
  const state = useRef({ theme, vehicles: EMPTY, modes, selectedId, detail });

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
      const t = (time - glideStart) / GLIDE_MS;
      // Hold still while the map is being moved, so the zoom or pan itself stays smooth.
      if (t >= 1 || (!map.isMoving() && time - lastFrame >= GLIDE_FRAME_MS)) {
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
      try {
        // Only what's on screen; anything off screen is left alone until it scrolls into view.
        const { vehicles } = await fetchVehicles(boundsOf(map), controller.signal);
        showing = true;
        // Glide from wherever the dots are drawn right now.
        const now = performance.now();
        shown = new Map(interpolate(shown, target, (now - glideStart) / GLIDE_MS).map((v) => [v.id, v]));
        target = vehicles;
        glideStart = now;
        cancelAnimationFrame(frame);
        if (map.getZoom() >= GLIDE_MIN_ZOOM) frame = requestAnimationFrame(draw);
        else {
          glideStart = -Infinity;
          shown = new Map(vehicles.map((v) => [v.id, v]));
          setVehicles(vehicles);
        }
        callbacks.current.onUpdate({ count: vehicles.length });
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        callbacks.current.onUpdate({ count: target.length, error: "Can't reach the live data server" });
      }
      timer = setTimeout(refresh, POLL_MS);
    };

    let started = false;
    map.on('style.load', () => {
      installLayers(map, state.current.theme, state.current);
      if (!started) {
        started = true;
        void refresh();
      }
    });

    const clickable = ['vehicle-dots', 'vehicle-labels', 'vehicle-arrows'];
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

    // Load the new view once the map settles.
    let moveTimer: ReturnType<typeof setTimeout> | undefined;
    map.on('moveend', () => {
      clearTimeout(moveTimer);
      if (map.getZoom() < VEHICLE_MIN_ZOOM && !showing) return;
      moveTimer = setTimeout(refresh, 250);
    });

    return () => {
      clearTimeout(timer);
      clearTimeout(moveTimer);
      cancelAnimationFrame(frame);
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

  // Show only the chosen kinds of vehicle.
  useEffect(() => {
    state.current.modes = modes;
    const map = mapRef.current;
    if (!map?.getLayer('vehicle-dots')) return;
    const filter = modeFilter(modes);
    map.setFilter('vehicle-dots', filter);
    map.setFilter('vehicle-labels', filter);
    map.setFilter('vehicle-arrows', ['all', ['get', 'hasBearing'], filter]);
  }, [modes]);

  // Highlight the tapped vehicle and draw the route ahead of it.
  useEffect(() => {
    Object.assign(state.current, { selectedId, detail });
    const map = mapRef.current;
    if (!map?.getLayer('vehicle-selected')) return;
    const selection = selectionData(detail);
    map.setFilter('vehicle-selected', ['==', ['get', 'id'], selectedId ?? '']);
    (map.getSource('selected-path') as GeoJSONSource).setData(selection.path);
    (map.getSource('selected-stops') as GeoJSONSource).setData(selection.stops);
  }, [selectedId, detail]);

  return <div ref={container} className="map" />;
}
