import { describe, expect, test } from "@jest/globals";
import * as BrandColors from "../../../Types/BrandColors";
import Color, { RGB } from "../../../Types/Color";
import {
  composite,
  getAlphaForLuminance,
  getContrastRatio,
  getPillColors,
  getReadableShade,
  getRelativeLuminance,
  parseColor,
  PillColors,
  PillTone,
} from "../../../UI/Components/Pill/PillColors";

/*
 * The colours a Pill paints, worked out from any hex a user can pick. The
 * promise under test is the one the old solid pill broke: whatever the
 * colour, the text reads against the badge behind it - in both themes, and
 * on every surface a pill actually sits on.
 */

const WHITE: RGB = { red: 255, green: 255, blue: 255 };
const BLACK: RGB = { red: 0, green: 0, blue: 0 };

// The light theme's card / row surfaces: white, and gray-50 (headers, hover).
const LIGHT_SURFACES: Array<RGB> = [WHITE, { red: 249, green: 250, blue: 251 }];

/*
 * The dark theme's (Theme.css): the page canvas, a card, a raised surface
 * (table header, hovered row), and the tertiary surface.
 */
const DARK_SURFACES: Array<RGB> = [
  { red: 15, green: 23, blue: 42 },
  { red: 23, green: 32, blue: 51 },
  { red: 30, green: 41, blue: 59 },
  { red: 39, green: 52, blue: 73 },
];

const WCAG_AA_TEXT: number = 4.5;

function parseRgba(value: string): { rgb: RGB; alpha: number } {
  const match: RegExpMatchArray | null = value.match(
    /^rgba\((\d+), (\d+), (\d+), ([\d.]+)\)$/,
  );

  if (!match) {
    throw new Error(`Not an rgba() colour: ${value}`);
  }

  return {
    rgb: {
      red: Number(match[1]),
      green: Number(match[2]),
      blue: Number(match[3]),
    },
    alpha: Number(match[4]),
  };
}

function hexToRgb(value: string): RGB {
  const rgb: RGB | null = parseColor(value);

  if (!rgb) {
    throw new Error(`Not a hex colour: ${value}`);
  }

  return rgb;
}

// What the browser paints behind the text: the wash over the surface.
function paintedWash(tone: PillTone, surface: RGB): RGB {
  const wash: { rgb: RGB; alpha: number } = parseRgba(tone.backgroundColor);
  return composite(wash.rgb, wash.alpha, surface);
}

function textContrast(tone: PillTone, surface: RGB): number {
  return getContrastRatio(hexToRgb(tone.textColor), paintedWash(tone, surface));
}

const STOCK_COLORS: Array<[string, Color]> = Object.entries(BrandColors)
  .filter((entry: [string, unknown]) => {
    return entry[1] instanceof Color;
  })
  .map((entry: [string, unknown]) => {
    return [entry[0], entry[1] as Color];
  });

const EDGE_COLORS: Array<string> = [
  "#ffffff",
  "#000000",
  "#fff5cc",
  "#ffff00",
  "#00ff00",
  "#00ffff",
  "#0000ff",
  "#ff00ff",
  "#808080",
  "#1e3a8a",
  "#fefefe",
  "#010101",
];

/*
 * A spread across the whole cube, the same on every run (a fixed-seed LCG),
 * so a failure names a colour that can be reproduced.
 */
function sampleColors(count: number): Array<string> {
  const colors: Array<string> = [];
  let seed: number = 20260101;

  for (let i: number = 0; i < count; i++) {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    colors.push(`#${(seed >>> 8).toString(16).padStart(6, "0").slice(-6)}`);
  }

  return colors;
}

const ALL_COLORS: Array<string> = [
  ...STOCK_COLORS.map((entry: [string, Color]) => {
    return entry[1].toString();
  }),
  ...EDGE_COLORS,
  ...sampleColors(400),
];

