/**
 * Floating liquid-glass bottom tab bar (React Native Skia).
 * - Tabs in exact order: Today, Stats, Calendar, Rewards, Settings.
 * - Glass pill: expo-blur base + Skia RuntimeEffect overlay (refractive edge
 *   wobble, top-biased specular rim, soft inner shadow). Falls back to the
 *   BlurView-only pill when Skia is unavailable (e.g. Expo Go).
 * - Active indicator: glass blob sliding between tabs on a no-overshoot
 *   spring, with a quick stretch-and-settle on travel + a light haptic tick
 *   on tab change.
 * - Lucide vector icons only (no emoji), 48dp minimum touch targets.
 * - Respects gesture-navigation bottom insets; same geometry (64dp pill at
 *   max(insets.bottom, 8) + 8) as before so the FAB dock stays clear.
 * - Rewards tab shows a small accent dot when a daily reward is claimable.
 *   The 60s badge poll is isolated in its own memoized component so it
 *   never re-renders the bar.
 */
import { Component, memo, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { Tabs } from 'expo-router';
import { BlurView } from 'expo-blur';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  CalendarDays,
  ChartColumn,
  Gift,
  SlidersHorizontal,
  Sun,
} from 'lucide-react-native';
import { HIT_SLOP, radius, space, TAP, type, useTheme } from '../../theme/tokens';
import { PressableScale } from '../../components/PressableScale';
import { isDailyRewardClaimable } from '../../rewards/engine';
import { useDb } from '../../db/useDb';
import { haptics } from '../../haptics';

// ---------------------------------------------------------------------------
// Skia availability gate.
// The native Skia module is NOT bundled with Expo Go, so a static import
// would crash there. We require() it defensively and additionally wrap the
// Canvas in an error boundary — either way we fall back to the BlurView pill.
// ---------------------------------------------------------------------------
type SkiaModule = typeof import('@shopify/react-native-skia');

let SkiaLib: SkiaModule | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  SkiaLib = require('@shopify/react-native-skia') as SkiaModule;
} catch {
  SkiaLib = null;
}

/** Catches Skia render-time failures (missing native module, bad shader). */
class SkiaErrorBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(): void {
    // Swallowed: the fallback pill renders instead.
  }

  render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

// ---------------------------------------------------------------------------
// Liquid-glass edge shader (static — no animated uniforms, zero per-frame
// cost). Draws only the pill border region:
//  - refractive edge: the ring boundary is displaced by a few px of smooth
//    sinusoidal wobble, like light bending at a glass edge;
//  - specular rim: thin bright ring, stronger at the top (light from above),
//    fading toward the bottom;
//  - inner shadow: soft dark band just inside the edge for depth.
// Everything else is transparent so the BlurView beneath shows through.
// ---------------------------------------------------------------------------
const GLASS_SHADER = `
uniform vec2 u_size;
uniform float u_radius;

float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

vec4 main(vec2 xy) {
  vec2 p = xy - u_size * 0.5;
  vec2 b = u_size * 0.5 - vec2(1.0);
  float d = sdRoundBox(p, b, u_radius);

  // Refractive edge wobble: displace the ring by a few px.
  float wob = sin(p.x * 0.32) * 1.1 + sin(p.y * 0.47 + 1.7) * 0.7;
  float dw = abs(d - wob * 0.4);

  // Specular rim: thin bright ring, top-biased.
  float ring = 1.0 - smoothstep(1.4, 3.0, dw);
  float topBias = 1.0 - smoothstep(-0.45, 0.75, p.y / max(b.y, 1.0));
  float spec = ring * (0.18 + 0.82 * topBias);
  vec3 col = vec3(1.0) * spec * 0.85;
  float a = spec * 0.85;

  // Inner shadow: soft dark band just inside the edge.
  float t = clamp(d / 11.0, 0.0, 1.0);
  float innerA = (1.0 - t) * (1.0 - t) * step(0.0, d) * 0.32;
  col = mix(col, vec3(0.0), innerA / max(a + innerA, 0.0001));
  a = a + innerA * (1.0 - a);

  // Faint refraction spill just outside the edge.
  float outer = (1.0 - smoothstep(0.0, 6.0, -d)) * (1.0 - step(0.0, d));
  col += vec3(1.0) * outer * 0.05;
  a += outer * 0.05;

  return vec4(col, clamp(a, 0.0, 1.0));
}
`;

const SkiaGlassOverlay = memo(function SkiaGlassOverlay({
  width,
  height,
}: {
  width: number;
  height: number;
}) {
  const effect = useMemo(() => {
    if (!SkiaLib) return null;
    try {
      return SkiaLib.Skia.RuntimeEffect.Make(GLASS_SHADER);
    } catch {
      return null;
    }
  }, []);

  if (!SkiaLib || !effect) return null;
  const { Canvas, Fill, Shader } = SkiaLib;

  return (
    <Canvas style={[StyleSheet.absoluteFill, { width, height }]} pointerEvents="none">
      <Fill>
        <Shader
          source={effect}
          uniforms={{ u_size: [width, height], u_radius: radius.xl }}
        />
      </Fill>
    </Canvas>
  );
});

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------
const VISIBLE_TAB_ORDER = ['index', 'stats', 'calendar', 'rewards', 'settings'] as const;

