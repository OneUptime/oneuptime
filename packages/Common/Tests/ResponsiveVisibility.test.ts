import { describe, expect, test } from "@jest/globals";
import {
  PHONE_WIDTH_IN_PX,
  LAPTOP_WIDTH_IN_PX,
  TAILWIND_BREAKPOINTS_IN_PX,
  WIDE_DESKTOP_WIDTH_IN_PX,
  describeVisibility,
  findHidingElement,
  isVisibleAtWidth,
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
