import { execFileSync } from 'node:child_process';
import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createSecureServer } from 'node:http2';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TrackDetail, TrackProps } from '../../web/src/tracking.js';
import {
  ACTIVITY_NAME,
  apnsConfigFromEnv,
  apnsJwt,
  apnsSender,
  LiveActivityPusher,
  parseRegistration,
  type PushSender,
} from '../src/liveActivities.js';
import { createApiServer } from '../src/server.js';
import { VehicleStore } from '../src/store.js';

const NOW = 1_800_000_000_000;
const TOKEN = 'ab'.repeat(32);

const stop = { stopId: 'C', name: 'Chambers St', lat: 40.7, lon: -74.0 };
const badge = { line: '1', color: '#ee352e', textColor: '#ffffff' };
const signUp = { token: TOKEN, vehicleId: 'v1', stop, badge, startedAt: NOW - 60_000 };

/** A train two stops from Chambers St, due in `inS` seconds. */
function train(upcoming: TrackDetail['upcoming'], status?: 'STOPPED_AT' | 'IN_TRANSIT_TO', stopId?: string): TrackDetail {
  return {
    vehicle: { id: 'v1', mode: 'subway', status, stopId, stopName: stopId, lat: 40.75, lon: -73.99, source: 'estimated' },
    upcoming,
  };
}

function setup(initial: TrackDetail | null) {
  let now = NOW;
  let detail = initial;
  const sent: { token: string; payload: any; priority: number }[] = [];
  let reply = { status: 200 } as { status: number; reason?: string };
  const send: PushSender = async (token, payload, priority) => {
    sent.push({ token, payload, priority });
    return reply;
  };
  const pusher = new LiveActivityPusher({ detail: () => detail }, send, () => now);
  return {
    pusher,
    sent,
    props: (i: number): TrackProps => JSON.parse(sent[i].payload.aps['content-state'].props),
    set: (d: TrackDetail | null) => (detail = d),
    advance: (ms: number) => (now += ms),
    reply: (r: { status: number; reason?: string }) => (reply = r),
  };
}

const ahead = (inS: number) => [
  { stopId: 'A', name: 'Canal St', time: NOW / 1000 + inS - 120 },
  { stopId: 'B', name: 'Franklin St', time: NOW / 1000 + inS - 60 },
  { stopId: 'C', name: 'Chambers St', time: NOW / 1000 + inS, lat: 40.7, lon: -74.0 },
];

describe('parseRegistration', () => {
  it('accepts a sign-up from the app', () => {
    expect(parseRegistration(signUp, NOW)).toEqual({ ...signUp, token: TOKEN });
  });

  it('refuses bad tokens, stops and colors', () => {
    expect(parseRegistration(null, NOW)).toBeTypeOf('string');
    expect(parseRegistration({ ...signUp, token: 'not hex' }, NOW)).toMatch(/token/);
    expect(parseRegistration({ ...signUp, stop: { stopId: 'C' } }, NOW)).toMatch(/stop/);
    expect(parseRegistration({ ...signUp, badge: { ...badge, color: 'red' } }, NOW)).toMatch(/badge/);
  });

  it('keeps start times from the future out', () => {
    const r = parseRegistration({ ...signUp, startedAt: NOW + 1e9 }, NOW);
    expect(typeof r !== 'string' && r.startedAt).toBe(NOW);
  });
});

describe('apnsConfigFromEnv', () => {
  it('is off until the key, key id and team id are all set', () => {
    expect(apnsConfigFromEnv({ APNS_KEY: 'x', APNS_KEY_ID: 'K' })).toBeNull();
    expect(apnsConfigFromEnv({ APNS_KEY: 'a\\nb', APNS_KEY_ID: 'K', APNS_TEAM_ID: 'T' })).toEqual({
      key: 'a\nb',
      keyId: 'K',
      teamId: 'T',
      topic: undefined,
      host: undefined,
    });
  });
});

