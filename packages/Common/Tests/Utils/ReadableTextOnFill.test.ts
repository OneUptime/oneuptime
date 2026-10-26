import { describe, expect, test } from "@jest/globals";
import Color, { RGB } from "../../Types/Color";
import {
  Green,
  Moroon,
  Red,
  Red900,
  Yellow,
  Yellow300,
} from "../../Types/BrandColors";
import {
  FILLED_TEXT_MINIMUM_CONTRAST,
  getContrastRatio,
  getReadableShade,
  getReadableTextOnFill,
  parseColor,
} from "../../Utils/ColorContrast";
import { SeededRandom, seededRandom } from "../Helpers/SeededRandom";

/*
 * The colour of words on a filled colour someone picked - a status page's
 * overall status banner, in the colour its owner gave that monitor status.
 *
 * The banner's words were white whatever the fill: 2.6:1 on the default
 * Operational green, 1.6:1 on Degraded's yellow. Now they are white where
 * white reads at 4.5:1, and otherwise the lightest shade of the fill's own
 * colour that does - deep green on green, deep amber on yellow - never a
 * grey, and never a change to the fill itself.
 */

const WHITE: RGB = { red: 255, green: 255, blue: 255 };

const rgbOf: (color: Color) => RGB = (color: Color): RGB => {
  const rgb: RGB | null = parseColor(color);

  if (!rgb) {
    throw new Error(`Not a colour: ${color.toString()}`);
  }

  return rgb;
};

// The hue of a colour, 0 to 360, or null for a grey.
const hueOf: (rgb: RGB) => number | null = (rgb: RGB): number | null => {
  const red: number = rgb.red / 255;
  const green: number = rgb.green / 255;
  const blue: number = rgb.blue / 255;
  const max: number = Math.max(red, green, blue);
  const min: number = Math.min(red, green, blue);
  const delta: number = max - min;

  if (delta < 0.02) {
    return null;
  }

  let hue: number;

  if (max === red) {
    hue = ((green - blue) / delta) % 6;
  } else if (max === green) {
    hue = (blue - red) / delta + 2;
  } else {
    hue = (red - green) / delta + 4;
  }

  return (hue * 60 + 360) % 360;
};

const hueDistance: (first: number, second: number) => number = (
  first: number,
  second: number,
): number => {
  const distance: number = Math.abs(first - second) % 360;

  return distance > 180 ? 360 - distance : distance;
};

