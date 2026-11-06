/*
 * Where a filter chip's popover sits across the screen. React-free, so the
 * App's tests read it.
 *
 * A popover hangs from its chip's left edge (FILTER_CHIP_POPOVER_CLASSES).
 * A chip toward the right of the bar - Labels beside Owner on a 390px phone
 * - opened its 18rem popover past the screen's right edge, and the whole
 * page scrolled sideways under the reader's thumb, the search box half off
 * the screen. A popover that would cross the edge moves left until it keeps
 * the page's margin, but never past the margin on the left.
 *
 * On a page read right to left (Persian) the popover hangs from its chip's
 * right edge - the start of the line - and opens towards the left: there it
 * crossed the screen's left edge, the Cloud Account chip's on App
 * Platforms' lists on a phone, and the page scrolled sideways the same way
 * (the UI review of #6149). It moves right until it keeps the margin, but
 * never past the margin on the right.
 */

// The page's own side margin on a phone (16px), kept on both sides.
export const CHIP_POPOVER_SCREEN_MARGIN: number = 16;

export interface ChipPopoverPlacementInput {
  // The chip's left edge, from the screen's left (getBoundingClientRect).
  chipLeft: number;
  // The popover's width as drawn.
  popoverWidth: number;
  // The screen's width without its scrollbar (documentElement.clientWidth).
  screenWidth: number;
  /*
   * On a page read right to left: the popover hangs from the chip's right
   * edge (chipRight, from the screen's left) and moves right.
   */
  isRightToLeft?: boolean | undefined;
  chipRight?: number | undefined;
}

/*
 * How far the popover moves from where it hangs: left of its chip on a
 * page read left to right, right of it on one read right to left. 0 when it
 * already fits.
 */
export const getChipPopoverShift: (
  input: ChipPopoverPlacementInput,
) => number = (input: ChipPopoverPlacementInput): number => {
  if (input.isRightToLeft) {
    const chipRight: number =
      input.chipRight === undefined ? input.chipLeft : input.chipRight;
    // How far past the left margin its left edge would be.
    const overflowOnTheLeft: number =
      CHIP_POPOVER_SCREEN_MARGIN - (chipRight - input.popoverWidth);

    if (!(overflowOnTheLeft > 0)) {
      return 0;
    }

    const roomOnTheRight: number = Math.max(
      0,
      input.screenWidth - CHIP_POPOVER_SCREEN_MARGIN - chipRight,
    );

    return Math.round(Math.min(overflowOnTheLeft, roomOnTheRight));
  }

  const overflow: number =
    input.chipLeft +
    input.popoverWidth -
    (input.screenWidth - CHIP_POPOVER_SCREEN_MARGIN);

  if (!(overflow > 0)) {
    return 0;
  }

  const roomOnTheLeft: number = Math.max(
    0,
    input.chipLeft - CHIP_POPOVER_SCREEN_MARGIN,
  );

  return Math.round(Math.min(overflow, roomOnTheLeft));
};
