import {
  DEFAULT_DROPDOWN_VIEWPORT_MARGIN_IN_PX,
  DropdownHorizontalAlignment,
  getDropdownAlignmentClassName,
  getDropdownHorizontalAlignment,
} from "../../../UI/Utils/DropdownAlignment";
import { describe, expect, test } from "@jest/globals";

// Tailwind `w-72`, the width every telemetry time range dropdown is styled to.
const DROPDOWN_WIDTH: number = 288;

describe("getDropdownHorizontalAlignment", () => {
  describe("triggers with room to the right", () => {
    test("left aligns a trigger at the far left of a desktop viewport", () => {
      /*
       * This is the metric explorer toolbar case: the time range button is the
       * first control in the toolbar, so the popup must open rightwards.
       */
      expect(
        getDropdownHorizontalAlignment({
          anchorLeft: 64,
          anchorRight: 180,
          dropdownWidth: DROPDOWN_WIDTH,
          viewportWidth: 1440,
        }),
      ).toBe(DropdownHorizontalAlignment.Left);
    });

    test("left aligns when the trigger starts at x=0", () => {
      expect(
        getDropdownHorizontalAlignment({
          anchorLeft: 0,
          anchorRight: 116,
          dropdownWidth: DROPDOWN_WIDTH,
          viewportWidth: 1024,
        }),
      ).toBe(DropdownHorizontalAlignment.Left);
    });

    test("left aligns a mid-page trigger that still fits", () => {
      expect(
        getDropdownHorizontalAlignment({
          anchorLeft: 500,
          anchorRight: 616,
          dropdownWidth: DROPDOWN_WIDTH,
          viewportWidth: 1440,
        }),
      ).toBe(DropdownHorizontalAlignment.Left);
    });

    test("left aligns when the popup lands exactly on the right gutter", () => {
      const viewportWidth: number = 1000;
      const anchorLeft: number =
        viewportWidth - DEFAULT_DROPDOWN_VIEWPORT_MARGIN_IN_PX - DROPDOWN_WIDTH;

      expect(
        getDropdownHorizontalAlignment({
          anchorLeft: anchorLeft,
          anchorRight: anchorLeft + 116,
          dropdownWidth: DROPDOWN_WIDTH,
          viewportWidth: viewportWidth,
        }),
      ).toBe(DropdownHorizontalAlignment.Left);
    });
  });

  describe("triggers near the right edge", () => {
    test("flips to right alignment one pixel past the right gutter", () => {
      const viewportWidth: number = 1000;
      const anchorLeft: number =
        viewportWidth -
        DEFAULT_DROPDOWN_VIEWPORT_MARGIN_IN_PX -
        DROPDOWN_WIDTH +
        1;

      expect(
        getDropdownHorizontalAlignment({
          anchorLeft: anchorLeft,
          anchorRight: viewportWidth - 20,
          dropdownWidth: DROPDOWN_WIDTH,
          viewportWidth: viewportWidth,
        }),
      ).toBe(DropdownHorizontalAlignment.Right);
    });

    test("right aligns a trigger flush against the right edge", () => {
      expect(
        getDropdownHorizontalAlignment({
          anchorLeft: 1300,
          anchorRight: 1436,
          dropdownWidth: DROPDOWN_WIDTH,
          viewportWidth: 1440,
        }),
      ).toBe(DropdownHorizontalAlignment.Right);
    });
  });

  describe("viewports smaller than the popup", () => {
    test("prefers the edge that clips least when neither side fits", () => {
      /*
       * A 200px viewport cannot contain a 288px popup. Left alignment clips by
       * 288 + 10 - 192 = 106; right alignment clips by 8 - (150 - 288) = 146.
       * Left wins.
       */
      expect(
        getDropdownHorizontalAlignment({
          anchorLeft: 10,
          anchorRight: 150,
          dropdownWidth: DROPDOWN_WIDTH,
          viewportWidth: 200,
        }),
      ).toBe(DropdownHorizontalAlignment.Left);
    });

    test("picks right alignment when that is the smaller overflow", () => {
      /*
       * Left alignment clips by 180 + 288 - 292 = 176; right alignment clips by
       * 8 - (290 - 288) = 6. Right wins.
       */
      expect(
        getDropdownHorizontalAlignment({
          anchorLeft: 180,
          anchorRight: 290,
          dropdownWidth: DROPDOWN_WIDTH,
          viewportWidth: 300,
        }),
      ).toBe(DropdownHorizontalAlignment.Right);
    });

    test("prefers left alignment when both edges clip by the same amount", () => {
      /*
       * Anchor built so both edges clip by exactly `overflow` pixels:
       * left overflow  = 14 + 288 - (300 - 8)  = 10
       * right overflow = 8 - (286 - 288)       = 10
       */
      const viewportWidth: number = 300;
      const margin: number = 8;
      const width: number = 288;
      const overflow: number = 10;
      const anchorLeft: number = viewportWidth - margin - width + overflow;
      const anchorRight: number = width + margin - overflow;

      expect(
        getDropdownHorizontalAlignment({
          anchorLeft: anchorLeft,
          anchorRight: anchorRight,
          dropdownWidth: width,
          viewportWidth: viewportWidth,
          viewportMargin: margin,
        }),
      ).toBe(DropdownHorizontalAlignment.Left);
    });
  });

  describe("viewport margin", () => {
    test("honours a custom margin when deciding to flip", () => {
      const viewportWidth: number = 1000;
      const anchorLeft: number = 700;

      // With no gutter the popup fits: 700 + 288 = 988 <= 1000.
      expect(
        getDropdownHorizontalAlignment({
          anchorLeft: anchorLeft,
          anchorRight: 820,
          dropdownWidth: DROPDOWN_WIDTH,
          viewportWidth: viewportWidth,
          viewportMargin: 0,
        }),
      ).toBe(DropdownHorizontalAlignment.Left);

      // With a 40px gutter it no longer fits: 988 > 960.
      expect(
        getDropdownHorizontalAlignment({
          anchorLeft: anchorLeft,
          anchorRight: 820,
          dropdownWidth: DROPDOWN_WIDTH,
          viewportWidth: viewportWidth,
          viewportMargin: 40,
        }),
      ).toBe(DropdownHorizontalAlignment.Right);
    });

    test("treats an explicit zero margin as zero, not as the default", () => {
      const viewportWidth: number = 1000;
      const anchorLeft: number = viewportWidth - DROPDOWN_WIDTH;

      expect(
        getDropdownHorizontalAlignment({
          anchorLeft: anchorLeft,
          anchorRight: viewportWidth,
          dropdownWidth: DROPDOWN_WIDTH,
          viewportWidth: viewportWidth,
          viewportMargin: 0,
        }),
      ).toBe(DropdownHorizontalAlignment.Left);

      expect(
        getDropdownHorizontalAlignment({
          anchorLeft: anchorLeft,
          anchorRight: viewportWidth,
          dropdownWidth: DROPDOWN_WIDTH,
          viewportWidth: viewportWidth,
        }),
      ).toBe(DropdownHorizontalAlignment.Right);
    });
  });

  describe("unmeasurable layouts", () => {
    test("defaults to left when the popup has no width yet", () => {
      expect(
        getDropdownHorizontalAlignment({
          anchorLeft: 1400,
          anchorRight: 1440,
          dropdownWidth: 0,
          viewportWidth: 1440,
        }),
      ).toBe(DropdownHorizontalAlignment.Left);
    });

    test("defaults to left when the viewport has no width", () => {
      expect(
        getDropdownHorizontalAlignment({
          anchorLeft: 0,
          anchorRight: 0,
          dropdownWidth: DROPDOWN_WIDTH,
          viewportWidth: 0,
        }),
      ).toBe(DropdownHorizontalAlignment.Left);
    });

    test("defaults to left for non-finite measurements", () => {
      expect(
        getDropdownHorizontalAlignment({
          anchorLeft: 0,
          anchorRight: 100,
          dropdownWidth: Number.NaN,
          viewportWidth: 1440,
        }),
      ).toBe(DropdownHorizontalAlignment.Left);

      expect(
        getDropdownHorizontalAlignment({
          anchorLeft: 0,
          anchorRight: 100,
          dropdownWidth: DROPDOWN_WIDTH,
          viewportWidth: Number.POSITIVE_INFINITY,
        }),
      ).toBe(DropdownHorizontalAlignment.Left);
    });
  });

  describe("common breakpoints", () => {
    /*
     * The picker is the first control in the toolbar on every telemetry page,
     * so it must stay left aligned no matter how narrow the screen gets.
     */
    const leftmostAnchorCases: Array<{ name: string; viewportWidth: number }> =
      [
        { name: "mobile", viewportWidth: 375 },
        { name: "tablet", viewportWidth: 768 },
        { name: "laptop", viewportWidth: 1280 },
        { name: "desktop", viewportWidth: 1920 },
      ];

    test.each(leftmostAnchorCases)(
      "left aligns a leftmost toolbar trigger on $name",
      (testCase: { name: string; viewportWidth: number }) => {
        expect(
          getDropdownHorizontalAlignment({
            anchorLeft: 16,
            anchorRight: 132,
            dropdownWidth: DROPDOWN_WIDTH,
            viewportWidth: testCase.viewportWidth,
          }),
        ).toBe(DropdownHorizontalAlignment.Left);
      },
    );
  });
});

describe("getDropdownAlignmentClassName", () => {
  test("maps left alignment to the Tailwind left-0 class", () => {
    expect(
      getDropdownAlignmentClassName(DropdownHorizontalAlignment.Left),
    ).toBe("left-0");
  });

  test("maps right alignment to the Tailwind right-0 class", () => {
    expect(
      getDropdownAlignmentClassName(DropdownHorizontalAlignment.Right),
    ).toBe("right-0");
  });

  test("never returns both positioning classes at once", () => {
    const classNames: Array<string> = [
      getDropdownAlignmentClassName(DropdownHorizontalAlignment.Left),
      getDropdownAlignmentClassName(DropdownHorizontalAlignment.Right),
    ];

    for (const className of classNames) {
      expect(
        className.includes("left-0") && className.includes("right-0"),
      ).toBe(false);
    }
  });
});
