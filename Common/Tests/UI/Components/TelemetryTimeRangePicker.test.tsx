import TelemetryTimeRangePicker, {
  TIME_RANGE_DROPDOWN_WIDTH_IN_PX,
} from "../../../UI/Components/TelemetryViewer/components/TelemetryTimeRangePicker";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";
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

const BUTTON_TEST_ID: string = "telemetry-time-range-picker-button";
const DROPDOWN_TEST_ID: string = "telemetry-time-range-picker-dropdown";

const ORIGINAL_INNER_WIDTH: number = window.innerWidth;
const originalGetBoundingClientRect: () => DOMRect =
  Element.prototype.getBoundingClientRect;

/*
 * jsdom performs no layout, so every rect comes back zero-sized. These helpers
 * let a test describe where the trigger button sits inside a viewport of a
 * given width, which is the only input the alignment logic reads.
 */
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

function renderPicker(
  value: RangeStartAndEndDateTime,
  onChange: (value: RangeStartAndEndDateTime) => void = jest.fn(),
): void {
  render(<TelemetryTimeRangePicker value={value} onChange={onChange} />);
}

function getTrigger(): HTMLElement {
  return screen.getByTestId(BUTTON_TEST_ID);
}

function getDropdown(): HTMLElement {
  return screen.getByTestId(DROPDOWN_TEST_ID);
}

function openDropdown(): HTMLElement {
  fireEvent.click(getTrigger());
  return getDropdown();
}

function hasClass(element: HTMLElement, className: string): boolean {
  return element.classList.contains(className);
}

