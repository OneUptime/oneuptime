import Color, { RGB } from "../../../Types/Color";
import { getContrastRatio, parseColor } from "../../../Utils/ColorContrast";
import { translationKey } from "../../Utils/TranslateTemplate";
import { ColorSwatchOption } from "./ColorPalette";

/*
 * The arithmetic behind the color field (Forms/Fields/ColorPicker): what a
 * stored value is, what a typed code means, and where a point on the
 * saturation square or the hue strip lands. Pure, so each rule is tested on
 * its own (Tests/UI/Components/ColorPicker/ColorValue.test.ts).
 */

// What the code box suggests, and what its messages give as an example.
export const COLOR_CODE_EXAMPLE: string = "#6366f1";

/*
 * Said under the code box when what is in it is not a color, on blur or
 * Enter - never while someone is still typing. Two messages, because "that
 * is not a color" alone leaves the reader to guess what is wrong.
 */
export const COLOR_CODE_INVALID_CHARACTERS_MESSAGE: string = translationKey(
  "Color codes use only the numbers 0-9 and the letters a-f, like #6366f1.",
);
export const COLOR_CODE_INVALID_LENGTH_MESSAGE: string = translationKey(
  "A color code has 6 characters after the #, like #6366f1.",
);

// What a color can arrive as: a Color, its text, or its JSON form.
export type ColorLike =
  | Color
  | string
  | { _type?: unknown; value?: unknown }
  | null
  | undefined;

/**
 * A stored color as the field compares it: lowercase #rrggbb, "" for none.
 * A value that is a color but not written as one (#ABC, rgb(...)) is
 * rewritten; one that is not a color at all is kept as it is, so it is still
 * shown, and simply matches no swatch.
 */
export const normalizeColorValue: (value: ColorLike) => string = (
  value: ColorLike,
): string => {
  let text: string = "";

  if (typeof value === "string") {
    text = value.trim();
  } else if (value instanceof Color) {
    text = value.toString().trim();
  } else if (value && typeof value.value === "string") {
    text = value.value.trim();
  }

  if (!text) {
    return "";
  }

  const rgb: RGB | null = parseColor(text);

  return rgb ? rgbToHex(rgb) : text;
};

export type ColorCodeInput =
  | { kind: "empty" }
  | { kind: "valid"; hex: string; isShorthand: boolean }
  | { kind: "invalid"; message: string };

const COLOR_CODE_PATTERN: RegExp = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;
const COLOR_CODE_CHARACTERS: RegExp = /^#?[0-9a-f]*$/i;

/**
 * What someone typed in the code box. "#6366F1", "6366f1" and " #6366f1 " are
 * all #6366f1; "#abc" is shorthand for #aabbcc. Anything else is invalid,
 * with the message that says why.
 */
export const readColorCodeInput: (text: string) => ColorCodeInput = (
  text: string,
): ColorCodeInput => {
  const trimmed: string = text.trim();

  if (!trimmed) {
    return { kind: "empty" };
  }

  const match: RegExpExecArray | null = COLOR_CODE_PATTERN.exec(trimmed);

  if (!match || !match[1]) {
    return {
      kind: "invalid",
      message: COLOR_CODE_CHARACTERS.test(trimmed)
        ? COLOR_CODE_INVALID_LENGTH_MESSAGE
        : COLOR_CODE_INVALID_CHARACTERS_MESSAGE,
    };
  }

  const digits: string = match[1].toLowerCase();
  const isShorthand: boolean = digits.length === 3;

  return {
    kind: "valid",
    hex: isShorthand
      ? `#${digits
          .split("")
          .map((digit: string): string => {
            return digit + digit;
          })
          .join("")}`
      : `#${digits}`,
    isShorthand,
  };
};

// The swatch a stored color is, if it is one.
export const findSwatch: (
  value: string,
  swatches: ReadonlyArray<ColorSwatchOption>,
) => ColorSwatchOption | undefined = (
  value: string,
  swatches: ReadonlyArray<ColorSwatchOption>,
): ColorSwatchOption | undefined => {
  const normalized: string = normalizeColorValue(value);

  if (!normalized) {
    return undefined;
  }

  return swatches.find((swatch: ColorSwatchOption): boolean => {
    return normalizeColorValue(swatch.hex) === normalized;
  });
};