const TAB_META: Record<
  string,
  { label: string; Icon: typeof Sun; badge?: 'claimable' }
> = {
  index: { label: 'Today', Icon: Sun },
  stats: { label: 'Stats', Icon: ChartColumn },
  calendar: { label: 'Calendar', Icon: CalendarDays },
  rewards: { label: 'Rewards', Icon: Gift, badge: 'claimable' },
  settings: { label: 'Settings', Icon: SlidersHorizontal },
};

const CLAIMABLE_POLL_MS = 60_000;

function useClaimableBadge(): boolean {
  const db = useDb();
  const [claimable, setClaimable] = useState(false);
  useEffect(() => {
    let mounted = true;
    const check = async () => {
      try {
        const v = await isDailyRewardClaimable(db);
        if (mounted) setClaimable(v);
      } catch {
        // badge is best-effort
      }
    };
    void check();
    const timer = setInterval(check, CLAIMABLE_POLL_MS);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void check();
    });
    return () => {
      mounted = false;
      clearInterval(timer);
      sub.remove();
    };
  }, [db]);
  return claimable;
}

/** Isolated badge so the 60s poll never re-renders the tab bar. */
const ClaimableDot = memo(function ClaimableDot() {
  const theme = useTheme();
  const claimable = useClaimableBadge();
  if (!claimable) return null;
  return (
    <View
      style={[styles.badgeDot, { backgroundColor: theme.accent }]}
      accessibilityLabel="Daily reward claimable"
    />
  );
});

interface TabButtonProps {
  route: { key: string; name: string };
  focused: boolean;
  onPress: () => void;
}

const TabButton = memo(function TabButton({ route, focused, onPress }: TabButtonProps) {
  const theme = useTheme();
  const meta = TAB_META[route.name] ?? TAB_META.index;
  const Icon = meta.Icon;
  // Solid colors only — icons and labels stay fully legible over the glass.
  // White is the accent for the active tab; inactive tabs are muted.
  const color = focused ? '#FFFFFF' : theme.textFaint;

  return (
    <PressableScale
      key={route.key}
      scaleTo={0.97}
      hitSlop={HIT_SLOP}
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={meta.label}
      onPress={onPress}
      style={styles.tabWrap}
      innerStyle={styles.tabInner}
    >
      <View style={styles.iconWrap}>
        <Icon color={color} size={20} strokeWidth={focused ? 2.3 : 1.8} />
        {meta.badge === 'claimable' && <ClaimableDot />}
      </View>
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.75}
        style={[
          styles.tabLabel,
          {
            color,
            fontWeight: focused ? '700' : '500',
          },
        ]}
      >
        {meta.label}
      </Text>
    </PressableScale>
  );
});

// ---------------------------------------------------------------------------
// Indicator physics — no-overshoot spring + stretch-and-settle.
// ---------------------------------------------------------------------------
const INDICATOR_SPRING = { damping: 28, stiffness: 300, mass: 1 } as const;
const STRETCH_SPRING = { damping: 28, stiffness: 300, mass: 1 } as const;

const PILL_HEIGHT = 64;
const TRACK_HEIGHT = 52;
const BLOB_HEIGHT = 46;
const BLOB_WIDTH = 60;

interface TabBarProps {
  state: {
    index: number;
    routes: { key: string; name: string }[];
  };
  descriptors: Record<string, { options: { title?: string } }>;
  navigation: {
    emit: (e: { type: string; target: string; canPreventDefault: boolean }) => {
      defaultPrevented: boolean;
    };
    navigate: (name: string) => void;
  };
}

