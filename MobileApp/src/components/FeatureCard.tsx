import { LinearGradient } from 'expo-linear-gradient';
import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';
import { radius, spacing } from '../theme/layout';
import { typography } from '../theme/typography';

type FeatureCardProps = {
  title: string;
  description: string;
  badge?: string;
};

const gradients = [
  ['#6C5CE7', '#8E8EFF'],
  ['#00D1FF', '#00FFA3'],
  ['#FF6CAB', '#7366FF'],
] as const;

const getGradient = (index: number) => gradients[index % gradients.length];

export const FeatureCard = memo(({ title, description, badge }: FeatureCardProps) => {
  return (
    <LinearGradient colors={getGradient(title.length)} style={styles.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
      <View style={styles.card}>
        {badge ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{badge}</Text>
          </View>
        ) : null}
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.description}>{description}</Text>
      </View>
    </LinearGradient>
  );
});

const styles = StyleSheet.create({
  gradient: {
    borderRadius: radius.lg,
    marginBottom: spacing.lg,
  },
  card: {
  padding: spacing.xl,
  backgroundColor: colors.card,
  borderRadius: radius.lg,
  borderWidth: 1,
  borderColor: colors.border,
  },
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs / 2,
    backgroundColor: colors.badgeBackground,
    borderRadius: radius.sm,
    marginBottom: spacing.sm,
  },
  badgeText: {
    ...typography.caption,
    color: colors.accentSecondary,
  },
  title: {
    ...typography.heading2,
    marginBottom: spacing.sm,
  },
  description: {
    ...typography.body,
  },
});
