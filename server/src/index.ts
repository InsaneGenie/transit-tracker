import { AlertStore } from './alerts.js';
import { FEEDS } from './feeds.js';
import { ReportBook, REPORTS_FILE } from './reports.js';
import { createApiServer } from './server.js';
import { VehicleStore } from './store.js';

const port = Number(process.env.PORT ?? 3000);
const store = new VehicleStore(FEEDS);
const alerts = new AlertStore();
const reports = new ReportBook({ file: REPORTS_FILE });
await reports.load();
store.reports = reports;
reports.start();
// Render stops the old server on each deploy: keep the day's report card notes for the new one.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => void reports.save().finally(() => process.exit(0)));
}
// Alerts don't need the schedules, so they're ready while those load.
alerts.start();

createApiServer(store, undefined, undefined, alerts).listen(port, () => {
  console.log(`Transit tracker API on http://localhost:${port}/api/vehicles`);
});

console.log('Loading schedules (first run downloads them, which takes a minute)...');
await store.loadStatic();
store.start();
for (const f of store.status()) {
  const schedule = f.staticLoaded ? 'schedule loaded' : `schedule failed: ${f.staticError ?? 'not configured'}`;
  console.log(`  ${f.id}: ${f.enabled ? schedule : f.lastError}`);
}
