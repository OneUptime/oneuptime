import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import WorkspaceSummaryFirstSendPreview, {
  WORKSPACE_SUMMARY_FIRST_SEND_TEMPLATE,
  WORKSPACE_SUMMARY_FIRST_SEND_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/WorkspaceSummaryFirstSendPreview";
import OneUptimeDate from "../../../Types/Date";
import EventInterval from "../../../Types/Events/EventInterval";
import Recurring from "../../../Types/Events/Recurring";
import PositiveNumber from "../../../Types/PositiveNumber";
import WorkspaceSummaryScheduleUtil from "../../../Utils/Workspace/WorkspaceSummarySchedule";
import { getJestSpyOn } from "../../Spy";

/*
 * The sentence under a new workspace summary's "Send First Report At": when
 * the first summary goes out, worked out the way the server will on save.
 * Leaving the date empty used to mean "a whole interval from the moment you
 * save"; it now means 09:00 at the start of the next week (or day, or
 * month) in the creator's time zone, and the form says which day that is.
 *
 * "Now" is Monday 5 Oct 2026, 12:00 UTC; the creator is in Berlin (CEST).
 */

const NOW: Date = OneUptimeDate.fromString("2026-10-05T12:00:00.000Z");

function every(intervalType: EventInterval, intervalCount: number): Recurring {
  const recurring: Recurring = new Recurring();
  recurring.intervalType = intervalType;
  recurring.intervalCount = new PositiveNumber(intervalCount);
  return recurring;
}

function sentence(): string | null {
  return (
    screen.queryByTestId(WORKSPACE_SUMMARY_FIRST_SEND_TEST_ID)?.textContent ||
    null
  );
}

beforeEach(() => {
  getJestSpyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
  getJestSpyOn(OneUptimeDate, "getCurrentTimezone").mockReturnValue(
    "Europe/Berlin",
  );
  getJestSpyOn(OneUptimeDate, "getUserPrefers12HourFormat").mockReturnValue(
    false,
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the first summary's sentence", () => {
  test("is one translatable sentence with the date in it", () => {
    expect(WORKSPACE_SUMMARY_FIRST_SEND_TEMPLATE).toBe(
      "The first summary goes out {{date}}.",
    );
  });

  test("with nothing picked says next Monday at 09:00, the creator's time", () => {
    render(<WorkspaceSummaryFirstSendPreview />);

    expect(sentence()).toBe(
      "The first summary goes out Mon, Oct 12, 2026, 09:00 CEST.",
    );
  });

  test("follows How Often: tomorrow for a daily summary, the 1st for a monthly one", () => {
    const { rerender } = render(
      <WorkspaceSummaryFirstSendPreview
        recurringInterval={every(EventInterval.Day, 1)}
      />,
    );

    expect(sentence()).toBe(
      "The first summary goes out Tue, Oct 6, 2026, 09:00 CEST.",
    );

    rerender(
      <WorkspaceSummaryFirstSendPreview
        recurringInterval={every(EventInterval.Month, 1)}
      />,
    );

    // Back on standard time by then.
    expect(sentence()).toBe(
      "The first summary goes out Sun, Nov 1, 2026, 09:00 CET.",
    );
  });

  test("reads How Often in either shape the form holds it in", () => {
    render(
      <WorkspaceSummaryFirstSendPreview
        recurringInterval={every(EventInterval.Day, 1).toJSON()}
      />,
    );

    expect(sentence()).toBe(
      "The first summary goes out Tue, Oct 6, 2026, 09:00 CEST.",
    );
  });

  test("says the date picked, when it is ahead", () => {
    render(
      <WorkspaceSummaryFirstSendPreview
        recurringInterval={every(EventInterval.Week, 1)}
        sendFirstReportAt={OneUptimeDate.fromString("2026-10-08T14:30:00.000Z")}
      />,
    );

    expect(sentence()).toBe(
      "The first summary goes out Thu, Oct 8, 2026, 16:30 CEST.",
    );
  });

  test("moves a date already past to the schedule's next occurrence", () => {
    // Tuesdays at 10:00 UTC since 1 Sep: next Tuesday, 12:00 in Berlin.
    render(
      <WorkspaceSummaryFirstSendPreview
        recurringInterval={every(EventInterval.Week, 1)}
        sendFirstReportAt="2026-09-01T10:00:00.000Z"
      />,
    );

    expect(sentence()).toBe(
      "The first summary goes out Tue, Oct 6, 2026, 12:00 CEST.",
    );
  });

  test("says what the server will store", () => {
    render(<WorkspaceSummaryFirstSendPreview />);

    const stored: Date | undefined =
      WorkspaceSummaryScheduleUtil.getCreateWrite({
        write: {
          sendFirstReportAt:
            WorkspaceSummaryScheduleUtil.getDefaultFirstSendDate({
              timezone: "Europe/Berlin",
              after: NOW,
            }),
        },
        now: NOW,
      }).nextSendAt;

    expect(stored?.toISOString()).toBe("2026-10-12T07:00:00.000Z");
    expect(sentence()).toContain("Oct 12, 2026, 09:00 CEST");
  });

  test("says nothing for a summary already saved: its next send is in the list", () => {
    render(
      <WorkspaceSummaryFirstSendPreview
        isSaved={true}
        recurringInterval={every(EventInterval.Week, 1)}
      />,
    );

    expect(sentence()).toBeNull();
  });
});
