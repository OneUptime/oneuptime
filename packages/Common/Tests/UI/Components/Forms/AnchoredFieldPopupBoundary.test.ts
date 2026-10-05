import {
  AnchoredPopupBox,
  AnchoredPopupPlacementResult,
  isAnchorOutsideBoundary,
  placeAnchoredPopupInBounds,
} from "../../../../UI/Types/UseAnchoredFieldPopup";
import { describe, expect, test } from "@jest/globals";

/*
 * Where a popup that stays inside its surroundings goes: the color field's
 * popover. Worked out from boxes alone, so every rule is pinned here.
 *
 * The report's picture: the color picker at the foot of the Create Label
 * dialog opened downwards - the window had room below it - across the
 * dialog's Cancel and Create Label buttons and out past the dialog's edge.
 * Now the popover's room is the dialog body as well as the window, it opens
 * on the side its whole content fits, and it closes when the body scrolls
 * its field out of sight.
 */

const GAP: number = 4;
const MARGIN: number = 8;

const VIEWPORT: { width: number; height: number } = {
  width: 1280,
  height: 800,
};

// A Create Label dialog body: 448px wide, from y=120 to y=620.
const DIALOG_BODY: AnchoredPopupBox = {
  top: 120,
  right: 864,
  bottom: 620,
  left: 416,
};

type BoxFunction = (
  left: number,
  top: number,
  width: number,
  height: number,
) => AnchoredPopupBox;

const box: BoxFunction = (
  left: number,
  top: number,
  width: number,
  height: number,
): AnchoredPopupBox => {
  return { left, top, right: left + width, bottom: top + height };
};

interface PlaceOptions {
  anchor: AnchoredPopupBox;
  boundary?: AnchoredPopupBox | null | undefined;
  popupHeight?: number | undefined;
  popupMaxHeight?: number | undefined;
  popupWidth?: number | undefined;
  preferredPlacement?: "below" | "above" | undefined;
  viewportWidth?: number | undefined;
  viewportHeight?: number | undefined;
}

const place: (options: PlaceOptions) => AnchoredPopupPlacementResult = (
  options: PlaceOptions,
): AnchoredPopupPlacementResult => {
  return placeAnchoredPopupInBounds({
    anchor: options.anchor,
    boundary: options.boundary,
    popupHeight: options.popupHeight ?? 250,
    popupMaxHeight: options.popupMaxHeight ?? 480,
    popupWidth: options.popupWidth ?? 232,
    preferredPlacement: options.preferredPlacement ?? "below",
    viewportWidth: options.viewportWidth ?? VIEWPORT.width,
    viewportHeight: options.viewportHeight ?? VIEWPORT.height,
  });
};

// The popup's box on screen, worked out the way the browser lays it out.
const popupBox: (
  placed: AnchoredPopupPlacementResult,
  height: number,
  viewportHeight?: number,
) => AnchoredPopupBox = (
  placed: AnchoredPopupPlacementResult,
  height: number,
  viewportHeight: number = VIEWPORT.height,
): AnchoredPopupBox => {
  const shown: number = Math.min(height, placed.maxHeight);
  const top: number =
    placed.top !== undefined
      ? placed.top
      : viewportHeight - placed.bottom! - shown;

  return {
    top,
    bottom: top + shown,
    left: placed.left,
    right: placed.left + placed.width,
  };
};

