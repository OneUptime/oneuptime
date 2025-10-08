import { TextStyle } from 'react-native';
import { colors } from './colors';

export const typography = {
  heading1: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.textPrimary,
  } satisfies TextStyle,
  heading2: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.textPrimary,
  } satisfies TextStyle,
  body: {
    fontSize: 16,
    lineHeight: 24,
    color: colors.textSecondary,
  } satisfies TextStyle,
  caption: {
    fontSize: 12,
    color: colors.textSecondary,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  } satisfies TextStyle,
};
