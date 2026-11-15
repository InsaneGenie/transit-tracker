// Renders the guide's pictures in web/src/guideArt.ts to the PNGs the app's guide shows
// (mobile/assets/guide), in light and dark. Run again after changing a picture:
//   node mobile/scripts/guide-art.mjs
// Needs web/node_modules (Vite loads the TypeScript) and Playwright with Chromium.
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const web = fileURLToPath(new URL('../../web/', import.meta.url));
const require = createRequire(web);
const { chromium } = require('playwright');
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href);
const out = fileURLToPath(new URL('../assets/guide/', import.meta.url));

const vite = await createServer({ root: web, logLevel: 'silent', server: { middlewareMode: true } });
const { guideArt, GUIDE_ART_COUNT, ART_W, ART_H } = await vite.ssrLoadModule('/src/guideArt.ts');
await vite.close();

const browser = await chromium.launch();
for (const scale of [2, 3]) {
  const page = await browser.newPage({ deviceScaleFactor: scale, viewport: { width: ART_W, height: ART_H } });
  for (let i = 0; i < GUIDE_ART_COUNT; i++) {
    for (const dark of [false, true]) {
      await page.setContent(`<body style="margin:0;background:transparent">${guideArt(i, dark)}</body>`);
      const name = `${i + 1}-${dark ? 'dark' : 'light'}@${scale}x.png`;
      await page.screenshot({ path: out + name, omitBackground: true, clip: { x: 0, y: 0, width: ART_W, height: ART_H } });
    }
  }
  await page.close();
}
await browser.close();
