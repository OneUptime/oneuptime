import { describe, expect, test } from "@jest/globals";
import {
  elevation,
  radius,
  spacing,
  touchTarget,
  typography,
  type ElevationLevel,
  type TypographyVariant,
} from "./tokens";
import * as themeIndex from "./index";

/*
 * The geometry every screen reaches for. These scales exist so that a card is
 * one radius, a secondary line one size and a gutter one width across the
 * whole app; the tests below hold the properties that make a scale a scale,
 * rather than re-typing the numbers.
 */

const VARIANTS: Array<TypographyVariant> = [
  "largeTitle",
  "title",
  "title2",
  "title3",
  "headline",
  "body",
  "callout",
  "subhead",
  "footnote",
  "caption",
  "overline",
];

describe("typography", () => {
  test("defines exactly the documented variants", () => {
    expect(Object.keys(typography).sort()).toEqual([...VARIANTS].sort());
  });

  test.each(VARIANTS)("%s sets a font size and a weight", (variant) => {
    const style: (typeof typography)[TypographyVariant] = typography[variant];

    expect(typeof style.fontSize).toBe("number");
    expect(style.fontSize).toBeGreaterThanOrEqual(11);
    expect(style.fontWeight).toBeDefined();
  });

  test.each(VARIANTS)(
    "%s sets a line height at least as tall as its font size",
    (variant) => {
      /*
       * Scaled text without a line height clips descenders on Android, and a
       * line height shorter than the glyphs clips them everywhere.
       */
      const style: (typeof typography)[TypographyVariant] = typography[variant];

      expect(typeof style.lineHeight).toBe("number");
      expect(style.lineHeight).toBeGreaterThanOrEqual(Number(style.fontSize));
    },
  );

  test("the scale runs from largest to smallest in the documented order", () => {
    const sizes: Array<number> = VARIANTS.map((variant) => {
      return Number(typography[variant].fontSize);
    });

    for (let index: number = 1; index < sizes.length; index++) {
      expect(sizes[index]).toBeLessThanOrEqual(sizes[index - 1]);
    }
  });

  test("titles are heavier than body copy", () => {
    const weight: (variant: TypographyVariant) => number = (variant) => {
      return Number(typography[variant].fontWeight);
    };

    expect(weight("largeTitle")).toBeGreaterThan(weight("body"));
    expect(weight("title")).toBeGreaterThan(weight("body"));
    expect(weight("headline")).toBeGreaterThan(weight("body"));
  });

  test("only the overline is upper-cased, and only as a display transform", () => {
    /*
     * textTransform keeps the underlying string in sentence case, so screen
     * readers do not spell an upper-cased heading out letter by letter.
     */
    for (const variant of VARIANTS) {
      expect(typography[variant].textTransform).toBe(
        variant === "overline" ? "uppercase" : undefined,
      );
    }
  });
});

describe("spacing", () => {
  test("strictly increases from the smallest step to the largest", () => {
    const steps: Array<number> = Object.values(spacing);

    expect(steps).toEqual([2, 4, 8, 12, 16, 20, 24, 32]);
    for (let index: number = 1; index < steps.length; index++) {
      expect(steps[index]).toBeGreaterThan(steps[index - 1]);
    }
  });

  test("every step is an even number of points, so halves stay on the pixel grid", () => {
    for (const step of Object.values(spacing)) {
      expect(step % 2).toBe(0);
    }
  });

  test("the screen gutter is 20 points", () => {
    expect(spacing.xl).toBe(20);
  });
});

describe("radius", () => {
  test("increases from small controls to sheets, with pill the largest", () => {
    expect(radius.sm).toBeLessThan(radius.md);
    expect(radius.md).toBeLessThan(radius.lg);
    expect(radius.lg).toBeLessThan(radius.xl);
    expect(radius.xl).toBeLessThan(radius.pill);
  });

  test("pill is large enough to round any control fully", () => {
    expect(radius.pill).toBeGreaterThanOrEqual(touchTarget * 4);
  });

  test("cards are 16 points round and buttons 12", () => {
    expect(radius.lg).toBe(16);
    expect(radius.md).toBe(12);
  });
});

describe("elevation", () => {
  const LEVELS: Array<Exclude<ElevationLevel, "none">> = [
    "card",
    "raised",
    "overlay",
  ];

  test.each([false, true])("none is an empty style (dark: %s)", (dark) => {
    expect(elevation("none", dark)).toEqual({});
  });

  test.each(LEVELS)("%s is a boxShadow string and nothing else", (level) => {
    /*
     * boxShadow works the same on iOS, Android and web under the new
     * architecture. Mixing in the legacy shadow* or Android elevation props
     * would draw a second, different shadow on one platform.
     */
    for (const dark of [false, true]) {
      const style: ReturnType<typeof elevation> = elevation(level, dark);

      expect(Object.keys(style)).toEqual(["boxShadow"]);
      expect(typeof style.boxShadow).toBe("string");
      expect(String(style.boxShadow)).toMatch(
        /^(-?\d+px -?\d+px \d+px rgba\(\d+, \d+, \d+, [\d.]+\)(, )?)+$/,
      );
    }
  });

  test("each level casts a larger shadow than the one below it", () => {
    const largestBlur: (level: ElevationLevel) => number = (level) => {
      const shadow: string = String(elevation(level, false).boxShadow);
      const blurs: Array<number> = [
        ...shadow.matchAll(/px -?\d+px (\d+)px/g),
      ].map((match: RegExpMatchArray) => {
        return Number(match[1]);
      });
      return Math.max(...blurs);
    };

    expect(largestBlur("raised")).toBeGreaterThan(largestBlur("card"));
    expect(largestBlur("overlay")).toBeGreaterThan(largestBlur("raised"));
  });

  test.each(LEVELS)(
    "%s is softer in dark mode, where a dark shadow on a dark canvas reads as dirt",
    (level) => {
      const opacities: (dark: boolean) => Array<number> = (dark) => {
        return [
          ...String(elevation(level, dark).boxShadow).matchAll(
            /rgba\(\d+, \d+, \d+, ([\d.]+)\)/g,
          ),
        ].map((match: RegExpMatchArray) => {
          return Number(match[1]);
        });
      };

      const light: Array<number> = opacities(false);
      const dark: Array<number> = opacities(true);

      expect(elevation(level, true)).not.toEqual(elevation(level, false));
      expect(dark).toHaveLength(light.length);
      dark.forEach((opacity: number, index: number) => {
        expect(opacity).toBeGreaterThan(0);
        expect(opacity).toBeLessThan(light[index]);
      });
    },
  );
});

describe("touchTarget", () => {
  test("is at least the 44 point platform minimum", () => {
    expect(touchTarget).toBeGreaterThanOrEqual(44);
  });
});

describe("the theme entry point", () => {
  test("re-exports the same token objects, not copies", () => {
    expect(themeIndex.spacing).toBe(spacing);
    expect(themeIndex.radius).toBe(radius);
    expect(themeIndex.typography).toBe(typography);
    expect(themeIndex.elevation).toBe(elevation);
    expect(themeIndex.touchTarget).toBe(touchTarget);
  });
});
