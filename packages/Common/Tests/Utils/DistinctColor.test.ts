import * as BrandColors from "../../Types/BrandColors";
import Color, { RGB } from "../../Types/Color";
import { getContrastRatio, parseColor } from "../../Utils/ColorContrast";
import {
  DISTINCT_COLORS,
  NEUTRAL_CHROMA,
  SIMILAR_HUE_DEGREES,
  areSimilarColors,
  getColorHue,
  pickColorForName,
  pickDistinctColor,
  pickRandomDistinctColor,
} from "../../Utils/DistinctColor";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The palette OneUptime picks a new record's colour from, and how it picks.
 *
 * A new label, state, severity, monitor status, incident role or bar colour
 * rule starts with a colour already picked - one the records beside it do
 * not use yet - instead of an empty picker that blocks Create. What is pinned:
 *
 *   - the palette is curated: no black, white or grey; every colour shows on
 *     the light and the dark theme alike; no two share a hue family; each is
 *     a colour the product already names (BrandColors);
 *   - the first colour no record looks like is picked - a near match counts
 *     as taken, a grey takes nothing - and once every colour is taken, the
 *     one taken least, so a long list goes round the palette evenly;
 *   - a machine-made record named the same gets the same colour everywhere.
 */

const THEME_CSS: string = fs.readFileSync(
  path.resolve(__dirname, "../../UI/Styles/Theme.css"),
  "utf8",
);

const SURFACE_TOKEN: RegExp = /--ou-surface-primary:\s*([^;]+);/;

// The surface a card, a table row and a form sit on, in one theme's block.
function surfaceIn(block: string): RGB {
  const start: number = THEME_CSS.indexOf(block);

  expect(start).toBeGreaterThanOrEqual(0);

  const match: RegExpExecArray | null = SURFACE_TOKEN.exec(
    THEME_CSS.slice(start),
  );

  expect(match).not.toBeNull();

  const rgb: RGB | null = parseColor(match![1]!.trim());

  expect(rgb).not.toBeNull();

  return rgb!;
}

const LIGHT_SURFACE: RGB = surfaceIn(":root {");
const DARK_SURFACE: RGB = surfaceIn("html.dark {");

// WCAG 2.1's minimum for a coloured dot, swatch or ring (1.4.11).
const NON_TEXT_CONTRAST: number = 3;

const hexes: (colors: ReadonlyArray<Color>) => Array<string> = (
  colors: ReadonlyArray<Color>,
): Array<string> => {
  return colors.map((color: Color): string => {
    return color.toString();
  });
};

const PALETTE: Array<string> = hexes(DISTINCT_COLORS);

const rgbOf: (hex: string) => RGB = (hex: string): RGB => {
  return parseColor(hex)!;
};

const hueDistance: (first: string, second: string) => number = (
  first: string,
  second: string,
): number => {
  const distance: number =
    Math.abs(getColorHue(first)! - getColorHue(second)!) % 360;

  return Math.min(distance, 360 - distance);
};