describe("parseColor", () => {
  test.each([
    ["#2ab57d", { red: 42, green: 181, blue: 125 }],
    ["2ab57d", { red: 42, green: 181, blue: 125 }],
    ["#2AB57D", { red: 42, green: 181, blue: 125 }],
    ["#fff", { red: 255, green: 255, blue: 255 }],
    ["#2ab57dcc", { red: 42, green: 181, blue: 125 }],
    ["rgb(42, 181, 125)", { red: 42, green: 181, blue: 125 }],
    ["rgba(42, 181, 125, 0.5)", { red: 42, green: 181, blue: 125 }],
    ["rgb(42 181 125)", { red: 42, green: 181, blue: 125 }],
    ["  #2ab57d  ", { red: 42, green: 181, blue: 125 }],
  ])("reads %s", (value: string, expected: RGB) => {
    expect(parseColor(value)).toEqual(expected);
  });

  test("reads a Color", () => {
    expect(parseColor(new Color("#fd625e"))).toEqual({
      red: 253,
      green: 98,
      blue: 94,
    });
  });

  test.each(["", "red", "#12345", "#ggg", "rgb(300, 0, 0)", "transparent"])(
    "gives up on %p rather than guessing",
    (value: string) => {
      expect(parseColor(value)).toBeNull();
    },
  );

  test("gives up on null and undefined", () => {
    expect(parseColor(null)).toBeNull();
    expect(parseColor(undefined)).toBeNull();
  });
});

describe("getRelativeLuminance and getContrastRatio", () => {
  test("follow WCAG 2 at the ends of the scale", () => {
    expect(getRelativeLuminance(BLACK)).toBe(0);
    expect(getRelativeLuminance(WHITE)).toBeCloseTo(1, 10);
    expect(getContrastRatio(BLACK, WHITE)).toBeCloseTo(21, 10);
    expect(getContrastRatio(WHITE, BLACK)).toBeCloseTo(21, 10);
    expect(getContrastRatio(WHITE, WHITE)).toBe(1);
  });

  test("match a known pair: gray-500 on white is 4.83:1", () => {
    expect(getContrastRatio(hexToRgb("#6b7280"), WHITE)).toBeCloseTo(4.83, 2);
  });

  test("white on the stock green is the under-3:1 the old pill drew", () => {
    expect(
      getContrastRatio(WHITE, hexToRgb(BrandColors.Green.toString())),
    ).toBeLessThan(3);
  });
});

describe("composite", () => {
  test("paints the colour over the surface at the given opacity", () => {
    expect(composite(BLACK, 0.5, WHITE)).toEqual({
      red: 128,
      green: 128,
      blue: 128,
    });
    expect(composite(BLACK, 0, WHITE)).toEqual(WHITE);
    expect(composite(BLACK, 1, WHITE)).toEqual(BLACK);
  });
});

describe("getReadableShade", () => {
  test("keeps a colour that already reads", () => {
    const navy: RGB = hexToRgb("#1e3a8a");

    expect(
      getReadableShade({
        color: navy,
        background: WHITE,
        minimumContrast: 4.5,
      }),
    ).toEqual(navy);
  });

  test("darkens a colour that does not, on a light background", () => {
    const green: RGB = hexToRgb("#2ab57d");
    const shade: RGB = getReadableShade({
      color: green,
      background: WHITE,
      minimumContrast: 4.5,
    });

    expect(getContrastRatio(shade, WHITE)).toBeGreaterThanOrEqual(4.5);
    expect(getRelativeLuminance(shade)).toBeLessThan(
      getRelativeLuminance(green),
    );
    // Still green: the shade only moved in lightness.
    expect(shade.green).toBeGreaterThan(shade.red);
    expect(shade.green).toBeGreaterThan(shade.blue);
  });

  test("lightens a colour that does not, on a dark background", () => {
    const slate: RGB = { red: 23, green: 32, blue: 51 };
    const maroon: RGB = hexToRgb("#b70400");
    const shade: RGB = getReadableShade({
      color: maroon,
      background: slate,
      minimumContrast: 7,
    });

    expect(getContrastRatio(shade, slate)).toBeGreaterThanOrEqual(7);
    expect(getRelativeLuminance(shade)).toBeGreaterThan(
      getRelativeLuminance(maroon),
    );
    expect(shade.red).toBeGreaterThan(shade.green);
  });

  test("stops at the nearest passing shade, not at black", () => {
    const shade: RGB = getReadableShade({
      color: hexToRgb("#2ab57d"),
      background: WHITE,
      minimumContrast: 4.5,
    });

    expect(getContrastRatio(shade, WHITE)).toBeLessThan(4.7);
  });

  test("caps the saturation of a shade it has to move", () => {
    const shade: RGB = getReadableShade({
      color: hexToRgb("#fd625e"),
      background: WHITE,
      minimumContrast: 5.25,
      maximumSaturation: 0.8,
    });

    // A neon red would be all red channel; a capped one keeps some of the rest.
    expect(shade.green).toBeGreaterThan(15);
    expect(getContrastRatio(shade, WHITE)).toBeGreaterThanOrEqual(5.25);
  });

  test.each(ALL_COLORS)(
    "reaches 4.5:1 on white and slate for %s",
    (hex: string) => {
      const color: RGB = hexToRgb(hex);
      const slate: RGB = { red: 23, green: 32, blue: 51 };

      expect(
        getContrastRatio(
          getReadableShade({
            color,
            background: WHITE,
            minimumContrast: 4.5,
          }),
          WHITE,
        ),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        getContrastRatio(
          getReadableShade({
            color,
            background: slate,
            minimumContrast: 4.5,
          }),
          slate,
        ),
      ).toBeGreaterThanOrEqual(4.5);
    },
  );
});

