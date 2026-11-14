const captured: Record<string, { layout: string; initialProps?: unknown }> = {};
export function createWidget(name: string, layout: string, initialProps?: unknown) {
  captured[name] = { layout, initialProps };
  return {};
}
export function createLiveActivity(name: string, layout: string) {
  captured[name] = { layout };
  return {};
}
export function after(date: Date) {
  return { after: date };
}
(globalThis as any).__captured = captured;
