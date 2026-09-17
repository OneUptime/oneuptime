import { describe, expect, test } from "@jest/globals";
import BrowserUtil from "../../../Server/Utils/Browser";
import ScreenSizeType from "../../../Types/ScreenSizeType";

/*
 * BrowserUtil.getViewportHeightAndWidth is a pure, synchronous lookup: it maps
 * a ScreenSizeType enum value to a fixed viewport { height, width }. It has one
 * switch case per enum member plus a default arm that mirrors Desktop.
 *
 * These tests pin every branch (Desktop, Mobile, Tablet, default), the exact
 * pixel values each branch returns, and the shape/orientation invariants that
 * downstream page.setViewportSize relies on. The function touches no network,
 * no filesystem, no clock and no randomness, so every assertion is fully
 * deterministic.
 */

interface Viewport {
  height: number;
  width: number;
}

function viewportFor(screenSizeType: ScreenSizeType): Viewport {
  return BrowserUtil.getViewportHeightAndWidth({
    screenSizeType: screenSizeType,
  });
}

describe("BrowserUtil.getViewportHeightAndWidth", () => {
  describe("per screen size branch", () => {
    test("Desktop maps to 1920x1080 (landscape full HD)", () => {
      const viewport: Viewport = viewportFor(ScreenSizeType.Desktop);

      expect(viewport).toEqual({ height: 1080, width: 1920 });
    });

    test("Mobile maps to 360x640 (portrait handset)", () => {
      const viewport: Viewport = viewportFor(ScreenSizeType.Mobile);

      expect(viewport).toEqual({ height: 640, width: 360 });
    });

    test("Tablet maps to 1024x768", () => {
      const viewport: Viewport = viewportFor(ScreenSizeType.Tablet);

      expect(viewport).toEqual({ height: 768, width: 1024 });
    });
  });

  describe("default / unknown branch", () => {
    test("an unknown screen size falls through to the Desktop defaults", () => {
      /*
       * The switch has an explicit default arm that assigns the same 1080x1920
       * as Desktop. It is only reachable with a value outside the enum, so we
       * cast an arbitrary string through unknown to exercise it. If a future
       * change forgets the default, this catches the resulting 0x0 viewport.
       */
      const viewport: Viewport = viewportFor(
        "SomeUnsupportedSize" as unknown as ScreenSizeType,
      );

      expect(viewport).toEqual({ height: 1080, width: 1920 });
    });

    test("the default branch never returns the 0x0 initial values", () => {
      const viewport: Viewport = viewportFor("" as unknown as ScreenSizeType);

      expect(viewport.height).toBeGreaterThan(0);
      expect(viewport.width).toBeGreaterThan(0);
    });

    test("default and Desktop are indistinguishable", () => {
      const desktop: Viewport = viewportFor(ScreenSizeType.Desktop);
      const unknown: Viewport = viewportFor(
        "not-a-real-size" as unknown as ScreenSizeType,
      );

      expect(unknown).toEqual(desktop);
    });
  });

  describe("shape and value invariants", () => {
    const allSizes: Array<ScreenSizeType> = [
      ScreenSizeType.Desktop,
      ScreenSizeType.Mobile,
      ScreenSizeType.Tablet,
    ];

    test("every enum member yields exactly a height and width", () => {
      for (const size of allSizes) {
        const viewport: Viewport = viewportFor(size);

        expect(Object.keys(viewport).sort()).toEqual(["height", "width"]);
      }
    });

    test("every dimension is a positive, finite integer", () => {
      for (const size of allSizes) {
        const viewport: Viewport = viewportFor(size);

        for (const value of [viewport.height, viewport.width]) {
          expect(Number.isInteger(value)).toBe(true);
          expect(Number.isFinite(value)).toBe(true);
          expect(value).toBeGreaterThan(0);
        }
      }
    });

    test("Mobile is the only portrait orientation; Desktop and Tablet are landscape", () => {
      const mobile: Viewport = viewportFor(ScreenSizeType.Mobile);
      const desktop: Viewport = viewportFor(ScreenSizeType.Desktop);
      const tablet: Viewport = viewportFor(ScreenSizeType.Tablet);

      expect(mobile.width).toBeLessThan(mobile.height);
      expect(desktop.width).toBeGreaterThan(desktop.height);
      expect(tablet.width).toBeGreaterThan(tablet.height);
    });

    test("Desktop is the largest surface and Mobile the smallest", () => {
      const areaOf: (viewport: Viewport) => number = (
        viewport: Viewport,
      ): number => {
        return viewport.height * viewport.width;
      };

      const desktopArea: number = areaOf(viewportFor(ScreenSizeType.Desktop));
      const tabletArea: number = areaOf(viewportFor(ScreenSizeType.Tablet));
      const mobileArea: number = areaOf(viewportFor(ScreenSizeType.Mobile));

      expect(desktopArea).toBeGreaterThan(tabletArea);
      expect(tabletArea).toBeGreaterThan(mobileArea);
    });

    test("the three known sizes are all distinct", () => {
      const serialized: Array<string> = allSizes.map(
        (size: ScreenSizeType): string => {
          return JSON.stringify(viewportFor(size));
        },
      );

      expect(new Set(serialized).size).toBe(allSizes.length);
    });
  });

  describe("purity and determinism", () => {
    test("repeated calls with the same input return equal values", () => {
      const first: Viewport = viewportFor(ScreenSizeType.Tablet);
      const second: Viewport = viewportFor(ScreenSizeType.Tablet);

      expect(second).toEqual(first);
    });

    test("each call returns a fresh object, so callers cannot corrupt later results", () => {
      const first: Viewport = viewportFor(ScreenSizeType.Desktop);
      first.height = -1;
      first.width = -1;

      const second: Viewport = viewportFor(ScreenSizeType.Desktop);

      expect(second).toEqual({ height: 1080, width: 1920 });
    });
  });
});
