/**
 * Floating monochrome bottom tab bar.
 * - Tabs in exact order: Today, Stats, Calendar, Settings.
 * - Linear/eased 180ms indicator (zero bounce, zero overshoot).
 * - Lucide vector icons only (no emoji), 48dp minimum touch targets.
 * - Respects gesture-navigation bottom insets.
 */
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Tabs } from 'expo-router';
import { BlurView } from 'expo-blur';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CalendarDays, ChartColumn, SlidersHorizontal, Sun } from 'lucide-react-native';
import { HIT_SLOP, radius, space, TAP, type, useTheme } from '../../theme/tokens';
import { PressableScale } from '../../components/PressableScale';

const VISIBLE_TAB_ORDER = ['index', 'stats', 'calendar', 'settings'] as const;

const TAB_META: Record<
  string,
  { label: string; Icon: typeof Sun }
> = {
  index: { label: 'Today', Icon: Sun },
  stats: { label: 'Stats', Icon: ChartColumn },
  calendar: { label: 'Calendar', Icon: CalendarDays },
  settings: { label: 'Settings', Icon: SlidersHorizontal },
};

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
  const [innerWidth, setInnerWidth] = useState(0);

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

  const activePos = useSharedValue(activeVisibleIndex);
  useEffect(() => {
    // 180ms cubic ease-out, zero bounce, zero overshoot
    // eslint-disable-next-line react-hooks/immutability
    activePos.value = withTiming(activeVisibleIndex, {
      duration: 180,
      easing: Easing.out(Easing.cubic),
    });
  }, [activeVisibleIndex, activePos]);

  const tabCount = Math.max(1, visibleRoutes.length);
  const slotWidth = innerWidth > 0 ? innerWidth / tabCount : 0;

  const indicatorStyle = useAnimatedStyle(() => ({
    width: slotWidth,
    transform: [{ translateX: activePos.value * slotWidth }],
  }));

  const bottomInset = Math.max(insets.bottom, 8) + 8;

  return (
    <View
      style={[styles.wrap, { bottom: bottomInset, marginHorizontal: space(2) }]}
      pointerEvents="box-none"
    >
      <BlurView
        intensity={80}
        tint={theme.name === 'light' ? 'light' : 'dark'}
        style={styles.blur}
      >
        <View
          style={[
            styles.pill,
            {
              borderColor: theme.borderStrong,
              backgroundColor:
                theme.name === 'light'
                  ? 'rgba(255, 255, 255, 0.88)'
                  : 'rgba(10, 10, 10, 0.88)',
            },
          ]}
        >
          {/* Specular top highlight */}
          <View
            pointerEvents="none"
            style={[styles.topHighlight, { backgroundColor: theme.topHighlight }]}
          />

          <View
            style={styles.tabsTrack}
            onLayout={(e) => setInnerWidth(e.nativeEvent.layout.width)}
          >
            {slotWidth > 0 && (
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.indicator,
                  indicatorStyle,
                  {
                    backgroundColor: theme.accentDim,
                    borderColor: theme.borderStrong,
                  },
                ]}
              >
                <View
                  style={[styles.indicatorTopLine, { backgroundColor: theme.text }]}
                />
              </Animated.View>
            )}

            {visibleRoutes.map((route, idx) => {
              const focused = activeVisibleIndex === idx;
              const meta = TAB_META[route.name] ?? TAB_META.index;
              const Icon = meta.Icon;
              const color = focused ? theme.text : theme.textFaint;

              return (
                <PressableScale
                  key={route.key}
                  scaleTo={0.97}
                  hitSlop={HIT_SLOP}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: focused }}
                  accessibilityLabel={meta.label}
                  onPress={() => {
                    const event = navigation.emit({
                      type: 'tabPress',
                      target: route.key,
                      canPreventDefault: true,
                    });
                    if (!event.defaultPrevented) {
                      navigation.navigate(route.name);
                    }
                  }}
                  style={styles.tabWrap}
                  innerStyle={styles.tabInner}
                >
                  <Icon color={color} size={20} strokeWidth={focused ? 2.3 : 1.8} />
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
            })}
          </View>
        </View>
      </BlurView>
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
  blur: {
    borderRadius: radius.xl,
    overflow: 'hidden',
  },
  pill: {
    height: 64,
    borderWidth: 1,
    borderRadius: radius.xl,
    paddingHorizontal: space(0.75),
    justifyContent: 'center',
    position: 'relative',
    overflow: 'hidden',
  },
  topHighlight: {
    position: 'absolute',
    top: 0,
    left: space(2),
    right: space(2),
    height: 1,
  },
  tabsTrack: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 52,
    position: 'relative',
  },
  indicator: {
    position: 'absolute',
    top: 2,
    bottom: 2,
    left: 0,
    borderRadius: radius.lg,
    borderWidth: 1,
    alignItems: 'center',
    overflow: 'hidden',
  },
  indicatorTopLine: {
    width: 20,
    height: 2,
    borderRadius: 1,
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
});