describe("TelemetryTimeRangePicker", () => {
  beforeEach(() => {
    setViewportWidth(1440);
    stubTriggerRect(64, 180);
  });

  afterEach(() => {
    cleanup();
    Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    setViewportWidth(ORIGINAL_INNER_WIDTH);
  });

  describe("dropdown alignment", () => {
    test("opens rightwards when the trigger sits at the left of the metrics toolbar", () => {
      /*
       * Regression: the panel was hard-coded to `right-0`, so on the metric
       * explorer — where the time range button is the first control in the
       * toolbar — the 288px panel rendered off the left edge of the content
       * area and on top of the app sidebar.
       */
      renderPicker({ range: TimeRange.PAST_ONE_HOUR });

      const dropdown: HTMLElement = openDropdown();

      expect(hasClass(dropdown, "left-0")).toBe(true);
      expect(hasClass(dropdown, "right-0")).toBe(false);
      expect(dropdown.getAttribute("data-align")).toBe("left");
    });

    test("stays left aligned for a trigger flush against x=0", () => {
      stubTriggerRect(0, 116);
      renderPicker({ range: TimeRange.PAST_ONE_HOUR });

      expect(hasClass(openDropdown(), "left-0")).toBe(true);
    });

    test("stays left aligned for a trigger in the middle of a wide toolbar", () => {
      stubTriggerRect(500, 616);
      renderPicker({ range: TimeRange.PAST_ONE_HOUR });

      expect(hasClass(openDropdown(), "left-0")).toBe(true);
    });

    test("flips to right alignment when the trigger is near the right edge", () => {
      stubTriggerRect(1310, 1430);
      renderPicker({ range: TimeRange.PAST_ONE_HOUR });

      const dropdown: HTMLElement = openDropdown();

      expect(hasClass(dropdown, "right-0")).toBe(true);
      expect(hasClass(dropdown, "left-0")).toBe(false);
      expect(dropdown.getAttribute("data-align")).toBe("right");
    });

    test("never emits both positioning classes at once", () => {
      stubTriggerRect(1310, 1430);
      renderPicker({ range: TimeRange.PAST_ONE_HOUR });

      const dropdown: HTMLElement = openDropdown();

      expect(
        hasClass(dropdown, "left-0") && hasClass(dropdown, "right-0"),
      ).toBe(false);
    });

    test("stays left aligned on a narrow mobile viewport", () => {
      setViewportWidth(375);
      stubTriggerRect(12, 128);
      renderPicker({ range: TimeRange.PAST_ONE_HOUR });

      expect(hasClass(openDropdown(), "left-0")).toBe(true);
    });

    test("re-measures alignment when the window is resized", () => {
      stubTriggerRect(1000, 1116);
      renderPicker({ range: TimeRange.PAST_ONE_HOUR });

      expect(hasClass(openDropdown(), "left-0")).toBe(true);

      // Shrink the window so the same trigger no longer has room to its right.
      act(() => {
        setViewportWidth(1200);
        window.dispatchEvent(new Event("resize"));
      });

      expect(hasClass(getDropdown(), "right-0")).toBe(true);
    });

    test("keeps the panel on screen when neither edge fits the viewport", () => {
      /*
       * Viewport narrower than the 288px panel: left alignment clips by 60px,
       * right alignment would clip by 116px, so left is the lesser evil.
       */
      setViewportWidth(300);
      stubTriggerRect(64, 180);
      renderPicker({ range: TimeRange.PAST_ONE_HOUR });

      const dropdown: HTMLElement = openDropdown();

      expect(hasClass(dropdown, "left-0")).toBe(true);
      expect(hasClass(dropdown, "max-w-[calc(100vw-1rem)]")).toBe(true);
    });

    test("re-measures alignment when scrolling moves the trigger sideways", () => {
      renderPicker({ range: TimeRange.PAST_ONE_HOUR });

      expect(hasClass(openDropdown(), "left-0")).toBe(true);

      act(() => {
        stubTriggerRect(1310, 1430);
        window.dispatchEvent(new Event("scroll"));
      });

      expect(hasClass(getDropdown(), "right-0")).toBe(true);
    });

    test("re-evaluates alignment each time the dropdown is reopened", () => {
      renderPicker({ range: TimeRange.PAST_ONE_HOUR });

      expect(hasClass(openDropdown(), "left-0")).toBe(true);

      fireEvent.click(getTrigger());
      expect(screen.queryByTestId(DROPDOWN_TEST_ID)).toBeNull();

      stubTriggerRect(1310, 1430);
      expect(hasClass(openDropdown(), "right-0")).toBe(true);
    });

    test("stops listening for layout changes once closed", () => {
      const removedEvents: Array<string> = [];
      const originalRemoveEventListener: typeof window.removeEventListener =
        window.removeEventListener.bind(window);

      window.removeEventListener = ((
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | EventListenerOptions,
      ): void => {
        removedEvents.push(type);
        originalRemoveEventListener(type, listener, options);
      }) as typeof window.removeEventListener;

      try {
        renderPicker({ range: TimeRange.PAST_ONE_HOUR });
        openDropdown();
        fireEvent.click(getTrigger());

        expect(removedEvents).toContain("resize");
        expect(removedEvents).toContain("scroll");
      } finally {
        window.removeEventListener = originalRemoveEventListener;
      }
    });

    test("ignores layout events once the dropdown is closed", () => {
      renderPicker({ range: TimeRange.PAST_ONE_HOUR });
      openDropdown();
      fireEvent.click(getTrigger());

      /*
       * Firing a resize after close must not resurrect the panel or throw
       * because a listener outlived the element it measured.
       */
      act(() => {
        setViewportWidth(300);
        window.dispatchEvent(new Event("resize"));
      });

      expect(screen.queryByTestId(DROPDOWN_TEST_ID)).toBeNull();
    });

    test("keeps the panel anchored below the trigger inside a relative container", () => {
      renderPicker({ range: TimeRange.PAST_ONE_HOUR });

      const dropdown: HTMLElement = openDropdown();

      expect(hasClass(dropdown, "absolute")).toBe(true);
      expect(hasClass(dropdown, "top-full")).toBe(true);
      expect(
        dropdown.parentElement?.classList.contains("relative") ?? false,
      ).toBe(true);
    });

    test("caps the panel width so it cannot exceed the viewport", () => {
      renderPicker({ range: TimeRange.PAST_ONE_HOUR });

      expect(hasClass(openDropdown(), "max-w-[calc(100vw-1rem)]")).toBe(true);
    });

    test("exports a width constant that matches the rendered w-72 panel", () => {
      expect(TIME_RANGE_DROPDOWN_WIDTH_IN_PX).toBe(288);

      renderPicker({ range: TimeRange.PAST_ONE_HOUR });
      expect(hasClass(openDropdown(), "w-72")).toBe(true);
    });
  });

  describe("open and close behaviour", () => {
    test("is closed until the trigger is clicked", () => {
      renderPicker({ range: TimeRange.PAST_ONE_HOUR });

      expect(screen.queryByTestId(DROPDOWN_TEST_ID)).toBeNull();
      expect(getTrigger().getAttribute("aria-expanded")).toBe("false");
    });

    test("marks the trigger as expanded while open", () => {
      renderPicker({ range: TimeRange.PAST_ONE_HOUR });
      openDropdown();

      expect(getTrigger().getAttribute("aria-expanded")).toBe("true");
    });

    test("closes when clicking outside the picker", () => {
      renderPicker({ range: TimeRange.PAST_ONE_HOUR });
      openDropdown();

      fireEvent.mouseDown(document.body);

      expect(screen.queryByTestId(DROPDOWN_TEST_ID)).toBeNull();
    });

    test("stays open when clicking inside the dropdown", () => {
      renderPicker({ range: TimeRange.PAST_ONE_HOUR });
      const dropdown: HTMLElement = openDropdown();

      fireEvent.mouseDown(dropdown);

      expect(screen.queryByTestId(DROPDOWN_TEST_ID)).not.toBeNull();
    });
  });

  describe("range selection", () => {
    test("shows the label of the currently selected preset", () => {
      renderPicker({ range: TimeRange.PAST_ONE_HOUR });

      expect(getTrigger().textContent).toContain("Past 1 Hour");
    });

    test("emits the picked preset and closes the dropdown", () => {
      const onChange: (value: RangeStartAndEndDateTime) => void = jest.fn();
      renderPicker({ range: TimeRange.PAST_ONE_HOUR }, onChange);
      openDropdown();

      fireEvent.click(screen.getByText("Past 30 Minutes"));

      expect(onChange).toHaveBeenCalledWith({
        range: TimeRange.PAST_THIRTY_MINS,
      });
      expect(screen.queryByTestId(DROPDOWN_TEST_ID)).toBeNull();
    });

    test("lists every preset option plus the custom entry", () => {
      renderPicker({ range: TimeRange.PAST_ONE_HOUR });
      const dropdown: HTMLElement = openDropdown();

      const optionLabels: Array<string> = Array.from(
        dropdown.querySelectorAll("button"),
      ).map((button: HTMLButtonElement): string => {
        return (button.textContent || "").trim();
      });

      const expectedLabels: Array<string> = [
        "Past 5 Minutes",
        "Past 15 Minutes",
        "Past 30 Minutes",
        "Past 1 Hour",
        "Past 2 Hours",
        "Past 3 Hours",
        "Past 1 Day",
        "Past 2 Days",
        "Past 1 Week",
        "Past 2 Weeks",
        "Past 1 Month",
        "Past 3 Months",
        "Custom Range...",
      ];

      expect(optionLabels).toEqual(expectedLabels);
    });

    test("keeps the date fields out of the narrow dropdown panel", () => {
      /*
       * Regression: the custom editor used to render two `datetime-local`
       * fields inside the 288px panel. It now lives in a modal, so the panel
       * itself stays a plain list of options.
       */
      renderPicker({
        range: TimeRange.CUSTOM,
        startAndEndDate: new InBetween<Date>(
          new Date("2024-01-01T00:00:00.000Z"),
          new Date("2024-01-02T00:00:00.000Z"),
        ),
      });

      const dropdown: HTMLElement = openDropdown();

      expect(hasClass(dropdown, "left-0")).toBe(true);
      expect(dropdown.querySelectorAll("input").length).toBe(0);
    });

    test("marks the custom entry as selected while a custom range is active", () => {
      renderPicker({
        range: TimeRange.CUSTOM,
        startAndEndDate: new InBetween<Date>(
          new Date("2024-01-01T00:00:00.000Z"),
          new Date("2024-01-02T00:00:00.000Z"),
        ),
      });

      openDropdown();

      expect(
        hasClass(
          screen.getByTestId("telemetry-time-range-picker-custom-option"),
          "text-indigo-700",
        ),
      ).toBe(true);
    });

    test("opens the custom range modal from the dropdown", () => {
      renderPicker({ range: TimeRange.PAST_ONE_HOUR });
      openDropdown();

      fireEvent.click(
        screen.getByTestId("telemetry-time-range-picker-custom-option"),
      );

      expect(screen.getByTestId("custom-time-range-modal")).toBeInTheDocument();
      // The dropdown gets out of the way once the modal is up.
      expect(screen.queryByTestId(DROPDOWN_TEST_ID)).toBeNull();
    });

    test("applies a custom range picked in the modal", () => {
      const emitted: Array<RangeStartAndEndDateTime> = [];
      renderPicker(
        { range: TimeRange.PAST_ONE_HOUR },
        (value: RangeStartAndEndDateTime) => {
          emitted.push(value);
        },
      );
      openDropdown();

      fireEvent.click(
        screen.getByTestId("telemetry-time-range-picker-custom-option"),
      );
      fireEvent.click(screen.getByText("Apply"));

      expect(emitted).toHaveLength(1);
      expect(emitted[0]!.range).toBe(TimeRange.CUSTOM);
      expect(emitted[0]!.startAndEndDate).toBeInstanceOf(InBetween);
    });
  });
});
