import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Marker } from 'react-native-maps';
import { colorFor, displayName, textColorFor } from '../../web/src/vehicles';
import type { Vehicle } from './api';

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
});

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
});
