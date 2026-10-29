/**
 * MTA service alerts: delays, suspensions and planned or temporary service changes, for every subway,
 * bus, LIRR and Metro-North line. The JSON version of the feed keeps the MTA's own extras (the alert's
 * kind, like "Planned - Suspended", and a readable "when"), which the protobuf decoder would drop.
 */
export const ALERTS_URL = 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/camsys%2Fall-alerts.json';

/** How bad it is, which picks the alert's color and order. */
export type AlertSeverity = 'suspended' | 'delays' | 'changes' | 'info';

export interface ServiceAlert {
  id: string;
  /** The MTA's own kind, e.g. "Delays" or "Planned - Stops Skipped". */
  type: string;
  severity: AlertSeverity;
  /** One line, with lines written as `[A]` like on MTA signs. */
  header: string;
  /** The details: which stops, what to do instead, and why. */
  description?: string;
  /** When it applies, in words, e.g. "Oct 29, Thursday, 6:00 AM to 8:00 AM". */
  when?: string;
  /** The current period if it's on now, otherwise the next one. Unix seconds; no end means until further notice. */
  start: number;
  end?: number;
  /** Whether it applies right now, not just later. */
  active: boolean;
  /** The lines it affects, as `RouteInfo` keys (`${feed}:${routeId}`). */
  lines: string[];
}

/** The feed each MTA agency's lines belong to, matching `FEEDS`. */
const FEED_FOR_AGENCY: Record<string, string> = {
  MTASBWY: 'mta-subway',
  'MTA NYCT': 'mta-bus',
  MTABC: 'mta-bus',
  LI: 'mta-lirr',
  MNR: 'mta-mnr',
};

/** Planned work starting this soon is shown ahead of time, so weekend changes show up by Thursday. */
export const UPCOMING_SECONDS = 3 * 24 * 3600;

export function severityOf(type: string): AlertSeverity {
  const t = type.toLowerCase();
  if (t.includes('suspended') || t.includes('no scheduled service')) return 'suspended';
  if (t.includes('delay') || t.includes('reduced service') || t.includes('slow')) return 'delays';
  if (/notice|extra service|elevator|escalator|information/.test(t)) return 'info';
  return 'changes';
}

const SEVERITY_ORDER: AlertSeverity[] = ['suspended', 'delays', 'changes', 'info'];

/** Text in English. */
function english(text: unknown): string | undefined {
  const translations = (text as { translation?: { text?: string; language?: string }[] } | undefined)?.translation;
  const found = translations?.find((t) => t.language === 'en') ?? translations?.find((t) => !t.language);
  return found?.text?.trim() || undefined;
}

const seconds = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

/** Alerts on now or starting within `UPCOMING_SECONDS`, most serious first, then soonest. */
export function parseAlerts(feed: unknown, now = Date.now() / 1000): ServiceAlert[] {
  const entities = (feed as { entity?: unknown[] } | null)?.entity ?? [];
  const out: ServiceAlert[] = [];
  for (const entity of entities as { id?: string; alert?: Record<string, unknown> }[]) {
    const alert = entity.alert;
    if (!entity.id || !alert) continue;

    const periods = ((alert.active_period as { start?: unknown; end?: unknown }[] | undefined) ?? [])
      .map((p) => ({ start: seconds(p.start) ?? 0, end: seconds(p.end) }))
      .filter((p) => p.end === undefined || p.end > now)
      .sort((a, b) => a.start - b.start);
    // No period at all means it's on until it leaves the feed.
    const period = (alert.active_period as unknown[] | undefined)?.length ? periods[0] : { start: 0, end: undefined };
    if (!period || period.start > now + UPCOMING_SECONDS) continue;

    const lines = new Set<string>();
    for (const e of (alert.informed_entity as { agency_id?: string; route_id?: string }[] | undefined) ?? []) {
      const feedId = e.agency_id && FEED_FOR_AGENCY[e.agency_id];
      if (feedId && e.route_id) lines.add(`${feedId}:${e.route_id}`);
    }
    const header = english(alert.header_text);
    if (!lines.size || !header) continue;

    const mercury = (alert['transit_realtime.mercury_alert'] ?? {}) as Record<string, unknown>;
    const type = typeof mercury.alert_type === 'string' && mercury.alert_type ? mercury.alert_type : 'Service change';
    out.push({
      id: entity.id,
      type,
      severity: severityOf(type),
      header,
      description: english(alert.description_text),
      when: english(mercury.human_readable_active_period),
      start: period.start,
      end: period.end,
      active: period.start <= now,
      lines: [...lines],
    });
  }
  return out.sort(
    (a, b) =>
      Number(b.active) - Number(a.active) ||
      SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) ||
      a.start - b.start,
  );
}

export type AlertFetcher = () => Promise<unknown>;

/** Keeps the latest alerts, refreshed every couple of minutes. */
export class AlertStore {
  private alerts: ServiceAlert[] = [];
  private timer?: NodeJS.Timeout;
  lastError?: string;
  updatedAt?: number;

  constructor(
    private fetcher: AlertFetcher = async () => {
      const res = await fetch(ALERTS_URL, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`service alerts returned ${res.status}`);
      return res.json();
    },
    private pollSeconds = 120,
  ) {}

  async poll(now = Date.now() / 1000): Promise<void> {
    try {
      this.alerts = parseAlerts(await this.fetcher(), now);
      this.updatedAt = now;
      this.lastError = undefined;
    } catch (err) {
      this.lastError = (err as Error).message;
    }
  }

  start(): void {
    const tick = async () => {
      await this.poll();
      this.timer = setTimeout(tick, this.pollSeconds * 1000);
    };
    void tick();
  }

  stop(): void {
    clearTimeout(this.timer);
  }

  /** Alerts touching any of these lines. Ones that ended since the last refresh are left out. */
  forLines(keys: string[], now = Date.now() / 1000): ServiceAlert[] {
    const wanted = new Set(keys);
    return this.current(now).filter((a) => a.lines.some((k) => wanted.has(k)));
  }

  /**
   * The most serious alert on now for each line, so the line list can mark them. Notices (a moved bus
   * stop, a closed elevator) don't count, or nearly every line would be marked.
   */
  summary(now = Date.now() / 1000): Record<string, AlertSeverity> {
    const worst: Record<string, AlertSeverity> = {};
    for (const a of this.current(now)) {
      if (!a.active || a.severity === 'info') continue;
      for (const key of a.lines) {
        const had = worst[key];
        if (!had || SEVERITY_ORDER.indexOf(a.severity) < SEVERITY_ORDER.indexOf(had)) worst[key] = a.severity;
      }
    }
    return worst;
  }

  private current(now: number): ServiceAlert[] {
    return this.alerts
      .filter((a) => a.end === undefined || a.end > now)
      .map((a) => (a.active || a.start > now ? a : { ...a, active: true }));
  }
}
