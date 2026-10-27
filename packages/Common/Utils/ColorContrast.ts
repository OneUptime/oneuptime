import Color, { RGB } from "../Types/Color";

/*
 * The colour arithmetic every user-picked colour goes through before it is
 * painted next to text: reading a colour the way it was typed, measuring two
 * colours against each other the way WCAG 2 does, and finding the nearest
 * shade of a colour that reads on a given background.
 *
 * Pure and React-free on purpose. The Pill (UI/Components/Pill/PillColors)
 * works out its badge tones with it, and the notification emails, which are
 * built on the server where React is not available, colour their severity,
 * state and status names with it (Utils/Email/EmailColorUtil).
 */

interface HSL {
  hue: number;
  saturation: number;
  lightness: number;
}

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
