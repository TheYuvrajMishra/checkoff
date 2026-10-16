/**
 * CheckOff — reusable monotone empty state: layered card, vector icon,
 * clear hierarchy, and tactile primary Button.
 */
import { StyleSheet, Text, View } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { radius, space, type, useTheme } from '../theme/tokens';
import { Button } from './Button';
import { Card } from './Card';

interface Props {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  actionLabel: string;
  onAction: () => void;
}

export function EmptyState({ icon: Icon, title, subtitle, actionLabel, onAction }: Props) {
  const theme = useTheme();
  return (
    <Card padding={space(3)} innerStyle={styles.cardInner}>
      <View
        style={[
          styles.iconWrap,
          { backgroundColor: theme.surface2, borderColor: theme.borderStrong },
        ]}
      >
        <Icon color={theme.text} size={24} strokeWidth={1.8} />
      </View>
      <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
      <Text style={[styles.subtitle, { color: theme.textDim }]}>{subtitle}</Text>
      <View style={styles.btnWrap}>
        <Button label={actionLabel} onPress={onAction} variant="primary" size="md" />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  cardInner: {
    alignItems: 'center',
    gap: space(1.25),
  },
  iconWrap: {
    width: 52,
    height: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space(0.5),
  },
  title: {
    ...type.h2,
    textAlign: 'center',
  },
  subtitle: {
    ...type.small,
    textAlign: 'center',
    maxWidth: 280,
  },
  btnWrap: {
    marginTop: space(1),
  },
});
