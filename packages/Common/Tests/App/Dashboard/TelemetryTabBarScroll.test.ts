import { describe, expect, test } from "@jest/globals";
import {
  getTabBarFadeClassName,
  getTabBarHiddenEdges,
  getTabBarScrollDelta,
  NO_HIDDEN_EDGES,
  TAB_BAR_FADE_CLASS_NAMES,
  TAB_BAR_PEEK_PX,
  TAB_BAR_SCROLL_PADDING_CLASS_NAME,
  TabBarHiddenEdges,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/TabBarScroll";

/*
 * A telemetry product's tab bar on a phone (Components/Telemetry/NavTabs):
 * one line that scrolls sideways when the tabs do not fit. Viewer, Insights,
 * AI, Setup Guide and Settings need about 510px in English and 650px in
 * German; a 390px phone gives them 326. They used to wrap, and Setup Guide
 * sat alone on a second line. What the bar measures is decided here: which
 * edges hide tabs (and fade), and how far to scroll the lit tab into view -
 * just far enough for the next tab to peek past the fade, so the first tabs
 * stay in sight whenever they can.
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

  const scrollFor: (
    tab: { left: number; right: number },
    isRightToLeft?: boolean,
  ) => number = (
    tab: { left: number; right: number },
    isRightToLeft: boolean = false,
  ): number => {
    return getTabBarScrollDelta({ tab, bar, isRightToLeft });
  };

  test("the room kept beside the lit tab is 3rem, and the scroller keeps it for a tab the keyboard reaches", () => {
    expect(TAB_BAR_PEEK_PX).toBe(48);
    // Tailwind's scroll-px-12 is 3rem of scroll padding on both sides.
    expect(TAB_BAR_SCROLL_PADDING_CLASS_NAME).toBe("scroll-px-12");
  });

  test("a lit tab already in view, with room beside it, stays where it is: the first tabs stay in sight", () => {
    // AI, the third tab, in English: in view with room to spare.
    expect(scrollFor({ left: 233, right: 290 })).toBe(0);
    // A tab in the middle of a scrolled bar stays too.
    expect(scrollFor({ left: 150, right: 240 })).toBe(0);
    /*
     * Viewer, the first, at the start: a scroll back the browser stops at
     * the start, so nothing moves.
     */
    expect(scrollFor({ left: 36, right: 129 })).toBeLessThanOrEqual(0);
  });

  test("a lit tab under the end's fade, or past it, comes in just far enough for the next tab to peek", () => {
    // AI in German ends at 326, under the right fade: in by 16px.
    expect(scrollFor({ left: 269, right: 326 })).toBe(
      326 - (358 - TAB_BAR_PEEK_PX),
    );
    // Settings, the last, well past the edge (the browser stops at the end).
    expect(scrollFor({ left: 470, right: 572 })).toBe(
      572 - (358 - TAB_BAR_PEEK_PX),
    );
  });

  test("a lit tab behind the start's edge comes back, the tab before it peeking", () => {
    expect(scrollFor({ left: -60, right: 40 })).toBe(
      -60 - (32 + TAB_BAR_PEEK_PX),
    );
  });

  test("German Exceptions on a phone: the AI tab comes into view and Exceptions, the first tab, stays in sight", () => {
    /*
     * Unscrolled, as Chromium draws them in a bar at 33..357: Ausnahmen
     * with its count at 37..193, Einblicke 197..304, KI 308..365. The bar
     * used to bring KI to its middle (142px), and Ausnahmen went wholly
     * behind the fade.
     */
    const delta: number = getTabBarScrollDelta({
      tab: { left: 308, right: 365 },
      bar: { left: 33, right: 357 },
      isRightToLeft: false,
    });

    expect(delta).toBe(365 - (357 - TAB_BAR_PEEK_PX));
    /*
     * Ausnahmen's end is then past the 1.5rem fade and its 12px padding:
     * its name shows.
     */
    expect(193 - delta).toBeGreaterThan(33 + 24 + 12);
  });

  test("right to left it is the same arithmetic: more to the right is a larger scrollLeft there too", () => {
    // The tab after the lit one is to its left: a lit tab under the left fade comes in.
    expect(scrollFor({ left: 50, right: 110 }, true)).toBe(
      50 - (32 + TAB_BAR_PEEK_PX),
    );
    // The first tab, at the start on the right, stays (the browser stops there).
    expect(scrollFor({ left: 260, right: 354 }, true)).toBeGreaterThanOrEqual(
      0,
    );
    expect(scrollFor({ left: 150, right: 240 }, true)).toBe(0);
  });

  test("a tab too wide for the room keeps what room there is, and one wider than the bar shows its start", () => {
    // 280px of a 326px bar: 23px each side, not 48.
    expect(scrollFor({ left: 100, right: 380 })).toBe(380 - (358 - 23));

    const wide: { left: number; right: number } = { left: 100, right: 500 };

    expect(scrollFor(wide)).toBe(100 - 32);
    expect(scrollFor(wide, true)).toBe(500 - 358);
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
