import { LinearGradient } from 'expo-linear-gradient';
import { memo } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { colors } from '../theme/colors';
import { radius, spacing } from '../theme/layout';
import { typography } from '../theme/typography';

type GlowingButtonProps = {
  label: string;
  onPress?: () => void;
};

export const GlowingButton = memo(({ label, onPress }: GlowingButtonProps) => (
  <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.shadow}>
    <LinearGradient colors={[colors.accentSecondary, colors.accent]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.button}>
      <Text style={styles.label}>{label}</Text>
    </LinearGradient>
  </Pressable>
));

const styles = StyleSheet.create({
  shadow: {
    borderRadius: radius.lg,
    shadowColor: colors.accent,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.4,
    shadowRadius: 24,
    elevation: 6,
  },
  button: {
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  label: {
    ...typography.heading2,
    textAlign: 'center',
  },
});
