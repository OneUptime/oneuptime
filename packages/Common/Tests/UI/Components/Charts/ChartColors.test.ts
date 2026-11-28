import { describe, expect, test } from "@jest/globals";
import {
  AvailableChartColors,
  ChartColorValue,
  ColorUtility,
  chartColors,
  constructCategoryColors,
  getColorClassName,
  getColorHex,
  isHexColorValue,
} from "../../../../UI/Components/Charts/ChartLibrary/Utils/ChartColors";

/*
 * A chart series is colored by a named palette key, painted with Tailwind
 * classes, or by a raw hex a person picked, painted with an inline style.
 * Mixing the two up paints a custom-colored series gray, or gives an SVG a
 * class name where it needs a color.
 */

const UTILITIES: Array<ColorUtility> = ["bg", "stroke", "fill", "text"];

describe("chartColors", () => {
  test("every palette color has a class for each utility and a hex", () => {
    for (const key of AvailableChartColors) {
      const color: (typeof chartColors)[string] = chartColors[key]!;

      for (const utility of UTILITIES) {
        expect(color[utility]).toBe(`${utility}-${String(key)}-500`);
      }

      expect(color.hex).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  test("AvailableChartColors lists the palette in its order", () => {
    expect(AvailableChartColors).toEqual(Object.keys(chartColors));
    expect(AvailableChartColors[0]).toBe("blue");
  });

  test("no two palette colors share a hex", () => {
    const hexes: Array<string> = AvailableChartColors.map(
      (key: ChartColorValue): string => {
        return chartColors[key]!.hex;
      },
    );

    expect(new Set(hexes).size).toBe(hexes.length);
  });
});

describe("isHexColorValue", () => {
  test("is a raw hex color", () => {
    expect(isHexColorValue("#6366f1")).toBe(true);
    expect(isHexColorValue("#FFF")).toBe(true);
  });

  test("ignores whitespace around a hex color", () => {
    expect(isHexColorValue("  #6366f1 ")).toBe(true);
  });

  test("is not a named palette key", () => {
    expect(isHexColorValue("indigo")).toBe(false);
    expect(isHexColorValue("")).toBe(false);
  });

  test("is not a missing value or a number", () => {
    expect(isHexColorValue(undefined)).toBe(false);
    expect(isHexColorValue(null)).toBe(false);
    expect(isHexColorValue(0 as unknown as ChartColorValue)).toBe(false);
  });
});

describe("constructCategoryColors", () => {
  test("gives each category the color at its position", () => {
    expect(
      Array.from(
        constructCategoryColors(["cpu", "memory"], ["blue", "#ff0000"]),
      ),
    ).toEqual([
      ["cpu", "blue"],
      ["memory", "#ff0000"],
    ]);
  });

  test("goes round the colors again when there are more categories", () => {
    expect(
      Array.from(
        constructCategoryColors(["a", "b", "c", "d", "e"], ["blue", "emerald"]),
      ),
    ).toEqual([
      ["a", "blue"],
      ["b", "emerald"],
      ["c", "blue"],
      ["d", "emerald"],
      ["e", "blue"],
    ]);
  });

  test("is empty without categories", () => {
    expect(constructCategoryColors([], ["blue"]).size).toBe(0);
  });

  test("keeps a repeated category's last color", () => {
    expect(constructCategoryColors(["a", "a"], ["blue", "rose"]).get("a")).toBe(
      "rose",
    );
  });
});

describe("getColorClassName", () => {
  test("is the palette color's class for each utility", () => {
    expect(getColorClassName("indigo", "bg")).toBe("bg-indigo-500");
    expect(getColorClassName("indigo", "stroke")).toBe("stroke-indigo-500");
    expect(getColorClassName("indigo", "fill")).toBe("fill-indigo-500");
    expect(getColorClassName("indigo", "text")).toBe("text-indigo-500");
  });

  test("is gray for a color the palette does not have", () => {
    for (const utility of UTILITIES) {
      expect(getColorClassName("chartreuse", utility)).toBe(
        `${utility}-gray-500`,
      );
    }
  });

  test("is no class for a hex color, so the series is not painted gray", () => {
    for (const utility of UTILITIES) {
      expect(getColorClassName("#ff0000", utility)).toBe("");
    }
  });
});

describe("getColorHex", () => {
  test("is the palette color's hex", () => {
    expect(getColorHex("indigo")).toBe("#6366f1");
    expect(getColorHex("emerald")).toBe("#10b981");
  });

  test("passes a hex color through unchanged", () => {
    expect(getColorHex("#ABCDEF")).toBe("#ABCDEF");
  });

  test("is gray for a color the palette does not have", () => {
    expect(getColorHex("chartreuse")).toBe("#6b7280");
    expect(getColorHex("chartreuse")).toBe(chartColors["gray"]!.hex);
  });
});
