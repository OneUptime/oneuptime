/** @timezone UTC */
import TimeRangePickerDropdown, {
  CUSTOM_RANGE_OPTION_LABEL,
  TIME_RANGE_PRESET_OPTIONS,
  getTimeRangeButtonLabel,
} from "../../../UI/Components/Date/TimeRangePickerDropdown";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import OneUptimeDate from "../../../Types/Date";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";
import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";

const PREFIX: string = "test-range-picker";
const DROPDOWN_WIDTH_IN_PX: number = 288;

interface Harness {
  emitted: Array<RangeStartAndEndDateTime>;
}

function renderPicker(value: RangeStartAndEndDateTime): Harness {
  const harness: Harness = { emitted: [] };

  render(
    <TimeRangePickerDropdown
      value={value}
      onChange={(next: RangeStartAndEndDateTime) => {
        harness.emitted.push(next);
      }}
      dataTestIdPrefix={PREFIX}
      dropdownWidthInPx={DROPDOWN_WIDTH_IN_PX}
    />,
  );

  return harness;
}

function openDropdown(): void {
  fireEvent.click(screen.getByTestId(`${PREFIX}-button`));
}

function openCustomModal(): void {
  openDropdown();
  fireEvent.click(screen.getByTestId(`${PREFIX}-custom-option`));
}

function getStartInput(): HTMLInputElement {
  return screen.getByTestId("custom-time-range-start") as HTMLInputElement;
}

function getEndInput(): HTMLInputElement {
  return screen.getByTestId("custom-time-range-end") as HTMLInputElement;
}

/*
 * jsdom normalises a `datetime-local` value to minute precision, so compare
 * the instant a field names rather than the string it reports.
 */
function getFieldDate(input: HTMLInputElement): Date {
  return OneUptimeDate.fromDateTimeLocalString(input.value);
}

function minutesBetweenFields(): number {
  return OneUptimeDate.getDifferenceInMinutes(
    getFieldDate(getStartInput()),
    getFieldDate(getEndInput()),
  );
}

afterEach(() => {
  cleanup();
});

describe("getTimeRangeButtonLabel", () => {
  test("uses the preset label for a preset range", () => {
    expect(getTimeRangeButtonLabel({ range: TimeRange.PAST_THIRTY_MINS })).toBe(
      "Past 30 Minutes",
    );
  });

  test("falls back to the raw range when there is no preset label", () => {
    expect(getTimeRangeButtonLabel({ range: TimeRange.CUSTOM })).toBe(
      TimeRange.CUSTOM,
    );
  });

  test("summarises a custom range as a start–end pair", () => {
    const label: string = getTimeRangeButtonLabel({
      range: TimeRange.CUSTOM,
      startAndEndDate: new InBetween<Date>(
        new Date("2024-03-01T10:00:00.000Z"),
        new Date("2024-03-02T13:30:00.000Z"),
      ),
    });

    expect(label).toBe("Mar 1, 10:00 – Mar 2, 13:30");
  });
});