const WHITE: RGB = { red: 255, green: 255, blue: 255 };
// The darkest text color of the light theme (gray-900).
const NEAR_BLACK: RGB = { red: 17, green: 24, blue: 39 };

/**
 * Whether the tick drawn on a swatch should be dark rather than white: the
 * one of the two that stands out more on that color. Every palette color
 * takes a white tick; a pale custom color takes a dark one.
 */
export const shouldUseDarkMark: (value: string) => boolean = (
  value: string,
): boolean => {
  const rgb: RGB | null = parseColor(value);

  if (!rgb) {
    return false;
  }

  return getContrastRatio(rgb, NEAR_BLACK) > getContrastRatio(rgb, WHITE);
};

/*
 * Hue, saturation and value (brightness): the two axes of the saturation
 * square and the one of the hue strip. h is 0 to 360, s and v 0 to 1.
 */
export interface Hsv {
  h: number;
  s: number;
  v: number;
}

const clamp: (value: number, min: number, max: number) => number = (
  value: number,
  min: number,
  max: number,
): number => {
  if (Number.isNaN(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, value));
};

const toHexPair: (channel: number) => string = (channel: number): string => {
  return Math.round(clamp(channel, 0, 255))
    .toString(16)
    .padStart(2, "0");
};

export const rgbToHex: (rgb: RGB) => string = (rgb: RGB): string => {
  return `#${toHexPair(rgb.red)}${toHexPair(rgb.green)}${toHexPair(rgb.blue)}`;
};

export const rgbToHsv: (rgb: RGB) => Hsv = (rgb: RGB): Hsv => {
  const red: number = rgb.red / 255;
  const green: number = rgb.green / 255;
  const blue: number = rgb.blue / 255;
  const max: number = Math.max(red, green, blue);
  const min: number = Math.min(red, green, blue);
  const delta: number = max - min;

  let hue: number = 0;

  if (delta !== 0) {
    if (max === red) {
      hue = ((green - blue) / delta) % 6;
    } else if (max === green) {
      hue = (blue - red) / delta + 2;
    } else {
      hue = (red - green) / delta + 4;
    }
  }

  return {
    h: (hue * 60 + 360) % 360,
    s: max === 0 ? 0 : delta / max,
    v: max,
  };
};

export const hsvToRgb: (hsv: Hsv) => RGB = (hsv: Hsv): RGB => {
  const hue: number = (((hsv.h % 360) + 360) % 360) / 60;
  const saturation: number = clamp(hsv.s, 0, 1);
  const value: number = clamp(hsv.v, 0, 1);
  const chroma: number = value * saturation;
  const second: number = chroma * (1 - Math.abs((hue % 2) - 1));
  const match: number = value - chroma;

  let red: number = 0;
  let green: number = 0;
  let blue: number = 0;

  if (hue < 1) {
    red = chroma;
    green = second;
  } else if (hue < 2) {
    red = second;
    green = chroma;
  } else if (hue < 3) {
    green = chroma;
    blue = second;
  } else if (hue < 4) {
    green = second;
    blue = chroma;
  } else if (hue < 5) {
    red = second;
    blue = chroma;
  } else {
    red = chroma;
    blue = second;
  }

  return {
    red: (red + match) * 255,
    green: (green + match) * 255,
    blue: (blue + match) * 255,
  };
};

export const hsvToHex: (hsv: Hsv) => string = (hsv: Hsv): string => {
  return rgbToHex(hsvToRgb(hsv));
};

/**
 * The HSV of a stored color, or null for something that is not a color. A
 * grey has no hue of its own, so it keeps `previousHue`: dragging to the
 * white edge of the square and back must not snap the hue strip to red.
 */
