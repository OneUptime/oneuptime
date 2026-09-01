import { describe, expect, test } from "@jest/globals";
import getHoverCardPosition, {
  HoverCardPosition,
  HoverCardTriggerRect,
  HOVER_CARD_VIEWPORT_MARGIN,
} from "../../FeatureSet/Dashboard/src/Components/Dashboard/Utils/HoverCardPosition";

/*
 * Dashboard widgets render inside a clipped, scrolling tile, so their hover
 * cards are position: fixed and placed from the trigger's viewport rect. That
 * arithmetic is what decides whether the card is readable or half off-screen,
 * and it cannot be checked by rendering: jsdom reports every rect as zero, and
 * a real browser only shows the failure at particular viewport sizes.
 *
 * The two widgets that use it (the honeycomb and the state timeline) sit in
 * the corners of a dashboard as often as the middle, so the edge cases below
 * are the normal cases.
 */

const CARD_WIDTH: number = 240;
const CARD_HEIGHT: number = 120;
const OFFSET: number = 8;

const VIEWPORT_WIDTH: number = 1280;
const VIEWPORT_HEIGHT: number = 800;

type PositionFunction = (
  rect: HoverCardTriggerRect,
  overrides?:
    | {
        cardWidth?: number | undefined;
        cardHeight?: number | undefined;
        viewportWidth?: number | undefined;
        viewportHeight?: number | undefined;
      }
    | undefined,
) => HoverCardPosition;

const positionFor: PositionFunction = (
  rect: HoverCardTriggerRect,
  overrides?:
    | {
        cardWidth?: number | undefined;
        cardHeight?: number | undefined;
        viewportWidth?: number | undefined;
        viewportHeight?: number | undefined;
      }
    | undefined,
): HoverCardPosition => {
  return getHoverCardPosition({
    rect: rect,
    cardWidth: overrides?.cardWidth ?? CARD_WIDTH,
    cardHeight: overrides?.cardHeight ?? CARD_HEIGHT,
    viewportWidth: overrides?.viewportWidth ?? VIEWPORT_WIDTH,
    viewportHeight: overrides?.viewportHeight ?? VIEWPORT_HEIGHT,
    offset: OFFSET,
  });
};

// A trigger comfortably in the middle of the viewport.
const CENTRED_TRIGGER: HoverCardTriggerRect = {
  left: 600,
  top: 400,
  width: 40,
  height: 20,
};

describe("getHoverCardPosition", () => {
  describe("horizontal placement", () => {
    test("centres the card on the trigger", () => {
      // 600 + 20 (half the trigger) - 120 (half the card)
      expect(positionFor(CENTRED_TRIGGER).left).toBe(500);
    });

    test("pins the card inside the left margin rather than letting it overhang", () => {
      const position: HoverCardPosition = positionFor({
        left: 4,
        top: 400,
        width: 40,
        height: 20,
      });

      expect(position.left).toBe(HOVER_CARD_VIEWPORT_MARGIN);
    });

    test("pins the card inside the right margin", () => {
      const position: HoverCardPosition = positionFor({
        left: VIEWPORT_WIDTH - 44,
        top: 400,
        width: 40,
        height: 20,
      });

      expect(position.left).toBe(
        VIEWPORT_WIDTH - CARD_WIDTH - HOVER_CARD_VIEWPORT_MARGIN,
      );
      expect(position.left + CARD_WIDTH).toBeLessThanOrEqual(
        VIEWPORT_WIDTH - HOVER_CARD_VIEWPORT_MARGIN,
      );
    });

    test("keeps the card on-screen on a viewport narrower than the card itself", () => {
      /*
       * A phone in portrait is narrower than the 240px card. Clamping to the
       * RIGHT edge first would push the card off to the left and hide its
       * label; the left margin has to win the tie.
       */
      const position: HoverCardPosition = positionFor(
        { left: 10, top: 400, width: 40, height: 20 },
        { viewportWidth: 200 },
      );

      expect(position.left).toBe(HOVER_CARD_VIEWPORT_MARGIN);
    });
  });

  describe("vertical placement", () => {
    test("prefers above the trigger when there is room", () => {
      const position: HoverCardPosition = positionFor(CENTRED_TRIGGER);

      expect(position.placement).toBe("above");
      expect(position.top).toBe(400 - CARD_HEIGHT - OFFSET);
    });

    test("flips below when the trigger is near the top of the viewport", () => {
      /*
       * The top row of a dashboard tile is exactly where this happens, and an
       * unflipped card would be clipped by the top of the window.
       */
      const position: HoverCardPosition = positionFor({
        left: 600,
        top: 40,
        width: 40,
        height: 20,
      });

      expect(position.placement).toBe("below");
      expect(position.top).toBe(40 + 20 + OFFSET);
    });

    test("flips at the exact boundary where the card would no longer fit", () => {
      const justFits: number =
        CARD_HEIGHT + OFFSET + HOVER_CARD_VIEWPORT_MARGIN;

      expect(
        positionFor({ left: 600, top: justFits, width: 40, height: 20 })
          .placement,
      ).toBe("above");
      expect(
        positionFor({ left: 600, top: justFits - 1, width: 40, height: 20 })
          .placement,
      ).toBe("below");
    });

    test("keeps a below-placed card inside the bottom margin", () => {
      const position: HoverCardPosition = positionFor(
        { left: 600, top: 10, width: 40, height: 20 },
        { viewportHeight: 100 },
      );

      expect(position.placement).toBe("below");
      expect(position.top).toBe(100 - CARD_HEIGHT - HOVER_CARD_VIEWPORT_MARGIN);
    });

    test("never places an above-card past the top margin", () => {
      /*
       * The flip already handles the common case; this is the belt-and-braces
       * clamp for a tall card in a short viewport, where neither side fits.
       */
      const position: HoverCardPosition = positionFor(
        { left: 600, top: 300, width: 40, height: 20 },
        { cardHeight: 600 },
      );

      expect(position.top).toBeGreaterThanOrEqual(HOVER_CARD_VIEWPORT_MARGIN);
    });
  });

  describe("first-pass behaviour", () => {
    test("produces a usable placement before the card has been measured", () => {
      /*
       * The caller passes a guessed height on the first layout pass, because
       * the card has not rendered yet. The result still has to be a real
       * position — a NaN would drop the card into the top-left corner.
       */
      const position: HoverCardPosition = positionFor(CENTRED_TRIGGER, {
        cardHeight: 100,
      });

      expect(Number.isFinite(position.left)).toBe(true);
      expect(Number.isFinite(position.top)).toBe(true);
    });

    test("handles a zero-sized trigger without producing a NaN", () => {
      // jsdom reports every getBoundingClientRect as zero.
      const position: HoverCardPosition = positionFor({
        left: 0,
        top: 0,
        width: 0,
        height: 0,
      });

      expect(Number.isFinite(position.left)).toBe(true);
      expect(Number.isFinite(position.top)).toBe(true);
      expect(position.placement).toBe("below");
    });
  });
});
