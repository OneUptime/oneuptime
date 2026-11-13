import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import CustomTimeRangeModal from "../../../UI/Components/Date/CustomTimeRangeModal";
import StartAndEndDate, {
  StartAndEndDateType,
} from "../../../UI/Components/Date/StartAndEndDate";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import OneUptimeDate from "../../../Types/Date";
import Timezone from "../../../Types/Timezone";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * THE ONE PLACE A DATE AND TIME FIELD KEEPS ITS SECONDS: A TELEMETRY TIME
 * RANGE (issue #7593).
 *
 * Times people schedule or record something at are picked to the minute.
 * A telemetry range is read against the timestamps of logs, traces and
 * metrics, and one narrowed around an error or a span is seconds wide, so
 * its From and To opt in to seconds (MinutePickersGuard lists them, with
 * that reason). These pin that they still show, ask for and hand back the
 * seconds - and that a date-only range does not.
 */

// 10:00:42 and 10:01:07 UTC.
const FROM: Date = new Date("2026-03-01T10:00:42.000Z");
const TO: Date = new Date("2026-03-01T10:01:07.000Z");

// A field stepping by the second holds "10:00:42", which jsdom may write with ".000".
function withSeconds(wallClock: string): RegExp {
  return new RegExp(`^${wallClock}(\\.000)?$`);
}

beforeEach(() => {
  OneUptimeDate.setUserTimezone(Timezone.UTC);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  OneUptimeDate.setUserTimezone(null);
});

describe("the custom range of a telemetry time range picker", () => {
  function renderModal(onSave: MockFunction): void {
    render(
      <CustomTimeRangeModal
        initialValue={new InBetween<Date>(FROM, TO)}
        onClose={getJestMockFunction()}
        onSave={onSave}
      />,
    );
  }

  function from(): HTMLInputElement {
    return screen.getByTestId<HTMLInputElement>("custom-time-range-start");
  }

  function to(): HTMLInputElement {
    return screen.getByTestId<HTMLInputElement>("custom-time-range-end");
  }

  test("shows the seconds of its From and To, and steps by the second", () => {
    renderModal(getJestMockFunction());

    expect(from().value).toMatch(withSeconds("2026-03-01T10:00:42"));
    expect(to().value).toMatch(withSeconds("2026-03-01T10:01:07"));
    expect(from()).toHaveAttribute("step", "1");
    expect(to()).toHaveAttribute("step", "1");
  });

  test("applies a range seconds wide, to the second", () => {
    const onSave: MockFunction = getJestMockFunction();
    renderModal(onSave);

    fireEvent.change(from(), { target: { value: "2026-03-01T10:00:50" } });
    fireEvent.change(to(), { target: { value: "2026-03-01T10:00:55" } });
    fireEvent.click(screen.getByText("Apply").closest("button")!);

    expect(onSave).toHaveBeenCalledTimes(1);

    const saved: InBetween<Date> = onSave.mock.calls[0]![0] as InBetween<Date>;

    expect(OneUptimeDate.fromString(saved.startValue).toISOString()).toBe(
      "2026-03-01T10:00:50.000Z",
    );
    expect(OneUptimeDate.fromString(saved.endValue).toISOString()).toBe(
      "2026-03-01T10:00:55.000Z",
    );
  });
});

describe("From and To of a telemetry time range", () => {
  test("a date and time range shows and steps by the second", () => {
    render(
      <StartAndEndDate
        type={StartAndEndDateType.DateTime}
        value={new InBetween<Date>(FROM, TO)}
        onValueChanged={getJestMockFunction()}
        hideTimeButtons={true}
      />,
    );

    const fields: Array<HTMLInputElement> = Array.from(
      document.querySelectorAll<HTMLInputElement>(
        'input[type="datetime-local"]',
      ),
    );

    expect(fields).toHaveLength(2);
    expect(fields[0]!.value).toMatch(withSeconds("2026-03-01T10:00:42"));
    expect(fields[1]!.value).toMatch(withSeconds("2026-03-01T10:01:07"));
    for (const field of fields) {
      expect(field).toHaveAttribute("step", "1");
    }
  });

  test("a date range asks for days only", () => {
    render(
      <StartAndEndDate
        type={StartAndEndDateType.Date}
        value={new InBetween<Date>(FROM, TO)}
        onValueChanged={getJestMockFunction()}
        hideTimeButtons={true}
      />,
    );

    const fields: Array<HTMLInputElement> = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[type="date"]'),
    );

    expect(fields).toHaveLength(2);
    expect(fields[0]!.value).toBe("2026-03-01");
    for (const field of fields) {
      expect(field).not.toHaveAttribute("step");
    }
    expect(
      document.querySelectorAll('input[type="datetime-local"]'),
    ).toHaveLength(0);
  });
});
