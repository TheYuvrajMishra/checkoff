import { Tabs } from 'expo-router';
import { useUiStore } from '../../state/ui';
import { dark, light, type } from '../../theme/tokens';

/**
 * Bottom tab bar. Text labels only — no icons, no emoji.
 * The Today tab (index) is sibling-owned; calendar/log/stats are Phase 4.
 */
export default function TabsLayout() {
  const themeName = useUiStore((s) => s.theme);
  const p = themeName === 'light' ? light : dark;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: p.surface,
          borderTopColor: p.border,
          borderTopWidth: 1,
        },
        tabBarActiveTintColor: p.accent,
        tabBarInactiveTintColor: p.textFaint,
        tabBarLabelStyle: {
          fontSize: type.small.fontSize,
          fontWeight: '600',
          letterSpacing: 0.4,
        },
      }}
    >
      {/* Sibling-owned. */}
      <Tabs.Screen name="index" options={{ title: 'Today' }} />
      <Tabs.Screen name="calendar" options={{ title: 'Calendar' }} />
      <Tabs.Screen name="log" options={{ title: 'Log' }} />
      <Tabs.Screen name="stats" options={{ title: 'Stats' }} />
    </Tabs>
  );
}
