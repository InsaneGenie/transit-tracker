import type { CSSProperties } from 'react';
import type { RouteInfo } from './api';
import { ModeIcon } from './ModeIcon';
import { colorFor, displayName, textColorFor } from './vehicles';

/** A line's badge: the subway's round bullet, a bus route's rounded square, a commuter line's diamond. */
export function LineBadge({ route, size = 34 }: { route: Pick<RouteInfo, 'mode' | 'name' | 'color'>; size?: number }) {
  const color = colorFor({ routeColor: route.color, mode: route.mode });
  if (route.mode === 'rail') {
    return (
      <span className="line-icon chip-rail" style={{ '--mode': color } as CSSProperties}>
        <ModeIcon mode="rail" size={size} />
      </span>
    );
  }
  const name = displayName(route.name);
  return (
    <span
      className={`line-icon line-icon-${route.mode}`}
      style={{
        minWidth: size,
        height: size,
        borderRadius: route.mode === 'bus' ? size * 0.26 : size / 2,
        background: color,
        color: textColorFor(color),
        fontSize: size * (name.length > 3 ? 0.34 : 0.42),
      }}
    >
      {name}
    </span>
  );
}
