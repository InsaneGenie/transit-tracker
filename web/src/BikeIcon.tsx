import { BIKE_FRAME, BIKE_WHEELS } from './bikes';

/** The Citi Bike button's icon: a bicycle in a circle, drawn hollow like the mode icons when switched off. */
export function BikeIcon({ size = 16 }: { size?: number }) {
  return (
    <svg className="mode-icon bike-icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle className="mode-icon-shape" cx="12" cy="12" r="11" strokeWidth="2" />
      <g className="bike-glyph" fill="none" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        {BIKE_WHEELS.map(([cx, cy, r]) => (
          <circle key={cx} cx={cx} cy={cy} r={r} />
        ))}
        <path d={BIKE_FRAME} />
      </g>
    </svg>
  );
}
