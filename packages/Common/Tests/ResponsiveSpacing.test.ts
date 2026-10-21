import { afterEach, describe, expect, test } from "@jest/globals";
import {
  BoxSpacing,
  SpacingProperty,
  describeElement,
  resolveMargin,
  resolvePadding,
  resolveScrollPadding,
  resolveSpaceBelowInPx,
  resolveSpacing,
  spacingValueInPx,
} from "./ResponsiveSpacing";
import {
  LAPTOP_WIDTH_IN_PX,
  PHONE_WIDTH_IN_PX,
  TABLET_WIDTH_IN_PX,
} from "./ResponsiveVisibility";

/*
 * The side panel and workflow picker suites lean on this helper to prove a
 * list's last row has room under it at every width. A helper that found room
 * too easily would let them pass with the row still flush on the footer, so
 * it gets its own cover - including the two class strings the real
 * regression turned on, with the padding Chrome computed for each.
 */

// SideOver's scroll content before the fix: no bottom padding from sm up.
const PRE_FIX_SIDE_OVER_CONTENT: string =
  "space-y-6 py-6 sm:space-y-0 sm:divide-y sm:divide-gray-200 sm:py-0 p-5";
// And after it: the bottom padding stays at every width.
const SIDE_OVER_CONTENT: string =
  "space-y-6 px-5 py-6 sm:space-y-0 sm:divide-y sm:divide-gray-200 sm:pt-0";

type BoxFunction = (
  top: number,
  right: number,
  bottom: number,
  left: number,
) => BoxSpacing;

const box: BoxFunction = (
  top: number,
  right: number,
  bottom: number,
  left: number,
): BoxSpacing => {
  return { top: top, right: right, bottom: bottom, left: left };
};

const NO_SPACING: BoxSpacing = box(0, 0, 0, 0);

