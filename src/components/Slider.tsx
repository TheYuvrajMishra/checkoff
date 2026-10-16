import { useEffect, useMemo, useRef, useState } from 'react';
import {
  PanResponder,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { haptics } from '../haptics';
import { HIT_SLOP, radius, space, TAP, type, useTheme } from '../theme/tokens';
import { PressableScale } from './PressableScale';

interface Props {
  label?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  formatValue?: (val: number) => string;
  presets?: number[];
  onChange: (val: number) => void;
  style?: StyleProp<ViewStyle>;
}

/**
 * Tactile horizontal sliding counter with discrete detents.
 * - Fires `haptics.selection()` on every detent crossed during drag
 * - Fires `haptics.check()` (light impact) on release
 * - Displays a large live value readout in monospace tabular numerals
 * - Includes optional quick-detent pills for rapid precision
 */
export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  suffix = '',
  formatValue,
  presets,
  onChange,
  style,
}: Props) {
  const theme = useTheme();
  const [trackWidth, setTrackWidth] = useState(0);
  const [liveValue, setLiveValue] = useState(value);
  const [dragging, setDragging] = useState(false);

  const trackWidthRef = useRef(0);
  const lastDetentRef = useRef(value);
  const startXRef = useRef(0);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!dragging) {
      setLiveValue(value);
      lastDetentRef.current = value;
    }
  }, [value, dragging]);

  const snapToDetent = (rawVal: number): number => {
    const clamped = Math.min(max, Math.max(min, rawVal));
    const steps = Math.round((clamped - min) / step);
    return Math.min(max, Math.max(min, min + steps * step));
  };

  const xToValue = (x: number, width: number): number => {
    if (width <= 0) return min;
    const ratio = Math.min(1, Math.max(0, x / width));
    return snapToDetent(min + ratio * (max - min));
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > Math.abs(g.dy),
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (evt) => {
          setDragging(true);
          const locX = evt.nativeEvent.locationX;
          startXRef.current = locX;
          const next = xToValue(locX, trackWidthRef.current);
          if (next !== lastDetentRef.current) {
            lastDetentRef.current = next;
            setLiveValue(next);
            onChangeRef.current(next);
            void haptics.selection();
          }
        },
        onPanResponderMove: (_, gestureState) => {
          const currentX = startXRef.current + gestureState.dx;
          const next = xToValue(currentX, trackWidthRef.current);
          if (next !== lastDetentRef.current) {
            lastDetentRef.current = next;
            setLiveValue(next);
            onChangeRef.current(next);
            void haptics.selection();
          }
        },
        onPanResponderRelease: () => {
          setDragging(false);
          void haptics.check();
        },
        onPanResponderTerminate: () => {
          setDragging(false);
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [min, max, step]
  );

  const onTrackLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    trackWidthRef.current = w;
    setTrackWidth(w);
  };

  const displayVal = dragging ? liveValue : value;
  const fraction = max > min ? Math.min(1, Math.max(0, (displayVal - min) / (max - min))) : 0;
  const readout = formatValue ? formatValue(displayVal) : `${displayVal}${suffix}`;

  // Up to 21 visible tick marks along the track
  const totalSteps = Math.max(1, Math.round((max - min) / step));
  const tickCount = Math.min(21, totalSteps + 1);
  const ticks = Array.from({ length: tickCount }, (_, i) => i / Math.max(1, tickCount - 1));

  return (
    <View style={[styles.container, style]}>
      <View style={styles.headerRow}>
        {label ? (
          <Text
            numberOfLines={1}
            style={[styles.label, { color: theme.textDim }]}
          >
            {label.toUpperCase()}
          </Text>
        ) : <View />}
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          style={[styles.readout, { color: theme.text }]}
        >
          {readout}
        </Text>
      </View>

      <View
        onLayout={onTrackLayout}
        {...panResponder.panHandlers}
        style={[
          styles.trackTouchArea,
          {
            backgroundColor: theme.surface2,
            borderColor: dragging ? theme.borderStrong : theme.border,
          },
        ]}
      >
        {/* Detent ruler ticks */}
        <View style={styles.ticksRow} pointerEvents="none">
          {ticks.map((t, i) => (
            <View
              key={i}
              style={[
                styles.tick,
                {
                  height: i === 0 || i === ticks.length - 1 || i === Math.floor(ticks.length / 2) ? 12 : 6,
                  backgroundColor: t <= fraction ? theme.bg : theme.textFaint,
                  opacity: t <= fraction ? 0.35 : 0.45,
                },
              ]}
            />
          ))}
        </View>

        {/* Active fill bar */}
        <View
          pointerEvents="none"
          style={[
            styles.fill,
            {
              width: `${Math.round(fraction * 100)}%`,
              backgroundColor: theme.text,
            },
          ]}
        />

        {/* Scrubber thumb indicator */}
        {trackWidth > 0 && (
          <View
            pointerEvents="none"
            style={[
              styles.thumb,
              {
                left: Math.min(
                  Math.max(4, fraction * trackWidth - 10),
                  Math.max(4, trackWidth - 24)
                ),
                backgroundColor: theme.text,
                borderColor: theme.bg,
                transform: [{ scaleY: dragging ? 1.08 : 1 }],
              },
            ]}
          >
            <View style={[styles.thumbCore, { backgroundColor: theme.bg }]} />
          </View>
        )}
      </View>

      {presets && presets.length > 0 && (
        <View style={styles.presetsRow}>
          {presets.map((p) => {
            const active = displayVal === p;
            const pText = formatValue ? formatValue(p) : `${p}${suffix}`;
            return (
              <PressableScale
                key={p}
                hitSlop={HIT_SLOP}
                onPress={() => {
                  lastDetentRef.current = p;
                  setLiveValue(p);
                  onChange(p);
                }}
                style={styles.presetWrap}
                innerStyle={[
                  styles.presetPill,
                  {
                    backgroundColor: active ? theme.text : theme.surface2,
                    borderColor: active ? theme.text : theme.border,
                  },
                ]}
              >
                <Text
                  numberOfLines={1}
                  style={[
                    styles.presetText,
                    { color: active ? theme.bg : theme.textDim },
                  ]}
                >
                  {pText}
                </Text>
              </PressableScale>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: space(1),
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: space(1),
  },
  label: {
    ...type.caption,
    letterSpacing: 1,
    flexShrink: 1,
  },
  readout: {
    ...type.h2,
    fontFamily: 'monospace',
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  trackTouchArea: {
    height: TAP,
    borderRadius: radius.md,
    borderWidth: 1,
    justifyContent: 'center',
    overflow: 'hidden',
    position: 'relative',
  },
  fill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    opacity: 0.9,
  },
  ticksRow: {
    position: 'absolute',
    left: space(1.5),
    right: space(1.5),
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 2,
  },
  tick: {
    width: 1.5,
    borderRadius: 1,
  },
  thumb: {
    position: 'absolute',
    width: 20,
    height: 36,
    borderRadius: 8,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 3,
  },
  thumbCore: {
    width: 2,
    height: 14,
    borderRadius: 1,
  },
  presetsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space(0.75),
  },
  presetWrap: {
    flexGrow: 1,
  },
  presetPill: {
    minHeight: 38,
    paddingHorizontal: space(1.25),
    borderRadius: radius.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  presetText: {
    ...type.mono,
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
});
