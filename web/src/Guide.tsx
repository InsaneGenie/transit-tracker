import { useState } from 'react';
import { CloseButton } from './CloseButton';
import { FEEDBACK_EMAIL, feedbackMailto } from './feedback';
import { GUIDE, GUIDE_NOTE } from './guide';
import { guideArt } from './guideArt';
import { SUPPORT_URL } from './support';
import { APP_STORE_URL, TESTFLIGHT_URL } from './testflight';
import { resetTips } from './Tip';

/** A few pages, each a picture and one line, opened from the toolbar's "?" and shown once on a first visit. */
export function Guide({ dark, onClose }: { dark: boolean; onClose: () => void }) {
  const [page, setPage] = useState(0);
  const step = GUIDE[page];
  const last = page === GUIDE.length - 1;

  return (
    <aside
      className="legend guide"
      aria-label="How to use"
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight' && !last) setPage(page + 1);
        if (e.key === 'ArrowLeft' && page > 0) setPage(page - 1);
      }}
    >
      <div className="sheet-handle" aria-hidden="true" />
      <header className="legend-header">
        <strong>How to use</strong>
        {!last && (
          <button className="link guide-skip" onClick={onClose}>
            Skip
          </button>
        )}
        <CloseButton onClick={onClose} />
      </header>

      <div className="legend-body">
        {/* Our own drawing, built from fixed shapes; nothing from outside goes into it. */}
        <div className="guide-art" aria-hidden="true" dangerouslySetInnerHTML={{ __html: guideArt(page, dark) }} />
        <h3 className="guide-title" aria-live="polite">
          {step.title}
        </h3>
        <p className="guide-text">{step.text}</p>

        <div className="guide-nav">
          <button className="chip" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="Previous">
            ‹
          </button>
          <div className="guide-dots" role="tablist" aria-label="Pages">
            {GUIDE.map((s, i) => (
              <button
                key={s.title}
                role="tab"
                aria-selected={i === page}
                aria-label={`${i + 1}. ${s.title}`}
                className={`guide-dot${i === page ? ' on' : ''}`}
                onClick={() => setPage(i)}
              />
            ))}
          </div>
          <button className="chip guide-next" onClick={last ? onClose : () => setPage(page + 1)}>
            {last ? 'Start' : 'Next'}
          </button>
        </div>

        {last && (
          <>
            <p className="muted small guide-note">
              {GUIDE_NOTE}{' '}
              <button className="link" onClick={resetTips}>
                Show them again
              </button>
            </p>
            <div className="guide-more">
              <a className="chip" href={APP_STORE_URL} target="_blank" rel="noopener">
                Get the iPhone app
              </a>
              <a className="chip" href={feedbackMailto({ from: 'Website', device: navigator.userAgent })}>
                Send feedback
              </a>
              {SUPPORT_URL && (
                <a className="chip guide-support-button" href={SUPPORT_URL} target="_blank" rel="noopener">
                  <span aria-hidden="true">♥</span> Support
                </a>
              )}
            </div>
            <p className="muted small guide-fine">
              Free, with no ads. Want features early? <a href={TESTFLIGHT_URL} target="_blank" rel="noopener">Join the iPhone beta</a>.
              No email app? Write to <a href={`mailto:${FEEDBACK_EMAIL}`}>{FEEDBACK_EMAIL}</a>.
            </p>
          </>
        )}
      </div>
    </aside>
  );
}