describe("placeAnchoredPopupInBounds, in the window alone", () => {
  test("opens under its field, at the field's left edge, as tall as its content", () => {
    const placed: AnchoredPopupPlacementResult = place({
      anchor: box(100, 200, 300, 40),
    });

    expect(placed.placement).toBe("below");
    expect(placed.top).toBe(240 + GAP);
    expect(placed.bottom).toBeUndefined();
    expect(placed.left).toBe(100);
    expect(placed.width).toBe(232);
    // All the room below, capped at the popup's own maximum.
    expect(placed.maxHeight).toBe(480);
    expect(placed.isInsideBoundary).toBe(false);
  });

  test("opens above when its content fits there and not below", () => {
    const placed: AnchoredPopupPlacementResult = place({
      anchor: box(100, 600, 300, 40),
      popupHeight: 300,
    });

    expect(placed.placement).toBe("above");
    expect(placed.top).toBeUndefined();
    expect(placed.bottom).toBe(VIEWPORT.height - 600 + GAP);
    expect(popupBox(placed, 300).bottom).toBe(600 - GAP);
  });

  test("stays below when its content fits there, however little room is above", () => {
    const placed: AnchoredPopupPlacementResult = place({
      anchor: box(100, 20, 300, 40),
      popupHeight: 300,
    });

    expect(placed.placement).toBe("below");
  });

  test("an above-preferring popup opens above when it fits, below when only that fits", () => {
    expect(
      place({
        anchor: box(100, 500, 300, 40),
        preferredPlacement: "above",
      }).placement,
    ).toBe("above");
    expect(
      place({
        anchor: box(100, 100, 300, 40),
        preferredPlacement: "above",
      }).placement,
    ).toBe("below");
  });

  test("fitting nowhere, it takes the side with more room and scrolls inside it", () => {
    const placed: AnchoredPopupPlacementResult = place({
      anchor: box(100, 300, 300, 40),
      popupHeight: 700,
      popupMaxHeight: 700,
    });

    // 800 - 340 - 4 - 8 = 448 below, 300 - 4 - 8 = 288 above.
    expect(placed.placement).toBe("below");
    expect(placed.maxHeight).toBe(800 - 340 - GAP - MARGIN);
  });

  test("never runs off the right edge: it moves left", () => {
    const placed: AnchoredPopupPlacementResult = place({
      anchor: box(1200, 200, 60, 40),
    });

    expect(placed.left).toBe(VIEWPORT.width - MARGIN - 232);
    expect(placed.left + placed.width).toBeLessThanOrEqual(
      VIEWPORT.width - MARGIN,
    );
  });

  test("on a phone narrower than the popup it is narrowed to the screen", () => {
    const placed: AnchoredPopupPlacementResult = place({
      anchor: box(16, 200, 200, 40),
      viewportWidth: 220,
    });

    expect(placed.left).toBe(MARGIN);
    expect(placed.width).toBe(220 - MARGIN * 2);
  });
});

