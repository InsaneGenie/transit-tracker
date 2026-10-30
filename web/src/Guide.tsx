import { CloseButton } from './CloseButton';
import { FEEDBACK_EMAIL, feedbackMailto } from './feedback';
import { GUIDE } from './guide';
import { TESTFLIGHT_URL } from './testflight';

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
        <section className="guide-feedback">
          <h3>iPhone app</h3>
          <p className="muted small">
            The map is also an iPhone app, in beta. Open the link on your iPhone; Apple's free TestFlight app installs it.
          </p>
          <a className="chip guide-feedback-button" href={TESTFLIGHT_URL} target="_blank" rel="noopener">
            Try the iPhone app beta
          </a>
        </section>
        <section className="guide-feedback">
          <h3>Feedback</h3>
          <p className="muted small">Found a bug, or have an idea? Tell us; it opens an email that's ready to send.</p>
          <a className="chip guide-feedback-button" href={feedbackMailto({ from: 'Website', device: navigator.userAgent })}>
            Report a bug or send feedback
          </a>
          <p className="muted small">
            No email app? Write to <a href={`mailto:${FEEDBACK_EMAIL}`}>{FEEDBACK_EMAIL}</a>.
          </p>
        </section>
        <button className="chip guide-done" onClick={onClose}>
          Got it
        </button>
      </div>
    </aside>
  );
}
