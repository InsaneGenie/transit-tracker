#!/usr/bin/env node
/**
 * Draws the Home Screen widget and the Live Activity in every size and state, the way the widget
 * extension on the iPhone does, and fails if any of them throws or uses a view the extension can't draw.
 * Run it with `npm run check:widgets` after changing anything in src/widgets/.
 *
 * Widget code runs apart from the app, in its own JavaScript engine, where a mistake shows up only on a
 * phone as a blank widget. This catches those here: it builds expo-widgets' widget runtime and the two
 * layouts with Metro, then runs them in Node. Pass -v to print what each one draws.
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'check-widgets-'));
const verbose = process.argv.includes('-v');
const expoCli = require.resolve('expo/bin/cli', { paths: [root] });
const widgetsDir = path.dirname(require.resolve('expo-widgets/package.json', { paths: [root] }));

function bundle(entry, output, metroConfig) {
  execFileSync(
    process.execPath,
    [expoCli, 'export:embed', '--platform', 'ios', '--entry-file', entry, '--bundle-output', output, '--dev', 'false', '--skip-server'],
    { cwd: root, stdio: verbose ? 'inherit' : 'ignore', env: { ...process.env, EXPO_OVERRIDE_METRO_CONFIG: metroConfig } },
  );
}

// The runtime the widget extension evaluates layouts in, and the layouts themselves.
bundle(path.join(widgetsDir, 'bundle/index.ts'), path.join(out, 'runtime.js'), path.join(widgetsDir, 'metro.config.js'));
bundle(path.join(__dirname, 'entry.js'), path.join(out, 'layouts.js'), path.join(__dirname, 'metro.config.js'));

const capture = { console, Date, Math, JSON, encodeURIComponent };
capture.globalThis = capture;
vm.createContext(capture);
vm.runInContext(fs.readFileSync(path.join(out, 'layouts.js'), 'utf8'), capture);
const layouts = capture.__captured;

const runtime = { console };
runtime.globalThis = runtime;
vm.createContext(runtime);
vm.runInContext(fs.readFileSync(path.join(out, 'runtime.js'), 'utf8'), runtime);
fs.rmSync(out, { recursive: true, force: true });

// The views expo-widgets' native renderer knows (ios/Widgets/ViewRenderer.swift); any other is drawn blank.
const KNOWN_VIEWS = new Set([
  'TextView', 'SlotView', 'HStackView', 'VStackView', 'ZStackView', 'OverlayView', 'BackgroundView', 'MaskView',
  'RectangleView', 'RoundedRectangleView', 'CapsuleView', 'CircleView', 'ImageView', 'AccessoryWidgetBackgroundView',
  'DividerView', 'EllipseView', 'LabelView', 'ProgressView', 'SpacerView', 'UnevenRoundedRectangleView', 'GaugeView',
  'ChartView', 'Button', 'react.fragment', 'LinkView',
]);

function walk(node, where, problems, lines, depth) {
  if (node == null || node === false) return;
  if (Array.isArray(node)) return node.forEach((n, i) => walk(n, `${where}[${i}]`, problems, lines, depth));
  if (typeof node !== 'object') return problems.push(`${where}: bare ${typeof node} ${JSON.stringify(node)} outside a Text`);
  const type = String(node.type);
  if (!KNOWN_VIEWS.has(type)) problems.push(`${where}: the widget can't draw a ${type}`);
  const p = node.props ?? {};
  const label = p.text ?? (p.timerInterval ? '[countdown]' : p.date ? `[${p.dateStyle ?? 'date'}]` : '');
  const mods = (p.modifiers ?? []).map((m) => m.$type).join(',');
  lines.push(`${'  '.repeat(depth)}${type}${label ? ` "${label}"` : ''}${mods ? `  {${mods}}` : ''}`);
  if (p.children !== undefined) walk(p.children, `${where}.${type}`, problems, lines, depth + 1);
}

function draw(name, props, environment) {
  runtime.__expoWidgetLayout = vm.runInContext(`(${layouts[name].layout})`, runtime);
  // Props reach the widget as JSON, so nothing but plain values survive.
  const tree = runtime.__expoWidgetRender(JSON.parse(JSON.stringify(props)), environment);
  const problems = [];
  const lines = [];
  if (tree && tree.type === undefined) {
    for (const [section, child] of Object.entries(tree)) {
      lines.push(`<${section}>`);
      walk(child, section, problems, lines, 1);
    }
  } else walk(tree, 'root', problems, lines, 0);
  return { problems, lines };
}

const now = Date.now();
let failed = 0;
let drawn = 0;
function check(label, name, props, environment) {
  drawn++;
  try {
    const { problems, lines } = draw(name, props, environment);
    if (problems.length) {
      failed++;
      console.log(`✗ ${label}\n  ${problems.join('\n  ')}`);
    } else if (verbose) console.log(`✓ ${label}\n${lines.join('\n')}\n`);
  } catch (err) {
    failed++;
    console.log(`✗ ${label}\n  ${err && err.stack ? err.stack.split('\n').slice(0, 3).join('\n  ') : err}`);
  }
}

const station = (id, badge, round, directions) => ({ id, badge, color: '#ee352e', textColor: '#ffffff', round, station: 'Chambers St', directions });
const ok = {
  state: 'ok',
  updatedAt: now - 60_000,
  stations: [
    station('mta-subway:1|137', '1', true, [
      { to: 'Van Cortlandt Park - 242 St', minutes: [0, 6, 12], away: 'Next stop' },
      { to: 'South Ferry', minutes: [4, 11], away: '' },
    ]),
    station('mta-bus:M15|400', 'M15', false, []),
  ],
};
const widgetStates = {
  'times': ok,
  'nothing on the way': { ...ok, stations: [ok.stations[1]] },
  'no stations saved': { state: 'empty', updatedAt: 0, stations: [] },
  'times ran out': { state: 'old', updatedAt: now - 3_600_000, stations: [] },
};
const families = ['systemSmall', 'systemMedium', 'accessoryRectangular', 'accessoryInline', 'accessoryCircular'];
for (const [state, props] of Object.entries(widgetStates)) {
  for (const family of families) {
    for (const colorScheme of ['light', 'dark']) {
      for (const configuration of [{ station: 'first' }, { station: 'mta-bus:M15|400' }, { station: 'removed' }, undefined]) {
        check(`widget, ${state}, ${family}, ${colorScheme}, showing ${configuration?.station ?? 'default'}`, 'NextArrivals', props, {
          timestamp: now,
          widgetFamily: family,
          colorScheme,
          widgetRenderingMode: family.startsWith('accessory') ? 'vibrant' : 'fullColor',
          configuration,
        });
      }
    }
  }
}

const coming = {
  line: 'A', color: '#0039a6', textColor: '#ffffff', mode: 'subway', stop: '14 St', arrival: now + 240_000, stopsAway: 2,
  where: 'Heading to 23 St', gps: false, startedAt: now - 120_000, updatedAt: now, phase: 'coming',
};
const activityStates = {
  'on its way': coming,
  'next stop, live GPS bus': { ...coming, mode: 'bus', line: 'M15', gps: true, stopsAway: 0 },
  'no time given': { ...coming, arrival: undefined },
  'due, no update yet': { ...coming, arrival: now - 5_000 },
  'arriving': { ...coming, phase: 'arriving', arrival: now + 20_000 },
  'arrived': { ...coming, phase: 'arrived', where: 'At 14 St' },
  'gone': { ...coming, phase: 'gone' },
  'lost': { ...coming, phase: 'lost' },
};
for (const [state, props] of Object.entries(activityStates)) {
  for (const environment of [{ colorScheme: 'dark' }, { colorScheme: 'light', isStale: true }]) {
    check(`Live Activity, ${state}, ${environment.colorScheme}${environment.isStale ? ', stale' : ''}`, 'TrackVehicle', props, environment);
  }
}

console.log(failed ? `${failed} of ${drawn} failed` : `All ${drawn} widget and Live Activity layouts drew.`);
process.exit(failed ? 1 : 0);
