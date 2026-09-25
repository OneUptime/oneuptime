import { describe, expect, test } from "@jest/globals";
import {
  NON_WIDTH_MEDIA_VARIANTS,
  PHONE_WIDTH_IN_PX,
  LAPTOP_WIDTH_IN_PX,
  ScreenReaderOnlyOptions,
  TAILWIND_BREAKPOINTS_IN_PX,
  WIDE_DESKTOP_WIDTH_IN_PX,
  describeVisibility,
  findHidingElement,
  isDisplayUtility,
  isMediaQueryVariant,
  isVisibleAtWidth,
  isVisuallyCollapsed,
  resolveDisplay,
  splitVariants,
} from "./ResponsiveVisibility";

/*
 * The header suites below lean on this helper to prove a button is on screen at
 * phone width. A helper that answered "visible" too easily would make all of
 * them pass while the bug they cover is still shipped, so it gets its own
 * cover — including the two class strings the real regression turned on:
 * "hidden lg:flex" (the wrapper that hid the profile button) and "lg:hidden"
 * (which must NOT read as hidden on a phone).
 */
describe("resolveDisplay", () => {
  test("an unprefixed utility applies at every width", () => {
    expect(resolveDisplay("flex items-center", PHONE_WIDTH_IN_PX)).toBe("flex");
    expect(resolveDisplay("flex items-center", LAPTOP_WIDTH_IN_PX)).toBe(
      "flex",
    );
  });

  test("markup that sets no display at all resolves to null, not hidden", () => {
    expect(
      resolveDisplay("relative z-20 items-center", PHONE_WIDTH_IN_PX),
    ).toBe(null);
    expect(resolveDisplay("", PHONE_WIDTH_IN_PX)).toBe(null);
    expect(resolveDisplay(null, PHONE_WIDTH_IN_PX)).toBe(null);
  });

  test("a breakpoint variant only wins once the viewport reaches it", () => {
    expect(resolveDisplay("hidden lg:flex", 1023)).toBe("hidden");
    expect(resolveDisplay("hidden lg:flex", 1024)).toBe("flex");
  });

  test("the largest matching breakpoint wins, whatever the source order", () => {
    expect(resolveDisplay("lg:flex hidden sm:block", LAPTOP_WIDTH_IN_PX)).toBe(
      "flex",
    );
    expect(resolveDisplay("lg:flex hidden sm:block", 700)).toBe("block");
    expect(resolveDisplay("lg:flex hidden sm:block", 400)).toBe("hidden");
  });

  test("lg:hidden is a wide-screen rule, so a phone still sees the element", () => {
    expect(resolveDisplay("flex lg:hidden", PHONE_WIDTH_IN_PX)).toBe("flex");
    expect(resolveDisplay("flex lg:hidden", LAPTOP_WIDTH_IN_PX)).toBe("hidden");
  });

  test("two unprefixed display utilities resolve in stylesheet order, not class order", () => {
    // Tailwind emits .hidden after .flex, so hidden wins however it is written.
    expect(resolveDisplay("flex hidden", LAPTOP_WIDTH_IN_PX)).toBe("hidden");
    expect(resolveDisplay("hidden flex", LAPTOP_WIDTH_IN_PX)).toBe("hidden");
    expect(resolveDisplay("grid block", LAPTOP_WIDTH_IN_PX)).toBe("grid");
  });

  test("state variants are ignored — they cannot answer a layout question", () => {
    expect(resolveDisplay("hidden group-hover:flex", LAPTOP_WIDTH_IN_PX)).toBe(
      "hidden",
    );
    expect(resolveDisplay("hidden lg:hover:flex", LAPTOP_WIDTH_IN_PX)).toBe(
      "hidden",
    );
  });

  test("arbitrary variants are ignored as a whole, brackets and all", () => {
    expect(
      resolveDisplay("flex group-[:not(:hover)]:hidden", LAPTOP_WIDTH_IN_PX),
    ).toBe("flex");
    expect(
      resolveDisplay(
        "inline [details:not([open])>summary>&]:hidden",
        LAPTOP_WIDTH_IN_PX,
      ),
    ).toBe("inline");
  });
});

