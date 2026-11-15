import { HStack, ProgressView, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import {
  background,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  minimumScaleFactor,
  monospacedDigit,
  multilineTextAlignment,
  padding,
  shapes,
  tint,
} from '@expo/ui/swift-ui/modifiers';
import { createLiveActivity, type LiveActivityEnvironment } from 'expo-widgets';
import type { TrackProps } from '../../../web/src/tracking';

/**
 * A train or bus followed to a station, on the Lock Screen and in the Dynamic Island. Its countdown
 * and progress bar run on their own, so they stay right between updates from the app or the server.
 *
 * Like the widget, this runs apart from the app and can only use its own body, props and environment.
 * The name must match ACTIVITY_NAME in server/src/liveActivities.ts, which pushes updates to it.
 */
const TrackActivity = (props: TrackProps, environment: LiveActivityEnvironment) => {
  'widget';
  const muted = { type: 'hierarchical', style: 'secondary' } as const;
  const over = props.phase === 'gone' || props.phase === 'lost';
  const now = Date.now();
  const hasTime = props.arrival !== undefined && props.arrival > now && props.phase === 'coming';
  const stale = environment.isStale === true;
  // Its time has come but no update has said it arrived yet.
  const due = props.phase === 'coming' && props.arrival !== undefined && props.arrival <= now;

  // A bullet for subway lines, a rounded tag for buses and rail.
  const badge = (size: number) => (
    <Text
      modifiers={[
        font({ size: size * 0.5, weight: 'heavy' }),
        foregroundStyle(props.textColor),
        lineLimit(1),
        minimumScaleFactor(0.5),
        padding({ horizontal: props.mode === 'subway' ? 0 : 5 }),
        frame({ minWidth: size, minHeight: size }),
        background(props.color, props.mode === 'subway' ? shapes.circle() : shapes.roundedRectangle({ cornerRadius: 6 })),
      ]}
    >
      {props.line}
    </Text>
  );

  const headline =
    props.phase === 'arrived'
      ? `At ${props.stop}`
      : props.phase === 'arriving'
        ? `Arriving at ${props.stop}`
        : props.phase === 'gone'
          ? `Left ${props.stop}`
          : props.phase === 'lost'
            ? 'Lost its live position'
            : `To ${props.stop}`;

  const away =
    props.phase !== 'coming'
      ? ''
      : props.stopsAway === 0
        ? 'Next stop'
        : `${props.stopsAway} stop${props.stopsAway === 1 ? '' : 's'} away`;

  // The time left as a clock that counts itself down; words once there's no time to count.
  const countdown = (size: number, width: number) =>
    hasTime ? (
      <Text
        timerInterval={{ lower: new Date(Math.min(now, props.arrival!)), upper: new Date(props.arrival!) }}
        countsDown
        modifiers={[
          font({ size, weight: 'bold' }),
          monospacedDigit(),
          lineLimit(1),
          minimumScaleFactor(0.6),
          multilineTextAlignment('trailing'),
          frame({ width }),
        ]}
      />
    ) : (
      <Text modifiers={[font({ size: size * 0.8, weight: 'bold' }), lineLimit(1), minimumScaleFactor(0.6), multilineTextAlignment('trailing')]}>
        {props.phase === 'arrived' ? 'Here' : props.phase === 'arriving' || due ? 'Now' : over ? 'Done' : '–'}
      </Text>
    );

  const progress =
    hasTime && props.startedAt < props.arrival! ? (
      <ProgressView
        timerInterval={{ lower: new Date(props.startedAt), upper: new Date(props.arrival!) }}
        countsDown={false}
        modifiers={[tint(props.color)]}
      />
    ) : null;

  const status = (
    <HStack spacing={4}>
      <Text modifiers={[font({ size: 12 }), foregroundStyle(muted), lineLimit(1)]}>
        {stale ? 'Open the app to refresh ·' : props.gps ? 'Live GPS ·' : 'Estimated ·'}
      </Text>
      <Text date={new Date(props.updatedAt)} dateStyle="time" modifiers={[font({ size: 12 }), foregroundStyle(muted)]} />
    </HStack>
  );

  return {
    banner: (
      <VStack alignment="leading" spacing={8} modifiers={[padding({ all: 14 })]}>
        <HStack spacing={10}>
          {badge(34)}
          <VStack alignment="leading" spacing={2}>
            <Text modifiers={[font({ size: 16, weight: 'bold' }), lineLimit(1)]}>{headline}</Text>
            <Text modifiers={[font({ size: 13 }), foregroundStyle(muted), lineLimit(1)]}>
              {away ? `${props.where} · ${away}` : props.where}
            </Text>
          </VStack>
          <Spacer />
          {countdown(26, 84)}
        </HStack>
        {progress}
        {status}
      </VStack>
    ),
    compactLeading: badge(22),
    compactTrailing: hasTime ? (
      <Text
        timerInterval={{ lower: new Date(Math.min(now, props.arrival!)), upper: new Date(props.arrival!) }}
        countsDown
        modifiers={[font({ size: 14, weight: 'semibold' }), monospacedDigit(), lineLimit(1), minimumScaleFactor(0.6), frame({ width: 46 })]}
      />
    ) : (
      <Text modifiers={[font({ size: 14, weight: 'semibold' })]}>
        {props.phase === 'arrived' ? 'Here' : props.phase === 'arriving' || due ? 'Now' : over ? 'Done' : '–'}
      </Text>
    ),
    minimal: badge(22),
    expandedLeading: <VStack modifiers={[padding({ leading: 4, top: 4 })]}>{badge(34)}</VStack>,
    expandedTrailing: <VStack modifiers={[padding({ trailing: 4, top: 4 })]}>{countdown(24, 84)}</VStack>,
    expandedCenter: (
      <VStack spacing={2}>
        <Text modifiers={[font({ size: 15, weight: 'bold' }), lineLimit(1)]}>{headline}</Text>
        <Text modifiers={[font({ size: 12 }), foregroundStyle(muted), lineLimit(1)]}>{away || props.where}</Text>
      </VStack>
    ),
    expandedBottom: (
      <VStack alignment="leading" spacing={6} modifiers={[padding({ horizontal: 8, bottom: 4 })]}>
        {progress}
        <HStack>
          <Text modifiers={[font({ size: 12 }), foregroundStyle(muted), lineLimit(1)]}>{props.where}</Text>
          <Spacer />
          <Text modifiers={[font({ size: 12 }), foregroundStyle(muted), lineLimit(1)]}>
            {stale ? 'Not updated lately' : props.gps ? 'Live GPS' : 'Estimated'}
          </Text>
        </HStack>
      </VStack>
    ),
  };
};

export default createLiveActivity<TrackProps>('TrackVehicle', TrackActivity);
