import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import TimeRangePickerDropdown, {
  TimeRangePickerSize,
} from "../../../UI/Components/Date/TimeRangePickerDropdown";
import {
  DropdownHorizontalAlignment,
  getDropdownWidthToFit,
} from "../../../UI/Utils/DropdownAlignment";
import TimeRange from "../../../Types/Time/TimeRange";

/*
 * A time range picker at the right of a table's header - the Session
 * Replay list's, Replay Users', User Flows' - opened its dropdown from its
 * left edge the first time, and the dropdown ran 43px past a laptop's
 * screen (115px past a phone's), the page scrolling sideways with it. Only
 * the second time did it open from its right edge.
 *
 * The dropdown is measured as it opens, and the first time it opened the
 * Dashboard's Tailwind runtime had not yet written the rule for its w-72:
 * it measured 131px, which fitted. It is now taken to be at least as wide
 * as it is styled to.
 */

const PREFIX: string = "header-range";
// Tailwind w-72, the width the dropdown is styled to.
const STYLED_WIDTH_IN_PX: number = 288;
// What the dropdown measured before its w-72 applied.
const UNSTYLED_WIDTH_IN_PX: number = 131;

interface Box {
  left: number;
  right: number;
}

const originalOffsetWidth: PropertyDescriptor | undefined =
  Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");
const originalInnerWidth: number = window.innerWidth;

function setViewportWidth(width: number): void {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
}

// The dropdown measures as it does before its stylesheet catches up.
function measureDropdownsAs(width: number): void {
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get(this: HTMLElement): number {
      return (this.getAttribute("data-testid") || "").endsWith("-dropdown")
        ? width
        : 0;
    },
  });
}

function renderPickerAt(box: Box): HTMLElement {
  render(
    <TimeRangePickerDropdown
      value={{ range: TimeRange.PAST_ONE_DAY }}
      onChange={(): void => {}}
      dataTestIdPrefix={PREFIX}
      dropdownWidthInPx={STYLED_WIDTH_IN_PX}
      size={TimeRangePickerSize.Header}
    />,
  );

  const button: HTMLElement = screen.getByTestId(`${PREFIX}-button`);

  button.getBoundingClientRect = (): DOMRect => {
    return {
      left: box.left,
      right: box.right,
      x: box.left,
      y: 182,
      top: 182,
      bottom: 220,
      width: box.right - box.left,
      height: 38,
      toJSON: (): string => {
        return "";
      },
    } as DOMRect;
  };

  return button;
}

function openedDropdown(button: HTMLElement): HTMLElement {
  fireEvent.click(button);

  return screen.getByTestId(`${PREFIX}-dropdown`);
}

beforeEach(() => {
  measureDropdownsAs(UNSTYLED_WIDTH_IN_PX);
});

afterEach(() => {
  cleanup();

  if (originalOffsetWidth) {
    Object.defineProperty(
      HTMLElement.prototype,
      "offsetWidth",
      originalOffsetWidth,
    );
  }

  setViewportWidth(originalInnerWidth);
});

describe("getDropdownWidthToFit", () => {
  test("is the styled width while the popup measures narrower", () => {
    expect(
      getDropdownWidthToFit({
        measuredWidthInPx: UNSTYLED_WIDTH_IN_PX,
        dropdownWidthInPx: STYLED_WIDTH_IN_PX,
      }),
    ).toBe(STYLED_WIDTH_IN_PX);
    // Not laid out at all.
    expect(
      getDropdownWidthToFit({
        measuredWidthInPx: 0,
        dropdownWidthInPx: STYLED_WIDTH_IN_PX,
      }),
    ).toBe(STYLED_WIDTH_IN_PX);
    expect(
      getDropdownWidthToFit({
        measuredWidthInPx: Number.NaN,
        dropdownWidthInPx: STYLED_WIDTH_IN_PX,
      }),
    ).toBe(STYLED_WIDTH_IN_PX);
  });

  test("is the measured width of a popup wider than it is styled to", () => {
    expect(
      getDropdownWidthToFit({
        measuredWidthInPx: 320,
        dropdownWidthInPx: STYLED_WIDTH_IN_PX,
      }),
    ).toBe(320);
  });
});

describe("a time range picker at the right of a table's header", () => {
  test("opens its dropdown from its right edge the first time, at a laptop's width", () => {
    setViewportWidth(1280);

    // Where the Session Replay list's picker stands at 1280.
    const dropdown: HTMLElement = openedDropdown(
      renderPickerAt({ left: 1027, right: 1173 }),
    );

    expect(dropdown).toHaveAttribute(
      "data-align",
      DropdownHorizontalAlignment.Right,
    );
    expect(dropdown).toHaveClass("right-0");
    expect(dropdown).not.toHaveClass("left-0");
  });

  test("and on a phone, where it follows the search on a line of its own", () => {
    setViewportWidth(390);

    const dropdown: HTMLElement = openedDropdown(
      renderPickerAt({ left: 153, right: 299 }),
    );

    expect(dropdown).toHaveAttribute(
      "data-align",
      DropdownHorizontalAlignment.Right,
    );
  });

  test("a picker with room to its right still opens from its left edge", () => {
    setViewportWidth(1280);

    // An explorer's toolbar, where the picker is the first control.
    const dropdown: HTMLElement = openedDropdown(
      renderPickerAt({ left: 64, right: 180 }),
    );

    expect(dropdown).toHaveAttribute(
      "data-align",
      DropdownHorizontalAlignment.Left,
    );
    expect(dropdown).toHaveClass("left-0");
  });
});
