import { createPrivateKey, sign, type KeyObject } from 'node:crypto';
import { connect, type ClientHttp2Session, type SecureClientSessionOptions } from 'node:http2';
import { tidyStopName } from '../../web/src/names.js';
import {
  ARRIVED_FOR_MS,
  isOver,
  staleAfter,
  trackChanged,
  trackProps,
  type TrackDetail,
  type TrackProps,
  type TrackStop,
} from '../../web/src/tracking.js';

/**
 * Keeps the iPhone app's Live Activities (a train or bus followed on the Lock Screen) up to date while
 * the app is closed, by sending Apple push notifications with fresh content. The app tells the server
 * which vehicle each one follows; nothing is stored on disk, so after a restart the app tells it again
 * the next time it opens, and in between the Lock Screen keeps counting down on its own.
 *
 * Pushing needs an Apple Push Notifications key: APNS_KEY (the .p8 file's text), APNS_KEY_ID and
 * APNS_TEAM_ID. Without them the server says so and the app keeps the Live Activity updated itself.
 */

/** The name the app gives its Live Activity in `createLiveActivity`; pushes must name it too. */
export const ACTIVITY_NAME = 'TrackVehicle';

/** The app's bundle id. Live Activity pushes go to "<bundle id>.push-type.liveactivity". */
const DEFAULT_TOPIC = 'com.insanegenie.nytransitlive';

/** How often each followed vehicle is looked at. */
const TICK_MS = 15_000;
/** The most followed at once, so a flood of sign-ups can't run the server out of memory. */
const MAX_ACTIVITIES = 1000;
/** Following ends after this long, well past any one trip to a station. */
const MAX_AGE_MS = 3 * 60 * 60 * 1000;
/** A vehicle missing from the feeds this long is given up on. */
const LOST_AFTER_MS = 3 * 60 * 1000;
/** Apple wants a fresh sign-in token at most every 20 minutes and at least every hour. */
const TOKEN_AGE_MS = 40 * 60 * 1000;

export interface Badge {
  line: string;
  color: string;
  textColor: string;
}

export interface Registration {
  /** The Live Activity's push token, in hex. */
  token: string;
  vehicleId: string;
  stop: TrackStop;
  badge: Badge;
  startedAt: number;
}

interface Followed extends Registration {
  last: TrackProps | null;
  /** When the vehicle was last in the feeds. */
  seenAt: number;
  /** Apple drops pushes whose timestamp is not newer than the last one's. */
  lastPushSeconds: number;
  /** When it was first seen standing at the station. */
  arrivedAt?: number;
}

/** Sends one push to Apple. Returns the HTTP status and Apple's reason when it failed. */
export type PushSender = (
  token: string,
  payload: object,
  priority: 5 | 10,
) => Promise<{ status: number; reason?: string }>;

export interface ApnsConfig {
  key: string;
  keyId: string;
  teamId: string;
  topic?: string;
  /** api.push.apple.com, or api.sandbox.push.apple.com for development builds. */
  host?: string;
}

/** The push settings from the environment, or null when they are not set. */
export function apnsConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ApnsConfig | null {
  const key = env.APNS_KEY?.trim();
  const keyId = env.APNS_KEY_ID?.trim();
  const teamId = env.APNS_TEAM_ID?.trim();
  if (!key || !keyId || !teamId) return null;
  return {
    // Hosting dashboards often keep the key on one line with \n written out.
    key: key.replace(/\\n/g, '\n'),
    keyId,
    teamId,
    topic: env.APNS_TOPIC?.trim() || undefined,
    host: env.APNS_HOST?.trim() || undefined,
  };
}

const base64url = (data: Buffer | string) => Buffer.from(data).toString('base64url');

/** Apple's sign-in token: a JSON Web Token signed with the push key (ES256). */
export function apnsJwt(key: KeyObject, keyId: string, teamId: string, nowMs: number): string {
  const header = base64url(JSON.stringify({ alg: 'ES256', kid: keyId }));
  const claims = base64url(JSON.stringify({ iss: teamId, iat: Math.floor(nowMs / 1000) }));
  const signature = sign('sha256', Buffer.from(`${header}.${claims}`), { key, dsaEncoding: 'ieee-p1363' });
  return `${header}.${claims}.${base64url(signature)}`;
}

