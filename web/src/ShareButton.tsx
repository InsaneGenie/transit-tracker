import { useEffect, useState } from 'react';
import { shareText } from './share';

/**
 * Shares a link: the phone's share sheet where there is one, otherwise the link is copied and the button
 * says so for a moment.
 */
export function ShareButton({ url, title }: { url: string; title: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const share = async () => {
    // Desktop browsers that have a share sheet tend to offer little in it, so they get the copied link.
    if (navigator.share && window.matchMedia('(pointer: coarse)').matches) {
      try {
        await navigator.share({ title, text: shareText(title), url });
        return;
      } catch (err) {
        // Closing the share sheet is not a failure.
        if ((err as Error).name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // No clipboard either; the address bar has nothing better, so show the link to copy by hand.
      window.prompt('Copy this link', url);
    }
  };

  return (
    <button className={`close share${copied ? ' share-copied' : ''}`} onClick={share} aria-label={copied ? 'Link copied' : 'Share'} title={copied ? 'Link copied' : 'Share'}>
      {copied ? (
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <path
            d="M8 10V2M5 4.5L8 1.5l3 3M5.5 7H4a1 1 0 0 0-1 1v5.5a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1h-1.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
      {copied && <span className="share-tip" role="status">Link copied</span>}
    </button>
  );
}