describe("resolvePadding", () => {
  test("an unprefixed utility applies at every width", () => {
    expect(resolvePadding("p-5", PHONE_WIDTH_IN_PX)).toEqual(
      box(20, 20, 20, 20),
    );
    expect(resolvePadding("p-5", LAPTOP_WIDTH_IN_PX)).toEqual(
      box(20, 20, 20, 20),
    );
  });

  test("markup with no padding utility has no padding", () => {
    expect(resolvePadding("", LAPTOP_WIDTH_IN_PX)).toEqual(NO_SPACING);
    expect(resolvePadding(null, LAPTOP_WIDTH_IN_PX)).toEqual(NO_SPACING);
    expect(resolvePadding(undefined, LAPTOP_WIDTH_IN_PX)).toEqual(NO_SPACING);
    expect(
      resolvePadding("flex items-center gap-3 text-sm", LAPTOP_WIDTH_IN_PX),
    ).toEqual(NO_SPACING);
  });

  test.each([
    ["p-5 py-6", box(24, 20, 24, 20)],
    ["py-6 p-5", box(24, 20, 24, 20)],
    ["pt-0 py-6", box(0, 0, 24, 0)],
    ["py-6 pt-0", box(0, 0, 24, 0)],
    ["p-5 pb-2", box(20, 20, 8, 20)],
    ["pb-2 p-5", box(20, 20, 8, 20)],
    ["px-5 pl-2", box(0, 20, 0, 8)],
    ["pl-2 px-5", box(0, 20, 0, 8)],
  ])(
    "an axis outranks all sides, and one side an axis, whatever the class order: %s",
    (classAttribute: string, expected: BoxSpacing) => {
      expect(resolvePadding(classAttribute, LAPTOP_WIDTH_IN_PX)).toEqual(
        expected,
      );
    },
  );

  test("a screen variant wins from its breakpoint up, and not a pixel before", () => {
    expect(resolvePadding("py-6 sm:pt-0", 639)).toEqual(box(24, 0, 24, 0));
    expect(resolvePadding("py-6 sm:pt-0", 640)).toEqual(box(0, 0, 24, 0));
  });

  test("the widest screen that holds wins, whatever the class order", () => {
    expect(resolvePadding("lg:pb-3 sm:pb-1", LAPTOP_WIDTH_IN_PX).bottom).toBe(
      12,
    );
    expect(resolvePadding("md:pb-2 sm:pb-1", TABLET_WIDTH_IN_PX).bottom).toBe(
      8,
    );
    expect(resolvePadding("md:pb-2 sm:pb-1", 700).bottom).toBe(4);
    expect(resolvePadding("md:pb-2 sm:pb-1", PHONE_WIDTH_IN_PX).bottom).toBe(0);
  });

  test("a max-* variant applies below its breakpoint and outranks unprefixed utilities", () => {
    expect(resolvePadding("pb-3 max-md:pb-4", 767).bottom).toBe(16);
    expect(resolvePadding("pb-3 max-md:pb-4", 768).bottom).toBe(12);
  });

  test("a min-width variant outranks a max-width one where both hold", () => {
    expect(resolvePadding("sm:pb-1 max-md:pb-4", 700).bottom).toBe(4);
    expect(resolvePadding("max-md:pb-4 sm:pb-1", 700).bottom).toBe(4);
    expect(
      resolvePadding("sm:pb-1 max-md:pb-4", PHONE_WIDTH_IN_PX).bottom,
    ).toBe(16);
  });

  test("the narrower max-* wins where two of them hold, as Tailwind emits them widest first", () => {
    expect(resolvePadding("max-md:pb-4 max-lg:pb-2", 700).bottom).toBe(16);
    expect(resolvePadding("max-lg:pb-2 max-md:pb-4", 700).bottom).toBe(16);
    expect(
      resolvePadding("max-md:pb-4 max-sm:pb-2", PHONE_WIDTH_IN_PX).bottom,
    ).toBe(8);
    expect(resolvePadding("max-md:pb-4 max-sm:pb-2", 700).bottom).toBe(16);
  });

  test("an arbitrary screen is resolved like a named one", () => {
    expect(resolvePadding("pb-1 min-[900px]:pb-2", 899).bottom).toBe(4);
    expect(resolvePadding("pb-1 min-[900px]:pb-2", 900).bottom).toBe(8);
  });

  test.each([
    ["p-px", 1],
    ["p-0", 0],
    ["p-0.5", 2],
    ["p-2.5", 10],
    ["p-6", 24],
    ["p-12", 48],
    ["p-96", 384],
    ["p-[3px]", 3],
    ["p-[1.5rem]", 24],
    ["p-[0]", 0],
  ])(
    "reads the default scale, px and arbitrary lengths: %s",
    (classAttribute: string, expected: number) => {
      expect(resolvePadding(classAttribute, LAPTOP_WIDTH_IN_PX)).toEqual(
        box(expected, expected, expected, expected),
      );
    },
  );

  test("a key the default scale does not have emits no rule, so it changes nothing", () => {
    expect(resolvePadding("pb-2 pb-13", LAPTOP_WIDTH_IN_PX).bottom).toBe(8);
    expect(resolvePadding("pb-full pb-auto", LAPTOP_WIDTH_IN_PX).bottom).toBe(
      0,
    );
  });

  test("an arbitrary value that is not a plain length has no length until layout", () => {
    expect(
      resolvePadding("pb-[calc(100%-2rem)]", LAPTOP_WIDTH_IN_PX).bottom,
    ).toBeNaN();
  });

  test("state variants are ignored - they cannot answer a layout question", () => {
    for (const classAttribute of [
      "hover:pb-9 pb-1",
      "focus:pb-9 pb-1",
      "focus-visible:pb-9 pb-1",
      "dark:pb-9 pb-1",
      "group-hover:pb-9 pb-1",
      "aria-selected:pb-9 pb-1",
      "pb-1 sm:hover:pb-9",
      "pb-1 [&>*]:pb-9",
    ]) {
      expect({
        classAttribute,
        bottom: resolvePadding(classAttribute, LAPTOP_WIDTH_IN_PX).bottom,
      }).toEqual({ classAttribute, bottom: 4 });
    }
  });

  test("media queries that do not test the width only hold when asked for: none by default", () => {
    expect(
      resolvePadding("motion-reduce:pb-9 pb-1", LAPTOP_WIDTH_IN_PX).bottom,
    ).toBe(4);
    expect(resolvePadding("print:pb-9 pb-1", LAPTOP_WIDTH_IN_PX).bottom).toBe(
      4,
    );
  });

  test("inline start and end read as left and right, and outrank an axis", () => {
    expect(resolvePadding("ps-4 pe-2", LAPTOP_WIDTH_IN_PX)).toEqual(
      box(0, 8, 0, 16),
    );
    expect(resolvePadding("px-5 ps-1", LAPTOP_WIDTH_IN_PX)).toEqual(
      box(0, 20, 0, 4),
    );
  });

  test("!important outranks every screen", () => {
    expect(resolvePadding("!pb-1 sm:pb-6", LAPTOP_WIDTH_IN_PX).bottom).toBe(4);
    expect(resolvePadding("pb-6 sm:!pb-1", LAPTOP_WIDTH_IN_PX).bottom).toBe(4);
    expect(resolvePadding("pb-6 sm:!pb-1", PHONE_WIDTH_IN_PX).bottom).toBe(24);
  });

  test("padding is never negative: Tailwind emits no rule for -pb-2", () => {
    expect(resolvePadding("-pb-2", LAPTOP_WIDTH_IN_PX)).toEqual(NO_SPACING);
  });

  test("does not mistake other utilities that start with p for padding", () => {
    expect(
      resolvePadding(
        "pointer-events-none place-items-center placeholder-gray-400 prose peer pr pb space-y-6 divide-y",
        LAPTOP_WIDTH_IN_PX,
      ),
    ).toEqual(NO_SPACING);
  });

  test("two utilities that set one side at the same place in the stylesheet are ambiguous, and say so", () => {
    expect(() => {
      return resolvePadding("pb-2 pb-4", LAPTOP_WIDTH_IN_PX);
    }).toThrow(
      '"pb-2" and "pb-4" both set the bottom padding at the same place in the stylesheet',
    );
    expect(() => {
      return resolvePadding("ps-1 pl-2", LAPTOP_WIDTH_IN_PX);
    }).toThrow("both set the left padding");
    expect(() => {
      return resolvePadding("sm:pb-2 sm:pb-4", PHONE_WIDTH_IN_PX);
    }).not.toThrow();
  });

  test("the same value twice, or at different screens, is not ambiguous", () => {
    expect(resolvePadding("pb-2 pb-2", LAPTOP_WIDTH_IN_PX).bottom).toBe(8);
    expect(resolvePadding("pb-2 sm:pb-4", LAPTOP_WIDTH_IN_PX).bottom).toBe(16);
  });

  /*
   * The two class strings the regression turned on, against the padding
   * Chrome computed for them with the vendored Play CDN at each width.
   */
  test.each([
    [PRE_FIX_SIDE_OVER_CONTENT, 390, box(24, 20, 24, 20)],
    [PRE_FIX_SIDE_OVER_CONTENT, 700, box(0, 20, 0, 20)],
    [PRE_FIX_SIDE_OVER_CONTENT, 1024, box(0, 20, 0, 20)],
    [SIDE_OVER_CONTENT, 390, box(24, 20, 24, 20)],
    [SIDE_OVER_CONTENT, 700, box(0, 20, 24, 20)],
    [SIDE_OVER_CONTENT, 1024, box(0, 20, 24, 20)],
  ])(
    "matches what Chrome computed for %s at %ipx",
    (classAttribute: string, width: number, expected: BoxSpacing) => {
      expect(resolvePadding(classAttribute, width)).toEqual(expected);
    },
  );
});

