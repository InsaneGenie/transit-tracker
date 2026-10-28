import { useEffect, useState } from 'react';
import { fetchVehicleDetail, type Mode, type VehicleDetail } from './api';
import { MapView, type MapInfo } from './MapView';
import { themeFor, type Theme } from './theme';
import { VehiclePanel } from './VehiclePanel';
import { MODE_LABELS } from './vehicles';

const ALL_MODES: Mode[] = ['subway', 'rail', 'bus'];
const DETAIL_POLL_MS = 10_000;

export function App() {
  const [modes, setModes] = useState<Mode[]>(ALL_MODES);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<VehicleDetail | null>(null);
  const [info, setInfo] = useState<MapInfo>({ count: 0 });
  const [theme, setTheme] = useState<Theme>(() => themeFor(new Date()));

  // Follow sunrise and sunset.
  useEffect(() => {
    const timer = setInterval(() => setTheme(themeFor(new Date())), 60_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // Keep the open vehicle's stops and arrival times fresh.
  useEffect(() => {
    setDetail(null);
    if (!selectedId) return;
    const controller = new AbortController();
    const load = () =>
      fetchVehicleDetail(selectedId, controller.signal)
        .then(setDetail)
        .catch((err: Error) => {
          // The trip ended or left the feed.
          if (err.name !== 'AbortError' && err.message.endsWith('404')) setSelectedId(null);
        });
    void load();
    const timer = setInterval(load, DETAIL_POLL_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [selectedId]);

  const toggle = (mode: Mode) =>
    setModes((m) => (m.includes(mode) ? m.filter((x) => x !== mode) : [...m, mode]));

  return (
    <div className="app">
      <MapView theme={theme} modes={modes} selectedId={selectedId} detail={detail} onSelect={setSelectedId} onUpdate={setInfo} />

      <div className="toolbar">
        <h1>NY Transit Live</h1>
        <div className="filters" role="group" aria-label="Show">
          {ALL_MODES.map((mode) => (
            <button
              key={mode}
              className={`chip chip-${mode}`}
              aria-pressed={modes.includes(mode)}
              onClick={() => toggle(mode)}
            >
              {MODE_LABELS[mode]}
            </button>
          ))}
        </div>
      </div>

      <div className={`status${info.error ? ' status-error' : ''}`}>
        {info.error ?? (info.zoomedOut ? 'Zoom in to see vehicles' : `${info.count.toLocaleString()} vehicles in view`)}
      </div>

      {detail && <VehiclePanel detail={detail} onClose={() => setSelectedId(null)} />}
    </div>
  );
}