describe('apnsJwt', () => {
  it('signs a token Apple can check with the public key', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const jwt = apnsJwt(privateKey, 'KEY123', 'TEAM456', NOW);
    const [h, c, s] = jwt.split('.');
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual({ alg: 'ES256', kid: 'KEY123' });
    expect(JSON.parse(Buffer.from(c, 'base64url').toString())).toEqual({ iss: 'TEAM456', iat: NOW / 1000 });
    const ok = verify('sha256', Buffer.from(`${h}.${c}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'));
    expect(ok).toBe(true);
  });
});

describe('LiveActivityPusher', () => {
  it('pushes only when something worth showing changes', async () => {
    const t = setup(train(ahead(180), 'IN_TRANSIT_TO', 'A'));
    expect(t.pusher.register(signUp)).toBe(true);
    await t.pusher.tick();
    expect(t.sent).toHaveLength(0);

    // A few seconds' drift is left to the Lock Screen's countdown.
    t.advance(15_000);
    t.set(train(ahead(170), 'IN_TRANSIT_TO', 'A'));
    await t.pusher.tick();
    expect(t.sent).toHaveLength(0);

    // One stop closer is worth a push.
    t.set(train(ahead(160).slice(1), 'IN_TRANSIT_TO', 'B'));
    await t.pusher.tick();
    expect(t.sent).toHaveLength(1);
    const { aps } = t.sent[0].payload;
    expect(aps.event).toBe('update');
    expect(aps['content-state'].name).toBe(ACTIVITY_NAME);
    expect(aps['stale-date']).toBeGreaterThan(aps.timestamp);
    expect(t.props(0)).toMatchObject({ line: '1', stop: 'Chambers St', stopsAway: 1, where: 'Heading to Franklin St', phase: 'coming' });
    expect(t.sent[0].priority).toBe(10);
  });

  it('ends the Live Activity once the train has left the station', async () => {
    const t = setup(train(ahead(60).slice(2), 'IN_TRANSIT_TO', 'C'));
    t.pusher.register(signUp);
    t.advance(30_000);
    t.set(train(ahead(30).slice(2), 'STOPPED_AT', 'C'));
    await t.pusher.tick();
    expect(t.props(0).phase).toBe('arrived');

    t.advance(60_000);
    t.set(train([{ stopId: 'D', name: 'Cortlandt St', time: NOW / 1000 + 200 }], 'IN_TRANSIT_TO', 'D'));
    await t.pusher.tick();
    expect(t.sent[1].payload.aps.event).toBe('end');
    expect(t.sent[1].payload.aps['dismissal-date']).toBeGreaterThan(t.sent[1].payload.aps.timestamp);
    expect(t.props(1).phase).toBe('gone');
    expect(t.pusher.count).toBe(0);
    // Each push is newer than the one before, or Apple ignores it.
    expect(t.sent[1].payload.aps.timestamp).toBeGreaterThan(t.sent[0].payload.aps.timestamp);
  });

  it('gives up on a vehicle the feeds stop reporting', async () => {
    const t = setup(train(ahead(600), 'IN_TRANSIT_TO', 'A'));
    t.pusher.register(signUp);
    t.set(null);
    t.advance(60_000);
    await t.pusher.tick();
    expect(t.sent).toHaveLength(0);
    t.advance(3 * 60_000);
    await t.pusher.tick();
    expect(t.sent[0].payload.aps.event).toBe('end');
    expect(t.props(0).phase).toBe('lost');
    expect(t.pusher.count).toBe(0);
  });

  it('forgets Live Activities Apple says are over', async () => {
    const t = setup(train(ahead(600), 'IN_TRANSIT_TO', 'A'));
    t.pusher.register(signUp);
    t.reply({ status: 410, reason: 'ExpiredToken' });
    t.set(train(ahead(500).slice(1), 'IN_TRANSIT_TO', 'B'));
    await t.pusher.tick();
    expect(t.pusher.count).toBe(0);
  });

  it('keeps trying after a failed push, and unregisters on request', async () => {
    const t = setup(train(ahead(600), 'IN_TRANSIT_TO', 'A'));
    t.pusher.register(signUp);
    t.reply({ status: 0, reason: 'request failed' });
    t.set(train(ahead(500).slice(1), 'IN_TRANSIT_TO', 'B'));
    await t.pusher.tick();
    t.reply({ status: 200 });
    await t.pusher.tick();
    expect(t.sent).toHaveLength(2);
    expect(t.pusher.unregister(TOKEN.toUpperCase())).toBe(true);
    expect(t.pusher.count).toBe(0);
  });

  it('does nothing without a push key', () => {
    const pusher = new LiveActivityPusher({ detail: () => null }, null);
    expect(pusher.enabled).toBe(false);
    expect(pusher.register(signUp)).toBe(false);
  });
});

describe('apnsSender', () => {
  it('posts the push to Apple with its headers and reads the answer', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'apns-'));
    const keyFile = path.join(dir, 'key.pem');
    const certFile = path.join(dir, 'cert.pem');
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes',
      '-keyout', keyFile, '-out', certFile, '-days', '1', '-subj', '/CN=localhost',
      '-addext', 'subjectAltName=DNS:localhost',
    ], { stdio: 'ignore' });
    const seen: { headers: Record<string, unknown>; body: any }[] = [];
    const apple = createSecureServer({ key: readFileSync(keyFile), cert: readFileSync(certFile) }, (req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        seen.push({ headers: req.headers, body: JSON.parse(Buffer.concat(chunks).toString()) });
        if (seen.length === 1) {
          res.writeHead(200);
          res.end();
        } else {
          res.writeHead(410, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ reason: 'Unregistered' }));
        }
      });
    });
    await new Promise<void>((resolve) => apple.listen(0, resolve));
    const { port } = apple.address() as AddressInfo;
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const send = apnsSender({ key: pem, keyId: 'K', teamId: 'T', host: `localhost:${port}` }, () => NOW, {
      ca: readFileSync(certFile),
    });
    try {
      expect(await send(TOKEN, { aps: { event: 'update' } }, 5)).toEqual({ status: 200, reason: undefined });
      expect(await send(TOKEN, { aps: { event: 'end' } }, 10)).toEqual({ status: 410, reason: 'Unregistered' });
      expect(seen[0].headers[':path']).toBe(`/3/device/${TOKEN}`);
      expect(seen[0].headers['apns-push-type']).toBe('liveactivity');
      expect(seen[0].headers['apns-topic']).toBe('com.insanegenie.nytransitlive.push-type.liveactivity');
      expect(seen[0].headers['apns-priority']).toBe('5');
      expect(String(seen[0].headers.authorization)).toMatch(/^bearer [\w-]+\.[\w-]+\.[\w-]+$/);
      expect(seen[0].body).toEqual({ aps: { event: 'update' } });
      expect(seen[1].headers['apns-priority']).toBe('10');
      // The public key matches the signature.
      const [h, c, s] = String(seen[0].headers.authorization).slice(7).split('.');
      expect(
        verify('sha256', Buffer.from(`${h}.${c}`), { key: createPublicKey(pem), dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')),
      ).toBe(true);
    } finally {
      apple.close();
    }
  });
});

describe('/api/live-activities', () => {
  it('signs a Live Activity up and off', async () => {
    const pusher = new LiveActivityPusher({ detail: () => null }, async () => ({ status: 200 }));
    const server = createApiServer(new VehicleStore([]), () => NOW / 1000, undefined, undefined, pusher).listen(0);
    const base = `http://localhost:${(server.address() as AddressInfo).port}/api/live-activities`;
    try {
      const ok = await fetch(base, { method: 'POST', body: JSON.stringify(signUp) });
      expect(await ok.json()).toEqual({ push: true });
      expect(pusher.count).toBe(1);
      const bad = await fetch(base, { method: 'POST', body: '{"token":"zz"}' });
      expect(bad.status).toBe(400);
      const tooBig = await fetch(base, { method: 'POST', body: 'x'.repeat(10_000) });
      expect(tooBig.status).toBe(400);
      expect((await fetch(`${base}/${TOKEN}`, { method: 'DELETE' })).status).toBe(200);
      expect(pusher.count).toBe(0);
      expect((await fetch(base)).status).toBe(405);
    } finally {
      server.close();
    }
  });

  it('says pushes are off when there is no key', async () => {
    const server = createApiServer(new VehicleStore([]), () => NOW / 1000).listen(0);
    const base = `http://localhost:${(server.address() as AddressInfo).port}/api/live-activities`;
    try {
      const res = await fetch(base, { method: 'POST', body: JSON.stringify(signUp) });
      expect(await res.json()).toEqual({ push: false });
    } finally {
      server.close();
    }
  });
});

describe('LiveActivityPusher clean-up', () => {
  it('ends it a few minutes after the train reached the station, in case the feed is stuck', async () => {
    const t = setup(train(ahead(10).slice(2), 'STOPPED_AT', 'C'));
    t.pusher.register(signUp);
    // Its time there has passed, but it is still standing at the station.
    t.set(train([{ stopId: 'D', name: 'Cortlandt St', time: NOW / 1000 + 200 }], 'STOPPED_AT', 'C'));
    t.advance(15_000);
    await t.pusher.tick();
    expect(t.sent.at(-1)?.payload.aps.event ?? 'none').not.toBe('end');
    expect(t.pusher.count).toBe(1);
    t.advance(3 * 60_000);
    await t.pusher.tick();
    expect(t.sent.at(-1)!.payload.aps.event).toBe('end');
    expect(t.props(t.sent.length - 1).phase).toBe('arrived');
    expect(t.pusher.count).toBe(0);
  });

  it('drops a sign-up for a vehicle it never sees', async () => {
    let now = NOW;
    const sent: unknown[] = [];
    const pusher = new LiveActivityPusher({ detail: () => null }, async (...args) => (sent.push(args), { status: 200 }), () => now);
    pusher.register(signUp);
    now += 4 * 60_000;
    await pusher.tick();
    expect(pusher.count).toBe(0);
    expect(sent).toHaveLength(0);
  });
});