export const colorToHsv: (value: string, previousHue?: number) => Hsv | null = (
  value: string,
  previousHue?: number,
): Hsv | null => {
  const rgb: RGB | null = parseColor(value);

  if (!rgb) {
    return null;
  }

  const hsv: Hsv = rgbToHsv(rgb);

  if ((hsv.s === 0 || hsv.v === 0) && previousHue !== undefined) {
    return { ...hsv, h: previousHue };
  }

  return hsv;
};

export interface PointerBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Where a point on the saturation square lands: left to right is grey to
 * full color, top to bottom bright to black. A point outside the square is
 * held to its edge, so a drag that overshoots still reaches the corner. Null
 * for a square with no size (not laid out yet).
 */
export const getSaturationAtPoint: (data: {
  x: number;
  y: number;
  box: PointerBox;
}) => { s: number; v: number } | null = (data: {
  x: number;
  y: number;
  box: PointerBox;
}): { s: number; v: number } | null => {
  if (data.box.width <= 0 || data.box.height <= 0) {
    return null;
  }

  return {
    s: clamp((data.x - data.box.left) / data.box.width, 0, 1),
    v: 1 - clamp((data.y - data.box.top) / data.box.height, 0, 1),
  };
};

// Where a point on the hue strip lands, in degrees; null for no size.
export const getHueAtPoint: (data: {
  x: number;
  box: PointerBox;
}) => number | null = (data: { x: number; box: PointerBox }): number | null => {
  if (data.box.width <= 0) {
    return null;
  }

  return clamp((data.x - data.box.left) / data.box.width, 0, 1) * 359;
};

/*
 * The keys the saturation square and the hue strip answer to, as WAI-ARIA's
 * slider: arrows move a step, Shift or Page Up/Down ten, Home and End go to
 * the ends.
 */
export const SATURATION_STEP: number = 0.01;
export const SATURATION_BIG_STEP: number = 0.1;
export const HUE_STEP: number = 1;
export const HUE_BIG_STEP: number = 10;

/**
 * The saturation square after a key press, or null for a key it does not
 * use. Left/Right move along saturation, Up/Down along brightness.
 */
export const moveSaturationByKey: (data: {
  hsv: Hsv;
  key: string;
  shiftKey: boolean;
}) => Hsv | null = (data: {
  hsv: Hsv;
  key: string;
  shiftKey: boolean;
}): Hsv | null => {
  const step: number = data.shiftKey ? SATURATION_BIG_STEP : SATURATION_STEP;
  const { hsv } = data;

  switch (data.key) {
    case "ArrowRight":
      return { ...hsv, s: clamp(hsv.s + step, 0, 1) };
    case "ArrowLeft":
      return { ...hsv, s: clamp(hsv.s - step, 0, 1) };
    case "ArrowUp":
      return { ...hsv, v: clamp(hsv.v + step, 0, 1) };
    case "ArrowDown":
      return { ...hsv, v: clamp(hsv.v - step, 0, 1) };
    case "PageUp":
      return { ...hsv, v: clamp(hsv.v + SATURATION_BIG_STEP, 0, 1) };
    case "PageDown":
      return { ...hsv, v: clamp(hsv.v - SATURATION_BIG_STEP, 0, 1) };
    case "Home":
      return { ...hsv, s: 0 };
    case "End":
      return { ...hsv, s: 1 };
    default:
      return null;
  }
};

// The hue strip after a key press, or null for a key it does not use.
export const moveHueByKey: (data: {
  hue: number;
  key: string;
  shiftKey: boolean;
}) => number | null = (data: {
  hue: number;
  key: string;
  shiftKey: boolean;
}): number | null => {
  const step: number = data.shiftKey ? HUE_BIG_STEP : HUE_STEP;

  switch (data.key) {
    case "ArrowRight":
    case "ArrowUp":
      return clamp(data.hue + step, 0, 359);
    case "ArrowLeft":
    case "ArrowDown":
      return clamp(data.hue - step, 0, 359);
    case "PageUp":
      return clamp(data.hue + HUE_BIG_STEP, 0, 359);
    case "PageDown":
      return clamp(data.hue - HUE_BIG_STEP, 0, 359);
    case "Home":
      return 0;
    case "End":
      return 359;
    default:
      return null;
  }
};
