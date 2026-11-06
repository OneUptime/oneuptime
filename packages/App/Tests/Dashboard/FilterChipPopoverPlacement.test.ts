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

/*
 * On a page read right to left (Persian) a popover hangs from its chip's
 * right edge and opens towards the left. On a 390px phone App Platforms'
 * Cloud Account chip ended 280px from the screen's left, and its 288px
 * popover reached 8px past the screen's left edge: the page scrolled
 * sideways, as it did on the right before (the UI review of #6149).
 */
describe("getChipPopoverShift - on a page read right to left", () => {
  test("a popover that fits stays under its chip", () => {
    expect(
      getChipPopoverShift({
        chipLeft: 235,
        chipRight: 352,
        popoverWidth: POPOVER,
        screenWidth: PHONE,
        isRightToLeft: true,
      }),
    ).toBe(0);
  });

  test("Cloud Account on a 390px phone: moves right to start 16px from the screen's left edge", () => {
    const chipRight: number = 280;
    const shift: number = getChipPopoverShift({
      chipLeft: 162,
      chipRight: chipRight,
      popoverWidth: POPOVER,
      screenWidth: PHONE,
      isRightToLeft: true,
    });

    expect(shift).toBe(24);
    expect(chipRight + shift - POPOVER).toBe(CHIP_POPOVER_SCREEN_MARGIN);
  });

  test("starting exactly at the margin is a fit", () => {
    expect(
      getChipPopoverShift({
        chipLeft: 200,
        chipRight: CHIP_POPOVER_SCREEN_MARGIN + POPOVER,
        popoverWidth: POPOVER,
        screenWidth: PHONE,
        isRightToLeft: true,
      }),
    ).toBe(0);
  });

  test("never past the margin on the right, however far left its chip sits", () => {
    const chipRight: number = 300;
    const wide: number = 384;
    const shift: number = getChipPopoverShift({
      chipLeft: 200,
      chipRight: chipRight,
      popoverWidth: wide,
      screenWidth: PHONE,
      isRightToLeft: true,
    });

    expect(chipRight + shift).toBe(PHONE - CHIP_POPOVER_SCREEN_MARGIN);
  });

  test("the same chip moves the other way, and by its own overflow, from where it hangs", () => {
    // Read left to right, the popover hangs from the chip's left: 76px too far right.
    expect(
      getChipPopoverShift({
        chipLeft: 162,
        chipRight: 280,
        popoverWidth: POPOVER,
        screenWidth: PHONE,
      }),
    ).toBe(76);
    // Read right to left, it hangs from the chip's right: 24px too far left.
    expect(
      getChipPopoverShift({
        chipLeft: 162,
        chipRight: 280,
        popoverWidth: POPOVER,
        screenWidth: PHONE,
        isRightToLeft: true,
      }),
    ).toBe(24);
  });

  test("whole pixels, and nothing to measure moves nothing", () => {
    expect(
      Number.isInteger(
        getChipPopoverShift({
          chipLeft: 160.2,
          chipRight: 279.6,
          popoverWidth: POPOVER,
          screenWidth: PHONE,
          isRightToLeft: true,
        }),
      ),
    ).toBe(true);
    expect(
      getChipPopoverShift({
        chipLeft: 0,
        chipRight: Number.NaN,
        popoverWidth: POPOVER,
        screenWidth: PHONE,
        isRightToLeft: true,
      }),
    ).toBe(0);
  });
});