describe("resolveScrollPadding", () => {
  test("one side", () => {
    expect(resolveScrollPadding("scroll-pb-6", LAPTOP_WIDTH_IN_PX)).toEqual(
      box(0, 0, 24, 0),
    );
  });

  test("all sides, an axis and one side rank as they do for padding", () => {
    expect(
      resolveScrollPadding("scroll-p-2 scroll-pb-6", LAPTOP_WIDTH_IN_PX),
    ).toEqual(box(8, 8, 24, 8));
    expect(
      resolveScrollPadding("scroll-pb-6 scroll-p-2", LAPTOP_WIDTH_IN_PX),
    ).toEqual(box(8, 8, 24, 8));
    expect(
      resolveScrollPadding("scroll-py-4 scroll-pt-1", LAPTOP_WIDTH_IN_PX),
    ).toEqual(box(4, 0, 16, 0));
  });

  test("a screen variant overrides it from its breakpoint up", () => {
    expect(
      resolveScrollPadding("scroll-pb-6 sm:scroll-pb-0", PHONE_WIDTH_IN_PX)
        .bottom,
    ).toBe(24);
    expect(
      resolveScrollPadding("scroll-pb-6 sm:scroll-pb-0", LAPTOP_WIDTH_IN_PX)
        .bottom,
    ).toBe(0);
  });

  test("padding and scroll padding are separate families", () => {
    expect(resolveScrollPadding("pb-6 p-4", LAPTOP_WIDTH_IN_PX)).toEqual(
      NO_SPACING,
    );
    expect(
      resolvePadding("scroll-pb-6 scroll-p-4", LAPTOP_WIDTH_IN_PX),
    ).toEqual(NO_SPACING);
    expect(
      resolveScrollPadding("scroll-mb-6 scroll-mt-28", LAPTOP_WIDTH_IN_PX),
    ).toEqual(NO_SPACING);
  });
});

