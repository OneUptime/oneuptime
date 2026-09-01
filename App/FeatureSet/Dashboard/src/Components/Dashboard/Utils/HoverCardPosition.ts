/*
 * Where a fixed-position hover card should sit relative to the thing it
 * describes.
 *
 * Widgets render inside a scrolling, clipped dashboard tile, so their hover
 * cards are `position: fixed` and placed from the trigger's viewport rect
 * rather than laid out next to it. That placement is the same arithmetic for
 * every widget that does it — centre horizontally, clamp inside the viewport,
 * and flip above→below when there is not enough room above — so it lives here
 * once, as a pure function that can be tested without a DOM.
 */

export interface HoverCardTriggerRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface HoverCardPositionInput {
  rect: HoverCardTriggerRect;
  cardWidth: number;
  /*
   * The card's measured height. Callers pass a guess on the first pass, before
   * the card has ever been laid out; the placement is corrected on the next.
   */
  cardHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  /** Gap between the trigger and the card, and the minimum viewport margin. */
  offset: number;
}

export interface HoverCardPosition {
  left: number;
  top: number;
  placement: "above" | "below";
}

/** The viewport margin the card is never allowed to cross. */
export const HOVER_CARD_VIEWPORT_MARGIN: number = 8;

export default function getHoverCardPosition(
  input: HoverCardPositionInput,
): HoverCardPosition {
  const { rect, cardWidth, cardHeight, viewportWidth, viewportHeight, offset } =
    input;

  const margin: number = HOVER_CARD_VIEWPORT_MARGIN;

  /*
   * Centre on the trigger, then clamp. Math.max wins the tie on a viewport
   * narrower than the card, so the card is pinned to the left edge and stays
   * partly readable rather than being pushed off-screen to the left.
   */
  let left: number = rect.left + rect.width / 2 - cardWidth / 2;
  left = Math.max(margin, Math.min(viewportWidth - cardWidth - margin, left));

  const spaceAbove: number = rect.top;
  const placement: "above" | "below" =
    spaceAbove < cardHeight + offset + margin ? "below" : "above";

  const top: number =
    placement === "above"
      ? Math.max(margin, rect.top - cardHeight - offset)
      : Math.min(
          viewportHeight - cardHeight - margin,
          rect.top + rect.height + offset,
        );

  return { left, top, placement };
}
