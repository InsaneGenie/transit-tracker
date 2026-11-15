import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

type Modules = {
  ArrivalsWidget: typeof import('./ArrivalsWidget').default;
  TrackActivity: typeof import('./TrackActivity').default;
};

let loaded: Modules | null | undefined;

/**
 * The widget and Live Activity, or null where they can't run: Android, the website preview, and Expo Go,
 * which lacks the native part. They are loaded only when asked for, since loading them registers them
 * with iOS, which fails without that native part.
 */
export function widgetModules(): Modules | null {
  if (loaded !== undefined) return loaded;
  loaded = null;
  if (Platform.OS !== 'ios' || !requireOptionalNativeModule('ExpoWidgets')) return loaded;
  try {
    loaded = {
      ArrivalsWidget: require('./ArrivalsWidget').default,
      TrackActivity: require('./TrackActivity').default,
    };
  } catch (err) {
    console.warn('Widgets could not be loaded', err);
  }
  return loaded;
}
