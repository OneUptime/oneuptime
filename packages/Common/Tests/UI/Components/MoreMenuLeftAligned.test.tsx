import MoreMenu from "../../../UI/Components/MoreMenu/MoreMenu";
import MoreMenuItem from "../../../UI/Components/MoreMenu/MoreMenuItem";
import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import React from "react";

/*
 * MoreMenu's left-aligned mode (isMenuLeftAligned).
 *
 * A ⋯ menu sits at the end of a row, so its menu hangs leftwards from the
 * trigger's right edge. A pill at the START of a line - the push level under
 * a rule on the On-Call Rules page - needs the opposite: the menu under it,
 * left edges together, rather than hanging out past the left of the table.
 *
 * Pinned here: where the menu goes when it is asked to line up on the left,
 * what it falls back to when there is no room on the right, that it still
 * flips above near the bottom of the screen, and that every menu that does
 * not ask is placed exactly as before.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
      };
    },
  };
});

jest.setTimeout(30000);

const VIEWPORT_WIDTH: number = 1280;
const VIEWPORT_HEIGHT: number = 800;
const MENU_WIDTH: number = 224;
const MENU_HEIGHT: number = 120;

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

let triggerRect: Rect = { top: 100, left: 200, width: 110, height: 22 };

const originalGetBoundingClientRect: () => DOMRect =
  HTMLElement.prototype.getBoundingClientRect;
const originalOffsetWidth: PropertyDescriptor | undefined =
  Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");
const originalOffsetHeight: PropertyDescriptor | undefined =
  Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
const originalInnerWidth: number = window.innerWidth;
const originalInnerHeight: number = window.innerHeight;

function toDomRect(rect: Rect): DOMRect {
  return {
    x: rect.left,
    y: rect.top,
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    toJSON: () => {
      return rect;
    },
  } as DOMRect;
}

beforeEach(() => {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: VIEWPORT_WIDTH,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: VIEWPORT_HEIGHT,
  });

  // jsdom does no layout: the trigger and the menu measure what the test says.
  HTMLElement.prototype.getBoundingClientRect = function (
    this: HTMLElement,
  ): DOMRect {
    if (this.getAttribute("aria-haspopup") === "menu") {
      return toDomRect(triggerRect);
    }

    return originalGetBoundingClientRect.call(this);
  };

  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get(this: HTMLElement): number {
      return this.getAttribute("role") === "menu" ? MENU_WIDTH : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get(this: HTMLElement): number {
      return this.getAttribute("role") === "menu" ? MENU_HEIGHT : 0;
    },
  });
});

afterEach(() => {
  cleanup();
  HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
  if (originalOffsetWidth) {
    Object.defineProperty(
      HTMLElement.prototype,
      "offsetWidth",
      originalOffsetWidth,
    );
  }
  if (originalOffsetHeight) {
    Object.defineProperty(
      HTMLElement.prototype,
      "offsetHeight",
      originalOffsetHeight,
    );
  }
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: originalInnerWidth,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: originalInnerHeight,
  });
  triggerRect = { top: 100, left: 200, width: 110, height: 22 };
});

function renderMenu(options: {
  isMenuLeftAligned?: boolean;
  isMenuPortaled?: boolean;
  isOpeningUpwards?: boolean;
}): void {
  render(
    <MoreMenu
      isMenuPortaled={options.isMenuPortaled ?? true}
      isMenuLeftAligned={options.isMenuLeftAligned}
      isOpeningUpwards={options.isOpeningUpwards}
      ariaLabel="Push notification level"
      elementToBeShownInsteadOfButton={
        <button type="button" data-testid="trigger">
          Critical alert
        </button>
      }
    >
      <MoreMenuItem
        text="Critical alert"
        isChecked={true}
        onClick={() => {
          return undefined;
        }}
      />
      <MoreMenuItem
        text="Standard"
        isChecked={false}
        onClick={() => {
          return undefined;
        }}
      />
    </MoreMenu>,
  );
}

function openMenu(): HTMLElement {
  fireEvent.click(screen.getByTestId("trigger"));
  return screen.getByRole("menu");
}

describe("MoreMenu, left-aligned and portalled", () => {
  test("opens below the trigger, left edges together", () => {
    triggerRect = { top: 100, left: 200, width: 110, height: 22 };

    renderMenu({ isMenuLeftAligned: true });

    const menu: HTMLElement = openMenu();

    // 8px under the trigger's bottom edge (100 + 22).
    expect(menu.style.top).toBe("130px");
    expect(menu.style.bottom).toBe("");
    expect(menu.style.left).toBe("200px");
    expect(menu.style.right).toBe("");
    expect(menu.style.visibility).toBe("visible");
  });

  test("grows from the corner at its trigger", () => {
    renderMenu({ isMenuLeftAligned: true });

    const menu: HTMLElement = openMenu();

    expect(menu).toHaveClass("origin-top-left");
    expect(menu).not.toHaveClass("origin-top-right");
  });

  test("flips above near the bottom of the screen, still lined up on the left", () => {
    triggerRect = { top: 740, left: 200, width: 110, height: 22 };

    renderMenu({ isMenuLeftAligned: true });

    const menu: HTMLElement = openMenu();

    // Anchored by its bottom edge, 8px above the trigger's top (800 - 740 + 8).
    expect(menu.style.bottom).toBe("68px");
    expect(menu.style.top).toBe("");
    expect(menu.style.left).toBe("200px");
    expect(menu).toHaveClass("origin-bottom-left");
  });

  test("opens above when asked to and there is room, lined up on the left", () => {
    triggerRect = { top: 400, left: 200, width: 110, height: 22 };

    renderMenu({ isMenuLeftAligned: true, isOpeningUpwards: true });

    const menu: HTMLElement = openMenu();

    expect(menu.style.bottom).toBe("408px");
    expect(menu.style.left).toBe("200px");
  });

  test("keeps clear of the left edge of the screen", () => {
    triggerRect = { top: 100, left: 3, width: 110, height: 22 };

    renderMenu({ isMenuLeftAligned: true });

    expect(openMenu().style.left).toBe("8px");
  });

  test("without room to the right, hangs leftwards from the trigger's right edge instead", () => {
    // 1150 + 224 runs past 1280 - 8.
    triggerRect = { top: 100, left: 1150, width: 110, height: 22 };

    renderMenu({ isMenuLeftAligned: true });

    const menu: HTMLElement = openMenu();

    // The right-aligned placement: 1280 - (1150 + 110).
    expect(menu.style.right).toBe("20px");
    expect(menu.style.left).toBe("");
    // And so it grows from the right, where it now meets its trigger.
    expect(menu).toHaveClass("origin-top-right");
  });

  test("a menu that just fits to the right still lines up on the left", () => {
    // 1048 + 224 = 1272 = 1280 - 8: exactly at the padding.
    triggerRect = { top: 100, left: 1048, width: 110, height: 22 };

    renderMenu({ isMenuLeftAligned: true });

    expect(openMenu().style.left).toBe("1048px");
  });
});

describe("MoreMenu, left-aligned in place", () => {
  test("sits under the trigger's left edge instead of its right", () => {
    renderMenu({ isMenuLeftAligned: true, isMenuPortaled: false });

    const menu: HTMLElement = openMenu();

    expect(menu).toHaveClass("absolute", "left-0", "origin-top-left");
    expect(menu).not.toHaveClass("right-0");
    expect(menu.style.position).toBe("");
  });
});

describe("every menu that does not ask is placed as before", () => {
  test("portalled: right edges together", () => {
    triggerRect = { top: 100, left: 1100, width: 34, height: 30 };

    renderMenu({});

    const menu: HTMLElement = openMenu();

    expect(menu.style.right).toBe("146px");
    expect(menu.style.left).toBe("");
    expect(menu).toHaveClass("origin-top-right");
  });

  test("portalled near the left edge: still hangs rightwards, still grows from the right", () => {
    triggerRect = { top: 100, left: 20, width: 34, height: 30 };

    renderMenu({});

    const menu: HTMLElement = openMenu();

    expect(menu.style.left).toBe("20px");
    expect(menu.style.right).toBe("");
    expect(menu).toHaveClass("origin-top-right");
  });

  test("in place: right-0", () => {
    renderMenu({ isMenuPortaled: false });

    const menu: HTMLElement = openMenu();

    expect(menu).toHaveClass("absolute", "right-0", "origin-top-right");
    expect(menu).not.toHaveClass("left-0");
  });

  test("an explicit false is the same as leaving it out", () => {
    triggerRect = { top: 100, left: 1100, width: 34, height: 30 };

    renderMenu({ isMenuLeftAligned: false });

    expect(openMenu().style.right).toBe("146px");
  });
});
