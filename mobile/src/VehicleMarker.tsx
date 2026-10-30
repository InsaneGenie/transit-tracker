import { memo, useEffect, useRef, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { Marker } from 'react-native-maps';
import { colorFor, displayName, textColorFor } from '../../web/src/vehicles';
import type { UpcomingStop, Vehicle } from './api';
import { GLYPHS, ModeIcon } from './ModeIcon';

interface Props {
  vehicle: Vehicle;
  labelled: boolean;
  selected: boolean;
  dark: boolean;
  onPress: (id: string) => void;
}

/** The vehicle's mode icon in its line's color, or a tag with the line's name too when zoomed in. */
export const VehicleMarker = memo(function VehicleMarker({ vehicle, labelled, selected, dark, onPress }: Props) {
  const color = colorFor(vehicle);
  const ink = textColorFor(color);
  const label = displayName(vehicle.routeName ?? vehicle.routeId ?? '');
  const border = selected ? (dark ? '#f9fafb' : '#111827') : dark ? '#111827' : '#ffffff';
  // The map draws a marker from a snapshot of its view. Taken before the mode picture has loaded, the
  // snapshot keeps an empty gap where the picture belongs, so the view is followed until it has loaded.
  const [drawn, setDrawn] = useState(false);
  const onGlyphLoad = () => setDrawn(true);
  // The arrow turns in steps, so a vehicle's view is only redrawn when it has turned noticeably.
  const bearing = arrowBearing(vehicle);
  const firstDraw = useRef(true);
  useEffect(() => {
    // Follow the view again while the arrow turns, then stop. The first time, stop after a while even if
    // the picture never reports in.
    if (!firstDraw.current) setDrawn(false);
    const timer = setTimeout(() => setDrawn(true), firstDraw.current ? 1500 : 400);
    firstDraw.current = false;
    return () => clearTimeout(timer);
  }, [bearing]);
  // The arrow sits just outside the icon or name tag, so the marker's view leaves room for it all round.
  const [half, setHalf] = useState(() => (labelled ? tagHalf(label) : DOT_HALF));
  const box = labelled ? { w: Math.max(tagHalf(label).w, half.w), h: Math.max(tagHalf(label).h, half.h) } : DOT_HALF;
  const width = 2 * (box.w + ARROW_ROOM);
  const height = 2 * (box.h + ARROW_ROOM);
  return (
    <Marker
      identifier={vehicle.id}
      coordinate={{ latitude: vehicle.lat, longitude: vehicle.lon }}
      anchor={{ x: 0.5, y: 0.5 }}
      // Redrawing a marker's view is the expensive part; once its picture is in, ours only changes when its props do.
      tracksViewChanges={!drawn}
      zIndex={selected ? 2 : 1}
      onPress={() => onPress(vehicle.id)}
      accessibilityLabel={`${label} ${vehicle.mode}`}
    >
      <View style={{ width, height, alignItems: 'center', justifyContent: 'center' }} collapsable={false}>
        {bearing !== undefined && (
          <Arrow bearing={bearing} half={selected ? { w: half.w * 1.25, h: half.h * 1.25 } : half} color={color} outline={border} />
        )}
        {labelled ? (
          <View
            style={[
              styles.tag,
              TAG_CORNERS[vehicle.mode],
              { backgroundColor: color, borderColor: border },
              selected && styles.selected,
            ]}
            onLayout={(e) => setHalf({ w: e.nativeEvent.layout.width / 2, h: e.nativeEvent.layout.height / 2 })}
          >
            <Image source={GLYPHS[vehicle.mode]} style={[styles.tagGlyph, { tintColor: ink }]} onLoad={onGlyphLoad} />
            {!!label && (
              <Text style={[styles.label, { color: ink }]} numberOfLines={1}>
                {label}
              </Text>
            )}
          </View>
        ) : (
          <View style={[selected && styles.selectedIcon, vehicle.source === 'estimated' && styles.estimated]}>
            <ModeIcon
              mode={vehicle.mode}
              size={20}
              color={color}
              ink={ink}
              border={{ color: border, width: selected ? 2.5 : 1.5 }}
              onLoad={onGlyphLoad}
            />
          </View>
        )}
      </View>
    </Marker>
  );
}, sameDot);

/** Half the size of a plain icon, which is 20 points across. */
const DOT_HALF = { w: 10, h: 10 };
/** The arrow's size, and the room around the icon kept for it (the tapped vehicle is drawn a quarter bigger). */
const ARROW_SIZE = 11;
const ARROW_GAP = 2;
const ARROW_ROOM = ARROW_SIZE + ARROW_GAP + 6;

/** A name tag's size worked out from its text, close enough to leave room for the arrow before it is laid out. */
function tagHalf(label: string): { w: number; h: number } {
  return { w: (5 * 2 + 3 + 13 + 3 + label.length * 7) / 2, h: 11 };
}

/** The way the vehicle is heading, rounded to steps of 15°, or nothing when its feed doesn't say. */
function arrowBearing(v: Vehicle): number | undefined {
  if (v.bearing === undefined || v.bearing === null || Number.isNaN(v.bearing)) return undefined;
  return (Math.round(v.bearing / 15) * 15) % 360;
}

/**
 * An arrowhead just outside the icon's edge on the side the vehicle is heading. A box `half` wide and high
 * is taken as the icon's edge, which is close enough for round icons and name tags alike.
 */
function Arrow({ bearing, half, color, outline }: { bearing: number; half: { w: number; h: number }; color: string; outline: string }) {
  const rad = (bearing * Math.PI) / 180;
  const [dx, dy] = [Math.sin(rad), -Math.cos(rad)];
  const toEdge = Math.min(dx ? half.w / Math.abs(dx) : Infinity, dy ? half.h / Math.abs(dy) : Infinity);
  const out = toEdge + ARROW_GAP + ARROW_SIZE / 2;
  return (
    <View
      pointerEvents="none"
      style={[
        styles.arrow,
        { transform: [{ translateX: dx * out }, { translateY: dy * out }, { rotate: `${bearing}deg` }] },
      ]}
    >
      {/* A triangle drawn with borders: the outline color behind, the line's color on top. */}
      <View style={[styles.arrowHead, styles.arrowOutline, { borderBottomColor: outline }]} />
      <View style={[styles.arrowHead, { borderBottomColor: color }]} />
    </View>
  );
}

/** Name tags keep a hint of their mode's outline: round for subway, square-ish for buses, sharp for rail. */
const TAG_CORNERS = {
  subway: { borderRadius: 11 },
  bus: { borderRadius: 6 },
  rail: { borderRadius: 2 },
} as const;

/** Every poll brings new vehicle objects; only the dots that look different or have moved are redrawn. */
function sameDot(a: Props, b: Props): boolean {
  const [v, w] = [a.vehicle, b.vehicle];
  return (
    a.labelled === b.labelled &&
    a.selected === b.selected &&
    a.dark === b.dark &&
    a.onPress === b.onPress &&
    v.id === w.id &&
    v.lat === w.lat &&
    v.lon === w.lon &&
    v.mode === w.mode &&
    v.source === w.source &&
    v.routeId === w.routeId &&
    v.routeName === w.routeName &&
    v.routeColor === w.routeColor &&
    arrowBearing(v) === arrowBearing(w)
  );
}

const styles = StyleSheet.create({
  tag: {
    flexDirection: 'row',
    gap: 3,
    minWidth: 24,
    height: 22,
    paddingHorizontal: 5,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tagGlyph: { width: 13, height: 13 },
  selected: { borderWidth: 3, transform: [{ scale: 1.25 }] },
  selectedIcon: { transform: [{ scale: 1.25 }] },
  estimated: { opacity: 0.9 },
  label: { fontSize: 11, fontWeight: '700' },
  arrow: { position: 'absolute', width: ARROW_SIZE, height: ARROW_SIZE, alignItems: 'center', justifyContent: 'center' },
  arrowHead: {
    position: 'absolute',
    top: 1.5,
    width: 0,
    height: 0,
    borderLeftWidth: 4.5,
    borderRightWidth: 4.5,
    borderBottomWidth: 8,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  arrowOutline: { top: -1, borderLeftWidth: 6.5, borderRightWidth: 6.5, borderBottomWidth: 11.5 },
  stopHit: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  stopDot: { width: 10, height: 10, borderRadius: 5, borderWidth: 2.5 },
  smallStopDot: { width: 8, height: 8, borderRadius: 4, borderWidth: 2 },
});

interface StopProps {
  stop: UpcomingStop;
  /** The line the stop is drawn for, handed back on a tap. */
  lineKey: string;
  color: string | undefined;
  background: string;
  /** Stations of other lines are drawn a little smaller. */
  small?: boolean;
  onPress: (stop: UpcomingStop, lineKey: string) => void;
}

/** A station on a drawn line. Kept apart so a vehicle update doesn't redraw every station too. */
export const StopMarker = memo(function StopMarker({ stop, lineKey, color, background, small, onPress }: StopProps) {
  return (
    <Marker
      coordinate={{ latitude: stop.lat!, longitude: stop.lon! }}
      anchor={{ x: 0.5, y: 0.5 }}
      tracksViewChanges={false}
      onPress={() => onPress(stop, lineKey)}
      accessibilityLabel={stop.name}
    >
      {/* The dot is far smaller than a fingertip, so a clear square around it takes the tap. The square only
          lays things out, so React Native would drop it and the map would center the dot's corner on the
          station instead; collapsable={false} keeps it. */}
      <View style={styles.stopHit} collapsable={false}>
        <View style={[styles.stopDot, small && styles.smallStopDot, { borderColor: color, backgroundColor: background }]} />
      </View>
    </Marker>
  );
});
