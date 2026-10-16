/**
 * CheckOff — reusable empty state: centered message + primary action.
 * Lucide icon, no emoji.
 */
import { StyleSheet, Text, View } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { useUiStore } from '../state/ui';
import { dark, light, radius, space, TAP, type, type ThemePalette } from '../theme/tokens';
import { PressableScale } from './PressableScale';

interface Props {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  actionLabel: string;
  onAction: () => void;
}

export function EmptyState({ icon: Icon, title, subtitle, actionLabel, onAction }: Props) {
  const theme: ThemePalette = useUiStore((s) => (s.theme === 'light' ? light : dark));
  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <View style={[styles.iconWrap, { backgroundColor: theme.accentDim }]}>
        <Icon color={theme.accent} size={28} strokeWidth={2} />
      </View>
      <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
      <Text style={[styles.subtitle, { color: theme.textDim }]}>{subtitle}</Text>
      <PressableScale
        onPress={onAction}
        style={[styles.btn, { marginTop: space(1) }]}
        innerStyle={[styles.btnInner, { backgroundColor: theme.accent }]}
        accessibilityRole="button"
        accessibilityLabel={actionLabel}
      >
        <Text style={[styles.btnText, { color: theme.onAccent }]}>{actionLabel}</Text>
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: space(3),
    alignItems: 'center',
    gap: space(1.5),
  },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space(0.5),
  },
  title: { ...type.h3, textAlign: 'center' },
  subtitle: { ...type.small, textAlign: 'center' },
  btn: {
    marginTop: space(1),
  },
  btnInner: {
    borderRadius: radius.md,
    minHeight: TAP,
    paddingHorizontal: space(3),
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnText: { fontSize: 15, fontWeight: '700' },
});