describe("resolveDisplay with max-width variants", () => {
  test("max-md:hidden applies below 768px and not from 768px up", () => {
    expect(resolveDisplay("max-md:hidden md:flex", 767)).toBe("hidden");
    expect(resolveDisplay("max-md:hidden md:flex", 768)).toBe("flex");
    expect(resolveDisplay("max-md:hidden", 768)).toBe(null);
  });

  test("max-* outranks unprefixed utilities, as it does in the emitted CSS", () => {
    expect(resolveDisplay("flex max-lg:hidden", 1023)).toBe("hidden");
    expect(resolveDisplay("flex max-lg:hidden", 1024)).toBe("flex");
  });

  test("the narrower max-* wins where two of them match, as Tailwind emits them widest-first", () => {
    expect(resolveDisplay("max-xl:hidden max-md:block", 500)).toBe("block");
    expect(resolveDisplay("max-xl:hidden max-md:block", 900)).toBe("hidden");
    expect(resolveDisplay("max-xl:hidden max-md:block", 1280)).toBe(null);
  });

  test("a min-width variant outranks a max-width variant where both match", () => {
    expect(resolveDisplay("max-lg:hidden sm:block", 700)).toBe("block");
    expect(resolveDisplay("max-lg:hidden sm:block", 500)).toBe("hidden");
  });

  test("2xl is a breakpoint for both directions", () => {
    expect(resolveDisplay("max-2xl:hidden 2xl:inline", 1535)).toBe("hidden");
    expect(resolveDisplay("max-2xl:hidden 2xl:inline", 1536)).toBe("inline");
  });
});

describe("resolveDisplay with a foreign .hidden rule on the page", () => {
  const foreign: { withForeignHiddenRule: boolean } = {
    withForeignHiddenRule: true,
  };

  test("the idiom that lost the customer their nav bar is hidden at every width", () => {
    for (const width of [
      PHONE_WIDTH_IN_PX,
      768,
      1024,
      WIDE_DESKTOP_WIDTH_IN_PX,
    ]) {
      expect(resolveDisplay("hidden md:flex", width, foreign)).toBe("hidden");
      expect(resolveDisplay("hidden lg:flex", width, foreign)).toBe("hidden");
    }
  });

  test("the replacement idiom does not carry the class the rule targets", () => {
    expect(resolveDisplay("max-md:hidden md:flex", 767, foreign)).toBe(
      "hidden",
    );
    expect(
      resolveDisplay(
        "max-md:hidden md:flex",
        WIDE_DESKTOP_WIDTH_IN_PX,
        foreign,
      ),
    ).toBe("flex");
  });

  test("breakpoint-prefixed hidden classes are not the bare class", () => {
    expect(resolveDisplay("flex lg:hidden", PHONE_WIDTH_IN_PX, foreign)).toBe(
      "flex",
    );
    expect(resolveDisplay("block md:hidden lg:block", 1280, foreign)).toBe(
      "block",
    );
  });

  /*
   * The whole fix rests on this: for every screen and every display value,
   * `max-<bp>:hidden <bp>:<display>` renders exactly what `hidden <bp>:<display>`
   * rendered on a clean page — and keeps rendering it when the foreign rule is
   * there, where the old idiom disappears.
   */
  test("max-<bp>:hidden <bp>:<display> matches hidden <bp>:<display> at every width, and survives the rule", () => {
    const widths: Array<number> = [
      320, 375, 639, 640, 767, 768, 1023, 1024, 1279, 1280, 1535, 1536, 1917,
      2560,
    ];

    for (const breakpoint of Object.keys(TAILWIND_BREAKPOINTS_IN_PX)) {
      for (const display of [
        "block",
        "flex",
        "inline",
        "inline-flex",
        "grid",
      ]) {
        const before: string = `hidden ${breakpoint}:${display}`;
        const after: string = `max-${breakpoint}:hidden ${breakpoint}:${display}`;

        for (const width of widths) {
          const clean: string | null = resolveDisplay(before, width);

          expect([after, width, resolveDisplay(after, width)]).toEqual([
            after,
            width,
            clean,
          ]);
          expect([after, width, resolveDisplay(after, width, foreign)]).toEqual(
            [after, width, clean],
          );

          if (width >= TAILWIND_BREAKPOINTS_IN_PX[breakpoint]!) {
            // What the customer saw: the old idiom gone at a width it belongs on.
            expect(resolveDisplay(before, width, foreign)).toBe("hidden");
            expect(clean).toBe(display);
          }
        }
      }
    }
  });
});