/** Sends pushes to Apple over one HTTP/2 connection, reconnecting when it drops. */
export function apnsSender(
  config: ApnsConfig,
  now = () => Date.now(),
  /** For tests, which talk to a stand-in for Apple. */
  connectOptions?: SecureClientSessionOptions,
): PushSender {
  const key = createPrivateKey(config.key);
  const origin = `https://${config.host ?? 'api.push.apple.com'}`;
  const topic = `${config.topic ?? DEFAULT_TOPIC}.push-type.liveactivity`;
  let session: ClientHttp2Session | null = null;
  let jwt = '';
  let jwtAt = 0;

  const open = () => {
    if (session && !session.closed && !session.destroyed) return session;
    const s = connect(origin, connectOptions);
    s.on('error', () => s.destroy());
    s.on('close', () => {
      if (session === s) session = null;
    });
    // An idle connection is closed rather than kept open forever.
    s.setTimeout(10 * 60 * 1000, () => s.close());
    session = s;
    return s;
  };

  return (token, payload, priority) =>
    new Promise((resolve) => {
      if (now() - jwtAt > TOKEN_AGE_MS) {
        jwt = apnsJwt(key, config.keyId, config.teamId, now());
        jwtAt = now();
      }
      const body = Buffer.from(JSON.stringify(payload));
      let req;
      try {
        req = open().request({
          ':method': 'POST',
          ':path': `/3/device/${token}`,
          authorization: `bearer ${jwt}`,
          'apns-push-type': 'liveactivity',
          'apns-topic': topic,
          'apns-priority': String(priority),
          'content-type': 'application/json',
          'content-length': body.length,
        });
      } catch {
        resolve({ status: 0, reason: 'connection failed' });
        return;
      }
      let status = 0;
      const chunks: Buffer[] = [];
      req.setTimeout(15_000, () => req.close());
      req.on('response', (headers) => (status = Number(headers[':status'] ?? 0)));
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('error', () => resolve({ status: 0, reason: 'request failed' }));
      req.on('close', () => {
        let reason: string | undefined;
        try {
          reason = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')).reason : undefined;
        } catch {
          reason = undefined;
        }
        resolve({ status, reason });
      });
      req.end(body);
    });
}

const HEX_TOKEN = /^[0-9a-f]{32,400}$/i;
const COLOR = /^#[0-9a-f]{6}$/i;

const text = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max;
const optionalNumber = (value: unknown): value is number | undefined =>
  value === undefined || (typeof value === 'number' && Number.isFinite(value));

/** Checks a sign-up from the app, returning it cleaned up, or why it was refused. */
export function parseRegistration(body: unknown, nowMs: number): Registration | string {
  if (!body || typeof body !== 'object') return 'expected a JSON object';
  const b = body as Record<string, any>;
  if (!text(b.token, 400) || !HEX_TOKEN.test(b.token)) return 'token must be the push token in hex';
  if (!text(b.vehicleId, 200)) return 'vehicleId is required';
  const stop = b.stop;
  if (!stop || !text(stop.stopId, 100) || !text(stop.name, 200) || !optionalNumber(stop.lat) || !optionalNumber(stop.lon)) {
    return 'stop needs a stopId and name';
  }
  const badge = b.badge;
  if (!badge || !text(badge.line, 60) || !text(badge.color, 7) || !COLOR.test(badge.color) || !text(badge.textColor, 7) || !COLOR.test(badge.textColor)) {
    return 'badge needs a line and #rrggbb colors';
  }
  const startedAt = typeof b.startedAt === 'number' && Number.isFinite(b.startedAt) ? Math.min(b.startedAt, nowMs) : nowMs;
  return {
    token: b.token.toLowerCase(),
    vehicleId: b.vehicleId,
    stop: { stopId: stop.stopId, name: stop.name, lat: stop.lat, lon: stop.lon },
    badge: { line: badge.line, color: badge.color, textColor: badge.textColor },
    startedAt,
  };
}

export interface VehicleSource {
  detail(id: string, nowSeconds: number): TrackDetail | null;
}

