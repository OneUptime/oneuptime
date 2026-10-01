import Color, { RGB } from "../../../Types/Color";

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

interface HSL {
  hue: number;
  saturation: number;
  lightness: number;
}

interface ThemeSpec {
  // What the pill sits on: a card, a table row.
  surface: RGB;
  /*
   * Text contrast against the wash. 4.5:1 is the WCAG AA floor; these sit
   * above it, so the text survives a slightly different surface (a hovered
   * row, a gray card header) and reads as a rich shade of the colour rather
   * than one that only just passes. The dark target matches the -300 shades
   * Theme.css already uses for its semantic text.
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
 * A shade that has to move far from the colour keeps no more saturation than
 * this: a darkened #fd625e at full saturation is a neon red, at this it is
 * the brick red a text colour should be.
 */
const MAX_SHADE_SATURATION: number = 0.8;

const FALLBACK_COLOR: RGB = { red: 107, green: 114, blue: 128 }; // gray-500

// #rgb, #rrggbb, or #rrggbbaa (the alpha is ignored); the # is optional.
const HEX_PATTERN: RegExp = /^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/;
// rgb(r, g, b), rgb(r g b), rgba(r, g, b, a) (the alpha is ignored).
const RGB_PATTERN: RegExp =
  /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})\b/;

export function parseColor(
  color: Color | string | null | undefined,
): RGB | null {
  const value: string = (color ? color.toString() : "").trim().toLowerCase();

  const hex: RegExpExecArray | null = HEX_PATTERN.exec(value);

  if (hex && hex[1]) {
    let digits: string = hex[1];

    if (digits.length === 3) {
      digits = digits
        .split("")
        .map((digit: string) => {
          return digit + digit;
        })
        .join("");
    }

    return {
      red: parseInt(digits.slice(0, 2), 16),
      green: parseInt(digits.slice(2, 4), 16),
      blue: parseInt(digits.slice(4, 6), 16),
    };
  }

  const rgb: RegExpExecArray | null = RGB_PATTERN.exec(value);

  if (rgb) {
    const red: number = Number(rgb[1]);
    const green: number = Number(rgb[2]);
    const blue: number = Number(rgb[3]);

    if (red <= 255 && green <= 255 && blue <= 255) {
      return { red, green, blue };
    }
  }

  return null;
}

// WCAG 2 relative luminance: 0 for black, 1 for white.
export function getRelativeLuminance(rgb: RGB): number {
  const linear: (channel: number) => number = (channel: number): number => {
    const value: number = channel / 255;
    return value <= 0.03928
      ? value / 12.92
      : Math.pow((value + 0.055) / 1.055, 2.4);
  };

  return (
    0.2126 * linear(rgb.red) +
    0.7152 * linear(rgb.green) +
    0.0722 * linear(rgb.blue)
  );
}

export function getContrastRatio(first: RGB, second: RGB): number {
  const a: number = getRelativeLuminance(first);
  const b: number = getRelativeLuminance(second);

  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// The colour a browser paints for `color` at `alpha` over `surface`.
export function composite(color: RGB, alpha: number, surface: RGB): RGB {
  const blend: (top: number, bottom: number) => number = (
    top: number,
    bottom: number,
  ): number => {
    return Math.round(top * alpha + bottom * (1 - alpha));
  };

  return {
    red: blend(color.red, surface.red),
    green: blend(color.green, surface.green),
    blue: blend(color.blue, surface.blue),
  };
}

function toHex(rgb: RGB): string {
  return Color.rgbToColor(rgb).toString();
}

function toRgba(rgb: RGB, alpha: number): string {
  return `rgba(${rgb.red}, ${rgb.green}, ${rgb.blue}, ${Number(
    alpha.toFixed(3),
  )})`;
}

function rgbToHsl(rgb: RGB): HSL {
  const red: number = rgb.red / 255;
  const green: number = rgb.green / 255;
  const blue: number = rgb.blue / 255;

  const max: number = Math.max(red, green, blue);
  const min: number = Math.min(red, green, blue);
  const lightness: number = (max + min) / 2;

  if (max === min) {
    return { hue: 0, saturation: 0, lightness };
  }

  const delta: number = max - min;
  const saturation: number =
    lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);

  let hue: number;

  if (max === red) {
    hue = (green - blue) / delta + (green < blue ? 6 : 0);
  } else if (max === green) {
    hue = (blue - red) / delta + 2;
  } else {
    hue = (red - green) / delta + 4;
  }

  return { hue: hue / 6, saturation, lightness };
}