describe("splitVariants", () => {
  test("splits on the variant separators", () => {
    expect(splitVariants("md:flex")).toEqual(["md", "flex"]);
    expect(splitVariants("lg:hover:flex")).toEqual(["lg", "hover", "flex"]);
    expect(splitVariants("flex")).toEqual(["flex"]);
  });

  test("keeps colons inside arbitrary values together", () => {
    expect(splitVariants("group-[:not(:hover)]:hidden")).toEqual([
      "group-[:not(:hover)]",
      "hidden",
    ]);
    expect(splitVariants("[details:not([open])>summary>&]:hidden")).toEqual([
      "[details:not([open])>summary>&]",
      "hidden",
    ]);
  });
});

describe("isVisibleAtWidth", () => {
  type BuildTreeFunction = (wrapperClass: string) => HTMLElement;

  const buildTree: BuildTreeFunction = (wrapperClass: string): HTMLElement => {
    const root: HTMLElement = document.createElement("div");
    root.className = "relative flex";
    const wrapper: HTMLElement = document.createElement("div");
    wrapper.className = wrapperClass;
    const button: HTMLElement = document.createElement("button");
    button.className = "h-9 w-9";
    wrapper.appendChild(button);
    root.appendChild(wrapper);
    return button;
  };

  test("an ancestor's `hidden` takes the whole subtree off a phone screen", () => {
    const button: HTMLElement = buildTree("hidden lg:flex");

    expect(isVisibleAtWidth(button, PHONE_WIDTH_IN_PX)).toBe(false);
    expect(isVisibleAtWidth(button, LAPTOP_WIDTH_IN_PX)).toBe(true);
  });

  test("an ancestor's max-lg:hidden does the same, and survives a foreign .hidden rule", () => {
    const button: HTMLElement = buildTree("max-lg:hidden lg:flex");

    expect(isVisibleAtWidth(button, PHONE_WIDTH_IN_PX)).toBe(false);
    expect(isVisibleAtWidth(button, LAPTOP_WIDTH_IN_PX)).toBe(true);
    expect(
      isVisibleAtWidth(button, LAPTOP_WIDTH_IN_PX, {
        withForeignHiddenRule: true,
      }),
    ).toBe(true);
  });

  test("the old idiom is off screen at desktop width once a foreign .hidden rule is present", () => {
    const button: HTMLElement = buildTree("hidden lg:flex");

    expect(
      isVisibleAtWidth(button, LAPTOP_WIDTH_IN_PX, {
        withForeignHiddenRule: true,
      }),
    ).toBe(false);
  });

  test("nothing hidden anywhere up the tree means visible", () => {
    const button: HTMLElement = buildTree("flex items-center gap-2");

    expect(isVisibleAtWidth(button, PHONE_WIDTH_IN_PX)).toBe(true);
    expect(findHidingElement(button, PHONE_WIDTH_IN_PX)).toBe(null);
  });

  test("an element that was never rendered is not visible", () => {
    expect(isVisibleAtWidth(null, PHONE_WIDTH_IN_PX)).toBe(false);
  });

  test("the failure message names the element and the classes doing the hiding", () => {
    const button: HTMLElement = buildTree("hidden lg:flex");

    expect(describeVisibility(button, PHONE_WIDTH_IN_PX)).toBe(
      'hidden at 375px by <div class="hidden lg:flex">',
    );
    expect(describeVisibility(button, LAPTOP_WIDTH_IN_PX)).toBe(
      "visible at 1280px",
    );
    expect(
      describeVisibility(button, LAPTOP_WIDTH_IN_PX, {
        withForeignHiddenRule: true,
      }),
    ).toBe(
      'hidden at 1280px with a foreign .hidden rule on the page by <div class="hidden lg:flex">',
    );
    expect(describeVisibility(null, PHONE_WIDTH_IN_PX)).toBe(
      "the element was never rendered",
    );
  });
});

