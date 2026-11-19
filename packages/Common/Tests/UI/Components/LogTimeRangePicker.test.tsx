import LogTimeRangePicker, {
  LOG_TIME_RANGE_DROPDOWN_WIDTH_IN_PX,
} from "../../../UI/Components/LogsViewer/components/LogTimeRangePicker";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";
import { LAYERED_POPOVER_CLASS_NAME } from "../../../UI/Components/Tooltip/LayeredPopover";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
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

/*
 * The edge of the button the dropdown hangs from, as the picker decided it
 * (data-align): "left" is the line's start, "right" its end. The dropdown
 * is drawn over the page from the button (LayeredPopover), not positioned
 * by classes inside the picker any more (#9859).
 */
function isAligned(element: HTMLElement, edge: "left" | "right"): boolean {
  return element.getAttribute("data-align") === edge;
}

// The layer's element the dropdown is drawn in: Tippy's root, on the body.
function layerOf(element: HTMLElement): HTMLElement {
  const layer: HTMLElement | null = element.closest<HTMLElement>(
    `.${LAYERED_POPOVER_CLASS_NAME}`,
  );

  expect(layer).not.toBeNull();

  return layer as HTMLElement;
}

// Where Popper placed the dropdown, once its first placement has run.
async function placementOf(element: HTMLElement): Promise<string | null> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  return layerOf(element).getAttribute("data-popper-placement");
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

    expect(isAligned(dropdown, "left")).toBe(true);
    expect(isAligned(dropdown, "right")).toBe(false);
    expect(dropdown.getAttribute("data-align")).toBe("left");
  });

  test("flips to right alignment when the trigger is near the right edge", () => {
    stubTriggerRect(1310, 1430);

    const dropdown: HTMLElement = openDropdown({
      range: TimeRange.PAST_ONE_HOUR,
    });

    expect(isAligned(dropdown, "right")).toBe(true);
    expect(isAligned(dropdown, "left")).toBe(false);
    expect(dropdown.getAttribute("data-align")).toBe("right");
  });

  test("stays left aligned on a narrow mobile viewport", () => {
    setViewportWidth(375);
    stubTriggerRect(12, 128);

    expect(
      isAligned(openDropdown({ range: TimeRange.PAST_ONE_HOUR }), "left"),
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

  test("keeps the panel anchored below the trigger, drawn over the page", async () => {
    const dropdown: HTMLElement = openDropdown({
      range: TimeRange.PAST_ONE_HOUR,
    });
    const layer: HTMLElement = layerOf(dropdown);

    /*
     * On the page's body, where no card it is in can cut it off - a logs
     * viewer with no filter bar draws its toolbar inside the list's card
     * (#9859) - placed under its button, from the edge it picked.
     */
    expect(layer.parentElement).toBe(document.body);
    expect(
      (layer as HTMLElement & { _tippy?: { reference: Element } })._tippy
        ?.reference,
    ).toBe(screen.getByTestId(BUTTON_TEST_ID));
    expect(await placementOf(dropdown)).toBe("bottom-start");
    expect(hasClass(dropdown, "absolute")).toBe(false);
  });

  test("hangs from the button's end when it picked it", async () => {
    stubTriggerRect(1310, 1430);

    const dropdown: HTMLElement = openDropdown({
      range: TimeRange.PAST_ONE_HOUR,
    });

    expect(isAligned(dropdown, "right")).toBe(true);
    expect(await placementOf(dropdown)).toBe("bottom-end");
  });

  test("keeps the date fields out of the narrow dropdown panel", () => {
    const dropdown: HTMLElement = openDropdown({
      range: TimeRange.CUSTOM,
      startAndEndDate: new InBetween<Date>(
        new Date("2024-01-01T00:00:00.000Z"),
        new Date("2024-01-02T00:00:00.000Z"),
      ),
    });

    expect(dropdown.querySelectorAll("input").length).toBe(0);
  });

  test("opens the custom range modal from the dropdown", () => {
    openDropdown({ range: TimeRange.PAST_ONE_HOUR });

    fireEvent.click(screen.getByTestId("log-time-range-picker-custom-option"));

    expect(screen.getByTestId("custom-time-range-modal")).toBeInTheDocument();
    expect(screen.queryByTestId(DROPDOWN_TEST_ID)).toBeNull();
  });

  test("applies a custom range picked in the modal", () => {
    const emitted: Array<RangeStartAndEndDateTime> = [];
    render(
      <LogTimeRangePicker
        value={{ range: TimeRange.PAST_ONE_HOUR }}
        onChange={(value: RangeStartAndEndDateTime) => {
          emitted.push(value);
        }}
      />,
    );

    fireEvent.click(screen.getByTestId(BUTTON_TEST_ID));
    fireEvent.click(screen.getByTestId("log-time-range-picker-custom-option"));
    fireEvent.click(screen.getByText("Apply"));

    expect(emitted).toHaveLength(1);
    expect(emitted[0]!.range).toBe(TimeRange.CUSTOM);
    expect(emitted[0]!.startAndEndDate).toBeInstanceOf(InBetween);
  });
});