function hslToRgb(hsl: HSL): RGB {
  const { hue, saturation, lightness } = hsl;

  if (saturation === 0) {
    const gray: number = Math.round(lightness * 255);
    return { red: gray, green: gray, blue: gray };
  }

  const q: number =
    lightness < 0.5
      ? lightness * (1 + saturation)
      : lightness + saturation - lightness * saturation;
  const p: number = 2 * lightness - q;

  const channel: (offset: number) => number = (offset: number): number => {
    let t: number = hue + offset;

    if (t < 0) {
      t += 1;
    }

    if (t > 1) {
      t -= 1;
    }

    let value: number = p;

    if (t < 1 / 6) {
      value = p + (q - p) * 6 * t;
    } else if (t < 1 / 2) {
      value = q;
    } else if (t < 2 / 3) {
      value = p + (q - p) * (2 / 3 - t) * 6;
    }

    return Math.round(value * 255);
  };

  return {
    red: channel(1 / 3),
    green: channel(0),
    blue: channel(-1 / 3),
  };
}

/*
 * The shade of `color` nearest to it that reaches `minimumContrast` against
 * `background`: the colour itself when it already does, otherwise the same
 * hue with only the lightness moved - toward black on a light background,
 * toward white on a dark one. Lightness moves luminance one way only, so a
 * binary search finds the boundary.
 */
export function getReadableShade(data: {
  color: RGB;
  background: RGB;
  minimumContrast: number;
  maximumSaturation?: number | undefined;
}): RGB {
  if (getContrastRatio(data.color, data.background) >= data.minimumContrast) {
    return data.color;
  }

  const original: HSL = rgbToHsl(data.color);
  const hsl: HSL = {
    ...original,
    saturation: Math.min(
      original.saturation,
      data.maximumSaturation === undefined ? 1 : data.maximumSaturation,
    ),
  };

  const passes: (lightness: number) => boolean = (
    lightness: number,
  ): boolean => {
    return (
      getContrastRatio(hslToRgb({ ...hsl, lightness }), data.background) >=
      data.minimumContrast
    );
  };

  if (passes(hsl.lightness)) {
    return hslToRgb(hsl);
  }

  // `low` never passes; `high` always does (black or white at the limit).
  let low: number = hsl.lightness;
  let high: number = getRelativeLuminance(data.background) < 0.5 ? 1 : 0;

  for (let step: number = 0; step < 24; step++) {
    const middle: number = (low + high) / 2;

    if (passes(middle)) {
      high = middle;
    } else {
      low = middle;
    }
  }

  return hslToRgb({ ...hsl, lightness: high });
}

/*
 * The opacity at which `color` over `surface` lands nearest to
 * `targetLuminance`, kept inside `range`. More opacity only ever moves the
 * result toward the colour, so a binary search finds it.
 */
export function getAlphaForLuminance(data: {
  color: RGB;
  surface: RGB;
  targetLuminance: number;
  range: { min: number; max: number };
}): number {
  const towardColor: number =
    getRelativeLuminance(data.color) - getRelativeLuminance(data.surface);

  let low: number = data.range.min;
  let high: number = data.range.max;

  for (let step: number = 0; step < 24; step++) {
    const middle: number = (low + high) / 2;
    const luminance: number = getRelativeLuminance(
      composite(data.color, middle, data.surface),
    );
    // Short of the target: more of the colour moves toward it.
    const isShort: boolean =
      towardColor < 0
        ? luminance > data.targetLuminance
        : luminance < data.targetLuminance;

    if (isShort) {
      low = middle;
    } else {
      high = middle;
    }
  }

  return (low + high) / 2;
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

export function getPillColors(
  color: Color | string | null | undefined,
): PillColors {
  const rgb: RGB = parseColor(color) || FALLBACK_COLOR;

  return {
    light: getTone(rgb, LIGHT_THEME),
    dark: getTone(rgb, DARK_THEME),
  };
}
