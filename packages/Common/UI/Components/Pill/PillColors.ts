import Color, { RGB } from "../../../Types/Color";
import {
  composite,
  getAlphaForLuminance,
  getContrastRatio,
  getReadableShade,
  getRelativeLuminance,
  parseColor,
} from "../../../Utils/ColorContrast";
import { CSSProperties } from "react";

/*
 * Every colour a Pill paints, worked out from the one colour its caller
 * passes: a state's, a severity's, a label's - any hex a user can pick.
 *
 * A pill used to be a solid swatch of that colour with black or white text
 * on it. White on the stock green (#2ab57d) or red (#fd625e) is under 3:1,
 * and a table with a solid pill on every row is mostly pill. Now it is a soft
 * badge: a dot in the colour itself, a pale wash of it, a hairline ring, and
 * text in a deeper shade of it. The text shade is searched for, not fixed,
 * so that it clears WCAG's 4.5:1 against the wash whatever the colour is: a
 * pale yellow comes out a deep amber, a navy stays navy.
 *
 * The dark theme gets its own set - lighter text, a dot that stays visible
 * on slate - because no one shade of a colour reads on both surfaces.
 */

/*
 * The colour arithmetic lives in Utils/ColorContrast, which is React-free so
 * the server-rendered emails can share it. Re-exported, so everything that
 * reads it from here keeps doing so.
 */
export {
  composite,
  getAlphaForLuminance,
  getContrastRatio,
  getReadableShade,
  getRelativeLuminance,
  parseColor,
};

export interface PillTone {
  backgroundColor: string;
  textColor: string;
  ringColor: string;
  dotColor: string;
}

export interface PillColors {
  light: PillTone;
  dark: PillTone;
}

export type PillStyle = CSSProperties & {
  [customProperty: `--${string}`]: string;
};

interface ThemeSpec {
  // What the pill sits on: a card, a table row.
  surface: RGB;
  /*
   * Text contrast against the wash. 4.5:1 is the WCAG AA floor; these sit
   * above it, so the text survives a slightly different surface (a hovered
   * row, a gray card header) and reads as a rich shade of the colour rather
   * than one that only just passes. The dark target lands near the -300
   * shades Theme.css already uses for its semantic text.
   */
  textContrast: number;
  // The dot is decoration - the text carries the meaning - but it must show.
  dotContrast: number;
  /*
   * The wash and the ring are the colour at whatever opacity lands them on
   * one luminance, so every colour weighs the same: ten percent of black is
   * a much heavier gray than ten percent of yellow is a yellow.
   */
  washLuminance: number;
  washAlpha: { min: number; max: number };
  ringLuminance: number;
  ringAlpha: { min: number; max: number };
}

const LIGHT_THEME: ThemeSpec = {
  surface: { red: 255, green: 255, blue: 255 },
  textContrast: 5.25,
  dotContrast: 1.5,
  washLuminance: 0.89,
  washAlpha: { min: 0.04, max: 0.16 },
  ringLuminance: 0.72,
  ringAlpha: { min: 0.12, max: 0.32 },
};

const DARK_THEME: ThemeSpec = {
  // --ou-surface-primary in the dark theme (Common/UI/Styles/Theme.css).
  surface: { red: 23, green: 32, blue: 51 },
  textContrast: 7,
  dotContrast: 3,
  washLuminance: 0.032,
  washAlpha: { min: 0.1, max: 0.2 },
  ringLuminance: 0.085,
  ringAlpha: { min: 0.2, max: 0.36 },
};

/*
 * A text shade that has to move off the colour keeps no more saturation than
 * this: a darkened #fd625e at full saturation is a neon red, at this it is
 * the brick red a text colour should be. A colour that already reads is kept
 * exactly as it is.
 */
const MAX_SHADE_SATURATION: number = 0.8;

const FALLBACK_COLOR: RGB = { red: 107, green: 114, blue: 128 }; // gray-500

function toHex(rgb: RGB): string {
  return Color.rgbToColor(rgb).toString();
}

function toRgba(rgb: RGB, alpha: number): string {
  return `rgba(${rgb.red}, ${rgb.green}, ${rgb.blue}, ${Number(
    alpha.toFixed(3),
  )})`;
}

function getTone(color: RGB, theme: ThemeSpec): PillTone {
  const dot: RGB = getReadableShade({
    color,
    background: theme.surface,
    minimumContrast: theme.dotContrast,
  });

  const washAlpha: number = getAlphaForLuminance({
    color: dot,
    surface: theme.surface,
    targetLuminance: theme.washLuminance,
    range: theme.washAlpha,
  });

  const text: RGB = getReadableShade({
    color,
    background: composite(dot, washAlpha, theme.surface),
    minimumContrast: theme.textContrast,
    maximumSaturation: MAX_SHADE_SATURATION,
  });

  const ringAlpha: number = getAlphaForLuminance({
    color: text,
    surface: theme.surface,
    targetLuminance: theme.ringLuminance,
    range: theme.ringAlpha,
  });

  return {
    backgroundColor: toRgba(dot, washAlpha),
    textColor: toHex(text),
    ringColor: toRgba(text, ringAlpha),
    dotColor: toHex(dot),
  };
}

/*
 * A page paints the same few colours over and over - every Enabled is the
 * same green - and working one out is a few dozen search steps per theme, so
 * each colour is worked out once. Bounded, because colours are user data.
 */
const PILL_COLORS_CACHE: Map<string, PillColors> = new Map();
const PILL_COLORS_CACHE_LIMIT: number = 512;

export function getPillColors(
  color: Color | string | null | undefined,
): PillColors {
  const rgb: RGB = parseColor(color) || FALLBACK_COLOR;
  const key: string = toHex(rgb);
  const cached: PillColors | undefined = PILL_COLORS_CACHE.get(key);

  if (cached) {
    return cached;
  }

  // Frozen, because every pill of this colour shares it.
  const colors: PillColors = Object.freeze({
    light: Object.freeze(getTone(rgb, LIGHT_THEME)),
    dark: Object.freeze(getTone(rgb, DARK_THEME)),
  });

  if (PILL_COLORS_CACHE.size >= PILL_COLORS_CACHE_LIMIT) {
    PILL_COLORS_CACHE.clear();
  }

  PILL_COLORS_CACHE.set(key, colors);

  return colors;
}

/*
 * The inline style that paints a tone. The light theme's colours are written
 * as they are, so a pill is right in an app that never loads Theme.css (the
 * status page). The dark theme's ride along as custom properties, which the
 * html.dark [data-ou-pill] rule in Theme.css swaps in; the element must carry
 * that attribute. A colour the caller overrides is the dark value too, so the
 * override wins in both themes.
 */
export function getPillToneStyle(
  colors: PillColors,
  overrides?: CSSProperties | undefined,
): PillStyle {
  return {
    backgroundColor: colors.light.backgroundColor,
    color: colors.light.textColor,
    boxShadow: `inset 0 0 0 1px ${colors.light.ringColor}`,
    "--ou-pill-dark-bg": String(
      overrides?.backgroundColor || colors.dark.backgroundColor,
    ),
    "--ou-pill-dark-text": String(overrides?.color || colors.dark.textColor),
    "--ou-pill-dark-shadow": String(
      overrides?.boxShadow || `inset 0 0 0 1px ${colors.dark.ringColor}`,
    ),
  };
}

// The same for the dot, under html.dark [data-ou-pill-dot].
export function getPillDotStyle(colors: PillColors): PillStyle {
  return {
    backgroundColor: colors.light.dotColor,
    "--ou-pill-dark-dot": colors.dark.dotColor,
  };
}
