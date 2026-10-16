/**
 * Floating glass bottom tab bar (Phase 3 reskin).
 * - Absolute-positioned pill with real blur (expo-blur), hairline border.
 * - Active tab indicator slides between tabs on the UI thread (Reanimated).
 * - Lucide vector icons with labels underneath. No emoji.
 */
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Tabs } from 'expo-router';
import { BlurView } from 'expo-blur';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CalendarDays, ChartColumn, ListChecks, Sun } from 'lucide-react-native';
import { useUiStore } from '../../state/ui';
import { dark, light, space, type, type ThemePalette } from '../../theme/tokens';

const ICONS: Record<string, typeof Sun> = {
  index: Sun,
  calendar: CalendarDays,
  log: ListChecks,
  stats: ChartColumn,
};

/** Minimal structural type for the React Navigation bottom tab bar props. */
interface TabBarProps {
  state: {
    index: number;
    routes: { key: string; name: string }[];
  };
  descriptors: Record<string, { options: { title?: string } }>;
  navigation: {
    emit: (e: { type: string; target: string; canPreventDefault: boolean }) => { defaultPrevented: boolean };
    navigate: (name: string) => void;
  };
}

function FloatingTabBar({ state, descriptors, navigation }: TabBarProps) {
  const themeName = useUiStore((s) => s.theme);
  const p: ThemePalette = themeName === 'light' ? light : dark;
  const insets = useSafeAreaInsets();
  const [barWidth, setBarWidth] = useState(0);

  const activeIndex = useSharedValue(state.index);
  useEffect(() => {
    activeIndex.value = withSpring(state.index, { damping: 22, stiffness: 320 });
  }, [state.index, activeIndex]);

  const tabWidth = barWidth > 0 ? barWidth / state.routes.length : 0;
  const indicatorStyle = useAnimatedStyle(() => ({
    width: tabWidth,
    transform: [{ translateX: activeIndex.value * tabWidth }],
  }));

  return (
    <View
      style={[styles.wrap, { bottom: insets.bottom + space(1.5), marginHorizontal: space(2) }]}
      pointerEvents="box-none"
    >
      <BlurView
        intensity={72}
        tint={themeName === 'light' ? 'light' : 'dark'}
        style={[styles.blur, { borderRadius: 28 }]}
      >
        <View
          style={[
            styles.pill,
            {
              borderColor: p.border,
              backgroundColor:
                themeName === 'light' ? 'rgba(255, 255, 255, 0.55)' : 'rgba(19, 19, 22, 0.55)',
            },
          ]}
          onLayout={(e) => setBarWidth(e.nativeEvent.layout.width)}
        >
          {tabWidth > 0 && (
            <Animated.View
              style={[styles.indicator, indicatorStyle, { backgroundColor: p.accentDim }]}
            />
          )}
          {state.routes.map((route, i) => {
            const focused = state.index === i;
            const label = descriptors[route.key]?.options.title ?? route.name;
            const Icon = ICONS[route.name] ?? Sun;
            const color = focused ? p.accent : p.textFaint;
            return (
              <Pressable
                key={route.key}
                accessibilityRole="button"
                accessibilityState={{ selected: focused }}
                accessibilityLabel={label}
                onPress={() => {
                  const event = navigation.emit({
                    type: 'tabPress',
                    target: route.key,
                    canPreventDefault: true,
                  });
                  if (!focused && !event.defaultPrevented) {
                    navigation.navigate(route.name);
                  }
                }}
                style={styles.tab}
                hitSlop={4}
              >
                <Icon color={color} size={22} strokeWidth={focused ? 2.4 : 2} />
                <Text style={[styles.tabLabel, { color }]}>{label}</Text>
              </Pressable>
            );
          })}
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
      <Tabs.Screen name="calendar" options={{ title: 'Calendar' }} />
      <Tabs.Screen name="log" options={{ title: 'Log' }} />
      <Tabs.Screen name="stats" options={{ title: 'Stats' }} />
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
    overflow: 'hidden',
  },
  pill: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: 28,
    paddingVertical: space(1),
    paddingHorizontal: space(1),
    // Fallback tint under the blur for legibility.
  },
  indicator: {
    position: 'absolute',
    top: space(1),
    bottom: space(1),
    left: space(1),
    borderRadius: 22,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingVertical: space(1),
    zIndex: 1,
  },
  tabLabel: {
    fontSize: type.small.fontSize,
    fontWeight: '600',
    letterSpacing: 0.4,
  },
});
