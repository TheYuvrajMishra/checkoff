/**
 * CheckOff — floating action button (docked cleanly above the floating tab bar).
 * Respects safe-area bottom insets (gesture navigation & 3-button bar) so it
 * never collides with the bottom navigation pill.
 */
import { useId } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { Plus } from 'lucide-react-native';
import { HIT_SLOP, shadow, space, useTheme } from '../theme/tokens';
import { PressableScale } from './PressableScale';

const FAB_SIZE = 56;
/** Height of the floating tab bar + vertical margins for scroll clearance */
export const TAB_BAR_HEIGHT = 64;
export const FAB_CLEARANCE = 160;

export function Fab({ onPress, label = 'Add task' }: { onPress: () => void; label?: string }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const rawId = useId();
  const gradId = `fab_${rawId.replace(/[^a-zA-Z0-9]/g, '')}`;

  // Tab bar sits at Math.max(insets.bottom, 8) + 8 and is 64dp high.
  // Dock FAB 14dp above the top edge of the tab bar so they never collide.
  const bottomOffset = Math.max(insets.bottom, 8) + TAB_BAR_HEIGHT + 22;

  return (
    <PressableScale
      onPress={onPress}
      scaleTo={0.96}
      style={[styles.wrap, { bottom: bottomOffset }]}
      innerStyle={[
        styles.fab,
        shadow.lg,
        {
          backgroundColor: theme.accent,
          borderColor: theme.borderStrong,
        },
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={HIT_SLOP}
    >
      <View style={[StyleSheet.absoluteFill, styles.sheenClip]} pointerEvents="none">
        <Svg width="100%" height="100%">
          <Defs>
            <LinearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
              <Stop offset="0%" stopColor={theme.buttonSheen[0]} stopOpacity="1" />
              <Stop offset="55%" stopColor={theme.buttonSheen[1]} stopOpacity="1" />
              <Stop offset="100%" stopColor={theme.buttonSheen[2]} stopOpacity="1" />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${gradId})`} />
        </Svg>
      </View>
      <Plus color={theme.onAccent} size={26} strokeWidth={2.5} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    right: space(2.5),
    zIndex: 90,
  },
  fab: {
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  sheenClip: {
    borderRadius: FAB_SIZE / 2,
    overflow: 'hidden',
  },
});
