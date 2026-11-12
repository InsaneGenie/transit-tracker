import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { get } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { pickEncoding } from '../src/compress.js';
import { createApiServer } from '../src/server.js';
import { VehicleStore } from '../src/store.js';

/** A raw request, so the test sees the bytes as sent rather than as a client unpacks them. */
function raw(url: string, acceptEncoding?: string): Promise<{ headers: Record<string, unknown>; body: Buffer }> {
  return new Promise((resolve, reject) => {
    get(url, { headers: acceptEncoding ? { 'accept-encoding': acceptEncoding } : {} }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ headers: res.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}

describe('compression', () => {
  it('picks brotli, then gzip, from what the client accepts', () => {
    expect(pickEncoding('gzip, deflate, br')).toBe('br');
    expect(pickEncoding('gzip, deflate')).toBe('gzip');
    expect(pickEncoding('br;q=0, gzip')).toBe('gzip');
    expect(pickEncoding('*')).toBe('br');
    expect(pickEncoding('identity')).toBeNull();
    expect(pickEncoding(undefined)).toBeNull();
  });

  it('sends files and live data compressed, and plain to clients that ask for that', async () => {
    const webDir = await mkdtemp(path.join(tmpdir(), 'web-'));
    await mkdir(path.join(webDir, 'assets'));
    const script = 'run();'.repeat(1000);
    await writeFile(path.join(webDir, 'index.html'), '<title>map</title>');
    await writeFile(path.join(webDir, 'assets', 'app-1234.js'), script);
    // The build's own compressed copy is used as is.
    await writeFile(path.join(webDir, 'assets', 'app-1234.js.br'), 'prebuilt');
    await writeFile(path.join(webDir, 'og-image.png'), Buffer.alloc(4000));
    const server = createApiServer(new VehicleStore([]), () => 0, webDir).listen(0);
    const base = `http://localhost:${(server.address() as AddressInfo).port}`;
    try {
      const br = await raw(`${base}/assets/app-1234.js`, 'gzip, br');
      expect(br.headers['content-encoding']).toBe('br');
      expect(br.headers.vary).toBe('accept-encoding');
      expect(br.body.toString()).toBe('prebuilt');

      // Without a prebuilt copy, one is made.
      const gz = await raw(`${base}/assets/app-1234.js`, 'gzip');
      expect(gz.headers['content-encoding']).toBe('gzip');
      expect(gunzipSync(gz.body).toString()).toBe(script);
      expect(gz.body.length).toBeLessThan(script.length / 10);

      const plain = await raw(`${base}/assets/app-1234.js`);
      expect(plain.headers['content-encoding']).toBeUndefined();
      expect(plain.body.toString()).toBe(script);

      // Images are already compressed, but can be kept for a day.
      const image = await raw(`${base}/og-image.png`, 'br');
      expect(image.headers['content-encoding']).toBeUndefined();
      expect(image.headers['cache-control']).toBe('public, max-age=86400');

      // A tiny answer isn't worth compressing.
      const small = await raw(`${base}/api/route-paths`, 'br');
      expect(small.headers['content-encoding']).toBeUndefined();
      expect(JSON.parse(small.body.toString())).toEqual({ lines: [] });
    } finally {
      server.close();
    }
  });
});