describe("isDisplayUtility", () => {
  test("names Tailwind's display utilities, hidden included, and nothing else", () => {
    for (const utility of ["block", "flex", "inline-grid", "hidden"]) {
      expect([utility, isDisplayUtility(utility)]).toEqual([utility, true]);
    }

    for (const utility of ["md:flex", "flex-col", "overflow-hidden", ""]) {
      expect([utility, isDisplayUtility(utility)]).toEqual([utility, false]);
    }
  });
});

/*
 * The sr-only half. SrOnlyForeignRule.test.tsx sweeps the whole tree with
 * this resolver, and ForeignHiddenRuleGuard takes its definition of a
 * media-query variant from here, so both lean on what these tests pin.
 */
describe("isMediaQueryVariant", () => {
  test("every variant that only wraps its utility in @media", () => {
    for (const variant of [
      "sm",
      "md",
      "lg",
      "xl",
      "2xl",
      "max-sm",
      "max-2xl",
      "min-[900px]",
      "max-[62rem]",
      ...NON_WIDTH_MEDIA_VARIANTS,
    ]) {
      expect([variant, isMediaQueryVariant(variant)]).toEqual([variant, true]);
    }

    expect(NON_WIDTH_MEDIA_VARIANTS).toEqual(
      expect.arrayContaining([
        "print",
        "motion-safe",
        "motion-reduce",
        "contrast-more",
        "contrast-less",
        "portrait",
        "landscape",
        "forced-colors",
      ]),
    );
  });

  test("no state or pseudo variant: each one adds to the selector", () => {
    for (const variant of [
      "hover",
      "focus",
      "focus-visible",
      "focus-within",
      "group-hover",
      "group-hover/card",
      "group-[.is-open]",
      "peer-checked",
      "aria-expanded",
      "data-[state=open]",
      // darkMode "class": `:is(.dark *)`, not a media query.
      "dark",
      "[&.is-open]",
      "[@media(hover:hover)]",
      "max-3xl",
      "min-sm",
    ]) {
      expect([variant, isMediaQueryVariant(variant)]).toEqual([variant, false]);
    }
  });
});

