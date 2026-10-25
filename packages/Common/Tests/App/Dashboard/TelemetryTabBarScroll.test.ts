import { describe, expect, test } from "@jest/globals";
import {
  getTabBarFadeClassName,
  getTabBarHiddenEdges,
  getTabBarScrollDelta,
  NO_HIDDEN_EDGES,
  TAB_BAR_FADE_CLASS_NAMES,
  TabBarHiddenEdges,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/TabBarScroll";

/*
 * A telemetry product's tab bar on a phone (Components/Telemetry/NavTabs):
 * one line that scrolls sideways when the tabs do not fit. Viewer, Insights,
 * AI, Setup Guide and Settings need about 510px in English and 650px in
 * German; a 390px phone gives them 326. They used to wrap, and Setup Guide
 * sat alone on a second line. What the bar measures is decided here: which
 * edges hide tabs (and fade), and how far to scroll the lit tab into view.
 */

// A bar 326px wide holding 509px of tabs, as English draws them on a phone.
const PHONE_BAR: { scrollWidth: number; clientWidth: number } = {
  scrollWidth: 509,
  clientWidth: 326,
};

describe("which edges of the tab bar hide tabs", () => {
  test("tabs that fit hide nothing, whichever way the page reads", () => {
    for (const isRightToLeft of [false, true]) {
      expect(
        getTabBarHiddenEdges({
          scrollLeft: 0,
          scrollWidth: 480,
          clientWidth: 1100,
          isRightToLeft,
        }),
      ).toEqual(NO_HIDDEN_EDGES);
      // Exactly as wide as the bar, or a rounding pixel over: still nothing.
      expect(
        getTabBarHiddenEdges({
          scrollLeft: 0,
          scrollWidth: 327,
          clientWidth: 326,
          isRightToLeft,
        }),
      ).toEqual(NO_HIDDEN_EDGES);
    }
  });

  test("left to right: at the start the end hides tabs, at the end the start does, in between both", () => {
    expect(
      getTabBarHiddenEdges({
        ...PHONE_BAR,
        scrollLeft: 0,
        isRightToLeft: false,
      }),
    ).toEqual({ left: false, right: true });
    expect(
      getTabBarHiddenEdges({
        ...PHONE_BAR,
        scrollLeft: 90,
        isRightToLeft: false,
      }),
    ).toEqual({ left: true, right: true });
    expect(
      getTabBarHiddenEdges({
        ...PHONE_BAR,
        scrollLeft: 183,
        isRightToLeft: false,
      }),
    ).toEqual({ left: true, right: false });
  });

  test("right to left (Persian): the tabs start on the right, so the left edge hides the rest", () => {
    // Browsers count scrollLeft down from 0 to minus the overflow there.
    expect(
      getTabBarHiddenEdges({
        ...PHONE_BAR,
        scrollLeft: 0,
        isRightToLeft: true,
      }),
    ).toEqual({ left: true, right: false });
    expect(
      getTabBarHiddenEdges({
        ...PHONE_BAR,
        scrollLeft: -90,
        isRightToLeft: true,
      }),
    ).toEqual({ left: true, right: true });
    expect(
      getTabBarHiddenEdges({
        ...PHONE_BAR,
        scrollLeft: -183,
        isRightToLeft: true,
      }),
    ).toEqual({ left: false, right: true });
  });

  test("a scroll past either end (an overscroll bounce) reads as that end", () => {
    expect(
      getTabBarHiddenEdges({
        ...PHONE_BAR,
        scrollLeft: -12,
        isRightToLeft: false,
      }),
    ).toEqual({ left: false, right: true });
    expect(
      getTabBarHiddenEdges({
        ...PHONE_BAR,
        scrollLeft: 400,
        isRightToLeft: false,
      }),
    ).toEqual({ left: true, right: false });
    // Right to left, past the start is a positive scrollLeft.
    expect(
      getTabBarHiddenEdges({
        ...PHONE_BAR,
        scrollLeft: 12,
        isRightToLeft: true,
      }),
    ).toEqual({ left: true, right: false });
    expect(
      getTabBarHiddenEdges({
        ...PHONE_BAR,
        scrollLeft: -400,
        isRightToLeft: true,
      }),
    ).toEqual({ left: false, right: true });
  });

  test("half a pixel from an end is that end: a fade never hides nothing", () => {
    expect(
      getTabBarHiddenEdges({
        ...PHONE_BAR,
        scrollLeft: 0.5,
        isRightToLeft: false,
      }),
    ).toEqual({ left: false, right: true });
    expect(
      getTabBarHiddenEdges({
        ...PHONE_BAR,
        scrollLeft: 182.5,
        isRightToLeft: false,
      }),
    ).toEqual({ left: true, right: false });
  });

  test("a measure that is not a number (a bar not laid out yet) hides nothing", () => {
    for (const broken of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        getTabBarHiddenEdges({
          scrollLeft: broken,
          scrollWidth: 509,
          clientWidth: 326,
          isRightToLeft: false,
        }),
      ).toEqual(NO_HIDDEN_EDGES);
      expect(
        getTabBarHiddenEdges({
          scrollLeft: 0,
          scrollWidth: broken,
          clientWidth: 326,
          isRightToLeft: false,
        }),
      ).toEqual(NO_HIDDEN_EDGES);
    }
  });
});

