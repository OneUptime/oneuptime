import Color from "../../../../Types/Color";
import { DISTINCT_COLORS, getColorHue } from "../../../../Utils/DistinctColor";
import {
  COLOR_PICKER_SWATCHES,
  ColorSwatchOption,
  DISTINCT_COLOR_NAMES,
} from "../../../../UI/Components/ColorPicker/ColorPalette";
import { describe, expect, test } from "@jest/globals";

/*
 * The swatches every color field leads with. They are the colors OneUptime
 * picks for a new record (Utils/DistinctColor, held to both themes and to
 * one another in DistinctColor.test.ts), so a Create form's color always
 * starts on one of them, ticked - each with a plain name to say and hover,
 * shown round the color wheel.
 */

const HEX: RegExp = /^#[0-9a-f]{6}$/;

describe("the color field's swatches", () => {
  test("are exactly the distinct palette, each color once, as lowercase hex", () => {
    const palette: Array<string> = DISTINCT_COLORS.map(
      (color: Color): string => {
        return color.toString().toLowerCase();
      },
    );
    const swatches: Array<string> = COLOR_PICKER_SWATCHES.map(
      (swatch: ColorSwatchOption): string => {
        return swatch.hex;
      },
    );

    expect([...swatches].sort()).toEqual([...palette].sort());
    expect(new Set(swatches).size).toBe(swatches.length);

    for (const hex of swatches) {
      expect(hex).toMatch(HEX);
    }
  });

  test("every one has a plain name of its own, never its code", () => {
    const names: Array<string> = COLOR_PICKER_SWATCHES.map(
      (swatch: ColorSwatchOption): string => {
        return swatch.name;
      },
    );

    expect(names).toEqual([
      "Red",
      "Orange",
      "Lime",
      "Green",
      "Teal",
      "Blue",
      "Indigo",
      "Purple",
      "Magenta",
      "Pink",
    ]);
    expect(new Set(names).size).toBe(names.length);

    for (const name of names) {
      expect(name).not.toMatch(/#|\d/);
    }
  });

  test("the names cover the palette and nothing else", () => {
    expect(Object.keys(DISTINCT_COLOR_NAMES).sort()).toEqual(
      DISTINCT_COLORS.map((color: Color): string => {
        return color.toString().toLowerCase();
      }).sort(),
    );
  });

  test("run round the color wheel, red first, so a green one is found among the greens", () => {
    const hues: Array<number> = COLOR_PICKER_SWATCHES.map(
      (swatch: ColorSwatchOption): number => {
        const hue: number | null = getColorHue(swatch.hex);

        // The palette has no greys: every swatch has a hue.
        expect(hue).not.toBeNull();

        return hue!;
      },
    );

    for (let index: number = 1; index < hues.length; index++) {
      expect(hues[index]!).toBeGreaterThan(hues[index - 1]!);
    }
  });

  test("leave DistinctColor's own order alone: the first new record is still indigo", () => {
    expect(DISTINCT_COLORS[0]!.toString().toLowerCase()).toBe("#6366f1");
    expect(COLOR_PICKER_SWATCHES[0]!.hex).not.toBe("#6366f1");
  });
});
