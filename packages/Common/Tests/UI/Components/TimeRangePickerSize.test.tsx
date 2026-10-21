import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";
import TimeRangePickerDropdown, {
  TIME_RANGE_PICKER_BUTTON_CLASS_NAMES,
  TimeRangePickerSize,
} from "../../../UI/Components/Date/TimeRangePickerDropdown";
import TelemetryTimeRangePicker, {
  TELEMETRY_TIME_RANGE_PICKER_TEST_ID_PREFIX,
} from "../../../UI/Components/TelemetryViewer/components/TelemetryTimeRangePicker";
import { TABLE_HEADER_CONTROL_HEIGHT_CLASS_NAME } from "../../../UI/Components/Table/TableHeaderControls";
import { CARD_MORE_MENU_TRIGGER_CLASS_NAME } from "../../../UI/Components/Card/CardMoreMenu";
import TimeRange from "../../../Types/Time/TimeRange";

/*
 * The time range picker's button comes in two sizes. Compact is the chip
 * an explorer's toolbar and an overview page's header hold, beside chips of
 * its size, and stays what every one of them draws. Header is as tall as a
 * card header's buttons - for a table that keeps its time range in its
 * header, beside its search and its ⋯, where the chip sat a size smaller
 * than everything around it (the Session Replay list's "Past 1 Day").
 */

const PREFIX: string = "size-test";

function renderPicker(size?: TimeRangePickerSize): HTMLElement {
  render(
    <TimeRangePickerDropdown
      value={{ range: TimeRange.PAST_ONE_DAY }}
      onChange={(): void => {}}
      dataTestIdPrefix={PREFIX}
      dropdownWidthInPx={288}
      size={size}
    />,
  );

  return screen.getByTestId(`${PREFIX}-button`);
}

function classesOf(className: string): Array<string> {
  return className.split(" ").filter(Boolean);
}

afterEach(() => {
  cleanup();
});

describe("the time range picker's sizes", () => {
  test("is the compact chip unless told otherwise, exactly as before", () => {
    const button: HTMLElement = renderPicker();

    expect(button).toHaveAttribute("data-size", TimeRangePickerSize.Compact);
    expect(button).toHaveClass(
      "inline-flex",
      "rounded-md",
      "border",
      "px-2.5",
      "py-1.5",
      "text-xs",
      "font-medium",
      "border-gray-200",
      "bg-white",
      "text-gray-700",
    );
    expect(button).not.toHaveClass("text-sm", "md:py-2");
    expect(button.querySelector("svg")).toHaveClass("h-3.5", "w-3.5");
  });

  test("Header is as tall as a card header's buttons and its ⋯", () => {
    const button: HTMLElement = renderPicker(TimeRangePickerSize.Header);

    expect(button).toHaveAttribute("data-size", TimeRangePickerSize.Header);
    expect(button).toHaveClass(
      ...classesOf(TABLE_HEADER_CONTROL_HEIGHT_CLASS_NAME),
      "px-3",
      "text-sm",
      "rounded-md",
      "border",
    );
    expect(button).not.toHaveClass("text-xs", "py-1.5");

    /* The same vertical padding the ⋯ beside it has, at both widths. */
    for (const padding of classesOf(TABLE_HEADER_CONTROL_HEIGHT_CLASS_NAME)) {
      expect(classesOf(CARD_MORE_MENU_TRIGGER_CLASS_NAME)).toContain(padding);
    }
  });

  test("Header wears the border a card's buttons wear, with a focus ring", () => {
    const button: HTMLElement = renderPicker(TimeRangePickerSize.Header);

    expect(button).toHaveClass(
      "border-gray-300",
      "bg-white",
      "hover:bg-gray-50",
      "focus-visible:ring-2",
    );
    expect(button).not.toHaveClass("border-gray-200");
  });

  test("Header draws its clock and chevron at the size of its text", () => {
    const button: HTMLElement = renderPicker(TimeRangePickerSize.Header);
    const icons: Array<Element> = Array.from(button.querySelectorAll("svg"));

    expect(icons).toHaveLength(2);

    for (const icon of icons) {
      expect(icon).toHaveClass("h-4", "w-4");
    }
  });

  test("both sizes turn indigo while open, and say what is picked", () => {
    for (const size of [TimeRangePickerSize.Compact, TimeRangePickerSize.Header]) {
      const button: HTMLElement = renderPicker(size);

      expect(button).toHaveTextContent("Past 1 Day");
      expect(button).toHaveAttribute("aria-expanded", "false");

      fireEvent.click(button);

      expect(button).toHaveAttribute("aria-expanded", "true");
      expect(button).toHaveClass(
        "border-indigo-300",
        "bg-indigo-50",
        "text-indigo-700",
      );
      expect(button).not.toHaveClass("border-gray-300", "border-gray-200");

      cleanup();
    }
  });

  test("each size's box is written once, for the tests and the pages to read", () => {
    expect(Object.keys(TIME_RANGE_PICKER_BUTTON_CLASS_NAMES).sort()).toEqual(
      [TimeRangePickerSize.Compact, TimeRangePickerSize.Header].sort(),
    );
    expect(TIME_RANGE_PICKER_BUTTON_CLASS_NAMES[TimeRangePickerSize.Header])
      .toContain(TABLE_HEADER_CONTROL_HEIGHT_CLASS_NAME);
  });
});

describe("TelemetryTimeRangePicker", () => {
  test("is compact unless told otherwise, and hands a size on", () => {
    const view: ReturnType<typeof render> = render(
      <TelemetryTimeRangePicker
        value={{ range: TimeRange.PAST_ONE_HOUR }}
        onChange={(): void => {}}
      />,
    );

    const button: () => HTMLElement = (): HTMLElement => {
      return screen.getByTestId(
        `${TELEMETRY_TIME_RANGE_PICKER_TEST_ID_PREFIX}-button`,
      );
    };

    expect(button()).toHaveAttribute("data-size", TimeRangePickerSize.Compact);

    view.rerender(
      <TelemetryTimeRangePicker
        value={{ range: TimeRange.PAST_ONE_HOUR }}
        onChange={(): void => {}}
        size={TimeRangePickerSize.Header}
      />,
    );

    expect(button()).toHaveAttribute("data-size", TimeRangePickerSize.Header);
  });
});
