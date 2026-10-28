import { createServer, type Server } from 'node:http';
import type { Bbox, VehicleStore } from './store.js';

function parseBbox(value: string | null): Bbox | null | 'invalid' {
  if (!value) return null;
  const parts = value.split(',').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return 'invalid';
  return parts as Bbox;
}

export function createApiServer(store: VehicleStore, now = () => Date.now() / 1000): Server {
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

    if (req.method !== 'GET') return send(405, { error: 'GET only' });

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

    if (url.pathname === '/api/health') return send(200, { feeds: store.status() });

    send(404, { error: 'not found' });
  });
}
