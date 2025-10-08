export const colors = {
  background: '#05040F',
  backgroundAlt: '#0F1125',
  accent: '#6C5CE7',
  accentSecondary: '#00D1FF',
  card: 'rgba(255, 255, 255, 0.08)',
  textPrimary: '#FFFFFF',
  textSecondary: 'rgba(255, 255, 255, 0.72)',
  badgeBackground: 'rgba(0, 209, 255, 0.18)',
  border: 'rgba(255, 255, 255, 0.12)',
} as const;

export type ColorName = keyof typeof colors;
