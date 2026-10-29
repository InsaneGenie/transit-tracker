import { CloseButton } from './CloseButton';
import { GUIDE } from './guide';

/** How to use the map, opened from the toolbar's "?" and shown once on a first visit. */
export function Guide({ onClose }: { onClose: () => void }) {
  return (
    <aside className="legend guide" aria-label="How to use">
      <div className="sheet-handle" aria-hidden="true" />
      <header className="legend-header">
        <strong>How to use</strong>
        <CloseButton onClick={onClose} />
      </header>
      <p className="muted small legend-hint">Live trains and buses across New York, wherever you zoom in.</p>

      <div className="legend-body">
        {GUIDE.map((section) => (
          <section key={section.title}>
            <h3>{section.title}</h3>
            <ul className="guide-points">
              {section.points.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          </section>
        ))}
        <button className="chip guide-done" onClick={onClose}>
          Got it
        </button>
      </div>
    </aside>
  );
}