/** Follows the registered vehicles and pushes their Live Activities' content as it changes. */
export class LiveActivityPusher {
  private followed = new Map<string, Followed>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly store: VehicleSource,
    private readonly send: PushSender | null,
    private readonly now = () => Date.now(),
  ) {}

  /** Whether pushes are set up; without them the app updates its Live Activities itself. */
  get enabled(): boolean {
    return this.send !== null;
  }

  get count(): number {
    return this.followed.size;
  }

  /**
   * Starts (or restarts) following a vehicle for a Live Activity. Its first content isn't pushed: the
   * app has just drawn it.
   */
  register(r: Registration): boolean {
    if (!this.send) return false;
    const existing = this.followed.get(r.token);
    if (!existing && this.followed.size >= MAX_ACTIVITIES) return false;
    const now = this.now();
    const detail = this.store.detail(r.vehicleId, now / 1000);
    const last = detail ? trackProps(detail, r.stop, this.lineOf(r), r.startedAt, now) : (existing?.last ?? null);
    this.followed.set(r.token, {
      ...r,
      last,
      seenAt: now,
      lastPushSeconds: existing?.lastPushSeconds ?? 0,
    });
    return true;
  }

  unregister(token: string): boolean {
    return this.followed.delete(token.toLowerCase());
  }

  start(): void {
    if (this.timer || !this.send) return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private lineOf(r: Registration) {
    return { ...r.badge, tidy: tidyStopName };
  }

  /** Looks at every followed vehicle once and pushes what changed. */
  async tick(): Promise<void> {
    if (this.running || !this.send) return;
    this.running = true;
    try {
      for (const f of [...this.followed.values()]) await this.update(f);
    } finally {
      this.running = false;
    }
  }

  private async update(f: Followed): Promise<void> {
    const now = this.now();
    const detail = this.store.detail(f.vehicleId, now / 1000);
    let props: TrackProps | null;
    if (detail) {
      f.seenAt = now;
      props = trackProps(detail, f.stop, this.lineOf(f), f.startedAt, now);
    } else if (now - f.seenAt > LOST_AFTER_MS) {
      // Never seen since signing up (say, the server had just restarted): nothing to tell it, so just stop.
      if (!f.last) {
        this.followed.delete(f.token);
        return;
      }
      props = { ...f.last, phase: 'lost', updatedAt: now };
    } else {
      // Feeds drop vehicles for a poll or two; the countdown carries on meanwhile.
      return;
    }
    if (now - f.startedAt > MAX_AGE_MS && !isOver(props.phase)) props = { ...props, phase: 'lost' };
    f.arrivedAt = props.phase === 'arrived' ? (f.arrivedAt ?? now) : undefined;
    const done = isOver(props.phase) || (f.arrivedAt !== undefined && now - f.arrivedAt >= ARRIVED_FOR_MS);

    if (done) {
      await this.push(f, props, 'end', 10);
      this.followed.delete(f.token);
      return;
    }
    if (!trackChanged(f.last, props)) return;
    // Arrival is what people wait for, so it goes at once; the rest can wait for a good moment.
    const urgent = props.phase !== f.last?.phase || props.stopsAway <= 1;
    if (await this.push(f, props, 'update', urgent ? 10 : 5)) f.last = props;
  }

  /** Sends one push; returns whether Apple took it. Activities Apple no longer knows are dropped. */
  private async push(f: Followed, props: TrackProps, event: 'update' | 'end', priority: 5 | 10): Promise<boolean> {
    const seconds = Math.max(Math.floor(this.now() / 1000), f.lastPushSeconds + 1);
    const aps: Record<string, unknown> = {
      timestamp: seconds,
      event,
      'content-state': { name: ACTIVITY_NAME, props: JSON.stringify(props) },
    };
    if (event === 'end') aps['dismissal-date'] = seconds + 2 * 60;
    else aps['stale-date'] = Math.floor(staleAfter(props) / 1000);
    const result = await this.send!(f.token, { aps }, priority);
    if (result.status === 200) {
      f.lastPushSeconds = seconds;
      return true;
    }
    // 410: the activity has ended. 400 BadDeviceToken: a token from another app or environment.
    if (result.status === 410 || result.reason === 'BadDeviceToken' || result.reason === 'DeviceTokenNotForTopic') {
      this.followed.delete(f.token);
    } else if (result.status !== 0 && result.status !== 429 && result.status < 500) {
      console.warn(`Live Activity push refused (${result.status} ${result.reason ?? ''})`);
    }
    return false;
  }
}
