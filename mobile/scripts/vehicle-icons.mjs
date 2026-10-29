// Renders the vehicle pictures in web/src/vehicleIcons.ts to the white PNGs the app tints per line
// (mobile/assets/vehicles). Run again after changing a picture:
//   node --experimental-strip-types mobile/scripts/vehicle-icons.mjs
// Needs Playwright with Chromium (npx playwright install chromium).
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { MODE_GLYPHS } from '../../web/src/vehicleIcons.ts';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const out = fileURLToPath(new URL('../assets/vehicles/', import.meta.url));
const SIZE = 16;

const browser = await chromium.launch();
for (const scale of [1, 2, 3]) {
  const page = await browser.newPage({ deviceScaleFactor: scale, viewport: { width: SIZE, height: SIZE } });
  for (const [mode, d] of Object.entries(MODE_GLYPHS)) {
    await page.setContent(
      `<body style="margin:0;background:transparent">` +
        `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 24 24" style="display:block">` +
        `<path d="${d}" fill="#fff" fill-rule="evenodd"/></svg></body>`,
    );
    const name = scale === 1 ? `${mode}.png` : `${mode}@${scale}x.png`;
    await page.screenshot({ path: out + name, omitBackground: true, clip: { x: 0, y: 0, width: SIZE, height: SIZE } });
  }
  await page.close();
}
await browser.close();
