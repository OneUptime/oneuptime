/** @timezone Asia/Kolkata */

import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import LayerDateTimeFieldElement from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/LayerDateTimeFieldElement";
import RestrictionTimesFieldElement from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/RestrictionTimesFieldElement";
import OneUptimeDate, { Moment } from "../../../Types/Date";
import RestrictionTimes, {
  RestrictionType,
} from "../../../Types/OnCallDutyPolicy/RestrictionTimes";
import Timezone from "../../../Types/Timezone";

/*
 * The schedule's time inputs, for a user whose User Settings zone (New York)
 * is not the browser's (India, see the docblock).
 *
 * The schedule preview grid shifts its Dates with the BROWSER-local wall-clock
 * helpers, because react-big-calendar draws in the browser's zone. These
 * inputs must not follow it. The datetime-local Input and the TimePicker read
 * and write their wall clocks in OneUptimeDate's current timezone, which is
 * the settings zone. So the rotation-start / hand-off field and the
 * restriction times stay on the current-timezone helpers
 * (getLocalDateFromWallClockInTimezone and its inverse). These tests lock that
 * in: either way round, the admin sees and enters the schedule zone's wall
 * clock. The browser-local helpers would put both fields off by nine and a
 * half hours.
 */

const SETTINGS_ZONE: Timezone = Timezone.AmericaNew_York;
const SCHEDULE_TIMEZONE: string = "Asia/Singapore";

// An instant given as a wall clock in the schedule's zone, e.g. "2026-09-23 09:00".
function inSchedule(wallClock: string): Date {
  return Moment.tz(wallClock, "YYYY-MM-DD HH:mm", SCHEDULE_TIMEZONE).toDate();
}

function wallClockInSchedule(date: Date): string {
  return Moment.tz(date, SCHEDULE_TIMEZONE).format("YYYY-MM-DD HH:mm");
}

function dailyRestriction(from: string, to: string): RestrictionTimes {
  const restrictionTimes: RestrictionTimes = new RestrictionTimes();
  restrictionTimes.restictionType = RestrictionType.Daily;
  restrictionTimes.dayRestrictionTimes = {
    startTime: inSchedule(`2026-09-23 ${from}`),
    endTime: inSchedule(`2026-09-23 ${to}`),
  };
  restrictionTimes.weeklyRestrictionTimes = [];
  return restrictionTimes;
}

function getInputValue(element: HTMLElement): string {
  return (element as HTMLInputElement).value;
}

beforeEach(() => {
  OneUptimeDate.setUserTimezone(SETTINGS_ZONE);
  // A 24-hour picker whatever the machine's locale, so hours read back as typed.
  jest
    .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
    .mockReturnValue(false);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  OneUptimeDate.setUserTimezone(null);
});

describe("The schedule's time inputs keep to the settings zone the pickers render in", () => {
  test("the test really does run with a settings zone that is neither the browser's nor the schedule's", () => {
    expect(OneUptimeDate.getCurrentTimezone()).toBe(SETTINGS_ZONE);
    expect(new Date(2026, 8, 23, 9, 0, 0).getTimezoneOffset()).toBe(-330);
  });

  test("the rotation-start / hand-off field shows a stored time at the schedule zone's clock", () => {
    render(
      <LayerDateTimeFieldElement
        dataTestId="hand-off"
        value={inSchedule("2026-09-23 09:00")}
        timezone={SCHEDULE_TIMEZONE}
      />,
    );

    /*
     * The browser-local helper would have shown 23:30 the evening before:
     * a Date reading 09:00 in India, which the Input reads in New York.
     */
    expect(getInputValue(screen.getByTestId("hand-off"))).toBe(
      "2026-09-23T09:00",
    );
  });

  test("the rotation-start / hand-off field stores a typed time as that wall clock in the schedule zone", () => {
    const onChange: MockFunction = getJestMockFunction();

    render(
      <LayerDateTimeFieldElement
        dataTestId="hand-off"
        value={inSchedule("2026-09-23 09:00")}
        timezone={SCHEDULE_TIMEZONE}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByTestId("hand-off"), {
      target: { value: "2026-09-23T10:30" },
    });

    /*
     * The Input resolves the typed wall clock in New York. The browser-local
     * helper would then have read it at India's clock and stored 20:00.
     */
    expect(onChange).toHaveBeenCalledTimes(1);
    const stored: Date = onChange.mock.calls[0]![0] as Date;
    expect(wallClockInSchedule(stored)).toBe("2026-09-23 10:30");
  });

  test("the restriction time pickers show stored times at the schedule zone's clock", () => {
    render(
      <RestrictionTimesFieldElement
        value={dailyRestriction("09:00", "11:30")}
        timezone={SCHEDULE_TIMEZONE}
      />,
    );

    const hours: Array<string> = screen
      .getAllByLabelText("Hours")
      .map(getInputValue);
    const minutes: Array<string> = screen
      .getAllByLabelText("Minutes")
      .map(getInputValue);

    expect(hours).toEqual(["09", "11"]);
    expect(minutes).toEqual(["00", "30"]);
  });

  test("a restriction time typed into the picker is stored as that wall clock in the schedule zone", async () => {
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
    const onChange: MockFunction = getJestMockFunction();

    render(
      <RestrictionTimesFieldElement
        value={dailyRestriction("09:00", "11:30")}
        timezone={SCHEDULE_TIMEZONE}
        onChange={onChange}
      />,
    );

    /*
     * Type an absolute time rather than nudging the one shown. A nudge
     * round-trips through whichever pair of helpers the field uses, since each
     * pair's display and store steps undo each other, so it could not tell
     * the two pairs apart.
     */
    await user.click(screen.getAllByLabelText("Hours")[0]!);
    const dialog: HTMLElement = screen.getByRole("dialog", {
      name: "Select time",
    });
    fireEvent.change(within(dialog).getByLabelText("Hours"), {
      target: { value: "14" },
    });
    fireEvent.change(within(dialog).getByLabelText("Minutes"), {
      target: { value: "15" },
    });
    await user.click(within(dialog).getByRole("button", { name: "Apply" }));

    /*
     * The picker builds 14:15 on New York's clock. The browser-local helper
     * would have read that Date on India's clock instead, which is nine and a
     * half or ten and a half hours later, and stored that.
     */
    expect(onChange).toHaveBeenCalled();
    const restrictionTimes: RestrictionTimes = onChange.mock.calls[
      onChange.mock.calls.length - 1
    ]![0] as RestrictionTimes;
    expect(
      wallClockInSchedule(restrictionTimes.dayRestrictionTimes!.startTime),
    ).toMatch(/ 14:15$/);
  });
});
