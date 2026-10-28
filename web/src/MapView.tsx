import {
  GeolocateControl,
  Map as MapLibreMap,
  NavigationControl,
  type FilterSpecification,
  setWorkerUrl,
  type GeoJSONSource,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { useEffect, useRef } from 'react';
import { fetchVehicles, type Bounds, type Mode, type Vehicle, type VehicleDetail } from './api';
import { colorFor, interpolate, toFeatureCollection } from './vehicles';

// MapLibre finds its worker next to its own file, which bundlers move; point it at the bundled copy.
setWorkerUrl(workerUrl);

const STYLE = import.meta.env.VITE_MAP_STYLE || 'https://tiles.openfreemap.org/styles/positron';
const POLL_MS = 5000;
const GLIDE_MS = 1000;
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

interface Props {
  modes: Mode[];
  selectedId: string | null;
  detail: VehicleDetail | null;
  onSelect: (id: string | null) => void;
  onUpdate: (info: { count: number; error?: string }) => void;
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

export function MapView({ modes, selectedId, detail, onSelect, onUpdate }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const callbacks = useRef({ onSelect, onUpdate });
  callbacks.current = { onSelect, onUpdate };

  useEffect(() => {
    const map = new MapLibreMap({
      container: container.current!,
      style: STYLE,
      center: [-73.97, 40.73],
      zoom: 11,
      minZoom: 5,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(new NavigationControl({ showCompass: true }), 'top-right');
    map.addControl(new GeolocateControl({ trackUserLocation: true }), 'top-right');

    let shown = new Map<string, Vehicle>();
    let target: Vehicle[] = [];
    let glideStart = 0;
    let frame = 0;
    let controller: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const draw = () => {
      const t = (performance.now() - glideStart) / GLIDE_MS;
      const now = interpolate(shown, target, t);
      (map.getSource('vehicles') as GeoJSONSource | undefined)?.setData(toFeatureCollection(now));
      if (t < 1) frame = requestAnimationFrame(draw);
      else shown = new Map(target.map((v) => [v.id, v]));
    };

    const refresh = async () => {
      clearTimeout(timer);
      controller?.abort();
      controller = new AbortController();
      try {
        const { vehicles } = await fetchVehicles(boundsOf(map), controller.signal);
        // Glide from wherever the dots are drawn right now.
        const t = (performance.now() - glideStart) / GLIDE_MS;
        shown = new Map(interpolate(shown, target, t).map((v) => [v.id, v]));
        target = vehicles;
        glideStart = performance.now();
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(draw);
        callbacks.current.onUpdate({ count: vehicles.length });
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        callbacks.current.onUpdate({ count: target.length, error: "Can't reach the live data server" });
      }
      timer = setTimeout(refresh, POLL_MS);
    };

    map.on('load', () => {
      map.addImage('arrow', arrowImage(), { sdf: true });
      map.addSource('vehicles', { type: 'geojson', data: EMPTY });
      map.addSource('selected-path', { type: 'geojson', data: EMPTY });
      map.addSource('selected-stops', { type: 'geojson', data: EMPTY });

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
          'circle-color': '#fff',
          'circle-stroke-color': ['get', 'color'],
          'circle-stroke-width': 2,
        },
      });
      map.addLayer({
        id: 'vehicle-arrows',
        type: 'symbol',
        source: 'vehicles',
        minzoom: 13,
        filter: ['get', 'hasBearing'],
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
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, 1.5, 11, 3.5, 13, 6, 16, 13],
          'circle-color': ['get', 'color'],
          'circle-stroke-color': '#fff',
          'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 10, 0, 13, 1.5],
        },
      });
      map.addLayer({
        id: 'vehicle-labels',
        type: 'symbol',
        source: 'vehicles',
        minzoom: 14,
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
        filter: ['==', ['get', 'id'], ''],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, 6, 13, 11, 16, 19],
          'circle-color': 'transparent',
          'circle-stroke-color': '#111827',
          'circle-stroke-width': 2.5,
        },
      });

      void refresh();
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

    let moveTimer: ReturnType<typeof setTimeout> | undefined;
    map.on('moveend', () => {
      clearTimeout(moveTimer);
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

  // Show only the chosen kinds of vehicle.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const filter: FilterSpecification = ['in', ['get', 'mode'], ['literal', modes]];
      map.setFilter('vehicle-dots', filter);
      map.setFilter('vehicle-labels', filter);
      map.setFilter('vehicle-arrows', ['all', ['get', 'hasBearing'], filter]);
    };
    if (map.getLayer('vehicle-dots')) apply();
    else map.once('load', apply);
  }, [modes]);

  // Highlight the tapped vehicle and draw the route ahead of it.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      map.setFilter('vehicle-selected', ['==', ['get', 'id'], selectedId ?? '']);
      const color = detail ? colorFor(detail.vehicle) : '#000';
      const path: GeoJSON.FeatureCollection =
        detail && detail.path.length > 1
          ? {
              type: 'FeatureCollection',
              features: [
                { type: 'Feature', geometry: { type: 'LineString', coordinates: detail.path }, properties: { color } },
              ],
            }
          : EMPTY;
      const stops: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: (detail?.upcoming ?? [])
          .filter((s) => s.lat !== undefined && s.lon !== undefined)
          .map((s) => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [s.lon!, s.lat!] },
            properties: { color, name: s.name ?? '' },
          })),
      };
      (map.getSource('selected-path') as GeoJSONSource).setData(path);
      (map.getSource('selected-stops') as GeoJSONSource).setData(stops);
    };
    if (map.getSource('selected-path')) apply();
    else map.once('load', apply);
  }, [selectedId, detail]);

  return <div ref={container} className="map" />;
}
