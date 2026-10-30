import { readFile } from 'node:fs/promises';
import { createServer, type Server, type ServerResponse } from 'node:http';
import path from 'node:path';
import type { AlertStore } from './alerts.js';
import type { Mode } from './feeds.js';
import type { Bbox, VehicleStore } from './store.js';

/** The built map (`npm run build` in web/), served alongside the API so the whole site is one service. */
const WEB_DIR = path.resolve(import.meta.dirname, '../../web/dist');

/**
 * How long a new server says it isn't ready while it loads schedules. Render sends no traffic to a new
 * deploy until it is ready, so the old one keeps serving instead of the two taking turns, which made
 * trains blink in and out. Past this it says ready anyway, so a slow load never fails the deploy.
 */
const READY_WAIT_MS = 10 * 60 * 1000;

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  // MapLibre's worker. Browsers refuse to start a module worker served with any other type.
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

async function sendFile(res: ServerResponse, webDir: string, pathname: string): Promise<void> {
  const index = path.join(webDir, 'index.html');
  const requested = path.join(webDir, pathname);
  // Paths that aren't a file get the map page, so links like /?theme=dark work.
  let file = requested.startsWith(webDir + path.sep) ? requested : index;
  let data = await readFile(file).catch(() => null);
  if (!data && file !== index) data = await readFile((file = index)).catch(() => null);
  if (!data) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('The map is not built yet. Run npm run build in web/.');
    return;
  }
  res.writeHead(200, {
    'content-type': CONTENT_TYPES[path.extname(file)] ?? 'application/octet-stream',
    // Vite puts a hash in every file name under assets/, so those never change.
    'cache-control': file.startsWith(path.join(webDir, 'assets') + path.sep) ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  res.end(data);
}

/** Enough for any filter someone would set by hand, while keeping one request from asking for every line. */
const MAX_ROUTE_LINES = 60;

function parseBbox(value: string | null): Bbox | null | 'invalid' {
  if (!value) return null;
  const parts = value.split(',').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return 'invalid';
  return parts as Bbox;
}

export function createApiServer(
  store: VehicleStore,
  now = () => Date.now() / 1000,
  webDir = WEB_DIR,
  alerts?: AlertStore,
): Server {
  const started = Date.now();
  return createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const send = (status: number, body: unknown) => {
      res.writeHead(status, {
        'content-type': 'application/json',
        'access-control-allow-origin': '*',
        'cache-control': 'no-store',
      });
      res.end(JSON.stringify(body));
    };

    if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, { error: 'GET only' });

    if (url.pathname === '/api/vehicles') {
      const bbox = parseBbox(url.searchParams.get('bbox'));
      if (bbox === 'invalid') return send(400, { error: 'bbox must be west,south,east,north' });
      const modes = url.searchParams.get('mode')?.split(',');
      const vehicles = store.vehicles(now(), bbox ?? undefined).filter((v) => !modes || modes.includes(v.mode));
      return send(200, { updatedAt: new Date().toISOString(), count: vehicles.length, vehicles });
    }

    const detail = url.pathname.match(/^\/api\/vehicles\/(.+)$/);
    if (detail) {
      const found = store.detail(decodeURIComponent(detail[1]), now());
      return found ? send(200, found) : send(404, { error: 'vehicle not found' });
    }

    if (url.pathname === '/api/routes') return send(200, { routes: store.routes() });

    if (url.pathname === '/api/route-lines') {
      const keys = (url.searchParams.get('keys') ?? '').split(',').filter(Boolean);
      if (keys.length > MAX_ROUTE_LINES) return send(400, { error: `at most ${MAX_ROUTE_LINES} lines at once` });
      return send(200, { lines: store.routeLines(keys) });
    }

    if (url.pathname === '/api/route-paths') {
      // Buses are left out: hundreds of routes would cover the map.
      const modes = (url.searchParams.get('modes') ?? 'subway,rail').split(',').filter((m): m is Mode => m === 'subway' || m === 'rail');
      return send(200, { lines: store.routePaths(modes) });
    }

    if (url.pathname === '/api/arrivals') {
      const line = url.searchParams.get('line');
      const lat = Number(url.searchParams.get('lat'));
      const lon = Number(url.searchParams.get('lon'));
      if (!line || !url.searchParams.get('lat') || !url.searchParams.get('lon') || !Number.isFinite(lat) || !Number.isFinite(lon)) {
        return send(400, { error: 'line, lat and lon are required' });
      }
      return send(200, { directions: store.arrivals(line, { lat, lon }, now()) });
    }

    if (url.pathname === '/api/line-vehicles') {
      const line = url.searchParams.get('line');
      if (!line) return send(400, { error: 'line is required' });
      return send(200, { vehicles: store.lineVehicles(line, now()) });
    }

    if (url.pathname === '/api/line-counts') return send(200, { lines: store.lineCounts(now()) });

    if (url.pathname === '/api/alerts') {
      if (!alerts) return send(200, { lines: {}, alerts: [] });
      const keys = (url.searchParams.get('lines') ?? '').split(',').filter(Boolean);
      if (keys.length > MAX_ROUTE_LINES) return send(400, { error: `at most ${MAX_ROUTE_LINES} lines at once` });
      // With no lines asked for, just which lines have trouble now; the details are asked for per line.
      return keys.length ? send(200, { alerts: alerts.forLines(keys, now()) }) : send(200, { lines: alerts.summary(now()) });
    }

    if (url.pathname === '/api/health') {
      const alertStatus = alerts && { updatedAt: alerts.updatedAt, lastError: alerts.lastError };
      const ready = store.ready() || Date.now() - started > READY_WAIT_MS;
      return send(ready ? 200 : 503, { ready, feeds: store.status(), ...(alertStatus && { alerts: alertStatus }) });
    }

    if (url.pathname.startsWith('/api/')) return send(404, { error: 'not found' });

    sendFile(res, webDir, url.pathname).catch(() => send(500, { error: 'could not read the map files' }));
  });
}
