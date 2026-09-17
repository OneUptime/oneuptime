import { describe, expect, test } from "@jest/globals";
import {
  PHONE_WIDTH_IN_PX,
  LAPTOP_WIDTH_IN_PX,
  describeVisibility,
  findHidingElement,
  isVisibleAtWidth,
  resolveDisplay,
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

  test("state variants are ignored — they cannot answer a layout question", () => {
    expect(resolveDisplay("hidden group-hover:flex", LAPTOP_WIDTH_IN_PX)).toBe(
      "hidden",
    );
    expect(resolveDisplay("hidden lg:hover:flex", LAPTOP_WIDTH_IN_PX)).toBe(
      "hidden",
    );
  });

  test("a max-width variant throws rather than being quietly ignored", () => {
    expect(() => {
      return resolveDisplay("max-lg:hidden", PHONE_WIDTH_IN_PX);
    }).toThrow(/max-width variants/);
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
    expect(describeVisibility(null, PHONE_WIDTH_IN_PX)).toBe(
      "the element was never rendered",
    );
  });
});
