import { FEEDS } from './feeds.js';
import { createApiServer } from './server.js';
import { VehicleStore } from './store.js';

const port = Number(process.env.PORT ?? 3000);
const store = new VehicleStore(FEEDS);

createApiServer(store).listen(port, () => {
  console.log(`Transit tracker API on http://localhost:${port}/api/vehicles`);
});

console.log('Loading schedules (first run downloads them, which takes a minute)...');
await store.loadStatic();
store.start();
for (const f of store.status()) {
  console.log(`  ${f.id}: ${f.enabled ? (f.staticLoaded ? 'schedule loaded' : 'no schedule') : f.lastError}`);
}