describe("isVisuallyCollapsed", () => {
  // Both sides of every breakpoint, plus the phone and the customer's screen.
  const widths: Array<number> = [
    320, 375, 639, 640, 767, 768, 1023, 1024, 1279, 1280, 1535, 1536, 1917,
    2560,
  ];

  const foreign: ScreenReaderOnlyOptions = { withForeignSrOnlyRule: true };

  // "639px collapsed", "640px shown" ...: a failure names the widths that went wrong.
  function collapseAcross(
    classAttribute: string,
    options?: ScreenReaderOnlyOptions,
  ): Array<string> {
    return widths.map((width: number): string => {
      return `${width}px ${isVisuallyCollapsed(classAttribute, width, options) ? "collapsed" : "shown"}`;
    });
  }

  function expectedCollapse(
    isCollapsedAt: (width: number) => boolean,
  ): Array<string> {
    return widths.map((width: number): string => {
      return `${width}px ${isCollapsedAt(width) ? "collapsed" : "shown"}`;
    });
  }

  function below(breakpoint: string): Array<string> {
    return expectedCollapse((width: number): boolean => {
      return width < TAILWIND_BREAKPOINTS_IN_PX[breakpoint]!;
    });
  }

  const everywhere: Array<string> = expectedCollapse((): boolean => {
    return true;
  });
  const nowhere: Array<string> = expectedCollapse((): boolean => {
    return false;
  });

  test("a class list without sr-only is never collapsed, foreign rule or not", () => {
    expect(collapseAcross("inline-flex items-center gap-1")).toEqual(nowhere);
    expect(collapseAcross("inline-flex items-center gap-1", foreign)).toEqual(
      nowhere,
    );
    // The foreign rule names `.sr-only` only; `not-sr-only` is not it.
    expect(collapseAcross("not-sr-only", foreign)).toEqual(nowhere);
  });

  test("a bare sr-only is collapsed at every width", () => {
    expect(collapseAcross("sr-only")).toEqual(everywhere);
    expect(collapseAcross("sr-only", foreign)).toEqual(everywhere);
  });

  test("the pre-fix `sr-only sm:not-sr-only` works on a clean page and collapses everywhere under a foreign .sr-only", () => {
    expect(collapseAcross("sr-only sm:not-sr-only")).toEqual(below("sm"));
    expect(collapseAcross("sr-only sm:not-sr-only", foreign)).toEqual(
      everywhere,
    );
  });

  test("`max-<bp>:sr-only <bp>:not-sr-only` collapses only below the breakpoint, foreign rule or not", () => {
    for (const breakpoint of Object.keys(TAILWIND_BREAKPOINTS_IN_PX)) {
      const classAttribute: string = `max-${breakpoint}:sr-only ${breakpoint}:not-sr-only`;

      expect(collapseAcross(classAttribute)).toEqual(below(breakpoint));
      expect(collapseAcross(classAttribute, foreign)).toEqual(
        below(breakpoint),
      );
    }
  });

  test("the max-width sr-only alone is enough: nothing needs undoing above it", () => {
    expect(collapseAcross("max-xl:sr-only", foreign)).toEqual(below("xl"));
  });

  test("class order does not matter; the stylesheet's order does", () => {
    // Emitted after sr-only in the same group, so it wins whichever is written first.
    expect(collapseAcross("not-sr-only sr-only")).toEqual(nowhere);
    expect(collapseAcross("sm:not-sr-only sr-only")).toEqual(below("sm"));
    // A min-width screen is emitted after every max-width one.
    expect(collapseAcross("sm:not-sr-only max-md:sr-only")).toEqual(
      below("sm"),
    );
  });

  test("a skip link is hidden until focused and shown once focused, even under a foreign .sr-only", () => {
    const skipLink: string = "sr-only focus:not-sr-only focus:absolute";

    expect(collapseAcross(skipLink, foreign)).toEqual(everywhere);
    // (0,2,0) beats the appended (0,1,0).
    expect(
      collapseAcross(skipLink, {
        withForeignSrOnlyRule: true,
        isFocused: true,
      }),
    ).toEqual(nowhere);
  });

  test("an !important foreign .sr-only would pin even a focused skip link shut", () => {
    /*
     * Neither Bootstrap 3 nor HTML5 Boilerplate marks .sr-only !important;
     * this is the boundary the skip links rely on, stated.
     */
    expect(
      collapseAcross("sr-only focus:not-sr-only", {
        withForeignSrOnlyRule: true,
        foreignSrOnlyRuleIsImportant: true,
        isFocused: true,
      }),
    ).toEqual(everywhere);
  });

  test("a focus undo inside a screen applies only from that screen up", () => {
    expect(
      collapseAcross("sr-only sm:focus:not-sr-only", {
        withForeignSrOnlyRule: true,
        isFocused: true,
      }),
    ).toEqual(below("sm"));
  });

  test("other state variants are left out: they out-specify the foreign rule, so it never decides them", () => {
    for (const classAttribute of [
      "sr-only hover:not-sr-only",
      "sr-only group-hover:not-sr-only",
      "sr-only dark:not-sr-only",
      "sr-only lg:group-hover:not-sr-only",
    ]) {
      expect(collapseAcross(classAttribute)).toEqual(everywhere);
      expect(collapseAcross(classAttribute, foreign)).toEqual(everywhere);
    }
  });

  test("a media query without a width holds only when the option says so, and the foreign rule beats it too", () => {
    const printed: ScreenReaderOnlyOptions = { mediaConditions: ["print"] };

    expect(collapseAcross("sr-only print:not-sr-only")).toEqual(everywhere);
    expect(collapseAcross("sr-only print:not-sr-only", printed)).toEqual(
      nowhere,
    );
    expect(
      collapseAcross("sr-only print:not-sr-only", {
        ...printed,
        withForeignSrOnlyRule: true,
      }),
    ).toEqual(everywhere);
    // A stack holds only where every query in it does.
    expect(collapseAcross("sr-only md:print:not-sr-only", printed)).toEqual(
      below("md"),
    );
    expect(
      collapseAcross("sr-only motion-reduce:not-sr-only", {
        mediaConditions: ["motion-safe"],
      }),
    ).toEqual(everywhere);
  });

  test("the media queries without a width sit where Tailwind emits them: motion and contrast before the screens, print after", () => {
    expect(
      isVisuallyCollapsed("motion-reduce:sr-only lg:not-sr-only", 1280, {
        mediaConditions: ["motion-reduce"],
      }),
    ).toBe(false);
    expect(
      isVisuallyCollapsed("contrast-more:sr-only lg:not-sr-only", 1280, {
        mediaConditions: ["contrast-more"],
      }),
    ).toBe(false);
    expect(
      isVisuallyCollapsed("print:sr-only lg:not-sr-only", 1280, {
        mediaConditions: ["print"],
      }),
    ).toBe(true);
    expect(
      isVisuallyCollapsed("forced-colors:sr-only lg:not-sr-only", 1280, {
        mediaConditions: ["forced-colors"],
      }),
    ).toBe(true);
  });

  test("an arbitrary px screen is resolved at its width and sorted among the named ones", () => {
    expect(
      collapseAcross("max-[900px]:sr-only min-[900px]:not-sr-only"),
    ).toEqual(
      expectedCollapse((width: number): boolean => {
        return width < 900;
      }),
    );
    expect(
      collapseAcross("max-[900px]:sr-only min-[900px]:not-sr-only", foreign),
    ).toEqual(
      expectedCollapse((width: number): boolean => {
        return width < 900;
      }),
    );
    expect(collapseAcross("sr-only min-[900px]:not-sr-only", foreign)).toEqual(
      everywhere,
    );

    // min-[900px] is emitted after md (768px) and before lg (1024px).
    expect(isVisuallyCollapsed("min-[900px]:sr-only md:not-sr-only", 950)).toBe(
      true,
    );
    expect(
      isVisuallyCollapsed("min-[900px]:sr-only lg:not-sr-only", 1100),
    ).toBe(false);
    // Every max-width screen, arbitrary or not, is emitted before every min-width one.
    expect(isVisuallyCollapsed("md:not-sr-only max-[900px]:sr-only", 800)).toBe(
      false,
    );
  });

  test("an arbitrary screen not in px never applies: the CDN emits nothing for mixed units", () => {
    expect(collapseAcross("sr-only min-[40rem]:not-sr-only")).toEqual(
      everywhere,
    );
  });

  test("two screens stacked hold only between them", () => {
    expect(collapseAcross("sr-only md:max-lg:not-sr-only")).toEqual(
      expectedCollapse((width: number): boolean => {
        return width < 768 || width >= 1024;
      }),
    );
    expect(collapseAcross("sr-only md:max-lg:not-sr-only", foreign)).toEqual(
      everywhere,
    );
  });
});
