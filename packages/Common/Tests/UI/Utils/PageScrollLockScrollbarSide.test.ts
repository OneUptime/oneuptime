import {
  getPageScrollbarSide,
  lockPageScroll,
  resetPageScrollLockForTesting,
  unlockPageScroll,
} from "../../../UI/Utils/PageScrollLock";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Hiding the page's scrollbar while a dialog is up reclaims its width, so
 * the lock pads the page back by as much. It padded the right, always: a
 * browser that draws the scrollbar on the left - Firefox in a language read
 * right to left, on every page - then had the page move left by the
 * scrollbar's width under every dialog. The lock now pads the side the
 * scrollbar was on: where the page's own box starts after it, the left.
 */

const SCROLLBAR_WIDTH: number = 15;

const setScrollbar: (data: { width: number; side: "left" | "right" }) => void = (
  data: { width: number; side: "left" | "right" },
): void => {
  Object.defineProperty(document.documentElement, "clientWidth", {
    configurable: true,
    value: window.innerWidth - data.width,
  });

  // A scrollbar on the left: the page's box starts its width in.
  jest
    .spyOn(document.documentElement, "getBoundingClientRect")
    .mockImplementation((): DOMRect => {
      const left: number = data.side === "left" ? data.width : 0;

      return {
        left,
        right: left + window.innerWidth - data.width,
        top: 0,
        bottom: 768,
        width: window.innerWidth - data.width,
        height: 768,
        x: left,
        y: 0,
        toJSON: () => {
          return {};
        },
      } as DOMRect;
    });
};

beforeEach(() => {
  resetPageScrollLockForTesting();
  document.body.style.removeProperty("overflow");
  document.body.style.removeProperty("padding-right");
  document.body.style.removeProperty("padding-left");
});

afterEach(() => {
  resetPageScrollLockForTesting();
  jest.restoreAllMocks();
  Object.defineProperty(document.documentElement, "clientWidth", {
    configurable: true,
    value: window.innerWidth,
  });
});

describe("getPageScrollbarSide", () => {
  test("the right, almost everywhere", () => {
    setScrollbar({ width: SCROLLBAR_WIDTH, side: "right" });

    expect(getPageScrollbarSide(SCROLLBAR_WIDTH)).toBe("right");
  });

  test("the left, where the page's box starts after the scrollbar", () => {
    setScrollbar({ width: SCROLLBAR_WIDTH, side: "left" });

    expect(getPageScrollbarSide(SCROLLBAR_WIDTH)).toBe("left");
  });

  test("the right, when there is no scrollbar to find (an overlay one)", () => {
    setScrollbar({ width: 0, side: "left" });

    expect(getPageScrollbarSide(0)).toBe("right");
  });
});

describe("the lock pads the side the scrollbar was on", () => {
  test("a scrollbar on the right: the right, as before", () => {
    setScrollbar({ width: SCROLLBAR_WIDTH, side: "right" });

    lockPageScroll();

    expect(document.body.style.paddingRight).toBe("15px");
    expect(document.body.style.paddingLeft).toBe("");
    expect(document.body.style.overflow).toBe("hidden");

    unlockPageScroll();

    expect(document.body.style.paddingRight).toBe("");
    expect(document.body.style.overflow).toBe("");
  });

  test("a scrollbar on the left: the left, and nothing on the right", () => {
    setScrollbar({ width: SCROLLBAR_WIDTH, side: "left" });

    lockPageScroll();

    expect(document.body.style.paddingLeft).toBe("15px");
    expect(document.body.style.paddingRight).toBe("");

    unlockPageScroll();

    expect(document.body.style.paddingLeft).toBe("");
  });

  test("puts back the page's own left padding when it lets go", () => {
    setScrollbar({ width: SCROLLBAR_WIDTH, side: "left" });
    document.body.style.setProperty("padding-left", "4px");

    lockPageScroll();

    expect(document.body.style.paddingLeft).toBe("15px");

    unlockPageScroll();

    expect(document.body.style.paddingLeft).toBe("4px");
  });

  test("an inner dialog adds no second gutter", () => {
    setScrollbar({ width: SCROLLBAR_WIDTH, side: "left" });

    lockPageScroll();
    lockPageScroll();

    expect(document.body.style.paddingLeft).toBe("15px");

    unlockPageScroll();

    expect(document.body.style.paddingLeft).toBe("15px");

    unlockPageScroll();

    expect(document.body.style.paddingLeft).toBe("");
  });
});