describe("placeAnchoredPopupInBounds, inside a dialog body", () => {
  test("REGRESSION: a field at the foot of the dialog opens upwards, inside the body, not over the buttons", () => {
    // The field's bottom edge 30px above the body's: the footer is below it.
    const anchor: AnchoredPopupBox = box(440, 550, 400, 40);
    const placed: AnchoredPopupPlacementResult = place({
      anchor,
      boundary: DIALOG_BODY,
      popupHeight: 250,
    });

    /*
     * The window has 198px below the field - more than the 160 the old rule
     * asked for, so it opened there, over the footer.
     */
    expect(placed.placement).toBe("above");
    expect(placed.isInsideBoundary).toBe(true);

    const shown: AnchoredPopupBox = popupBox(placed, 250);

    expect(shown.top).toBeGreaterThanOrEqual(DIALOG_BODY.top + GAP);
    expect(shown.bottom).toBeLessThanOrEqual(anchor.top);
    expect(shown.left).toBeGreaterThanOrEqual(DIALOG_BODY.left + GAP);
    expect(shown.right).toBeLessThanOrEqual(DIALOG_BODY.right - GAP);
  });

  test("a field near the top of the body opens downwards and ends inside the body", () => {
    const anchor: AnchoredPopupBox = box(440, 160, 400, 40);
    const placed: AnchoredPopupPlacementResult = place({
      anchor,
      boundary: DIALOG_BODY,
      popupHeight: 250,
    });

    expect(placed.placement).toBe("below");
    expect(placed.top).toBe(200 + GAP);

    const shown: AnchoredPopupBox = popupBox(placed, 250);

    expect(shown.bottom).toBeLessThanOrEqual(DIALOG_BODY.bottom - GAP);
  });

  test("content taller than either side of the body scrolls in the larger side, inside the body", () => {
    const anchor: AnchoredPopupBox = box(440, 330, 400, 40);
    const placed: AnchoredPopupPlacementResult = place({
      anchor,
      boundary: DIALOG_BODY,
      popupHeight: 420,
    });

    // 620 - 4 - 370 - 4 = 242 below, 330 - 4 - 124 = 202 above.
    expect(placed.placement).toBe("below");
    expect(placed.maxHeight).toBe(DIALOG_BODY.bottom - GAP - 370 - GAP);
    expect(popupBox(placed, 420).bottom).toBe(DIALOG_BODY.bottom - GAP);
  });

  test("a body with less than a useful height either side gives way to the window", () => {
    const shortBody: AnchoredPopupBox = { ...DIALOG_BODY, top: 500, bottom: 620 };
    const placed: AnchoredPopupPlacementResult = place({
      anchor: box(440, 540, 400, 40),
      boundary: shortBody,
      popupHeight: 250,
    });

    expect(placed.isInsideBoundary).toBe(false);
    // The window has room above the field for all of it.
    expect(placed.placement).toBe("above");
    expect(placed.maxHeight).toBe(480);
  });

  test("a popup wider than the body is narrowed to it", () => {
    const narrowBody: AnchoredPopupBox = box(100, 100, 200, 500);
    const placed: AnchoredPopupPlacementResult = place({
      anchor: box(110, 150, 180, 40),
      boundary: narrowBody,
    });

    expect(placed.isInsideBoundary).toBe(true);
    expect(placed.left).toBe(100 + GAP);
    expect(placed.width).toBe(200 - GAP * 2);
  });

  test("a field at the body's right edge has its popup moved left, inside the body", () => {
    const placed: AnchoredPopupPlacementResult = place({
      anchor: box(800, 200, 60, 40),
      boundary: DIALOG_BODY,
    });

    expect(placed.left + placed.width).toBeLessThanOrEqual(
      DIALOG_BODY.right - GAP,
    );
    expect(placed.left).toBe(DIALOG_BODY.right - GAP - 232);
  });

  test("a body past the window's edge is cut to the window", () => {
    const tallBody: AnchoredPopupBox = box(416, -200, 448, 1400);
    const placed: AnchoredPopupPlacementResult = place({
      anchor: box(440, 700, 400, 40),
      boundary: tallBody,
      popupHeight: 250,
    });

    // 800 - 8 - 740 - 4 = 48 below: it opens above, inside the window.
    expect(placed.placement).toBe("above");
    expect(popupBox(placed, 250).top).toBeGreaterThanOrEqual(MARGIN);
  });

  test("a body not laid out yet - no size - is ignored, not squeezed into", () => {
    const placed: AnchoredPopupPlacementResult = place({
      anchor: box(100, 200, 300, 40),
      boundary: { top: 0, right: 0, bottom: 0, left: 0 },
    });

    expect(placed.isInsideBoundary).toBe(false);
    expect(placed.placement).toBe("below");
    expect(placed.width).toBe(232);
  });

  test("content shorter than its maximum is measured by the content", () => {
    // 150px of content fits under a field with 160px of body below it.
    const placed: AnchoredPopupPlacementResult = place({
      anchor: box(440, 400, 400, 40),
      boundary: { ...DIALOG_BODY, bottom: 608 },
      popupHeight: 150,
    });

    expect(placed.placement).toBe("below");
  });
});

describe("isAnchorOutsideBoundary: a field scrolled out of its dialog body", () => {
  test("a field in view, or partly in view, is not outside", () => {
    expect(
      isAnchorOutsideBoundary({
        anchor: box(440, 300, 400, 40),
        boundary: DIALOG_BODY,
      }),
    ).toBe(false);
    expect(
      isAnchorOutsideBoundary({
        anchor: box(440, 100, 400, 40),
        boundary: DIALOG_BODY,
      }),
    ).toBe(false);
    expect(
      isAnchorOutsideBoundary({
        anchor: box(440, 600, 400, 40),
        boundary: DIALOG_BODY,
      }),
    ).toBe(false);
  });

  test("a field scrolled above or below the body is outside", () => {
    expect(
      isAnchorOutsideBoundary({
        anchor: box(440, 40, 400, 40),
        boundary: DIALOG_BODY,
      }),
    ).toBe(true);
    expect(
      isAnchorOutsideBoundary({
        anchor: box(440, 700, 400, 40),
        boundary: DIALOG_BODY,
      }),
    ).toBe(true);
  });

  test("a body with no size hides nothing", () => {
    expect(
      isAnchorOutsideBoundary({
        anchor: box(440, 700, 400, 40),
        boundary: { top: 0, right: 0, bottom: 0, left: 0 },
      }),
    ).toBe(false);
  });
});
