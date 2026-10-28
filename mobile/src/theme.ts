/** Card and text colors, matching the website's light and dark looks. The map itself follows the phone. */
export function palette(dark: boolean) {
  return dark
    ? { card: '#1f2937', text: '#f9fafb', muted: '#9ca3af', border: '#374151', accent: '#2563eb', chip: 'rgba(31,41,55,0.92)' }
    : { card: '#ffffff', text: '#111827', muted: '#6b7280', border: '#d1d5db', accent: '#2563eb', chip: 'rgba(255,255,255,0.94)' };
}

export const MODE_DOT = { subway: '#4b5563', rail: '#7c3aed', bus: '#2563eb' } as const;