function FloatingTabBar({ state, navigation }: TabBarProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [trackWidth, setTrackWidth] = useState(0);
  const [pillSize, setPillSize] = useState({ width: 0, height: 0 });

  const visibleRoutes = useMemo(() => {
    const map = new Map(state.routes.map((r) => [r.name, r]));
    return VISIBLE_TAB_ORDER.map((name) => map.get(name)).filter(
      (r): r is { key: string; name: string } => Boolean(r)
    );
  }, [state.routes]);

  const currentRouteName = state.routes[state.index]?.name ?? 'index';
  // If user navigated to hidden 'log' screen inside (tabs), highlight 'settings'
  const activeVisibleIndex = useMemo(() => {
    const targetName = currentRouteName === 'log' ? 'settings' : currentRouteName;
    const idx = visibleRoutes.findIndex((r) => r.name === targetName);
    return idx >= 0 ? idx : 0;
  }, [currentRouteName, visibleRoutes]);

  const tabCount = Math.max(1, visibleRoutes.length);

  const activePos = useSharedValue(activeVisibleIndex);
  const slotW = useSharedValue(0);
  const stretch = useSharedValue(1);

  useEffect(() => {
    slotW.value = trackWidth / tabCount;
  }, [trackWidth, tabCount, slotW]);

  useEffect(() => {
    // No-overshoot slide between tabs + quick stretch-and-settle.
    activePos.value = withSpring(activeVisibleIndex, INDICATOR_SPRING);
    stretch.value = withSequence(
      withTiming(1.18, { duration: 110, easing: Easing.out(Easing.quad) }),
      withSpring(1, STRETCH_SPRING)
    );
  }, [activeVisibleIndex, activePos, stretch]);

  const blobSlotStyle = useAnimatedStyle(() => ({
    width: slotW.value,
    transform: [{ translateX: activePos.value * slotW.value }],
  }));
  const blobStretchStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: stretch.value }],
  }));

  // Light glass blob behind the active tab. Dark-tinted on the light theme
  // so the white active icon/label stays legible; light-tinted on dark.
  const blobBackground =
    theme.name === 'light' ? 'rgba(22, 22, 26, 0.62)' : 'rgba(255, 255, 255, 0.16)';
  const blobBorder =
    theme.name === 'light' ? 'rgba(255, 255, 255, 0.30)' : 'rgba(255, 255, 255, 0.35)';

  const bottomInset = Math.max(insets.bottom, 8) + 8;

  const handleTabPress = (route: { key: string; name: string }) => {
    // Light haptic tick on every tab change (no-op when haptics disabled).
    void haptics.light();
    const event = navigation.emit({
      type: 'tabPress',
      target: route.key,
      canPreventDefault: true,
    });
    if (!event.defaultPrevented) {
      navigation.navigate(route.name);
    }
  };

  return (
    <View
      style={[styles.wrap, { bottom: bottomInset, marginHorizontal: space(2) }]}
      pointerEvents="box-none"
    >
      <View
        style={[
          styles.pill,
          {
            borderColor: theme.borderStrong,
            backgroundColor:
              theme.name === 'light'
                ? 'rgba(255, 255, 255, 0.55)'
                : 'rgba(10, 10, 10, 0.55)',
          },
        ]}
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          setPillSize({ width, height });
        }}
      >
        {/* Backdrop blur base (works everywhere, incl. Expo Go). */}
        <BlurView
          intensity={100}
          tint={theme.name === 'light' ? 'light' : 'dark'}
          style={[StyleSheet.absoluteFill, { borderRadius: radius.xl }]}
        />

        {/* Skia liquid-glass edge effects; silent no-op on failure. */}
        <SkiaErrorBoundary fallback={null}>
          {pillSize.width > 0 && pillSize.height > 0 && (
            <SkiaGlassOverlay width={pillSize.width} height={pillSize.height} />
          )}
        </SkiaErrorBoundary>

        <View
          style={styles.tabsTrack}
          onLayout={(e) => {
            setTrackWidth(e.nativeEvent.layout.width);
          }}
        >
          {trackWidth > 0 && (
            <Animated.View
              pointerEvents="none"
              style={[styles.blobSlot, blobSlotStyle]}
            >
              <Animated.View style={blobStretchStyle}>
                <View
                  style={[
                    styles.blob,
                    { backgroundColor: blobBackground, borderColor: blobBorder },
                  ]}
                />
              </Animated.View>
            </Animated.View>
          )}

          {visibleRoutes.map((route, idx) => (
            <TabButton
              key={route.key}
              route={route}
              focused={activeVisibleIndex === idx}
              onPress={() => handleTabPress(route)}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <FloatingTabBar {...(props as unknown as TabBarProps)} />}
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen name="index" options={{ title: 'Today' }} />
      <Tabs.Screen name="stats" options={{ title: 'Stats' }} />
      <Tabs.Screen name="calendar" options={{ title: 'Calendar' }} />
      <Tabs.Screen name="rewards" options={{ title: 'Rewards' }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
      <Tabs.Screen name="log" options={{ href: null, title: 'Logs' }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 50,
  },
  pill: {
    height: PILL_HEIGHT,
    borderWidth: 1,
    borderRadius: radius.xl,
    paddingHorizontal: space(0.75),
    justifyContent: 'center',
    position: 'relative',
    overflow: 'hidden',
  },
  tabsTrack: {
    flexDirection: 'row',
    alignItems: 'center',
    height: TRACK_HEIGHT,
    position: 'relative',
  },
  blobSlot: {
    position: 'absolute',
    top: (TRACK_HEIGHT - BLOB_HEIGHT) / 2,
    bottom: (TRACK_HEIGHT - BLOB_HEIGHT) / 2,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  blob: {
    width: BLOB_WIDTH,
    height: BLOB_HEIGHT,
    borderRadius: 18,
    borderWidth: 1,
  },
  tabWrap: {
    flex: 1,
    height: TAP,
    justifyContent: 'center',
    zIndex: 1,
  },
  tabInner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingHorizontal: 2,
  },
  tabLabel: {
    fontSize: type.caption.fontSize,
    lineHeight: 14,
    letterSpacing: 0.3,
  },
  iconWrap: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeDot: {
    position: 'absolute',
    top: -2,
    right: -8,
    width: 9,
    height: 9,
    borderRadius: 4.5,
  },
});