describe("resolveMargin", () => {
  test("positive and negative margins", () => {
    expect(resolveMargin("mb-3", LAPTOP_WIDTH_IN_PX)).toEqual(box(0, 0, 12, 0));
    expect(resolveMargin("-mb-2", LAPTOP_WIDTH_IN_PX).bottom).toBe(-8);
    expect(resolveMargin("-mx-5", LAPTOP_WIDTH_IN_PX)).toEqual(
      box(0, -20, 0, -20),
    );
    // Zero, not negative zero.
    expect(resolveMargin("-mb-0", LAPTOP_WIDTH_IN_PX).bottom).toBe(0);
  });

  test("all sides, an axis and one side rank as they do for padding", () => {
    expect(resolveMargin("m-2 mb-5", LAPTOP_WIDTH_IN_PX)).toEqual(
      box(8, 8, 20, 8),
    );
    expect(resolveMargin("mb-5 m-2", LAPTOP_WIDTH_IN_PX)).toEqual(
      box(8, 8, 20, 8),
    );
    expect(resolveMargin("my-4 mt-1", LAPTOP_WIDTH_IN_PX)).toEqual(
      box(4, 0, 16, 0),
    );
  });

  test("auto has no length until layout", () => {
    const centred: BoxSpacing = resolveMargin(
      "mx-auto mb-2",
      LAPTOP_WIDTH_IN_PX,
    );

    expect(centred.left).toBeNaN();
    expect(centred.right).toBeNaN();
    expect(centred.top).toBe(0);
    expect(centred.bottom).toBe(8);
  });

  test("does not mistake other utilities that start with m for margins", () => {
    expect(
      resolveMargin(
        "max-w-2xl min-h-0 min-w-0 mix-blend-multiply mt mb",
        LAPTOP_WIDTH_IN_PX,
      ),
    ).toEqual(NO_SPACING);
  });
});

