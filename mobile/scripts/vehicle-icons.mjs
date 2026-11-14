// Renders the vehicle pictures in web/src/vehicleIcons.ts to the white PNGs the app tints per line
// (mobile/assets/vehicles), the wheelchair in web/src/accessibility.ts and the Citi Bike bicycle in web/src/bikes.ts. Run again after changing a picture:
//   node --experimental-strip-types mobile/scripts/vehicle-icons.mjs
// Needs Playwright with Chromium (npx playwright install chromium).
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { WHEELCHAIR_GLYPH } from '../../web/src/accessibility.ts';
import { BIKE_FRAME, BIKE_WHEELS } from '../../web/src/bikes.ts';
import { MODE_GLYPHS } from '../../web/src/vehicleIcons.ts';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const out = fileURLToPath(new URL('../assets/vehicles/', import.meta.url));
const SIZE = 16;

const browser = await chromium.launch();
for (const scale of [1, 2, 3]) {
  const page = await browser.newPage({ deviceScaleFactor: scale, viewport: { width: SIZE, height: SIZE } });
  const filled = Object.entries({ ...MODE_GLYPHS, wheelchair: WHEELCHAIR_GLYPH }).map(([name, d]) => [
    name,
    `<path d="${d}" fill="#fff" fill-rule="evenodd"/>`,
  ]);
  const bike =
    `<g fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">` +
    BIKE_WHEELS.map(([cx, cy, r]) => `<circle cx="${cx}" cy="${cy}" r="${r}"/>`).join('') +
    `<path d="${BIKE_FRAME}"/></g>`;
  for (const [mode, picture] of [...filled, ['bike', bike]]) {
    await page.setContent(
      `<body style="margin:0;background:transparent">` +
        `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 24 24" style="display:block">` +
        `${picture}</svg></body>`,
    );
    const name = scale === 1 ? `${mode}.png` : `${mode}@${scale}x.png`;
    await page.screenshot({ path: out + name, omitBackground: true, clip: { x: 0, y: 0, width: SIZE, height: SIZE } });
  }
  await page.close();
}
await browser.close();
