import LogTimeRangePicker, {
  LOG_TIME_RANGE_DROPDOWN_WIDTH_IN_PX,
} from "../../../UI/Components/LogsViewer/components/LogTimeRangePicker";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";
import "@testing-library/jest-dom/extend-expect";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

const BUTTON_TEST_ID: string = "log-time-range-picker-button";
const DROPDOWN_TEST_ID: string = "log-time-range-picker-dropdown";

const ORIGINAL_INNER_WIDTH: number = window.innerWidth;
const originalGetBoundingClientRect: () => DOMRect =
  Element.prototype.getBoundingClientRect;

function setViewportWidth(width: number): void {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
}

function stubTriggerRect(left: number, right: number): void {
  Element.prototype.getBoundingClientRect = function (this: Element): DOMRect {
    if (
      this instanceof HTMLElement &&
      this.getAttribute("data-testid") === BUTTON_TEST_ID
    ) {
      return {
        left: left,
        right: right,
        top: 40,
        bottom: 68,
        width: right - left,
        height: 28,
        x: left,
        y: 40,
        toJSON: (): Record<string, unknown> => {
          return {};
        },
      } as DOMRect;
    }

    return originalGetBoundingClientRect.call(this);
  };
}

function openDropdown(value: RangeStartAndEndDateTime): HTMLElement {
  render(<LogTimeRangePicker value={value} onChange={jest.fn()} />);
  fireEvent.click(screen.getByTestId(BUTTON_TEST_ID));
  return screen.getByTestId(DROPDOWN_TEST_ID);
}

function hasClass(element: HTMLElement, className: string): boolean {
  return element.classList.contains(className);
}

describe("LogTimeRangePicker", () => {
  beforeEach(() => {
    setViewportWidth(1440);
    stubTriggerRect(64, 180);
  });

  afterEach(() => {
    cleanup();
    Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    setViewportWidth(ORIGINAL_INNER_WIDTH);
  });

  test("opens rightwards when the trigger sits at the left of the toolbar", () => {
    const dropdown: HTMLElement = openDropdown({
      range: TimeRange.PAST_ONE_HOUR,
    });

    expect(hasClass(dropdown, "left-0")).toBe(true);
    expect(hasClass(dropdown, "right-0")).toBe(false);
    expect(dropdown.getAttribute("data-align")).toBe("left");
  });

  test("flips to right alignment when the trigger is near the right edge", () => {
    stubTriggerRect(1310, 1430);

    const dropdown: HTMLElement = openDropdown({
      range: TimeRange.PAST_ONE_HOUR,
    });

    expect(hasClass(dropdown, "right-0")).toBe(true);
    expect(hasClass(dropdown, "left-0")).toBe(false);
    expect(dropdown.getAttribute("data-align")).toBe("right");
  });

  test("stays left aligned on a narrow mobile viewport", () => {
    setViewportWidth(375);
    stubTriggerRect(12, 128);

    expect(
      hasClass(openDropdown({ range: TimeRange.PAST_ONE_HOUR }), "left-0"),
    ).toBe(true);
  });

  test("caps the panel width so it cannot exceed the viewport", () => {
    expect(
      hasClass(
        openDropdown({ range: TimeRange.PAST_ONE_HOUR }),
        "max-w-[calc(100vw-1rem)]",
      ),
    ).toBe(true);
  });

  test("exports a width constant that matches the rendered w-72 panel", () => {
    expect(LOG_TIME_RANGE_DROPDOWN_WIDTH_IN_PX).toBe(288);
    expect(
      hasClass(openDropdown({ range: TimeRange.PAST_ONE_HOUR }), "w-72"),
    ).toBe(true);
  });

  test("keeps the panel anchored below the trigger", () => {
    const dropdown: HTMLElement = openDropdown({
      range: TimeRange.PAST_ONE_HOUR,
    });

    expect(hasClass(dropdown, "absolute")).toBe(true);
    expect(hasClass(dropdown, "top-full")).toBe(true);
    expect(
      dropdown.parentElement?.classList.contains("relative") ?? false,
    ).toBe(true);
  });
});