describe("getAlphaForLuminance", () => {
  test("lands a dark colour over white on the target luminance", () => {
    const alpha: number = getAlphaForLuminance({
      color: BLACK,
      surface: WHITE,
      targetLuminance: 0.89,
      range: { min: 0, max: 1 },
    });

    // Within one step of an 8-bit channel, which is as near as paint gets.
    expect(
      Math.abs(getRelativeLuminance(composite(BLACK, alpha, WHITE)) - 0.89),
    ).toBeLessThan(0.008);
  });

  test("lands a light colour over a dark surface on the target luminance", () => {
    const slate: RGB = { red: 23, green: 32, blue: 51 };
    const alpha: number = getAlphaForLuminance({
      color: WHITE,
      surface: slate,
      targetLuminance: 0.05,
      range: { min: 0, max: 1 },
    });

    expect(
      Math.abs(getRelativeLuminance(composite(WHITE, alpha, slate)) - 0.05),
    ).toBeLessThan(0.008);
  });

  test("stays inside its range when the target is out of reach", () => {
    // Yellow at full strength is lighter than the target: the most it gets.
    expect(
      getAlphaForLuminance({
        color: hexToRgb("#ffbf53"),
        surface: WHITE,
        targetLuminance: 0.89,
        range: { min: 0.04, max: 0.16 },
      }),
    ).toBeCloseTo(0.16, 3);

    // Black would need almost none: the least it gets.
    expect(
      getAlphaForLuminance({
        color: BLACK,
        surface: WHITE,
        targetLuminance: 0.99,
        range: { min: 0.04, max: 0.16 },
      }),
    ).toBeCloseTo(0.04, 3);
  });
});