describe("resolveSpacing", () => {
  test("reads only the family it is asked for", () => {
    const classAttribute: string = "p-1 scroll-p-2 m-3";

    expect(
      resolveSpacing(classAttribute, LAPTOP_WIDTH_IN_PX, "padding"),
    ).toEqual(box(4, 4, 4, 4));
    expect(
      resolveSpacing(classAttribute, LAPTOP_WIDTH_IN_PX, "scroll-padding"),
    ).toEqual(box(8, 8, 8, 8));
    expect(
      resolveSpacing(classAttribute, LAPTOP_WIDTH_IN_PX, "margin"),
    ).toEqual(box(12, 12, 12, 12));
  });
});

describe("spacingValueInPx", () => {
  test.each([
    ["px", "padding", 1],
    ["0", "padding", 0],
    ["0.5", "padding", 2],
    ["3.5", "margin", 14],
    ["96", "scroll-padding", 384],
    ["[3px]", "padding", 3],
    ["[2.5px]", "padding", 2.5],
    ["[1.5rem]", "margin", 24],
    ["[0]", "padding", 0],
  ])("%s (%s) is %ppx", (value: string, property: string, expected: number) => {
    expect(spacingValueInPx(value, property as SpacingProperty)).toBe(expected);
  });

  test("a value Tailwind emits no rule for is null", () => {
    expect(spacingValueInPx("13", "padding")).toBeNull();
    expect(spacingValueInPx("full", "padding")).toBeNull();
    expect(spacingValueInPx("auto", "padding")).toBeNull();
    expect(spacingValueInPx("auto", "scroll-padding")).toBeNull();
  });

  test("a value with no length until layout is NaN", () => {
    expect(spacingValueInPx("auto", "margin")).toBeNaN();
    expect(spacingValueInPx("[calc(1px+2px)]", "padding")).toBeNaN();
    expect(spacingValueInPx("[var(--gap)]", "padding")).toBeNaN();
  });
});

describe("describeElement", () => {
  test("names the tag and its classes", () => {
    const element: HTMLElement = document.createElement("div");
    element.className = "px-5 py-6";

    expect(describeElement(element)).toBe('<div class="px-5 py-6">');
    expect(describeElement(document.createElement("span"))).toBe("<span>");
  });
});

