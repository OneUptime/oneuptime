import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';
import { radius, spacing } from '../theme/layout';
import { typography } from '../theme/typography';

type MetricCardProps = {
  value: string;
  label: string;
  trend?: string;
};

export const MetricCard = memo(({ value, label, trend }: MetricCardProps) => (
  <View style={styles.card}>
    <Text style={styles.value}>{value}</Text>
    <Text style={styles.label}>{label}</Text>
    {trend ? <Text style={styles.trend}>{trend}</Text> : null}
  </View>
));

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    width: '48%',
    marginBottom: spacing.lg,
  },
  value: {
    ...typography.heading2,
    marginBottom: spacing.xs,
  },
  label: {
    ...typography.body,
    marginBottom: spacing.xs,
  },
  trend: {
    ...typography.caption,
    color: colors.accentSecondary,
  },
});