describe("getPillColors", () => {
  test.each(ALL_COLORS)(
    "light text reads on the wash on every light surface: %s",
    (hex: string) => {
      const colors: PillColors = getPillColors(hex);

      for (const surface of LIGHT_SURFACES) {
        expect(textContrast(colors.light, surface)).toBeGreaterThanOrEqual(
          WCAG_AA_TEXT,
        );
      }
    },
  );

  test.each(ALL_COLORS)(
    "dark text reads on the wash on every dark surface: %s",
    (hex: string) => {
      const colors: PillColors = getPillColors(hex);

      for (const surface of DARK_SURFACES) {
        expect(textContrast(colors.dark, surface)).toBeGreaterThanOrEqual(
          WCAG_AA_TEXT,
        );
      }
    },
  );

  test.each(ALL_COLORS)(
    "the dot shows on the surface in both themes: %s",
    (hex: string) => {
      const colors: PillColors = getPillColors(hex);

      expect(
        getContrastRatio(hexToRgb(colors.light.dotColor), WHITE),
      ).toBeGreaterThanOrEqual(1.5);
      expect(
        getContrastRatio(hexToRgb(colors.dark.dotColor), DARK_SURFACES[1]!),
      ).toBeGreaterThanOrEqual(3);
    },
  );

  test("the dot is the colour itself whenever it shows", () => {
    expect(getPillColors(BrandColors.Green).light.dotColor).toBe("#2ab57d");
    expect(getPillColors(BrandColors.Red).light.dotColor).toBe("#fd625e");
    expect(getPillColors(BrandColors.Yellow).light.dotColor).toBe("#ffbf53");
    expect(getPillColors(BrandColors.Black).light.dotColor).toBe("#000000");
    expect(getPillColors(BrandColors.Green).dark.dotColor).toBe("#2ab57d");
    expect(getPillColors(BrandColors.Gray500).dark.dotColor).toBe("#6b7280");
  });

  test("a dot that would vanish is shaded until it shows", () => {
    // White on white, black and maroon on slate.
    expect(getPillColors("#ffffff").light.dotColor).not.toBe("#ffffff");
    expect(getPillColors("#000000").dark.dotColor).not.toBe("#000000");
    expect(getPillColors(BrandColors.Moroon500).dark.dotColor).not.toBe(
      "#b70400",
    );
  });

  test("text that already reads keeps the exact colour", () => {
    // Maroon and navy clear the light target as they are.
    expect(getPillColors(BrandColors.Moroon500).light.textColor).toBe(
      "#b70400",
    );
    expect(getPillColors("#1e3a8a").light.textColor).toBe("#1e3a8a");
  });

  test("the stock state colours get a deeper shade of themselves", () => {
    const green: RGB = hexToRgb(
      getPillColors(BrandColors.Green).light.textColor,
    );
    const red: RGB = hexToRgb(getPillColors(BrandColors.Red).light.textColor);

    expect(green.green).toBeGreaterThan(green.red);
    expect(green.green).toBeGreaterThan(green.blue);
    expect(red.red).toBeGreaterThan(red.green);
    expect(red.red).toBeGreaterThan(red.blue);
    expect(getRelativeLuminance(green)).toBeLessThan(
      getRelativeLuminance(hexToRgb("#2ab57d")),
    );
  });

  test("every colour's wash weighs about the same in the light theme", () => {
    /*
     * The regression: a fixed ten percent of black was a heavy gray beside
     * ten percent of green. Colours whose wash is not capped land on one
     * luminance; yellow (capped at its most) is the one lighter exception.
     */
    const luminances: Array<number> = [
      BrandColors.Black,
      BrandColors.Gray500,
      BrandColors.Green,
      BrandColors.Red,
      BrandColors.Blue500,
      BrandColors.Moroon500,
      BrandColors.Purple500,
    ].map((color: Color) => {
      return getRelativeLuminance(
        paintedWash(getPillColors(color).light, WHITE),
      );
    });

    for (const luminance of luminances) {
      expect(luminance).toBeGreaterThan(0.87);
      expect(luminance).toBeLessThan(0.91);
    }
  });

  test("the dark wash is lighter than the surface, never a hole in it", () => {
    for (const hex of ["#000000", "#b70400", "#1e3a8a", "#2ab57d"]) {
      expect(
        getRelativeLuminance(
          paintedWash(getPillColors(hex).dark, DARK_SURFACES[1]!),
        ),
      ).toBeGreaterThan(getRelativeLuminance(DARK_SURFACES[1]!));
    }
  });

  test("dark text is lighter than light text, for the same colour", () => {
    for (const hex of ALL_COLORS.slice(0, 40)) {
      const colors: PillColors = getPillColors(hex);

      expect(
        getRelativeLuminance(hexToRgb(colors.dark.textColor)),
      ).toBeGreaterThan(getRelativeLuminance(hexToRgb(colors.light.textColor)));
    }
  });

  test("rings are translucent shades of the text", () => {
    const colors: PillColors = getPillColors(BrandColors.Green);
    const ring: { rgb: RGB; alpha: number } = parseRgba(colors.light.ringColor);

    expect(ring.rgb).toEqual(hexToRgb(colors.light.textColor));
    expect(ring.alpha).toBeGreaterThan(0);
    expect(ring.alpha).toBeLessThan(1);
  });

  test("an unreadable colour falls back to gray rather than throwing", () => {
    // The old pill threw from Color.shouldUseDarkText on these.
    expect(getPillColors("not-a-colour")).toEqual(getPillColors("#6b7280"));
    expect(getPillColors(undefined)).toEqual(getPillColors("#6b7280"));
    expect(getPillColors(null)).toEqual(getPillColors("#6b7280"));
  });

  test("a Color and its hex string give the same colours", () => {
    expect(getPillColors(new Color("#fd625e"))).toEqual(
      getPillColors("#fd625e"),
    );
  });
});