describe("resolveSpaceBelowInPx", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  type MountFunction = (html: string) => {
    scroller: HTMLElement;
    last: HTMLElement;
  };

  // `#scroller` is the scroll container, `#last` the element measured from.
  const mount: MountFunction = (
    html: string,
  ): { scroller: HTMLElement; last: HTMLElement } => {
    document.body.innerHTML = html;

    return {
      scroller: document.getElementById("scroller")!,
      last: document.getElementById("last")!,
    };
  };

  test("adds up the bottom padding of everything between the element and the scroll container", () => {
    const { scroller, last } = mount(
      `<div id="scroller" class="overflow-y-auto"><div class="${SIDE_OVER_CONTENT}"><div class="pt-4"><div class="space-y-6"><button id="last" class="px-3 py-2.5">Browse all resources</button></div></div></div></div>`,
    );

    for (const width of [
      PHONE_WIDTH_IN_PX,
      639,
      640,
      TABLET_WIDTH_IN_PX,
      LAPTOP_WIDTH_IN_PX,
    ]) {
      expect({
        width,
        space: resolveSpaceBelowInPx(last, scroller, width),
      }).toEqual({ width, space: 24 });
    }
  });

  test("finds the regression: the pre-fix panel leaves nothing under its last row from 640px up", () => {
    const { scroller, last } = mount(
      `<div id="scroller" class="overflow-y-auto"><div class="${PRE_FIX_SIDE_OVER_CONTENT}"><div class="pt-4"><button id="last">Browse all resources</button></div></div></div>`,
    );

    expect(resolveSpaceBelowInPx(last, scroller, 639)).toBe(24);
    expect(resolveSpaceBelowInPx(last, scroller, 640)).toBe(0);
    expect(resolveSpaceBelowInPx(last, scroller, LAPTOP_WIDTH_IN_PX)).toBe(0);
  });

  test("counts the scroll container's own padding", () => {
    const { scroller, last } = mount(
      `<div id="scroller" class="overflow-y-auto pb-2"><div class="py-6"><button id="last"></button></div></div>`,
    );

    expect(resolveSpaceBelowInPx(last, scroller, LAPTOP_WIDTH_IN_PX)).toBe(32);
  });

  test("counts a bottom margin a padding keeps inside its parent", () => {
    const { scroller, last } = mount(
      `<div id="scroller" class="overflow-y-auto"><div class="py-6"><form class="mb-3 pb-1"><p id="last" class="mb-2">Run</p></form></div></div>`,
    );

    // 8 (the p's margin) + 4 (the form's padding) + 12 (its margin) + 24.
    expect(resolveSpaceBelowInPx(last, scroller, LAPTOP_WIDTH_IN_PX)).toBe(48);
  });

  test("counts a margin directly inside the scroll container", () => {
    const { scroller, last } = mount(
      `<div id="scroller" class="overflow-y-auto"><div id="last" class="mb-3"></div></div>`,
    );

    expect(resolveSpaceBelowInPx(last, scroller, LAPTOP_WIDTH_IN_PX)).toBe(12);
  });

  test.each(["flex flex-col", "grid", "flow-root", "overflow-hidden"])(
    "a parent with %s keeps its last child's margin inside",
    (parentClasses: string) => {
      const { scroller, last } = mount(
        `<div id="scroller" class="overflow-y-auto"><div class="py-6"><div class="${parentClasses}"><button id="last" class="mb-2"></button></div></div></div>`,
      );

      expect(resolveSpaceBelowInPx(last, scroller, LAPTOP_WIDTH_IN_PX)).toBe(
        32,
      );
    },
  );

  test("throws for a margin that would collapse through its parent", () => {
    const { scroller, last } = mount(
      `<div id="scroller" class="overflow-y-auto"><div class="py-6"><div class="space-y-2"><p id="last" class="mb-3"></p></div></div></div>`,
    );

    expect(() => {
      return resolveSpaceBelowInPx(last, scroller, LAPTOP_WIDTH_IN_PX);
    }).toThrow(
      'The bottom margin of <p class="mb-3"> collapses through <div class="space-y-2">',
    );
  });

  test("a margin that only applies at some widths only matters there", () => {
    const { scroller, last } = mount(
      `<div id="scroller" class="overflow-y-auto"><div class="py-6"><div><p id="last" class="sm:mb-3"></p></div></div></div>`,
    );

    expect(resolveSpaceBelowInPx(last, scroller, PHONE_WIDTH_IN_PX)).toBe(24);
    expect(() => {
      return resolveSpaceBelowInPx(last, scroller, LAPTOP_WIDTH_IN_PX);
    }).toThrow("collapses through");
  });

  test("throws when an element is laid out below it, naming that element", () => {
    const { scroller, last } = mount(
      `<div id="scroller" class="overflow-y-auto"><div class="py-6"><button id="last"></button><p class="text-sm">More</p></div></div>`,
    );

    expect(() => {
      return resolveSpaceBelowInPx(last, scroller, LAPTOP_WIDTH_IN_PX);
    }).toThrow('<p class="text-sm"> is laid out below <button>');
  });

  test("throws when an ancestor has something laid out below it", () => {
    const { scroller, last } = mount(
      `<div id="scroller" class="overflow-y-auto"><div class="py-6"><section><button id="last"></button></section><footer class="mt-4">Footer</footer></div></div>`,
    );

    expect(() => {
      return resolveSpaceBelowInPx(last, scroller, LAPTOP_WIDTH_IN_PX);
    }).toThrow('<footer class="mt-4"> is laid out below <section>');
  });

  test("throws for text laid out below it", () => {
    const { scroller, last } = mount(
      `<div id="scroller" class="overflow-y-auto"><div class="py-6"><button id="last"></button>Tail</div></div>`,
    );

    expect(() => {
      return resolveSpaceBelowInPx(last, scroller, LAPTOP_WIDTH_IN_PX);
    }).toThrow('the text "Tail" is laid out below <button>');
  });

  test("what is not laid out below it does not count", () => {
    const { scroller, last } = mount(
      `<div id="scroller" class="overflow-y-auto"><div class="py-6"><button id="last"></button>
        <span class="sr-only">Done</span>
        <div class="hidden"></div>
        <div hidden></div>
        <div class="absolute inset-0"></div>
        <div class="fixed bottom-0"></div>
        <template><p>Later</p></template>
        <script></script>
        <!-- a comment -->
      </div></div>`,
    );

    expect(resolveSpaceBelowInPx(last, scroller, LAPTOP_WIDTH_IN_PX)).toBe(24);
  });

  test("a sibling hidden only at some widths is below it at the others", () => {
    const { scroller, last } = mount(
      `<div id="scroller" class="overflow-y-auto"><div class="py-6"><button id="last"></button><p class="max-sm:hidden">Wide screens only</p></div></div>`,
    );

    expect(resolveSpaceBelowInPx(last, scroller, PHONE_WIDTH_IN_PX)).toBe(24);
    expect(() => {
      return resolveSpaceBelowInPx(last, scroller, LAPTOP_WIDTH_IN_PX);
    }).toThrow("is laid out below");
  });

  test("throws for a bottom border between it and the scroll container", () => {
    for (const borderClasses of [
      "border border-gray-200",
      "border-b",
      "border-y-2",
      "sm:border-b",
    ]) {
      const { scroller, last } = mount(
        `<div id="scroller" class="overflow-y-auto"><div class="py-6"><div class="${borderClasses}"><button id="last"></button></div></div></div>`,
      );

      expect(() => {
        return resolveSpaceBelowInPx(last, scroller, LAPTOP_WIDTH_IN_PX);
      }).toThrow("draws a bottom border below <button>");
    }
  });

  test("a border on the element itself, a top border, no width or a colour alone are fine", () => {
    for (const html of [
      `<div class="py-6"><div id="last" class="rounded-lg border border-gray-200"></div></div>`,
      `<div class="py-6"><div class="border-t border-gray-200"><button id="last"></button></div></div>`,
      `<div class="py-6"><div class="border-0 border-b-0 border-indigo-300"><button id="last"></button></div></div>`,
      `<div class="py-6"><div class="max-sm:border-b"><button id="last"></button></div></div>`,
    ]) {
      const { scroller, last } = mount(
        `<div id="scroller" class="overflow-y-auto">${html}</div>`,
      );

      expect({
        html,
        space: resolveSpaceBelowInPx(last, scroller, LAPTOP_WIDTH_IN_PX),
      }).toEqual({ html, space: 24 });
    }
  });

  test("throws when the element is not inside the scroll container", () => {
    const { scroller } = mount(
      `<div id="scroller" class="overflow-y-auto"><div class="py-6"></div></div><button id="outside"></button>`,
    );
    const outside: HTMLElement = document.getElementById("outside")!;

    expect(() => {
      return resolveSpaceBelowInPx(outside, scroller, LAPTOP_WIDTH_IN_PX);
    }).toThrow('<button> is not inside <div class="overflow-y-auto">');
    expect(() => {
      return resolveSpaceBelowInPx(scroller, scroller, LAPTOP_WIDTH_IN_PX);
    }).toThrow("is not inside");
  });

  test("a margin with no length until layout makes the answer NaN, not a number", () => {
    const { scroller, last } = mount(
      `<div id="scroller" class="overflow-y-auto"><div class="py-6"><div class="flex flex-col"><button id="last" class="mb-auto"></button></div></div></div>`,
    );

    expect(resolveSpaceBelowInPx(last, scroller, LAPTOP_WIDTH_IN_PX)).toBeNaN();
  });
});
