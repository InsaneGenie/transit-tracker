import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Marker } from 'react-native-maps';
import { colorFor, displayName, textColorFor } from '../../web/src/vehicles';
import type { UpcomingStop, Vehicle } from './api';

interface Props {
  vehicle: Vehicle;
  labelled: boolean;
  selected: boolean;
  dark: boolean;
  onPress: (id: string) => void;
}

/** A dot in the line's color, with the line's name on it when zoomed in. */
export const VehicleMarker = memo(function VehicleMarker({ vehicle, labelled, selected, dark, onPress }: Props) {
  const color = colorFor(vehicle);
  const label = displayName(vehicle.routeName ?? vehicle.routeId ?? '');
  return (
    <Marker
      identifier={vehicle.id}
      coordinate={{ latitude: vehicle.lat, longitude: vehicle.lon }}
      anchor={{ x: 0.5, y: 0.5 }}
      // Redrawing a marker's view is the expensive part; ours only changes when its props do.
      tracksViewChanges={false}
      zIndex={selected ? 2 : 1}
      onPress={() => onPress(vehicle.id)}
      accessibilityLabel={`${label} ${vehicle.mode}`}
    >
      <View
        style={[
          labelled ? styles.pill : styles.dot,
          { backgroundColor: color, borderColor: selected ? (dark ? '#f9fafb' : '#111827') : dark ? '#111827' : '#ffffff' },
          selected && styles.selected,
          vehicle.source === 'estimated' && !labelled && styles.estimated,
        ]}
      >
        {labelled && (
          <Text style={[styles.label, { color: textColorFor(color) }]} numberOfLines={1}>
            {label}
          </Text>
        )}
      </View>
    </Marker>
  );
}, sameDot);

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
    v.routeColor === w.routeColor
  );
}

const styles = StyleSheet.create({
  dot: { width: 12, height: 12, borderRadius: 6, borderWidth: 1.5 },
  pill: {
    minWidth: 24,
    height: 22,
    paddingHorizontal: 5,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selected: { borderWidth: 3, transform: [{ scale: 1.25 }] },
  estimated: { opacity: 0.9 },
  label: { fontSize: 11, fontWeight: '700' },
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
      {/* The dot is far smaller than a fingertip, so a clear square around it takes the tap. */}
      <View style={styles.stopHit}>
        <View style={[styles.stopDot, small && styles.smallStopDot, { borderColor: color, backgroundColor: background }]} />
      </View>
    </Marker>
  );
});