describe("the fade over a hidden edge", () => {
  test("each hidden side fades, and a bar that hides nothing has no mask at all", () => {
    expect(getTabBarFadeClassName({ left: false, right: false })).toBe("");
    expect(getTabBarFadeClassName({ left: true, right: false })).toBe(
      TAB_BAR_FADE_CLASS_NAMES.left,
    );
    expect(getTabBarFadeClassName({ left: false, right: true })).toBe(
      TAB_BAR_FADE_CLASS_NAMES.right,
    );
    expect(getTabBarFadeClassName({ left: true, right: true })).toBe(
      TAB_BAR_FADE_CLASS_NAMES.both,
    );
  });

  test("the fade is a mask, so it is the same in light and dark, with the -webkit- copy Safari reads", () => {
    for (const className of Object.values(TAB_BAR_FADE_CLASS_NAMES)) {
      expect(className).toContain("[mask-image:linear-gradient(");
      expect(className).toContain("[-webkit-mask-image:linear-gradient(");
      // No colour of its own: transparent to black is only how much shows.
      expect(className).not.toMatch(/(?:bg|text|from|to)-(?:white|gray)/);
    }

    // Each side fades toward its own edge.
    expect(TAB_BAR_FADE_CLASS_NAMES.left).toContain("to_right,transparent");
    expect(TAB_BAR_FADE_CLASS_NAMES.right).toContain("to_left,transparent");
    expect(TAB_BAR_FADE_CLASS_NAMES.both).toContain(
      "to_right,transparent,black_1.5rem,black_calc(100%-1.5rem),transparent",
    );
  });

  test("every pair of edges has a class Tailwind can see in the source", () => {
    const edges: Array<TabBarHiddenEdges> = [
      { left: false, right: false },
      { left: true, right: false },
      { left: false, right: true },
      { left: true, right: true },
    ];

    expect(
      new Set(
        edges.map((pair: TabBarHiddenEdges): string => {
          return getTabBarFadeClassName(pair);
        }),
      ).size,
    ).toBe(4);
  });
});

describe("scrolling the lit tab into view", () => {
  // The bar is at 32..358 on a 390px phone (16px padding each side).
  const bar: { left: number; right: number } = { left: 32, right: 358 };

  test("the lit tab is brought to the bar's middle, so its neighbours peek past both fades", () => {
    // AI, the third tab, partly under the right fade (German).
    expect(
      getTabBarScrollDelta({
        tab: { left: 297, right: 354 },
        bar,
        isRightToLeft: false,
      }),
    ).toBe((297 + 354) / 2 - (32 + 358) / 2);
    // Settings, the last, well past the edge: to the middle (the browser
    // stops at the end).
    expect(
      getTabBarScrollDelta({
        tab: { left: 470, right: 572 },
        bar,
        isRightToLeft: false,
      }),
    ).toBe((470 + 572) / 2 - 195);
    // Viewer, the first, before the middle: a negative scroll the browser
    // stops at the start.
    expect(
      getTabBarScrollDelta({
        tab: { left: 37, right: 130 },
        bar,
        isRightToLeft: false,
      }),
    ).toBeLessThan(0);
  });

  test("a tab already in the middle stays", () => {
    expect(
      getTabBarScrollDelta({
        tab: { left: 150, right: 240 },
        bar,
        isRightToLeft: false,
      }),
    ).toBe(0);
  });

  test("right to left it is the same arithmetic: more to the right is a larger scrollLeft there too", () => {
    expect(
      getTabBarScrollDelta({
        tab: { left: -100, right: -10 },
        bar,
        isRightToLeft: true,
      }),
    ).toBe((-100 + -10) / 2 - 195);
  });

  test("a tab wider than the bar shows its start: its left edge, or its right one right to left", () => {
    const wide: { left: number; right: number } = { left: 100, right: 500 };

    expect(getTabBarScrollDelta({ tab: wide, bar, isRightToLeft: false })).toBe(
      100 - 32,
    );
    expect(getTabBarScrollDelta({ tab: wide, bar, isRightToLeft: true })).toBe(
      500 - 358,
    );
  });

  test("boxes that are not laid out (jsdom, a hidden bar) scroll nothing", () => {
    expect(
      getTabBarScrollDelta({
        tab: { left: 0, right: 0 },
        bar: { left: 0, right: 0 },
        isRightToLeft: false,
      }),
    ).toBe(0);
    expect(
      getTabBarScrollDelta({
        tab: { left: Number.NaN, right: 10 },
        bar,
        isRightToLeft: false,
      }),
    ).toBe(0);
  });
});
