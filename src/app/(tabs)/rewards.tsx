/**
 * CheckOff — Rewards tab.
 *
 * Points balance, level progress, badge gallery, user-defined redeemable
 * rewards, and the points ledger. Reads through src/rewards/engine.ts
 * (SQLite-backed rewards engine).
 */
import { useCallback, useState, type ReactNode } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import {
  CheckCircle2,
  Flame,
  Gift,
  Lock,
  Palette,
  Plus,
  Star,
  Ticket,
  Timer,
  Trophy,
} from 'lucide-react-native';
import { useDb } from '../../db/useDb';
import { localDateString } from '../../db/time';
import { useUiStore } from '../../state/ui';
import { dark, light, radius, space, type } from '../../theme/tokens';
import { Card } from '../../components/Card';
import { MetallicText } from '../../components/MetallicText';
import { Button } from '../../components/Button';
import { FAB_CLEARANCE } from '../../components/Fab';
import { haptics } from '../../haptics';
import {
  claimDailyReward,
  getBadges,
  getBalance,
  getLedgerHistory,
  getLevel,
  getUserRewards,
  isDailyRewardClaimable,
  redeemReward,
  addUserReward,
  type BadgeView,
  type RewardLedgerRow,
  type LevelInfo,
  type UserReward,
} from '../../rewards/engine';

const BADGE_ICONS: Record<BadgeView['icon'], typeof Flame> = {
  streak: Flame,
  completions: CheckCircle2,
  focus: Timer,
  skills: Palette,
};

function formatPoints(n: number): string {
  return n.toLocaleString('en-US');
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

interface RewardsState {
  balance: number;
  level: LevelInfo;
  badges: BadgeView[];
  userRewards: UserReward[];
  ledger: RewardLedgerRow[];
  claimable: boolean;
}

const INITIAL: RewardsState = {
  balance: 0,
  level: { level: 0, progress: 0, currentThreshold: 0, nextThreshold: 100 },
  badges: [],
  userRewards: [],
  ledger: [],
  claimable: false,
};

function InlineEmpty({
  palette,
  icon,
  title,
  body,
}: {
  palette: 'dark' | 'light';
  icon: ReactNode;
  title: string;
  body: string;
}) {
  const p = palette === 'dark' ? dark : light;
  return (
    <View style={emptyStyles.wrap}>
      <View
        style={[
          emptyStyles.iconWrap,
          { backgroundColor: p.bgSurface, borderColor: p.border },
        ]}
      >
        {icon}
      </View>
      <Text style={[emptyStyles.title, { color: p.textPrimary }]}>{title}</Text>
      <Text style={[emptyStyles.body, { color: p.textMuted }]}>{body}</Text>
    </View>
  );
}

const emptyStyles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    paddingVertical: space.md,
    gap: 6,
  },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  title: {
    ...type.bodyMedium,
  },
  body: {
    ...type.caption,
    textAlign: 'center',
    maxWidth: 260,
  },
});

