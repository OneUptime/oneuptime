import {
  CHIP_POPOVER_SCREEN_MARGIN,
  getChipPopoverShift,
} from "../../FeatureSet/Dashboard/src/Components/ResourceOwners/FilterChipPopoverPlacement";
import { describe, expect, test } from "@jest/globals";

/*
 * WHERE A FILTER CHIP'S POPOVER SITS ACROSS THE SCREEN.
 *
 * A chip's popover hangs from the chip's left edge. On a 390px phone the
 * second chip of On-Call Schedules - Labels, beside Owner - starts at 207px,
 * and its 288px popover ran to 495px: past the screen, the whole page
 * scrolling sideways to show the focused search box. The popover now moves
 * left until it keeps the page's 16px margin, and never past the margin on
 * the left. Drawn in a browser by the OwnerFilters offline suite.
 */

const PHONE: number = 390;
const POPOVER: number = 288;

describe("getChipPopoverShift - a chip's popover stays on the screen", () => {
  test("the page's own margin, 16px", () => {
    expect(CHIP_POPOVER_SCREEN_MARGIN).toBe(16);
  });

  test("a popover that fits stays under its chip", () => {
    // The Owner chip on a laptop, and the first chip on a phone that fits.
    expect(
      getChipPopoverShift({
        chipLeft: 333,
        popoverWidth: POPOVER,
        screenWidth: 1280,
      }),
    ).toBe(0);
    expect(
      getChipPopoverShift({
        chipLeft: 70,
        popoverWidth: POPOVER,
        screenWidth: PHONE,
      }),
    ).toBe(0);
  });

  test("Labels on a 390px phone: moves left to end 16px from the screen's edge", () => {
    const chipLeft: number = 207;
    const shift: number = getChipPopoverShift({
      chipLeft: chipLeft,
      popoverWidth: POPOVER,
      screenWidth: PHONE,
    });

    expect(shift).toBe(121);
    expect(chipLeft - shift + POPOVER).toBe(PHONE - CHIP_POPOVER_SCREEN_MARGIN);
  });

  test("ending exactly at the margin is a fit", () => {
    expect(
      getChipPopoverShift({
        chipLeft: PHONE - CHIP_POPOVER_SCREEN_MARGIN - POPOVER,
        popoverWidth: POPOVER,
        screenWidth: PHONE,
      }),
    ).toBe(0);
  });

  test("never past the margin on the left, however far right its chip sits", () => {
    const chipLeft: number = 100;
    const wide: number = 384;
    const shift: number = getChipPopoverShift({
      chipLeft: chipLeft,
      popoverWidth: wide,
      screenWidth: PHONE,
    });

    expect(chipLeft - shift).toBe(CHIP_POPOVER_SCREEN_MARGIN);
  });

  test("a chip already at the margin does not move", () => {
    expect(
      getChipPopoverShift({
        chipLeft: CHIP_POPOVER_SCREEN_MARGIN,
        popoverWidth: 500,
        screenWidth: PHONE,
      }),
    ).toBe(0);
  });

  test("whole pixels, whatever the chip's fraction", () => {
    const shift: number = getChipPopoverShift({
      chipLeft: 207.4,
      popoverWidth: POPOVER,
      screenWidth: PHONE,
    });

    expect(Number.isInteger(shift)).toBe(true);
  });

  test("nothing to measure yet (a test's DOM) moves nothing", () => {
    expect(
      getChipPopoverShift({ chipLeft: 0, popoverWidth: 0, screenWidth: 0 }),
    ).toBe(0);
    expect(
      getChipPopoverShift({
        chipLeft: Number.NaN,
        popoverWidth: POPOVER,
        screenWidth: PHONE,
      }),
    ).toBe(0);
  });
});
