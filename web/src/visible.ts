/**
 * Whether the page is on screen. A tab left open in the background used to keep asking for live
 * data all day, which nobody sees and which counts against the server's monthly data allowance.
 */
export const pageVisible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';

/**
 * Like setInterval, but skips its turns while the page is hidden, and catches up at once when the page
 * is shown again. Returns a function that stops it.
 */
export function everyWhileVisible(fn: () => void, ms: number): () => void {
  let missed = false;
  const timer = setInterval(() => {
    if (pageVisible()) fn();
    else missed = true;
  }, ms);
  const onShow = () => {
    if (!pageVisible() || !missed) return;
    missed = false;
    fn();
  };
  document.addEventListener('visibilitychange', onShow);
  return () => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onShow);
  };
}