export default function RewardsScreen() {
  const db = useDb();
  const ui = useUiStore();
  const palette = ui.theme === 'dark' ? dark : light;
  const [state, setState] = useState<RewardsState>(INITIAL);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [cost, setCost] = useState('');
  const [adding, setAdding] = useState(false);
  const [redeemingId, setRedeemingId] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);

  const load = useCallback(async () => {
    try {
      const [balance, level, badges, userRewards, ledger, claimable] =
        await Promise.all([
          getBalance(db),
          getLevel(db),
          getBadges(db),
          getUserRewards(db),
          getLedgerHistory(db, 50),
          isDailyRewardClaimable(db),
        ]);
      setState({ balance, level, badges, userRewards, ledger, claimable });
    } catch {
      // keep previous state on read errors
    } finally {
      setLoading(false);
    }
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const handleClaim = async () => {
    if (claiming) return;
    setClaiming(true);
    haptics.medium();
    try {
      const result = await claimDailyReward(db, localDateString());
      haptics.success();
      await load();
      const extras: string[] = [];
      if (result.extras.freezes > 0) extras.push('a streak freeze');
      if (result.extras.badges.length > 0) extras.push('a badge');
      Alert.alert(
        'Daily reward claimed',
        `+${formatPoints(result.pointsAwarded)} points added to your balance.` +
          (extras.length > 0 ? ` Also earned ${extras.join(' and ')}.` : '')
      );
    } catch (e) {
      Alert.alert(
        'Claim failed',
        e instanceof Error ? e.message : 'Could not claim the daily reward.'
      );
    } finally {
      setClaiming(false);
    }
  };

  const handleAddReward = async () => {
    const trimmed = name.trim();
    const parsedCost = Math.floor(Number(cost));
    if (!trimmed) {
      Alert.alert('Name required', 'Give your reward a name first.');
      return;
    }
    if (!Number.isFinite(parsedCost) || parsedCost <= 0) {
      Alert.alert('Invalid cost', 'Cost must be a positive number of points.');
      return;
    }
    if (adding) return;
    setAdding(true);
    haptics.light();
    try {
      await addUserReward(db, trimmed, parsedCost);
      setName('');
      setCost('');
      haptics.success();
      await load();
    } catch (e) {
      Alert.alert(
        'Add failed',
        e instanceof Error ? e.message : 'Could not save the reward.'
      );
    } finally {
      setAdding(false);
    }
  };

  const handleRedeem = (reward: UserReward) => {
    Alert.alert(
      'Redeem reward',
      `Spend ${formatPoints(reward.cost)} points on "${reward.name}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Redeem',
          style: 'default',
          onPress: () => void doRedeem(reward.id),
        },
      ]
    );
  };

  const doRedeem = async (id: string) => {
    if (redeemingId) return;
    setRedeemingId(id);
    try {
      await redeemReward(db, id);
      haptics.success();
      await load();
    } catch (e) {
      haptics.warning();
      Alert.alert(
        'Cannot redeem',
        e instanceof Error ? e.message : 'Not enough points.'
      );
    } finally {
      setRedeemingId(null);
    }
  };

  const earnedCount = state.badges.filter((b) => b.earned).length;

  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.safe, { backgroundColor: palette.bg }]}
    >
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: FAB_CLEARANCE }]}
        showsVerticalScrollIndicator={false}
      >
        <View>
          <Text style={[styles.eyebrow, { color: palette.textMuted }]}>
            POINTS ECONOMY
          </Text>
          <MetallicText variant="h1" palette={palette}>
            Rewards
          </MetallicText>
        </View>

        {/* Balance */}
        <Card palette={palette} variant="elevated" padding="md">
          <View style={styles.balanceRow}>
            <View
              style={[
                styles.starBadge,
                {
                  backgroundColor: palette.bgSurface,
                  borderColor: palette.borderStrong,
                },
              ]}
            >
              <Star size={22} color={palette.textPrimary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.balanceLabel, { color: palette.textMuted }]}>
                TOTAL BALANCE
              </Text>
              <Text style={[styles.balanceValue, { color: palette.textPrimary }]}>
                {loading ? '—' : formatPoints(state.balance)}
              </Text>
            </View>
            <Trophy size={18} color={palette.textFaint} />
          </View>
          {state.claimable && (
            <View style={{ marginTop: space.md }}>
              <Button
                label={claiming ? 'Claiming...' : 'Claim Daily Reward'}
                variant="primary"
                loading={claiming}
                icon={<Gift size={15} color={palette.textInverse} />}
                onPress={() => void handleClaim()}
                fullWidth
              />
            </View>
          )}
        </Card>

        {/* Level */}
        <Card palette={palette} padding="md">
          <View style={styles.levelHeader}>
            <Text style={[styles.levelTitle, { color: palette.textPrimary }]}>
              Level {state.level.level}
            </Text>
            <Text style={[styles.levelSub, { color: palette.textSecondary }]}>
              {formatPoints(state.level.currentThreshold)} /{' '}
              {formatPoints(state.level.nextThreshold)} pts
            </Text>
          </View>
          <View
            style={[
              styles.progressTrack,
              { backgroundColor: palette.bgElevated, borderColor: palette.border },
            ]}
          >
            <View
              style={[
                styles.progressFill,
                {
                  width: `${Math.min(100, Math.max(0, state.level.progress * 100))}%`,
                  backgroundColor: palette.textPrimary,
                },
              ]}
            />
          </View>
          <Text style={[styles.levelHint, { color: palette.textMuted }]}>
            Next level unlocks at{' '}
            {formatPoints(state.level.nextThreshold)} lifetime points
          </Text>
        </Card>

        {/* Badges */}
        <Card palette={palette} padding="md">
          <View style={styles.sectionHead}>
            <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>
              Badges
            </Text>
            <Text style={[styles.sectionSub, { color: palette.textMuted }]}>
              {earnedCount} / {state.badges.length} earned
            </Text>
          </View>
          {state.badges.length === 0 ? (
            <InlineEmpty
              palette={ui.theme}
              icon={<Trophy size={24} color={palette.textFaint} />}
              title="No badges yet"
              body="Badges unlock as you build streaks, complete tasks, and log focus time."
            />
          ) : (
            <View style={styles.badgeGrid}>
              {state.badges.map((badge) => {
                const Icon = BADGE_ICONS[badge.icon] ?? Flame;
                const earned = badge.earned;
                return (
                  <View
                    key={badge.key}
                    style={[
                      styles.badgeCell,
                      {
                        backgroundColor: earned ? palette.bgElevated : palette.bg,
                        borderColor: earned ? palette.borderStrong : palette.border,
                        opacity: earned ? 1 : 0.55,
                      },
                    ]}
                  >
                    <View
                      style={[
                        styles.badgeIconWrap,
                        {
                          backgroundColor: palette.bgSurface,
                          borderColor: palette.border,
                        },
                      ]}
                    >
                      {earned ? (
                        <Icon size={20} color={palette.textPrimary} />
                      ) : (
                        <Lock size={18} color={palette.textFaint} />
                      )}
                    </View>
                    <Text
                      style={[styles.badgeName, { color: palette.textPrimary }]}
                      numberOfLines={2}
                    >
                      {badge.name}
                    </Text>
                    <Text
                      style={[styles.badgeThreshold, { color: palette.textMuted }]}
                      numberOfLines={1}
                    >
                      {badge.thresholdLabel}
                    </Text>
                  </View>
                );
              })}
            </View>
          )}
        </Card>

        {/* My Rewards */}
        <Card palette={palette} padding="md">
          <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>
            My Rewards
          </Text>
          <Text style={[styles.sectionHint, { color: palette.textMuted }]}>
            Define your own rewards and redeem them with points.
          </Text>

          <View style={styles.addForm}>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Reward name"
              placeholderTextColor={palette.textFaint}
              style={[
                styles.input,
                {
                  color: palette.textPrimary,
                  borderColor: palette.borderStrong,
                  backgroundColor: palette.bg,
                },
              ]}
              accessibilityLabel="Reward name"
            />
            <TextInput
              value={cost}
              onChangeText={setCost}
              placeholder="Cost"
              placeholderTextColor={palette.textFaint}
              keyboardType="number-pad"
              style={[
                styles.input,
                styles.costInput,
                {
                  color: palette.textPrimary,
                  borderColor: palette.borderStrong,
                  backgroundColor: palette.bg,
                },
              ]}
              accessibilityLabel="Reward cost in points"
            />
            <Button
              label={adding ? 'Adding...' : 'Add'}
              variant="secondary"
              loading={adding}
              icon={<Plus size={15} color={palette.textPrimary} />}
              onPress={() => void handleAddReward()}
            />
          </View>

          {state.userRewards.length === 0 ? (
            <InlineEmpty
              palette={ui.theme}
              icon={<Gift size={24} color={palette.textFaint} />}
              title="No rewards defined"
              body="Add your first reward above — a treat you unlock with points."
            />
          ) : (
            <View style={styles.rewardList}>
              {state.userRewards.map((reward) => {
                const affordable = state.balance >= reward.cost;
                const redeeming = redeemingId === reward.id;
                return (
                  <View
                    key={reward.id}
                    style={[
                      styles.rewardRow,
                      { borderColor: palette.border, backgroundColor: palette.bg },
                    ]}
                  >
                    <View
                      style={[
                        styles.rewardIcon,
                        {
                          backgroundColor: palette.bgSurface,
                          borderColor: palette.border,
                        },
                      ]}
                    >
                      <Ticket size={16} color={palette.textSecondary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text
                        style={[styles.rewardName, { color: palette.textPrimary }]}
                        numberOfLines={1}
                      >
                        {reward.name}
                      </Text>
                      <Text
                        style={[styles.rewardCost, { color: palette.textMuted }]}
                      >
                        {formatPoints(reward.cost)} pts
                        {reward.redeemedCount > 0
                          ? ` · redeemed ${reward.redeemedCount}x`
                          : ''}
                      </Text>
                    </View>
                    <Button
                      label={redeeming ? '...' : 'Redeem'}
                      variant="secondary"
                      loading={redeeming}
                      disabled={!affordable || redeeming}
                      onPress={() => handleRedeem(reward)}
                    />
                  </View>
                );
              })}
            </View>
          )}
        </Card>

        {/* History */}
        <Card palette={palette} padding="md">
          <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>
            History
          </Text>
          {state.ledger.length === 0 ? (
            <InlineEmpty
              palette={ui.theme}
              icon={<Star size={24} color={palette.textFaint} />}
              title="No points history"
              body="Earned and redeemed points will appear here."
            />
          ) : (
            <View style={styles.ledgerList}>
              {state.ledger.map((entry, idx) => {
                const positive = entry.points >= 0;
                return (
                  <View key={entry.id}>
                    <View style={styles.ledgerRow}>
                      <View style={{ flex: 1 }}>
                        <Text
                          style={[styles.ledgerReason, { color: palette.textPrimary }]}
                          numberOfLines={1}
                        >
                          {entry.reason}
                        </Text>
                        <Text
                          style={[styles.ledgerDate, { color: palette.textMuted }]}
                        >
                          {formatDate(entry.tsUtc)}
                        </Text>
                      </View>
                      <Text
                        style={[
                          styles.ledgerPoints,
                          { color: palette.textPrimary },
                        ]}
                      >
                        {positive ? '+' : ''}
                        {formatPoints(entry.points)}
                      </Text>
                    </View>
                    {idx < state.ledger.length - 1 && (
                      <View
                        style={[styles.divider, { backgroundColor: palette.border }]}
                      />
                    )}
                  </View>
                );
              })}
            </View>
          )}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: {
    paddingHorizontal: space.base,
    paddingTop: space.md,
    gap: space.md,
  },
  eyebrow: {
    ...type.label,
    marginBottom: 2,
  },
  balanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  starBadge: {
    width: 52,
    height: 52,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  balanceLabel: {
    ...type.caption,
    letterSpacing: 1.2,
  },
  balanceValue: {
    ...type.statBig,
    marginTop: 2,
  },
  levelHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: space.sm,
  },
  levelTitle: {
    ...type.h2,
  },
  levelSub: {
    ...type.monoSm,
  },
  progressTrack: {
    height: 10,
    borderRadius: 5,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 5,
  },
  levelHint: {
    ...type.caption,
    marginTop: space.sm,
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: space.md,
  },
  sectionTitle: {
    ...type.h3,
    marginBottom: space.xs,
  },
  sectionSub: {
    ...type.monoSm,
  },
  sectionHint: {
    ...type.caption,
    marginBottom: space.md,
  },
  badgeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  badgeCell: {
    width: '31%',
    aspectRatio: 0.92,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.sm,
    gap: 4,
  },
  badgeIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeName: {
    ...type.caption,
    textAlign: 'center',
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  badgeThreshold: {
    ...type.monoSmall,
  },
  addForm: {
    flexDirection: 'row',
    gap: space.sm,
    marginBottom: space.md,
    alignItems: 'center',
  },
  input: {
    ...type.body,
    flex: 1,
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.md,
  },
  costInput: {
    flex: 0,
    width: 96,
  },
  rewardList: {
    gap: space.sm,
  },
  rewardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  rewardIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rewardName: {
    ...type.bodyMedium,
  },
  rewardCost: {
    ...type.monoSm,
    marginTop: 2,
  },
  ledgerList: {},
  ledgerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    paddingVertical: space.sm,
  },
  ledgerReason: {
    ...type.bodySm,
  },
  ledgerDate: {
    ...type.monoSm,
    marginTop: 2,
  },
  ledgerPoints: {
    ...type.monoLg,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
  },
});
