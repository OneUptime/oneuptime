import type { TextStyle, ViewStyle } from "react-native";

/*
 * Geometry and type shared by every screen.
 *
 * Screens used to carry their own font sizes, radii and gaps, and no two
 * agreed: a card was 14, 16 or 18 points round depending on who wrote it, and
 * a secondary line was 13, 14 or 15 points. These scales are the only values
 * components should reach for, so the app reads as one product.
 */

export const spacing: Readonly<{
  xxs: number;
  xs: number;
  sm: number;
  md: number;
  lg: number;
  xl: number;
  xxl: number;
  xxxl: number;
}> = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

export const radius: Readonly<{
  sm: number;
  md: number;
  lg: number;
  xl: number;
  pill: number;
}> = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 22,
  pill: 999,
} as const;

export type TypographyVariant =
  | "largeTitle"
  | "title"
  | "title2"
  | "title3"
  | "headline"
  | "body"
  | "callout"
  | "subhead"
  | "footnote"
  | "caption"
  | "overline";

/*
 * Sizes follow the platform text styles people already read all day. Every
 * variant sets a line height, because scaled text without one clips
 * descenders on Android.
 */
export const typography: Readonly<Record<TypographyVariant, TextStyle>> = {
  largeTitle: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: "800",
    letterSpacing: -0.6,
  },
  title: {
    fontSize: 26,
    lineHeight: 32,
    fontWeight: "700",
    letterSpacing: -0.5,
  },
  title2: {
    fontSize: 21,
    lineHeight: 27,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  title3: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "600",
    letterSpacing: -0.2,
  },
  headline: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "600",
    letterSpacing: -0.1,
  },
  body: {
    fontSize: 16,
    lineHeight: 23,
    fontWeight: "400",
  },
  callout: {
    fontSize: 15,
    lineHeight: 21,
    fontWeight: "400",
  },
  subhead: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "400",
  },
  footnote: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "400",
  },
  caption: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "500",
  },
  overline: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
} as const;

export type ElevationLevel = "none" | "card" | "raised" | "overlay";

/*
 * One definition per level for each platform. New-architecture React Native
 * accepts `boxShadow` on iOS, Android and web alike, so cards cast the same
 * soft shadow everywhere instead of an Android elevation that looks nothing
 * like the iOS one.
 */
export function elevation(level: ElevationLevel, dark: boolean): ViewStyle {
  if (level === "none") {
    return {};
  }
  const alpha: number = dark ? 0.5 : 1;
  const shadows: Record<Exclude<ElevationLevel, "none">, string> = {
    card: `0px 1px 2px rgba(16, 24, 40, ${0.05 * alpha}), 0px 1px 3px rgba(16, 24, 40, ${0.06 * alpha})`,
    raised: `0px 4px 12px rgba(16, 24, 40, ${0.08 * alpha}), 0px 2px 4px rgba(16, 24, 40, ${0.04 * alpha})`,
    overlay: `0px 12px 32px rgba(16, 24, 40, ${0.18 * alpha})`,
  };
  return { boxShadow: shadows[level] };
}

/** Minimum comfortable touch target for any control. */
export const touchTarget: number = 48;
