import { AlertStore } from './alerts.js';
import { FEEDS } from './feeds.js';
import { apnsConfigFromEnv, apnsSender, LiveActivityPusher } from './liveActivities.js';
import { createApiServer } from './server.js';
import { VehicleStore } from './store.js';

const port = Number(process.env.PORT ?? 3000);
const store = new VehicleStore(FEEDS);
const alerts = new AlertStore();
// Alerts don't need the schedules, so they're ready while those load.
alerts.start();

// Live Activity pushes, when an Apple push key is set (see liveActivities.ts).
const apns = apnsConfigFromEnv();
let sender = null;
try {
  sender = apns && apnsSender(apns);
} catch (err) {
  console.error(`APNS_KEY could not be read, so Live Activities won't get pushes: ${(err as Error).message}`);
}
const liveActivities = new LiveActivityPusher(store, sender);
liveActivities.start();
console.log(sender ? 'Live Activity pushes are on.' : 'Live Activity pushes are off (no APNS_KEY, APNS_KEY_ID and APNS_TEAM_ID).');

createApiServer(store, undefined, undefined, alerts, liveActivities).listen(port, () => {
  console.log(`Transit tracker API on http://localhost:${port}/api/vehicles`);
});

console.log('Loading schedules (first run downloads them, which takes a minute)...');
await store.loadStatic();
store.start();
for (const f of store.status()) {
  const schedule = f.staticLoaded ? 'schedule loaded' : `schedule failed: ${f.staticError ?? 'not configured'}`;
  console.log(`  ${f.id}: ${f.enabled ? schedule : f.lastError}`);
}