describe("the words on a filled colour", () => {
  test("WCAG's text minimum: 4.5:1", () => {
    expect(FILLED_TEXT_MINIMUM_CONTRAST).toBe(4.5);
  });

  test.each([
    ["Operational's default green", Green],
    ["Degraded's default yellow", Yellow],
    ["Offline's default red", Red],
    ["a pale yellow", Yellow300],
  ])(
    "on %s, white does not read, so the words are a deep shade of it at 4.5:1",
    (_name: string, fill: Color) => {
      const rgb: RGB = rgbOf(fill);

      expect(getContrastRatio(WHITE, rgb)).toBeLessThan(4.5);

      const text: RGB = getReadableTextOnFill(rgb);

      expect(text).not.toEqual(WHITE);
      expect(getContrastRatio(text, rgb)).toBeGreaterThanOrEqual(4.5);
      // Darker than the fill: words, not a highlight.
      expect(text.red + text.green + text.blue).toBeLessThan(
        rgb.red + rgb.green + rgb.blue,
      );
      // The fill's own colour, not a grey.
      expect(hueDistance(hueOf(text)!, hueOf(rgb)!)).toBeLessThan(12);
    },
  );

  test("the default green's words are deep green, the yellow's deep amber", () => {
    const onGreen: RGB = getReadableTextOnFill(rgbOf(Green));
    const onYellow: RGB = getReadableTextOnFill(rgbOf(Yellow));

    // Green leads in a green, red and green lead in an amber.
    expect(onGreen.green).toBeGreaterThan(onGreen.red);
    expect(onGreen.green).toBeGreaterThan(onGreen.blue);
    expect(onYellow.red).toBeGreaterThan(onYellow.blue);
    expect(onYellow.green).toBeGreaterThan(onYellow.blue);
  });

  test.each([
    ["a deep red", Moroon],
    ["the darkest red", Red900],
    ["navy", new Color("#1e3a8a")],
    ["black", new Color("#000000")],
  ])("on %s, the words stay white", (_name: string, fill: Color) => {
    const rgb: RGB = rgbOf(fill);

    expect(getContrastRatio(WHITE, rgb)).toBeGreaterThanOrEqual(4.5);
    expect(getReadableTextOnFill(rgb)).toEqual(WHITE);
  });

  test("on white itself, the words are a grey that reads", () => {
    const text: RGB = getReadableTextOnFill(WHITE);

    expect(getContrastRatio(text, WHITE)).toBeGreaterThanOrEqual(4.5);
    expect(text.red).toBe(text.green);
    expect(text.green).toBe(text.blue);
  });

  test("whatever colour an owner picks, its words read at 4.5:1 (600 seeded colours)", () => {
    const random: SeededRandom = seededRandom(4936);
    let darkWords: number = 0;

    for (let index: number = 0; index < 600; index++) {
      const fill: RGB = {
        red: random(256),
        green: random(256),
        blue: random(256),
      };
      const text: RGB = getReadableTextOnFill(fill);
      const ratio: number = getContrastRatio(text, fill);

      expect([fill, ratio >= 4.5]).toEqual([fill, true]);

      if (text !== WHITE && getContrastRatio(WHITE, fill) < 4.5) {
        darkWords++;
        // Only where white could not: never trading readable white away.
        expect(getContrastRatio(WHITE, fill)).toBeLessThan(
          FILLED_TEXT_MINIMUM_CONTRAST,
        );
      }
    }

    // Both answers come up: the sweep is not all one kind of fill.
    expect(darkWords).toBeGreaterThan(100);
    expect(darkWords).toBeLessThan(550);
  });

  test("the lightest shade that reads: one step lighter would not", () => {
    const fill: RGB = rgbOf(Green);
    const text: RGB = getReadableTextOnFill(fill);
    const lighter: RGB = {
      red: Math.min(255, text.red + 6),
      green: Math.min(255, text.green + 6),
      blue: Math.min(255, text.blue + 6),
    };

    expect(getContrastRatio(text, fill)).toBeLessThan(5);
    expect(getContrastRatio(lighter, fill)).toBeLessThan(4.5);
  });
});

describe("getReadableShade's direction", () => {
  test("without one, it moves away from the background as before", () => {
    const yellow: RGB = { red: 250, green: 204, blue: 21 };

    const onWhite: RGB = getReadableShade({
      color: yellow,
      background: WHITE,
      minimumContrast: 4.5,
    });

    expect(getContrastRatio(onWhite, WHITE)).toBeGreaterThanOrEqual(4.5);
  });

  test("towards dark, it darkens even on a mid-tone background", () => {
    const green: RGB = rgbOf(Green);

    const shade: RGB = getReadableShade({
      color: green,
      background: green,
      minimumContrast: 4.5,
      towards: "dark",
    });

    expect(getContrastRatio(shade, green)).toBeGreaterThanOrEqual(4.5);
    expect(shade.green).toBeLessThan(green.green);
  });

  test("towards light, it lightens", () => {
    const navy: RGB = { red: 30, green: 58, blue: 138 };

    const shade: RGB = getReadableShade({
      color: navy,
      background: navy,
      minimumContrast: 4.5,
      towards: "light",
    });

    expect(getContrastRatio(shade, navy)).toBeGreaterThanOrEqual(4.5);
    expect(shade.blue).toBeGreaterThan(navy.blue);
  });
});
