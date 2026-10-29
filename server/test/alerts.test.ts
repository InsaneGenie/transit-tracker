import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { AlertStore, parseAlerts, severityOf, UPCOMING_SECONDS } from '../src/alerts.js';
import { createApiServer } from '../src/server.js';
import { VehicleStore } from '../src/store.js';

const T = 1_700_000_000;

const text = (en: string) => ({ translation: [{ text: en, language: 'en' }, { text: `<p>${en}</p>`, language: 'en-html' }] });

function alert(
  id: string,
  type: string,
  routes: [agency: string, route: string][],
  periods: { start: number; end?: number }[],
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    alert: {
      active_period: periods,
      informed_entity: routes.map(([agency_id, route_id]) => ({ agency_id, route_id })),
      header_text: text(`${type} on ${routes.map((r) => `[${r[1]}]`).join('')}`),
      'transit_realtime.mercury_alert': { alert_type: type, ...extra },
    },
  };
}

const feed = {
  entity: [
    alert('planned', 'Planned - Stops Skipped', [['MTASBWY', 'A']], [{ start: T + 3600, end: T + 7200 }], {
      human_readable_active_period: text('Tonight, 9 PM to 10 PM'),
    }),
    alert('delay', 'Delays', [['MTASBWY', '2'], ['MTASBWY', '5']], [{ start: T - 600, end: T + 1800 }]),
    alert('bus', 'Detour', [['MTA NYCT', 'M15'], ['MTABC', 'Q10']], [{ start: T - 60 }]),
    alert('rail', 'Part Suspended', [['LI', '1']], [{ start: T - 60, end: T + 60 }]),
    alert('notice', 'Station Notice', [['MNR', '2']], []),
    alert('far', 'Planned - Suspended', [['MTASBWY', 'G']], [{ start: T + UPCOMING_SECONDS + 60, end: T + UPCOMING_SECONDS * 2 }]),
    alert('over', 'Delays', [['MTASBWY', 'L']], [{ start: T - 7200, end: T - 3600 }]),
    alert('unknown-agency', 'Delays', [['NJT', 'X']], [{ start: T - 60 }]),
  ],
};

describe('severityOf', () => {
  it('sorts the MTA kinds into four', () => {
    expect(severityOf('Planned - Part Suspended')).toBe('suspended');
    expect(severityOf('Expect Delays')).toBe('delays');
    expect(severityOf('Reduced Service')).toBe('delays');
    expect(severityOf('Planned - Reroute')).toBe('changes');
    expect(severityOf('Special Schedule')).toBe('changes');
    expect(severityOf('Station Notice')).toBe('info');
  });
});

describe('parseAlerts', () => {
  const alerts = parseAlerts(feed, T);
  const byId = new Map(alerts.map((a) => [a.id, a]));

  it('keeps alerts on now or soon, and drops ended, far-off and unknown-line ones', () => {
    expect([...byId.keys()].sort()).toEqual(['bus', 'delay', 'notice', 'planned', 'rail']);
  });

  it('turns MTA agencies and routes into line keys', () => {
    expect(byId.get('delay')!.lines).toEqual(['mta-subway:2', 'mta-subway:5']);
    expect(byId.get('bus')!.lines).toEqual(['mta-bus:M15', 'mta-bus:Q10']);
    expect(byId.get('rail')!.lines).toEqual(['mta-lirr:1']);
    expect(byId.get('notice')!.lines).toEqual(['mta-mnr:2']);
  });

  it('reads the kind, when, and whether it is on now', () => {
    expect(byId.get('planned')).toMatchObject({
      type: 'Planned - Stops Skipped',
      severity: 'changes',
      when: 'Tonight, 9 PM to 10 PM',
      header: 'Planned - Stops Skipped on [A]',
      active: false,
      start: T + 3600,
    });
    expect(byId.get('delay')).toMatchObject({ active: true, severity: 'delays' });
    expect(byId.get('notice')).toMatchObject({ active: true, end: undefined });
  });

  it('lists ones on now first, the most serious first', () => {
    expect(alerts.map((a) => a.id)).toEqual(['rail', 'delay', 'bus', 'notice', 'planned']);
  });

  it('picks the next period of a recurring alert', () => {
    const recurring = alert('nights', 'Planned - Suspended', [['MTASBWY', 'F']], [
      { start: T - 7200, end: T - 3600 },
      { start: T + 80_000, end: T + 90_000 },
    ]);
    expect(parseAlerts({ entity: [recurring] }, T)[0]).toMatchObject({ start: T + 80_000, active: false });
  });

  it('copes with an empty or odd feed', () => {
    expect(parseAlerts(null, T)).toEqual([]);
    expect(parseAlerts({ entity: [{ id: 'x' }, { alert: {} }] }, T)).toEqual([]);
  });
});

describe('AlertStore', () => {
  it('finds alerts by line and marks the worst one on now', async () => {
    const store = new AlertStore(async () => feed);
    await store.poll(T);
    expect(store.forLines(['mta-subway:A'], T).map((a) => a.id)).toEqual(['planned']);
    expect(store.forLines(['mta-subway:5', 'mta-bus:Q10'], T).map((a) => a.id)).toEqual(['delay', 'bus']);
    // Notices and later planned work don't mark a line.
    expect(store.summary(T)).toEqual({
      'mta-lirr:1': 'suspended',
      'mta-subway:2': 'delays',
      'mta-subway:5': 'delays',
      'mta-bus:M15': 'changes',
      'mta-bus:Q10': 'changes',
    });
  });

  it('drops alerts that ended since the last refresh and starts ones that began', async () => {
    const store = new AlertStore(async () => feed);
    await store.poll(T);
    const later = T + 3700;
    expect(store.forLines(['mta-lirr:1', 'mta-subway:A'], later).map((a) => [a.id, a.active])).toEqual([['planned', true]]);
  });

  it('keeps the last alerts when a refresh fails', async () => {
    let fail = false;
    const store = new AlertStore(async () => {
      if (fail) throw new Error('feed down');
      return feed;
    });
    await store.poll(T);
    fail = true;
    await store.poll(T);
    expect(store.lastError).toBe('feed down');
    expect(store.forLines(['mta-subway:2'], T)).toHaveLength(1);
  });

  it('is served at /api/alerts', async () => {
    const alerts = new AlertStore(async () => feed);
    await alerts.poll(T);
    const server = createApiServer(new VehicleStore([]), () => T, undefined, alerts).listen(0);
    const base = `http://localhost:${(server.address() as AddressInfo).port}`;
    try {
      const summary = await (await fetch(`${base}/api/alerts`)).json();
      expect(summary.lines['mta-subway:2']).toBe('delays');
      const detail = await (await fetch(`${base}/api/alerts?lines=mta-subway:A`)).json();
      expect(detail.alerts.map((a: { id: string }) => a.id)).toEqual(['planned']);
      const health = await (await fetch(`${base}/api/health`)).json();
      expect(health.alerts.updatedAt).toBe(T);
    } finally {
      server.close();
    }
  });
});
