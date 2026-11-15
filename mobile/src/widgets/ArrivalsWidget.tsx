import { Circle, HStack, Spacer, Text, VStack, ZStack } from '@expo/ui/swift-ui';
import {
  background,
  containerBackground,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  minimumScaleFactor,
  monospacedDigit,
  padding,
  shapes,
  widgetURL,
} from '@expo/ui/swift-ui/modifiers';
import { createWidget, type WidgetEnvironment } from 'expo-widgets';
import type { WidgetProps } from '../../../web/src/widgetTimeline';

/** Which saved station a widget shows, chosen by holding the widget and tapping Edit Widget. */
export type ArrivalsWidgetConfiguration = { station?: string };

/**
 * The Home Screen and Lock Screen widget: the next trains or buses at a station saved in the app.
 *
 * This function runs inside the widget, apart from the app, so it can't use anything from outside its
 * own body (not even constants from this file): only its props, its environment and Expo UI.
 */
const ArrivalsWidget = (props: WidgetProps, environment: WidgetEnvironment<ArrivalsWidgetConfiguration>) => {
  'widget';
  const family = environment.widgetFamily ?? 'systemSmall';
  const lockScreen = family === 'accessoryRectangular' || family === 'accessoryInline' || family === 'accessoryCircular';
  const dark = environment.colorScheme === 'dark';
  const muted = { type: 'hierarchical', style: 'secondary' } as const;
  const surface = dark ? '#111827' : '#ffffff';
  const stations = props.stations ?? [];
  const wanted = environment.configuration?.station;
  const shown = stations.find((s) => s.id === wanted) ?? stations[0];
  const link = shown
    ? `nytransitlive://station?id=${encodeURIComponent(shown.id)}`
    : 'nytransitlive://widget';

  const times = (minutes: number[]) => {
    if (!minutes.length) return '';
    const rest = minutes.filter((m, i) => i > 0 || m > 0);
    if (minutes[0] === 0) return rest.length ? `Now, ${rest.join(', ')} min` : 'Now';
    return `${minutes.join(', ')} min`;
  };
  const soonest = (minutes: number[]) => (minutes[0] === 0 ? 'Now' : `${minutes[0]} min`);

  const badge = (size: number) =>
    shown && (
      <Text
        modifiers={[
          font({ size: size * 0.5, weight: 'heavy' }),
          foregroundStyle(lockScreen ? 'primary' : shown.textColor),
          lineLimit(1),
          minimumScaleFactor(0.5),
          padding({ horizontal: shown.round ? 0 : 6 }),
          frame({ minWidth: size, minHeight: size }),
          background(lockScreen ? { type: 'hierarchical', style: 'tertiary' } : shown.color, shown.round ? shapes.circle() : shapes.roundedRectangle({ cornerRadius: 6 })),
        ]}
      >
        {shown.badge}
      </Text>
    );

  const footer =
    props.state === 'old' ? (
      <Text modifiers={[font({ size: 11 }), foregroundStyle(muted), lineLimit(1)]}>Open the app for new times</Text>
    ) : props.updatedAt > 0 ? (
      <HStack spacing={3}>
        <Text modifiers={[font({ size: 11 }), foregroundStyle(muted)]}>As of</Text>
        <Text date={new Date(props.updatedAt)} dateStyle="time" modifiers={[font({ size: 11 }), foregroundStyle(muted)]} />
      </HStack>
    ) : null;

  // Nothing saved yet, or the times ran out.
  if (!shown || props.state !== 'ok') {
    const message = !shown ? 'Tap a station in NY Transit Live, then Add to widget.' : 'Open the app for new times';
    if (family === 'accessoryInline') return <Text modifiers={[widgetURL(link)]}>{!shown ? 'Add a station' : 'Open for new times'}</Text>;
    if (family === 'accessoryCircular') {
      return (
        <ZStack modifiers={[widgetURL(link), containerBackground({ type: 'hierarchical', style: 'quaternary' }, 'widget')]}>
          <Circle modifiers={[foregroundStyle({ type: 'hierarchical', style: 'quaternary' })]} />
          <Text modifiers={[font({ size: 20, weight: 'bold' })]}>{shown ? shown.badge : '+'}</Text>
        </ZStack>
      );
    }
    return (
      <VStack
        alignment="leading"
        spacing={6}
        modifiers={[widgetURL(link), containerBackground(lockScreen ? 'clear' : surface, 'widget'), frame({ maxWidth: 10000, maxHeight: 10000, alignment: 'topLeading' })]}
      >
        <HStack spacing={6}>
          {badge(lockScreen ? 18 : 26)}
          <Text modifiers={[font({ size: lockScreen ? 14 : 15, weight: 'bold' }), lineLimit(1)]}>{shown ? shown.station : 'Next trains'}</Text>
        </HStack>
        <Text modifiers={[font({ size: lockScreen ? 12 : 13 }), foregroundStyle(muted), lineLimit(3)]}>{message}</Text>
        {!lockScreen && <Spacer />}
        {!lockScreen && footer}
      </VStack>
    );
  }

  const directions = shown.directions;
  const first = directions[0];

  if (family === 'accessoryInline') {
    return (
      <Text modifiers={[widgetURL(link)]}>
        {first ? `${shown.badge} ${soonest(first.minutes)} · ${shown.station}` : `${shown.badge} · ${shown.station}`}
      </Text>
    );
  }

  if (family === 'accessoryCircular') {
    return (
      <ZStack modifiers={[widgetURL(link), containerBackground({ type: 'hierarchical', style: 'quaternary' }, 'widget')]}>
        <Circle modifiers={[foregroundStyle({ type: 'hierarchical', style: 'quaternary' })]} />
        <VStack spacing={0}>
          <Text modifiers={[font({ size: 12, weight: 'heavy' }), lineLimit(1), minimumScaleFactor(0.5)]}>{shown.badge}</Text>
          <Text modifiers={[font({ size: 18, weight: 'bold' }), monospacedDigit(), lineLimit(1), minimumScaleFactor(0.5)]}>
            {first ? (first.minutes[0] === 0 ? 'Now' : String(first.minutes[0])) : '–'}
          </Text>
          {first && first.minutes[0] !== 0 && <Text modifiers={[font({ size: 9 })]}>min</Text>}
        </VStack>
      </ZStack>
    );
  }

  if (family === 'accessoryRectangular') {
    return (
      <VStack alignment="leading" spacing={1} modifiers={[widgetURL(link), containerBackground('clear', 'widget'), frame({ maxWidth: 10000, alignment: 'leading' })]}>
        <HStack spacing={4}>
          {badge(16)}
          <Text modifiers={[font({ size: 14, weight: 'bold' }), lineLimit(1)]}>{shown.station}</Text>
        </HStack>
        {directions.length ? (
          directions.slice(0, 2).map((d) => (
            <HStack key={d.to} spacing={4}>
              <Text modifiers={[font({ size: 13 }), lineLimit(1), foregroundStyle(muted)]}>{d.to}</Text>
              <Spacer />
              <Text modifiers={[font({ size: 13, weight: 'semibold' }), monospacedDigit(), lineLimit(1)]}>{times(d.minutes.slice(0, 2))}</Text>
            </HStack>
          ))
        ) : (
          <Text modifiers={[font({ size: 13 }), foregroundStyle(muted)]}>Nothing on the way</Text>
        )}
      </VStack>
    );
  }

  const medium = family === 'systemMedium';
  return (
    <VStack
      alignment="leading"
      spacing={medium ? 8 : 4}
      modifiers={[widgetURL(link), containerBackground(surface, 'widget'), frame({ maxWidth: 10000, maxHeight: 10000, alignment: 'topLeading' })]}
    >
      <HStack spacing={6}>
        {badge(medium ? 28 : 22)}
        <Text modifiers={[font({ size: medium ? 16 : 14, weight: 'bold' }), lineLimit(1), minimumScaleFactor(0.8)]}>{shown.station}</Text>
      </HStack>
      {directions.length ? (
        directions.slice(0, 2).map((d) => (
          <VStack key={d.to} alignment="leading" spacing={1}>
            <Text modifiers={[font({ size: 11, weight: 'semibold' }), foregroundStyle(muted), lineLimit(1)]}>{`To ${d.to}`}</Text>
            {medium ? (
              <HStack spacing={6} alignment="firstTextBaseline">
                <Text modifiers={[font({ size: 22, weight: 'bold' }), monospacedDigit(), lineLimit(1)]}>{soonest(d.minutes)}</Text>
                <Text modifiers={[font({ size: 13 }), foregroundStyle(muted), monospacedDigit(), lineLimit(1)]}>
                  {d.minutes.length > 1 ? `then ${d.minutes.slice(1).join(', ')} min` : ''}
                </Text>
                <Spacer />
                <Text modifiers={[font({ size: 12 }), foregroundStyle(muted), lineLimit(1)]}>{d.away}</Text>
              </HStack>
            ) : (
              <Text modifiers={[font({ size: 16, weight: 'bold' }), monospacedDigit(), lineLimit(1), minimumScaleFactor(0.7)]}>{times(d.minutes)}</Text>
            )}
          </VStack>
        ))
      ) : (
        <Text modifiers={[font({ size: 13 }), foregroundStyle(muted)]}>{shown.round ? 'No trains on the way right now' : 'Nothing on the way right now'}</Text>
      )}
      <Spacer />
      {footer}
    </VStack>
  );
};

export default createWidget<WidgetProps, ArrivalsWidgetConfiguration>('NextArrivals', ArrivalsWidget, {
  stations: [],
  updatedAt: 0,
  state: 'empty',
});
