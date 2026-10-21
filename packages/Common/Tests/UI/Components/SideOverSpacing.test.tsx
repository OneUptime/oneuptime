import SideOver, {
  ComponentProps,
} from "../../../UI/Components/SideOver/SideOver";
import { resetPageScrollLockForTesting } from "../../../UI/Utils/PageScrollLock";
import {
  resolvePadding,
  resolveScrollPadding,
  resolveSpaceBelowInPx,
} from "../../ResponsiveSpacing";
import {
  LAPTOP_WIDTH_IN_PX,
  PHONE_WIDTH_IN_PX,
  TABLET_WIDTH_IN_PX,
  WIDE_DESKTOP_WIDTH_IN_PX,
} from "../../ResponsiveVisibility";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import React from "react";

/*
 * The room SideOver leaves under the last thing in it. The panel's content
 * lost its bottom padding from the sm breakpoint up (`py-6 sm:py-0`), so on
 * any screen 640px or wider a scrolled panel's last row sat flush on the
 * footer's divider - reported on the workflow picker's "Browse all
 * resources", and true of every other panel too. jsdom lays nothing out, so
 * these read the classes through ResponsiveSpacing, which resolves them the
 * way the Tailwind build does.
 */

// Both sides of every breakpoint, and the devices the suites name.
const WIDTHS: Array<number> = [
  PHONE_WIDTH_IN_PX,
  639,
  640,
  767,
  TABLET_WIDTH_IN_PX,
  1023,
  1024,
  LAPTOP_WIDTH_IN_PX,
  1535,
  1536,
  WIDE_DESKTOP_WIDTH_IN_PX,
];

// 1.5rem: what phones always had under the last row, now at every width.
const BOTTOM_SPACE_IN_PX: number = 24;

// The content's classes before the fix, to show these tests catch it.
const PRE_FIX_CONTENT_CLASSES: string =
  "space-y-6 py-6 sm:space-y-0 sm:divide-y sm:divide-gray-200 sm:py-0 p-5";

const baseProps: ComponentProps = {
  title: "Panel",
  description: "A panel with a long list in it.",
  onClose: jest.fn(),
  children: <div data-testid="only-child">Last row</div>,
};

type ScrollContainerFunction = () => HTMLElement;

const getScrollContainer: ScrollContainerFunction = (): HTMLElement => {
  return screen.getByTestId("side-over-content");
};

// The padded wrapper the children are rendered into.
const getContent: ScrollContainerFunction = (): HTMLElement => {
  return getScrollContainer().firstElementChild as HTMLElement;
};

describe("SideOver leaves room under its last row", () => {
  beforeEach(() => {
    resetPageScrollLockForTesting();
  });

  afterEach(() => {
    resetPageScrollLockForTesting();
    document.body.style.overflow = "";
    document.body.style.paddingRight = "";
  });

  test.each(WIDTHS)(
    "24px between the last child and the footer at %ipx",
    (width: number) => {
      render(<SideOver {...baseProps} />);

      expect(
        resolveSpaceBelowInPx(
          screen.getByTestId("only-child"),
          getScrollContainer(),
          width,
        ),
      ).toBe(BOTTOM_SPACE_IN_PX);
    },
  );

  test.each(WIDTHS)(
    "with several children, the same room under the last one at %ipx",
    (width: number) => {
      render(
        <SideOver {...baseProps}>
          {[
            <div key="first" data-testid="first-child">
              First section
            </div>,
            <div key="last" data-testid="last-child">
              Last section
            </div>,
          ]}
        </SideOver>,
      );

      expect(
        resolveSpaceBelowInPx(
          screen.getByTestId("last-child"),
          getScrollContainer(),
          width,
        ),
      ).toBe(BOTTOM_SPACE_IN_PX);
      // And the measurement knows the first child is not the end of the list.
      expect(() => {
        return resolveSpaceBelowInPx(
          screen.getByTestId("first-child"),
          getScrollContainer(),
          width,
        );
      }).toThrow("is laid out below");
    },
  );

  test.each(WIDTHS)(
    "what the keyboard scrolls into view stops the same distance short of the footer at %ipx",
    (width: number) => {
      render(<SideOver {...baseProps} />);

      const scrollPaddingBottom: number = resolveScrollPadding(
        getScrollContainer().getAttribute("class"),
        width,
      ).bottom;

      expect(scrollPaddingBottom).toBe(BOTTOM_SPACE_IN_PX);
      expect(scrollPaddingBottom).toBe(
        resolveSpaceBelowInPx(
          screen.getByTestId("only-child"),
          getScrollContainer(),
          width,
        ),
      );
    },
  );

  test("keeps 20px gutters at the sides at every width", () => {
    render(<SideOver {...baseProps} />);

    for (const width of WIDTHS) {
      const padding: { left: number; right: number } = resolvePadding(
        getContent().getAttribute("class"),
        width,
      );

      expect({ width, left: padding.left, right: padding.right }).toEqual({
        width,
        left: 20,
        right: 20,
      });
    }
  });

  test("still drops the top padding from sm up, as callers with a sticky header of their own expect", () => {
    render(<SideOver {...baseProps} />);

    for (const width of WIDTHS) {
      expect({
        width,
        top: resolvePadding(getContent().getAttribute("class"), width).top,
      }).toEqual({ width, top: width < 640 ? 24 : 0 });
    }
  });

  test("pads the content, not the scroll container, so a sticky header can reach the panel's edges", () => {
    render(<SideOver {...baseProps} />);

    for (const width of WIDTHS) {
      expect({
        width,
        padding: resolvePadding(
          getScrollContainer().getAttribute("class"),
          width,
        ),
      }).toEqual({
        width,
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
      });
    }
  });

  test("the pre-fix classes fail this from 640px up, so the check would have caught it", () => {
    render(<SideOver {...baseProps} />);

    getContent().setAttribute("class", PRE_FIX_CONTENT_CLASSES);

    const child: HTMLElement = screen.getByTestId("only-child");

    expect(resolveSpaceBelowInPx(child, getScrollContainer(), 639)).toBe(
      BOTTOM_SPACE_IN_PX,
    );
    expect(resolveSpaceBelowInPx(child, getScrollContainer(), 640)).toBe(0);
    expect(
      resolveSpaceBelowInPx(child, getScrollContainer(), LAPTOP_WIDTH_IN_PX),
    ).toBe(0);
  });
});
