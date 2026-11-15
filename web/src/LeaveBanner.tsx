import { alertStatus, watchLabel } from './leaveAlert';
import type { LeaveAlert } from './useLeaveAlert';
import { tidyStopName } from './vehicles';

/** The "should I run?" alert that is on, over the map: its countdown, and tapping it opens the station. */
export function LeaveBanner({ alert, onOpen }: { alert: LeaveAlert; onOpen: () => void }) {
  const { watch, plan, now, notifyState } = alert;
  if (!watch) return null;
  const station = watch.station.name ? tidyStopName(watch.station.name) : 'your stop';
  const quiet = notifyState === 'denied' || notifyState === 'unsupported';
  return (
    <div className={`leave-banner${plan?.kind === 'leave' ? ' leave-banner-go' : ''}`} role="status" aria-live="polite">
      <button className="leave-banner-main" onClick={onOpen} title="Show this station">
        <span className="leave-banner-icon" aria-hidden="true">
          {plan?.kind === 'leave' ? '🏃' : '🔔'}
        </span>
        <span className="leave-banner-text">
          <strong>{alertStatus(watch, plan, now)}</strong>
          <span className="leave-banner-sub">
            {watchLabel(watch)} at {station} · {watch.walkMinutes} min walk
            {quiet && ' · Notifications are off, so keep this page open'}
          </span>
        </span>
      </button>
      <button className="leave-banner-close" onClick={alert.stop} aria-label="Stop alert" title="Stop alert">
        ×
      </button>
    </div>
  );
}