describe("TimeRangePickerDropdown", () => {
  describe("test ids", () => {
    test("namespaces every test id with the given prefix", () => {
      renderPicker({ range: TimeRange.PAST_ONE_HOUR });

      expect(screen.getByTestId(`${PREFIX}-button`)).toBeInTheDocument();

      openDropdown();

      expect(screen.getByTestId(`${PREFIX}-dropdown`)).toBeInTheDocument();
      expect(screen.getByTestId(`${PREFIX}-custom-option`)).toBeInTheDocument();
    });
  });

  describe("presets", () => {
    test("lists every preset plus the custom entry", () => {
      renderPicker({ range: TimeRange.PAST_ONE_HOUR });
      openDropdown();

      const labels: Array<string> = Array.from(
        screen.getByTestId(`${PREFIX}-dropdown`).querySelectorAll("button"),
      ).map((button: HTMLButtonElement): string => {
        return (button.textContent || "").trim();
      });

      expect(labels).toEqual([
        ...TIME_RANGE_PRESET_OPTIONS.map(
          (option: { label: string }): string => {
            return option.label;
          },
        ),
        CUSTOM_RANGE_OPTION_LABEL,
      ]);
    });

    test("emits a preset without any absolute window attached", () => {
      const harness: Harness = renderPicker({ range: TimeRange.PAST_ONE_HOUR });
      openDropdown();

      fireEvent.click(screen.getByText("Past 2 Days"));

      expect(harness.emitted).toEqual([{ range: TimeRange.PAST_TWO_DAYS }]);
    });

    test("closes the dropdown after picking a preset", () => {
      renderPicker({ range: TimeRange.PAST_ONE_HOUR });
      openDropdown();

      fireEvent.click(screen.getByText("Past 2 Days"));

      expect(screen.queryByTestId(`${PREFIX}-dropdown`)).toBeNull();
    });

    test("switching back to a preset from a custom range drops the window", () => {
      const harness: Harness = renderPicker({
        range: TimeRange.CUSTOM,
        startAndEndDate: new InBetween<Date>(
          new Date("2024-03-01T10:00:00.000Z"),
          new Date("2024-03-01T13:00:00.000Z"),
        ),
      });
      openDropdown();

      fireEvent.click(screen.getByText("Past 1 Hour"));

      expect(harness.emitted).toEqual([{ range: TimeRange.PAST_ONE_HOUR }]);
    });
  });

  describe("custom range modal", () => {
    test("is not mounted until the custom entry is clicked", () => {
      renderPicker({ range: TimeRange.PAST_ONE_HOUR });
      openDropdown();

      expect(screen.queryByTestId("custom-time-range-modal")).toBeNull();
    });

    test("opens on the custom entry and closes the dropdown behind it", () => {
      renderPicker({ range: TimeRange.PAST_ONE_HOUR });
      openCustomModal();

      expect(screen.getByTestId("custom-time-range-modal")).toBeInTheDocument();
      expect(screen.queryByTestId(`${PREFIX}-dropdown`)).toBeNull();
    });

    test("seeds from the absolute bounds of the selected preset", () => {
      renderPicker({ range: TimeRange.PAST_THREE_HOURS });
      openCustomModal();

      expect(minutesBetweenFields()).toBe(180);
    });

    test("seeds from the active custom range when there is one", () => {
      const start: Date = new Date("2024-03-01T10:00:00.000Z");
      const end: Date = new Date("2024-03-01T13:00:00.000Z");

      renderPicker({
        range: TimeRange.CUSTOM,
        startAndEndDate: new InBetween<Date>(start, end),
      });
      openCustomModal();

      expect(getFieldDate(getStartInput()).getTime()).toBe(start.getTime());
      expect(getFieldDate(getEndInput()).getTime()).toBe(end.getTime());
    });

    test("falls back to the preset bounds when a custom range has no window", () => {
      renderPicker({ range: TimeRange.CUSTOM });
      openCustomModal();

      expect(getStartInput().value).not.toBe("");
      expect(getEndInput().value).not.toBe("");
    });

    test("emits a custom range when the modal is applied", () => {
      const harness: Harness = renderPicker({ range: TimeRange.PAST_ONE_HOUR });
      openCustomModal();

      fireEvent.change(getStartInput(), {
        target: { value: "2024-03-01T08:00:00" },
      });
      fireEvent.change(getEndInput(), {
        target: { value: "2024-03-01T09:30:00" },
      });
      fireEvent.click(screen.getByText("Apply"));

      expect(harness.emitted).toHaveLength(1);
      expect(harness.emitted[0]!.range).toBe(TimeRange.CUSTOM);
      expect(
        OneUptimeDate.toDateTimeLocalString(
          harness.emitted[0]!.startAndEndDate!.startValue,
        ),
      ).toBe("2024-03-01T08:00:00");
      expect(
        OneUptimeDate.toDateTimeLocalString(
          harness.emitted[0]!.startAndEndDate!.endValue,
        ),
      ).toBe("2024-03-01T09:30:00");
    });

    test("unmounts the modal once a range is applied", () => {
      renderPicker({ range: TimeRange.PAST_ONE_HOUR });
      openCustomModal();

      fireEvent.click(screen.getByText("Apply"));

      expect(screen.queryByTestId("custom-time-range-modal")).toBeNull();
    });

    test("emits nothing when the modal is cancelled", () => {
      const harness: Harness = renderPicker({ range: TimeRange.PAST_ONE_HOUR });
      openCustomModal();

      fireEvent.change(getStartInput(), {
        target: { value: "2024-03-01T08:00:00" },
      });
      fireEvent.click(screen.getByText("Cancel"));

      expect(harness.emitted).toHaveLength(0);
      expect(screen.queryByTestId("custom-time-range-modal")).toBeNull();
    });

    test("discards abandoned edits when reopened", () => {
      renderPicker({
        range: TimeRange.CUSTOM,
        startAndEndDate: new InBetween<Date>(
          new Date("2024-03-01T10:00:00.000Z"),
          new Date("2024-03-01T13:00:00.000Z"),
        ),
      });

      openCustomModal();
      fireEvent.change(getStartInput(), {
        target: { value: "2024-03-01T01:00:00" },
      });
      fireEvent.click(screen.getByText("Cancel"));

      openCustomModal();

      expect(getFieldDate(getStartInput()).getTime()).toBe(
        new Date("2024-03-01T10:00:00.000Z").getTime(),
      );
    });

    test("re-seeds from the preset selected since it was last opened", () => {
      renderPicker({ range: TimeRange.PAST_THREE_HOURS });

      openCustomModal();
      expect(minutesBetweenFields()).toBe(180);
      fireEvent.click(screen.getByText("Cancel"));

      cleanup();
      renderPicker({ range: TimeRange.PAST_ONE_DAY });
      openCustomModal();

      expect(minutesBetweenFields()).toBe(1440);
    });
  });

  describe("click outside", () => {
    test("closes the dropdown on an outside mousedown", () => {
      renderPicker({ range: TimeRange.PAST_ONE_HOUR });
      openDropdown();

      fireEvent.mouseDown(document.body);

      expect(screen.queryByTestId(`${PREFIX}-dropdown`)).toBeNull();
    });

    test("leaves the custom modal alone on an outside mousedown", () => {
      /*
       * The native date picker a `datetime-local` field opens renders outside
       * this component. While the editor lived in the dropdown, clicking a day
       * in that popup tore the whole panel down mid-edit.
       */
      renderPicker({ range: TimeRange.PAST_ONE_HOUR });
      openCustomModal();

      fireEvent.mouseDown(document.body);

      expect(screen.getByTestId("custom-time-range-modal")).toBeInTheDocument();
    });
  });
});
