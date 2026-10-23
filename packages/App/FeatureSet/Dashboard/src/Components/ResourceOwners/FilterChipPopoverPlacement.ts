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
}

// How far the popover moves left of its chip: 0 when it already fits.
export const getChipPopoverShift: (
  input: ChipPopoverPlacementInput,
) => number = (input: ChipPopoverPlacementInput): number => {
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
