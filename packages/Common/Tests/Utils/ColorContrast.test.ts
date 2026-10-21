import { RGB } from "../../Types/Color";
import * as ColorContrast from "../../Utils/ColorContrast";
import * as PillColors from "../../UI/Components/Pill/PillColors";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The colour arithmetic the Pill and the notification emails share. Its
 * behaviour is pinned in depth by PillColors.test.ts, which reads it through
 * the Pill's re-export; this file pins the two things that re-export cannot:
 * that the module stands on its own without React - the emails are rendered
 * by App, which has none - and that the Pill hands out these very functions
 * rather than copies that could drift apart.
 */

const WHITE: RGB = { red: 255, green: 255, blue: 255 };
const BLACK: RGB = { red: 0, green: 0, blue: 0 };

describe("ColorContrast stands on its own", () => {
  test("imports nothing from React or from the UI", () => {
    const source: string = fs.readFileSync(
      path.resolve(__dirname, "../../Utils/ColorContrast.ts"),
      "utf8",
    );
    const imports: Array<string> = Array.from(
      source.matchAll(/from\s+"([^"]+)"/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    expect(imports).toEqual(["../Types/Color"]);
  });

  test.each([
    "composite",
    "getAlphaForLuminance",
    "getContrastRatio",
    "getReadableShade",
    "getRelativeLuminance",
    "parseColor",
  ] as const)(
    "the Pill re-exports %s itself, not a copy",
    (name: keyof typeof ColorContrast) => {
      expect(typeof ColorContrast[name]).toBe("function");
      expect(PillColors[name]).toBe(ColorContrast[name]);
    },
  );
});

describe("ColorContrast arithmetic, read directly", () => {
  test("parses hex and rgb() colours to channels", () => {
    expect(ColorContrast.parseColor("#ef4444")).toEqual({
      red: 239,
      green: 68,
      blue: 68,
    });
    expect(ColorContrast.parseColor("rgb(239, 68, 68)")).toEqual({
      red: 239,
      green: 68,
      blue: 68,
    });
    expect(ColorContrast.parseColor("tomato")).toBeNull();
  });

  test("measures contrast the WCAG 2 way", () => {
    expect(ColorContrast.getContrastRatio(BLACK, WHITE)).toBeCloseTo(21, 10);
    expect(ColorContrast.getContrastRatio(WHITE, WHITE)).toBe(1);
  });

  test("darkens a pale colour until it reads, and keeps a dark one", () => {
    const yellow: RGB = { red: 250, green: 204, blue: 21 };
    const shade: RGB = ColorContrast.getReadableShade({
      color: yellow,
      background: WHITE,
      minimumContrast: 4.5,
    });

    expect(ColorContrast.getContrastRatio(shade, WHITE)).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(
      ColorContrast.getReadableShade({
        color: BLACK,
        background: WHITE,
        minimumContrast: 4.5,
      }),
    ).toEqual(BLACK);
  });

  test("composites and finds an opacity for a target luminance", () => {
    expect(ColorContrast.composite(BLACK, 0.5, WHITE)).toEqual({
      red: 128,
      green: 128,
      blue: 128,
    });

    const alpha: number = ColorContrast.getAlphaForLuminance({
      color: BLACK,
      surface: WHITE,
      targetLuminance: 0.5,
      range: { min: 0, max: 1 },
    });

    expect(alpha).toBeGreaterThan(0);
    expect(alpha).toBeLessThan(1);
  });
});
