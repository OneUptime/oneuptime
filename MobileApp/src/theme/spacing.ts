export const spacing: {
  readonly xs: 4;
  readonly sm: 8;
  readonly md: 16;
  readonly lg: 24;
  readonly xl: 32;
  readonly xxl: 48;
} = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const radius: {
  readonly sm: 6;
  readonly md: 12;
  readonly lg: 16;
} = {
  sm: 6,
  md: 12,
  lg: 16,
} as const;

export type Spacing = typeof spacing;
export type Radius = typeof radius;
