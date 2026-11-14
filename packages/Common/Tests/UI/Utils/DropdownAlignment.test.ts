import {
  DEFAULT_DROPDOWN_PLACEMENT,
  DEFAULT_DROPDOWN_VIEWPORT_MARGIN_IN_PX,
  DropdownHorizontalAlignment,
  DropdownPlacement,
  getDropdownAlignmentClassName,
  getDropdownAnchorEdges,
  getDropdownHorizontalAlignment,
  getDropdownPlacement,
  getDropdownShiftStyle,
  getDropdownShiftToFit,
  getDropdownViewportWidth,
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

/*
 * On a page that reads right to left, Tailwind's left-0 and right-0 mean
 * the line's start and end (Styles/TailwindReadingDirection.js): "Left"
 * pins a popup to its trigger's right edge and grows it leftwards. The
 * trigger's edges are read from the right, so the same resolver keeps the
 * popup on the screen - a Persian toolbar's last trigger sits at the
 * page's left end, and its popup opens from the trigger's left edge.
 */
describe("getDropdownAnchorEdges", () => {
  test("left to right, the trigger's edges as they are", () => {
    expect(
      getDropdownAnchorEdges({
        anchorLeft: 625,
        anchorRight: 744,
        viewportWidth: 768,
        isRightToLeft: false,
      }),
    ).toEqual({ anchorLeft: 625, anchorRight: 744 });
  });

  test("right to left, measured from the screen's right edge", () => {
    expect(
      getDropdownAnchorEdges({
        anchorLeft: 24,
        anchorRight: 145,
        viewportWidth: 768,
        isRightToLeft: true,
      }),
    ).toEqual({ anchorLeft: 623, anchorRight: 744 });
  });

  test("a Persian toolbar's last trigger, at the page's left end, opens toward the page", () => {
    const edges: { anchorLeft: number; anchorRight: number } =
      getDropdownAnchorEdges({
        anchorLeft: 24,
        anchorRight: 145,
        viewportWidth: 768,
        isRightToLeft: true,
      });

    // "Right" is the line's end: the popup's left edge on the trigger's, growing rightwards.
    expect(
      getDropdownHorizontalAlignment({
        ...edges,
        dropdownWidth: DROPDOWN_WIDTH,
        viewportWidth: 768,
      }),
    ).toBe(DropdownHorizontalAlignment.Right);
  });

  test("a Persian trigger with room toward the page's left opens from its start", () => {
    const edges: { anchorLeft: number; anchorRight: number } =
      getDropdownAnchorEdges({
        anchorLeft: 463,
        anchorRight: 584,
        viewportWidth: 1280,
        isRightToLeft: true,
      });

    expect(
      getDropdownHorizontalAlignment({
        ...edges,
        dropdownWidth: DROPDOWN_WIDTH,
        viewportWidth: 1280,
      }),
    ).toBe(DropdownHorizontalAlignment.Left);
  });
});

/*
 * The width a popup stays inside is the page's, not the window's: on a
 * phone the window grows with whatever runs past the screen, and a panel
 * first drawn past the edge of a 390px phone (innerWidth 900 then) found
 * room there and stayed off the screen.
 */
describe("getDropdownViewportWidth", () => {
  test("the page's width, where the window grew past it", () => {
    expect(getDropdownViewportWidth({ pageWidth: 390, windowWidth: 900 })).toBe(
      390,
    );
  });

  test("the page's width on a desktop too: a scrollbar is no room", () => {
    expect(
      getDropdownViewportWidth({ pageWidth: 1265, windowWidth: 1280 }),
    ).toBe(1265);
  });

  test("the window's, where the page reads no width (jsdom)", () => {
    expect(getDropdownViewportWidth({ pageWidth: 0, windowWidth: 768 })).toBe(
      768,
    );
    expect(
      getDropdownViewportWidth({ pageWidth: Number.NaN, windowWidth: 768 }),
    ).toBe(768);
  });

  test("a phone's trigger at its toolbar's end opens toward the page by the page's width", () => {
    const viewportWidth: number = getDropdownViewportWidth({
      pageWidth: 390,
      windowWidth: 900,
    });

    expect(
      getDropdownHorizontalAlignment({
        anchorLeft: 211,
        anchorRight: 353,
        dropdownWidth: DROPDOWN_WIDTH,
        viewportWidth: viewportWidth,
      }),
    ).toBe(DropdownHorizontalAlignment.Right);
    // By the grown window's, it opened off the screen.
    expect(
      getDropdownHorizontalAlignment({
        anchorLeft: 211,
        anchorRight: 353,
        dropdownWidth: DROPDOWN_WIDTH,
        viewportWidth: 900,
      }),
    ).toBe(DropdownHorizontalAlignment.Left);
  });
});

/*
 * A POPUP TOO WIDE FOR EITHER SIDE OF ITS TRIGGER SLIDES ONTO THE SCREEN
 * (#7098).
 *
 * The session replay's tab picker is 28rem (448px) wide. Under a button in
 * the middle of a 390px phone neither edge of the button has room for it,
 * so whichever edge it hangs from it ran off the screen. It now slides
 * along the line, away from that edge, until it sits inside the gutters.
 */
const PICKER_WIDTH: number = 448;

// A placement's popup, in viewport coordinates, the way the browser draws it.
function drawnBox(
  placement: DropdownPlacement,
  input: { anchorLeft: number; anchorRight: number; viewportWidth: number },
  width: number,
): { left: number; right: number } {
  const drawnWidth: number = Math.min(
    width,
    input.viewportWidth - 2 * DEFAULT_DROPDOWN_VIEWPORT_MARGIN_IN_PX,
  );

  if (placement.alignment === DropdownHorizontalAlignment.Right) {
    const right: number = input.anchorRight + placement.shiftInPx;

    return { left: right - drawnWidth, right: right };
  }

  const left: number = input.anchorLeft - placement.shiftInPx;

  return { left: left, right: left + drawnWidth };
}

describe("getDropdownShiftToFit", () => {
  test("a popup that fits where it hangs does not move", () => {
    expect(
      getDropdownShiftToFit({
        anchorLeft: 64,
        anchorRight: 180,
        dropdownWidth: PICKER_WIDTH,
        viewportWidth: 1280,
        alignment: DropdownHorizontalAlignment.Left,
      }),
    ).toBe(0);
    expect(
      getDropdownShiftToFit({
        anchorLeft: 1100,
        anchorRight: 1200,
        dropdownWidth: PICKER_WIDTH,
        viewportWidth: 1280,
        alignment: DropdownHorizontalAlignment.Right,
      }),
    ).toBe(0);
  });

  test("hung from its left edge, it slides left just enough to clear the right gutter", () => {
    // 150 + 374 = 524 against a right gutter at 382: 142 to the left.
    expect(
      getDropdownShiftToFit({
        anchorLeft: 150,
        anchorRight: 250,
        dropdownWidth: PICKER_WIDTH,
        viewportWidth: 390,
        alignment: DropdownHorizontalAlignment.Left,
      }),
    ).toBe(142);
  });

  test("hung from its right edge, it slides right just enough to clear the left gutter", () => {
    // 250 - 374 = -124 against a left gutter at 8: 132 to the right.
    expect(
      getDropdownShiftToFit({
        anchorLeft: 150,
        anchorRight: 250,
        dropdownWidth: PICKER_WIDTH,
        viewportWidth: 390,
        alignment: DropdownHorizontalAlignment.Right,
      }),
    ).toBe(132);
  });

  test("never past the far gutter", () => {
    // A trigger near the left edge has only 2px to give before the left gutter.
    expect(
      getDropdownShiftToFit({
        anchorLeft: 10,
        anchorRight: 90,
        dropdownWidth: 2000,
        viewportWidth: 1280,
        alignment: DropdownHorizontalAlignment.Left,
      }),
    ).toBe(2);
    expect(
      getDropdownShiftToFit({
        anchorLeft: 1190,
        anchorRight: 1270,
        dropdownWidth: 2000,
        viewportWidth: 1280,
        alignment: DropdownHorizontalAlignment.Right,
      }),
    ).toBe(2);
  });

  test("honours a custom margin", () => {
    expect(
      getDropdownShiftToFit({
        anchorLeft: 150,
        anchorRight: 250,
        dropdownWidth: PICKER_WIDTH,
        viewportWidth: 390,
        viewportMargin: 16,
        alignment: DropdownHorizontalAlignment.Left,
      }),
      // 358 wide between 16px gutters: 150 + 358 - 374 = 134.
    ).toBe(134);
  });

  test("an unmeasured layout does not move", () => {
    for (const input of [
      { dropdownWidth: 0, viewportWidth: 390 },
      { dropdownWidth: PICKER_WIDTH, viewportWidth: 0 },
      { dropdownWidth: Number.NaN, viewportWidth: 390 },
      { dropdownWidth: PICKER_WIDTH, viewportWidth: Number.NaN },
    ]) {
      expect(
        getDropdownShiftToFit({
          anchorLeft: 150,
          anchorRight: 250,
          ...input,
          alignment: DropdownHorizontalAlignment.Left,
        }),
      ).toBe(0);
    }

    expect(
      getDropdownShiftToFit({
        anchorLeft: Number.NaN,
        anchorRight: 250,
        dropdownWidth: PICKER_WIDTH,
        viewportWidth: 390,
        alignment: DropdownHorizontalAlignment.Left,
      }),
    ).toBe(0);
  });
});

describe("getDropdownPlacement keeps the picker inside the gutters wherever its button sits", () => {
  test.each([
    // [viewport, button's left edge, button's width]
    [390, 16, 92],
    [390, 140, 92],
    [390, 282, 92],
    [320, 16, 92],
    [320, 120, 92],
    [320, 212, 92],
    [640, 200, 92],
    [768, 340, 92],
    [1024, 600, 92],
    [1280, 16, 92],
    [1280, 700, 92],
    [1280, 1172, 92],
  ])(
    "a %ipx screen, a button at %ipx",
    (viewportWidth: number, anchorLeft: number, buttonWidth: number) => {
      const input: {
        anchorLeft: number;
        anchorRight: number;
        viewportWidth: number;
      } = {
        anchorLeft: anchorLeft,
        anchorRight: anchorLeft + buttonWidth,
        viewportWidth: viewportWidth,
      };
      const placement: DropdownPlacement = getDropdownPlacement({
        ...input,
        dropdownWidth: PICKER_WIDTH,
      });
      const box: { left: number; right: number } = drawnBox(
        placement,
        input,
        PICKER_WIDTH,
      );

      expect(box.left).toBeGreaterThanOrEqual(
        DEFAULT_DROPDOWN_VIEWPORT_MARGIN_IN_PX,
      );
      expect(box.right).toBeLessThanOrEqual(
        viewportWidth - DEFAULT_DROPDOWN_VIEWPORT_MARGIN_IN_PX,
      );
    },
  );

  test("its alignment is getDropdownHorizontalAlignment's, so a popup with room hangs as before", () => {
    const input: {
      anchorLeft: number;
      anchorRight: number;
      dropdownWidth: number;
      viewportWidth: number;
    } = {
      anchorLeft: 1100,
      anchorRight: 1200,
      dropdownWidth: DROPDOWN_WIDTH,
      viewportWidth: 1280,
    };

    expect(getDropdownPlacement(input)).toEqual({
      alignment: getDropdownHorizontalAlignment(input),
      shiftInPx: 0,
    });
    expect(getDropdownPlacement(input).alignment).toBe(
      DropdownHorizontalAlignment.Right,
    );
  });

  test("on a Persian page, measured in the mirrored frame, it stays inside too", () => {
    // A button 140px from the screen's left edge of a 390px Persian page.
    const edges: { anchorLeft: number; anchorRight: number } =
      getDropdownAnchorEdges({
        anchorLeft: 140,
        anchorRight: 232,
        viewportWidth: 390,
        isRightToLeft: true,
      });
    const placement: DropdownPlacement = getDropdownPlacement({
      ...edges,
      dropdownWidth: PICKER_WIDTH,
      viewportWidth: 390,
    });
    const box: { left: number; right: number } = drawnBox(
      placement,
      { ...edges, viewportWidth: 390 },
      PICKER_WIDTH,
    );

    expect(placement.shiftInPx).toBeGreaterThan(0);
    expect(box.left).toBeGreaterThanOrEqual(8);
    expect(box.right).toBeLessThanOrEqual(382);
  });

  test("starts at the default: hung from the start, not moved", () => {
    expect(DEFAULT_DROPDOWN_PLACEMENT).toEqual({
      alignment: DropdownHorizontalAlignment.Left,
      shiftInPx: 0,
    });
  });
});

describe("getDropdownShiftStyle", () => {
  test("no style for a popup that fits", () => {
    expect(getDropdownShiftStyle(DEFAULT_DROPDOWN_PLACEMENT)).toEqual({});
    expect(
      getDropdownShiftStyle({
        alignment: DropdownHorizontalAlignment.Right,
        shiftInPx: 0,
      }),
    ).toEqual({});
  });

  test("a negative inset on the side it hangs from, with logical properties", () => {
    expect(
      getDropdownShiftStyle({
        alignment: DropdownHorizontalAlignment.Left,
        shiftInPx: 142,
      }),
    ).toEqual({ insetInlineStart: "-142px" });
    expect(
      getDropdownShiftStyle({
        alignment: DropdownHorizontalAlignment.Right,
        shiftInPx: 132,
      }),
    ).toEqual({ insetInlineEnd: "-132px" });
  });

  test("never a physical side, which would not mirror on a Persian page", () => {
    for (const alignment of [
      DropdownHorizontalAlignment.Left,
      DropdownHorizontalAlignment.Right,
    ]) {
      const style: Record<string, unknown> = getDropdownShiftStyle({
        alignment: alignment,
        shiftInPx: 40,
      }) as Record<string, unknown>;

      expect(Object.keys(style)).not.toContain("left");
      expect(Object.keys(style)).not.toContain("right");
      expect(Object.keys(style)).not.toContain("marginLeft");
      expect(Object.keys(style)).not.toContain("transform");
    }
  });
});
