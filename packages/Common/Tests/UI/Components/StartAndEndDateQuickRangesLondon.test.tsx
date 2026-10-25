/** @timezone Europe/London */

import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import StartAndEndDate, {
  StartAndEndDateType,
} from "../../../UI/Components/Date/StartAndEndDate";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import OneUptimeDate from "../../../Types/Date";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The time range picker's quick buttons on the day London's clocks went back
 * (01:00 UTC on 2026-10-25). Each sets a range that ends now, seconds
 * dropped, and lights up while the range is its length, which the picker
 * reads in minutes (1 day is 1,440). The day and week buttons counted
 * calendar days back, so that day 1 day set 25 hours and no button lit up;
 * they count hours now. The file runs in Europe/London (TimezoneEnvironment
 * reads the @timezone docblock), and the first test shows a calendar day
 * there is 25 hours at that moment, so the rest cannot pass in a zone that
 * did not take.
 */

const HOUR: number = 60 * 60 * 1000;

// Seconds and milliseconds are dropped from the end.
const NOW: string = "2026-10-25T03:49:30.500Z";
const END: string = "2026-10-25T03:49:00.000Z";

const QUICK_RANGES: Array<[string, number]> = [
  ["1 day", 24],
  ["1 week", 7 * 24],
  ["2 weeks", 14 * 24],
  ["3 weeks", 21 * 24],
];

const picker: (
  value: InBetween<Date>,
  onValueChanged: MockFunction,
) => React.ReactElement = (
  value: InBetween<Date>,
  onValueChanged: MockFunction,
): React.ReactElement => {
  return (
    <StartAndEndDate
      type={StartAndEndDateType.DateTime}
      value={value}
      onValueChanged={onValueChanged}
    />
  );
};

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the time range picker's quick buttons, the day the clocks go back", () => {
  test("the file runs in Europe/London, where a calendar day back from now is 25 hours", () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(
      "Europe/London",
    );

    const end: Date = new Date(END);

    expect(
      (end.getTime() - OneUptimeDate.addRemoveDays(end, -1).getTime()) / HOUR,
    ).toBe(25);
  });

  for (const [name, hours] of QUICK_RANGES) {
    test(`${name} sets the ${hours} hours up to now, and lights up`, () => {
      jest
        .spyOn(OneUptimeDate, "getCurrentDate")
        .mockReturnValue(new Date(NOW));
      const onValueChanged: MockFunction = getJestMockFunction();

      const { rerender } = render(
        picker(
          new InBetween<Date>(
            new Date("2026-10-20T00:00:00.000Z"),
            new Date(END),
          ),
          onValueChanged,
        ),
      );

      expect(screen.getByRole("button", { name: name })).not.toHaveClass(
        "bg-indigo-600",
      );

      fireEvent.click(screen.getByRole("button", { name: name }));

      expect(onValueChanged).toHaveBeenCalledTimes(1);

      const range: InBetween<Date> = onValueChanged.mock
        .calls[0]![0] as InBetween<Date>;

      expect(range.endValue.toISOString()).toBe(END);
      expect(range.endValue.getTime() - range.startValue.getTime()).toBe(
        hours * HOUR,
      );

      rerender(picker(range, onValueChanged));

      expect(screen.getByRole("button", { name: name })).toHaveClass(
        "bg-indigo-600",
      );
    });
  }
});