describe("the palette", () => {
  test("is the dark and light themes' surfaces this test reads", () => {
    expect(LIGHT_SURFACE).toEqual({ red: 255, green: 255, blue: 255 });
    expect(DARK_SURFACE).toEqual({ red: 23, green: 32, blue: 51 });
  });

  test("holds enough colours to go round, each listed once, as lowercase hex", () => {
    expect(PALETTE.length).toBeGreaterThanOrEqual(8);
    expect(new Set(PALETTE).size).toBe(PALETTE.length);

    for (const hex of PALETTE) {
      expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  test("has no black, white or grey", () => {
    for (const hex of PALETTE) {
      expect({ hex, hue: getColorHue(hex) }).not.toEqual({ hex, hue: null });
    }

    for (const grey of [
      BrandColors.Black,
      BrandColors.White,
      BrandColors.Gray500,
      BrandColors.Grey,
      BrandColors.Slate500,
      BrandColors.Zinc500,
      BrandColors.VeryLightGray,
      BrandColors.LightGray,
    ]) {
      expect(PALETTE).not.toContain(grey.toString());
    }
  });

  test("shows on both themes: every colour clears 3:1 against the light and the dark surface", () => {
    for (const hex of PALETTE) {
      expect({
        hex,
        light: getContrastRatio(rgbOf(hex), LIGHT_SURFACE) >= NON_TEXT_CONTRAST,
        dark: getContrastRatio(rgbOf(hex), DARK_SURFACE) >= NON_TEXT_CONTRAST,
      }).toEqual({ hex, light: true, dark: true });
    }
  });

  test("never holds two colours of one hue family", () => {
    for (const first of PALETTE) {
      for (const second of PALETTE) {
        if (first === second) {
          continue;
        }

        expect({
          pair: `${first} ${second}`,
          similar: areSimilarColors(first, second),
        }).toEqual({ pair: `${first} ${second}`, similar: false });
      }
    }
  });

  test("lists each colour far round the wheel from the one before, so records made one after another stand apart", () => {
    for (let index: number = 1; index < PALETTE.length; index++) {
      expect(
        hueDistance(PALETTE[index - 1]!, PALETTE[index]!),
      ).toBeGreaterThanOrEqual(80);
    }
  });

  test("is made of colours the product already names", () => {
    const named: Set<string> = new Set<string>(
      Object.values(BrandColors)
        .filter((value: unknown): value is Color => {
          return value instanceof Color;
        })
        .map((color: Color): string => {
          return color.toString().toLowerCase();
        }),
    );

    for (const hex of PALETTE) {
      expect({ hex, named: named.has(hex) }).toEqual({ hex, named: true });
    }
  });

  test("starts with indigo, the product's own colour", () => {
    expect(PALETTE[0]).toBe(BrandColors.Indigo500.toString());
  });
});

describe("hues", () => {
  test("are read off any colour the pickers write", () => {
    expect(getColorHue("#ff0000")).toBe(0);
    expect(getColorHue("#00ff00")).toBe(120);
    expect(getColorHue("#0000ff")).toBe(240);
    expect(getColorHue(new Color("#ff00ff"))).toBe(300);
    expect(Math.round(getColorHue("#ec4899")!)).toBe(330);
    // Three-digit and upper case, as people type them.
    expect(getColorHue("#F00")).toBe(0);
  });

  test("are none for a grey, black, white or something that is not a colour", () => {
    for (const value of [
      "#000000",
      "#ffffff",
      "#4a4a4a",
      "#6b7280",
      "#64748b",
      "transparent",
      "",
      "not a colour",
      null,
      undefined,
    ]) {
      expect({ value, hue: getColorHue(value) }).toEqual({ value, hue: null });
    }
  });

  test("a muted colour has one, a greyish one does not", () => {
    // Channels 0.2 of their range apart: a muted, but real, red.
    expect(NEUTRAL_CHROMA).toBeLessThan(0.2);
    expect(getColorHue("#996666")).toBe(0);
    // 0.07 apart: a grey with a hint of red.
    expect(getColorHue("#857373")).toBeNull();
  });

  test("are similar within SIMILAR_HUE_DEGREES, round the wheel too", () => {
    expect(SIMILAR_HUE_DEGREES).toBe(20);
    // OneUptime's seeded red and tailwind's red-500.
    expect(areSimilarColors("#fd625e", BrandColors.Red500)).toBe(true);
    // Maroon is still red.
    expect(areSimilarColors(BrandColors.Moroon500, "#ef4444")).toBe(true);
    // Rose (350) and red (0) meet across 360.
    expect(areSimilarColors(BrandColors.Rose500, BrandColors.Red500)).toBe(
      true,
    );
    expect(areSimilarColors("#ff0000", "#ff0015")).toBe(true);
    // Indigo is not purple.
    expect(areSimilarColors(BrandColors.Indigo500, BrandColors.Purple500)).toBe(
      false,
    );
    // A grey is similar to nothing, not even another grey.
    expect(areSimilarColors("#6b7280", "#64748b")).toBe(false);
    expect(areSimilarColors("#000000", "#000000")).toBe(false);
  });
});

describe("picking a colour for a new record", () => {
  test("is the first colour of the palette when nothing is listed", () => {
    expect(pickDistinctColor().toString()).toBe(PALETTE[0]);
    expect(pickDistinctColor([]).toString()).toBe(PALETTE[0]);
  });

  test("is one none of a new project's incident states looks like", () => {
    // Identified, Acknowledged, Resolved as ProjectService seeds them.
    const picked: string = pickDistinctColor([
      BrandColors.Red,
      BrandColors.Yellow,
      BrandColors.Green,
    ]).toString();

    expect(picked).toBe(BrandColors.Indigo500.toString());

    for (const seeded of [
      BrandColors.Red,
      BrandColors.Yellow,
      BrandColors.Green,
    ]) {
      expect(areSimilarColors(picked, seeded)).toBe(false);
    }
  });

  test("skips a colour a record only nearly uses", () => {
    // indigo-600 is not indigo-500, but reads as the same colour.
    expect(pickDistinctColor(["#4f46e5"]).toString()).toBe(PALETTE[1]);
    expect(pickDistinctColor([new Color("#4F46E5")]).toString()).toBe(
      PALETTE[1],
    );
  });

  test("takes the first colour no record looks like, in the palette's order", () => {
    expect(pickDistinctColor([PALETTE[0]!, PALETTE[1]!]).toString()).toBe(
      PALETTE[2],
    );
    // Order of the records does not matter, only what they use.
    expect(pickDistinctColor([PALETTE[1]!, PALETTE[0]!]).toString()).toBe(
      PALETTE[2],
    );
    // A gap is filled before the palette goes on.
    expect(
      pickDistinctColor([PALETTE[0]!, PALETTE[2]!, PALETTE[3]!]).toString(),
    ).toBe(PALETTE[1]);
  });

  test("leaves greys, empty values and what is not a colour out of it", () => {
    expect(
      pickDistinctColor([
        BrandColors.Black,
        "#4A4A4A",
        BrandColors.White,
        "transparent",
        "",
        null,
        undefined,
      ]).toString(),
    ).toBe(PALETTE[0]);
  });

  test("once every colour is taken, is the one taken least - the earliest of those", () => {
    expect(pickDistinctColor(PALETTE).toString()).toBe(PALETTE[0]);
    expect(pickDistinctColor([...PALETTE, PALETTE[0]!]).toString()).toBe(
      PALETTE[1],
    );
    expect(
      pickDistinctColor([...PALETTE, ...PALETTE.slice(0, 4)]).toString(),
    ).toBe(PALETTE[4]);
  });

  test("goes round the palette evenly as a list grows, never repeating the colour before", () => {
    const list: Array<string> = [];

    for (let made: number = 0; made < PALETTE.length * 3 + 4; made++) {
      const picked: string = pickDistinctColor(list).toString();

      if (list.length > 0) {
        expect(areSimilarColors(picked, list[list.length - 1])).toBe(false);
      }

      list.push(picked);
    }

    const counts: Array<number> = PALETTE.map((hex: string): number => {
      return list.filter((picked: string): boolean => {
        return picked === hex;
      }).length;
    });

    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    // The first round is the palette, in its order.
    expect(list.slice(0, PALETTE.length)).toEqual(PALETTE);
  });

  test("hands out a colour of its own, never the palette's", () => {
    const picked: Color = pickDistinctColor();

    picked.color = "#000000";

    expect(DISTINCT_COLORS[0]!.toString()).toBe(PALETTE[0]);
    expect(pickDistinctColor().toString()).toBe(PALETTE[0]);
  });
});

describe("a colour picked at random", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("is any colour of the palette, and only those", () => {
    const seen: Set<string> = new Set<string>();

    for (let index: number = 0; index < PALETTE.length; index++) {
      jest
        .spyOn(Math, "random")
        .mockReturnValueOnce((index + 0.5) / PALETTE.length);
      seen.add(pickRandomDistinctColor().toString());
    }

    expect(Array.from(seen)).toEqual(PALETTE);
  });

  test("stays in the palette at the very edges of Math.random", () => {
    jest.spyOn(Math, "random").mockReturnValueOnce(0);
    expect(pickRandomDistinctColor().toString()).toBe(PALETTE[0]);

    jest.spyOn(Math, "random").mockReturnValueOnce(0.9999999999);
    expect(pickRandomDistinctColor().toString()).toBe(
      PALETTE[PALETTE.length - 1],
    );
  });

  test("hands out a colour of its own", () => {
    jest.spyOn(Math, "random").mockReturnValueOnce(0);

    const picked: Color = pickRandomDistinctColor();
    picked.color = "#000000";

    expect(DISTINCT_COLORS[0]!.toString()).toBe(PALETTE[0]);
  });
});

describe("a colour for a record made by name", () => {
  const NAMES: Array<string> = [
    "production",
    "staging",
    "team:payments",
    "region:eu-west-1",
    "k8s",
    "",
    "Ünïcödé",
    "a much longer label name that goes on for a while",
  ];

  test("is the same for the same name, every time", () => {
    for (const name of NAMES) {
      expect(pickColorForName(name).toString()).toBe(
        pickColorForName(name).toString(),
      );
    }
  });

  test("is always a colour of the palette - never black or grey", () => {
    for (let index: number = 0; index < 200; index++) {
      const name: string = `label-${index}`;

      expect(PALETTE).toContain(pickColorForName(name).toString());
    }

    for (const name of NAMES) {
      expect(PALETTE).toContain(pickColorForName(name).toString());
    }
  });

  test("spreads names over the palette", () => {
    const used: Set<string> = new Set<string>();

    for (let index: number = 0; index < 200; index++) {
      used.add(pickColorForName(`label-${index}`).toString());
    }

    expect(used.size).toBe(PALETTE.length);
  });

  test("hands out a colour of its own", () => {
    const picked: Color = pickColorForName("production");
    const before: string = picked.toString();

    picked.color = "#000000";

    expect(pickColorForName("production").toString()).toBe(before);
  });
});

describe("the module", () => {
  test("stands on its own, without React or the server", () => {
    const source: string = fs.readFileSync(
      path.resolve(__dirname, "../../Utils/DistinctColor.ts"),
      "utf8",
    );
    const imports: Array<string> = Array.from(
      source.matchAll(/from\s+"([^"]+)"/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    expect(imports.sort()).toEqual(
      ["../Types/BrandColors", "../Types/Color", "./ColorContrast"].sort(),
    );
  });
});
