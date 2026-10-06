import WorkspaceNotificationSummary from "Common/Models/DatabaseModels/WorkspaceNotificationSummary";
import OneUptimeDate from "Common/Types/Date";
import EventInterval from "Common/Types/Events/EventInterval";
import Recurring from "Common/Types/Events/Recurring";
import ObjectID from "Common/Types/ObjectID";
import PositiveNumber from "Common/Types/PositiveNumber";
import Timezone from "Common/Types/Timezone";
import WorkspaceSummaryScheduleUtil, {
  WorkspaceSummaryScheduleWrite,
} from "Common/Utils/Workspace/WorkspaceSummarySchedule";

/*
 * The worker that posts workspace summaries (recurring incident, alert and
 * episode summaries in Slack or Microsoft Teams) once a minute picks the
 * enabled summaries whose next send is due, moves each one's next send on
 * and posts it.
 *
 * The problem this pins: it moved the next send on by one interval from
 * the send that was due. A next send long past - the worker was down, or a
 * summary was dated in the past - stayed in the past after the move, so the
 * summary was posted again a minute later, and again, until the schedule
 * caught up: a weekly summary three weeks behind went out four times in
 * four minutes. Now the next send is the schedule's first occurrence after
 * now (WorkspaceSummaryScheduleUtil.getNextSendAfterDue): one interval on,
 * normally, and a summary long past is posted once.
 *
 * The job registers itself through RunCron when imported and exports
 * nothing, so the Cron util is mocked to capture the handler, as the other
 * App/Tests/Workers/Jobs suites do, and each test drives one tick.
 *
 * Dates are UTC; Monday 5 Oct 2026 is the reference week.
 */

type CronHandler = () => Promise<void>;

const mockCapturedJobs: Record<string, CronHandler> = {};

jest.mock("../../../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(
      (jobName: string, _options: unknown, runFunction: CronHandler): void => {
        mockCapturedJobs[jobName] = runFunction;
      },
    ),
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/WorkspaceNotificationSummaryService", () => {
  return {
    __esModule: true,
    default: {
      findAllBy: jest.fn(),
      updateOneById: jest.fn(),
      sendSummary: jest.fn(),
    },
  };
});

import WorkspaceNotificationSummaryService from "Common/Server/Services/WorkspaceNotificationSummaryService";
import "../../../../FeatureSet/Workers/Jobs/WorkspaceNotificationSummary/SendSummary";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

const JOB_NAME: string = "WorkspaceNotificationSummary:SendSummary";

const FIRST_SUMMARY_ID: string = "3e000000-0000-4000-8000-000000000001";
const SECOND_SUMMARY_ID: string = "3e000000-0000-4000-8000-000000000002";

type MockedService = {
  findAllBy: jest.Mock;
  updateOneById: jest.Mock;
  sendSummary: jest.Mock;
};

const service: MockedService =
  WorkspaceNotificationSummaryService as unknown as MockedService;

let now: Date = OneUptimeDate.fromString("2026-10-05T12:00:00.000Z");

function every(intervalType: EventInterval, intervalCount: number): Recurring {
  const recurring: Recurring = new Recurring();
  recurring.intervalType = intervalType;
  recurring.intervalCount = new PositiveNumber(intervalCount);
  return recurring;
}

// A summary as the worker selects it.
function summary(data: {
  id?: string | undefined;
  nextSendAt: Date;
  recurringInterval: Recurring;
  sendFirstReportAt?: Date | undefined;
  timezone?: string | undefined;
}): WorkspaceNotificationSummary {
  const workspaceSummary: WorkspaceNotificationSummary =
    new WorkspaceNotificationSummary();
  workspaceSummary._id = data.id || FIRST_SUMMARY_ID;
  workspaceSummary.nextSendAt = data.nextSendAt;
  workspaceSummary.recurringInterval = data.recurringInterval;

  if (data.sendFirstReportAt) {
    workspaceSummary.sendFirstReportAt = data.sendFirstReportAt;
  }

  if (data.timezone) {
    workspaceSummary.timezone = data.timezone as Timezone;
  }

  return workspaceSummary;
}

// The wall clock an instant reads in a zone, for readable expectations.
function wallClock(iso: string, timezone: string): string {
  return OneUptimeDate.getDateAsCustomFormattedStringInTimezone({
    date: OneUptimeDate.fromString(iso),
    format: "ddd YYYY-MM-DD HH:mm z",
    timezone: timezone,
  });
}

// One tick, at `at`, for the summaries the query finds.
async function tick(
  at: string,
  summaries: Array<WorkspaceNotificationSummary>,
): Promise<void> {
  now = OneUptimeDate.fromString(at);
  service.findAllBy.mockResolvedValueOnce(summaries as never);
  await mockCapturedJobs[JOB_NAME]!();
}

interface WrittenNextSend {
  id: string;
  nextSendAt: string;
}

// Every next send the tick wrote, in order, as ISO strings.
function writtenNextSends(): Array<WrittenNextSend> {
  return service.updateOneById.mock.calls.map(
    (call: Array<unknown>): WrittenNextSend => {
      const argument: { id: ObjectID; data: { nextSendAt: Date } } =
        call[0] as { id: ObjectID; data: { nextSendAt: Date } };

      return {
        id: argument.id.toString(),
        nextSendAt: argument.data.nextSendAt.toISOString(),
      };
    },
  );
}

// The summaries the tick posted, in order.
function postedSummaryIds(): Array<string> {
  return service.sendSummary.mock.calls.map((call: Array<unknown>): string => {
    return (call[0] as { summaryId: ObjectID }).summaryId.toString();
  });
}

beforeEach(() => {
  service.findAllBy.mockReset();
  service.updateOneById.mockReset();
  service.updateOneById.mockResolvedValue(1 as never);
  service.sendSummary.mockReset();
  service.sendSummary.mockResolvedValue(undefined as never);

  jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation((): Date => {
    return new Date(now.getTime());
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("WorkspaceNotificationSummary:SendSummary", () => {
  test("is registered", () => {
    expect(mockCapturedJobs[JOB_NAME]).toBeDefined();
  });

  test("asks only for enabled summaries whose next send is due, with their schedule", async () => {
    await tick("2026-10-12T09:00:30.000Z", []);

    const findArgument: {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
      props: Record<string, unknown>;
    } = service.findAllBy.mock.calls[0]![0] as {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
      props: Record<string, unknown>;
    };

    expect(findArgument.query["isEnabled"]).toBe(true);
    expect(findArgument.query["nextSendAt"]).toBeDefined();
    expect(findArgument.select["nextSendAt"]).toBe(true);
    expect(findArgument.select["recurringInterval"]).toBe(true);
    expect(findArgument.props["isRoot"]).toBe(true);
    expect(service.updateOneById).not.toHaveBeenCalled();
    expect(service.sendSummary).not.toHaveBeenCalled();
  });

  test("posts a summary on the default schedule the server stores, and moves it on a week", async () => {
    // What the server stores for a summary created on Monday 5 Oct with no schedule.
    const defaults: WorkspaceSummaryScheduleWrite =
      WorkspaceSummaryScheduleUtil.getCreateWrite({
        write: {},
        now: OneUptimeDate.fromString("2026-10-05T12:00:00.000Z"),
      });

    expect(defaults.nextSendAt?.toISOString()).toBe("2026-10-12T09:00:00.000Z");

    await tick("2026-10-12T09:00:30.000Z", [
      summary({
        nextSendAt: defaults.nextSendAt!,
        recurringInterval: defaults.recurringInterval!,
      }),
    ]);

    expect(writtenNextSends()).toEqual([
      { id: FIRST_SUMMARY_ID, nextSendAt: "2026-10-19T09:00:00.000Z" },
    ]);
    expect(postedSummaryIds()).toEqual([FIRST_SUMMARY_ID]);
  });

  test("moves the next send on before it posts, so a slow post is not posted twice", async () => {
    await tick("2026-10-12T09:00:30.000Z", [
      summary({
        nextSendAt: OneUptimeDate.fromString("2026-10-12T09:00:00.000Z"),
        recurringInterval: every(EventInterval.Week, 1),
      }),
    ]);

    expect(service.updateOneById).toHaveBeenCalledTimes(1);
    expect(service.sendSummary).toHaveBeenCalledTimes(1);
    expect(service.updateOneById.mock.invocationCallOrder[0]!).toBeLessThan(
      service.sendSummary.mock.invocationCallOrder[0]!,
    );
  });

  test.each([
    // [interval, count, due, tick, next send]
    [
      EventInterval.Day,
      1,
      "2026-10-06T09:00:00.000Z",
      "2026-10-06T09:00:20.000Z",
      "2026-10-07T09:00:00.000Z",
    ],
    [
      EventInterval.Week,
      2,
      "2026-10-12T09:00:00.000Z",
      "2026-10-12T09:01:00.000Z",
      "2026-10-26T09:00:00.000Z",
    ],
    [
      EventInterval.Month,
      1,
      "2026-11-01T09:00:00.000Z",
      "2026-11-01T09:00:10.000Z",
      "2026-12-01T09:00:00.000Z",
    ],
    [
      EventInterval.Hour,
      6,
      "2026-10-05T12:00:00.000Z",
      "2026-10-05T12:00:45.000Z",
      "2026-10-05T18:00:00.000Z",
    ],
  ])(
    "moves an every-%s (x%s) summary due at %s, posted at %s, on to %s",
    async (
      intervalType: EventInterval,
      intervalCount: number,
      dueAt: string,
      tickAt: string,
      expected: string,
    ) => {
      await tick(tickAt, [
        summary({
          nextSendAt: OneUptimeDate.fromString(dueAt),
          recurringInterval: every(intervalType, intervalCount),
        }),
      ]);

      expect(writtenNextSends()).toEqual([
        { id: FIRST_SUMMARY_ID, nextSendAt: expected },
      ]);
      expect(postedSummaryIds()).toEqual([FIRST_SUMMARY_ID]);
    },
  );

  test("posts a weekly summary three weeks behind once, and moves it to its next Monday 09:00, not into the past", async () => {
    // Due Monday 14 Sep; the worker was down until Monday 5 Oct, 12:00.
    await tick("2026-10-05T12:00:00.000Z", [
      summary({
        nextSendAt: OneUptimeDate.fromString("2026-09-14T09:00:00.000Z"),
        recurringInterval: every(EventInterval.Week, 1),
      }),
    ]);

    /*
     * One interval on from the due send would be 21 Sep - in the past, so
     * the next tick would post it again.
     */
    expect(writtenNextSends()).toEqual([
      { id: FIRST_SUMMARY_ID, nextSendAt: "2026-10-12T09:00:00.000Z" },
    ]);
    expect(postedSummaryIds()).toEqual([FIRST_SUMMARY_ID]);
    expect(
      OneUptimeDate.fromString(writtenNextSends()[0]!.nextSendAt).getTime(),
    ).toBeGreaterThan(now.getTime());
  });

  test("keeps a fortnightly summary's own weeks when it catches up", async () => {
    // Every other Monday from 3 Aug: 17 Aug, 31 Aug, 14 Sep, 28 Sep, 12 Oct.
    await tick("2026-10-05T12:00:00.000Z", [
      summary({
        nextSendAt: OneUptimeDate.fromString("2026-08-03T09:00:00.000Z"),
        recurringInterval: every(EventInterval.Week, 2),
      }),
    ]);

    expect(writtenNextSends()).toEqual([
      { id: FIRST_SUMMARY_ID, nextSendAt: "2026-10-12T09:00:00.000Z" },
    ]);
    expect(postedSummaryIds()).toEqual([FIRST_SUMMARY_ID]);
  });

  test("catches an every-6-hours summary up to its next slot, not to now plus 6 hours", async () => {
    // Every 6 hours from 00:00 on 1 Oct; at 12:00:30 on 5 Oct the next slot is 18:00.
    await tick("2026-10-05T12:00:30.000Z", [
      summary({
        nextSendAt: OneUptimeDate.fromString("2026-10-01T00:00:00.000Z"),
        recurringInterval: every(EventInterval.Hour, 6),
      }),
    ]);

    expect(writtenNextSends()).toEqual([
      { id: FIRST_SUMMARY_ID, nextSendAt: "2026-10-05T18:00:00.000Z" },
    ]);
  });

  test("a summary it caught up on is not due on the next tick", async () => {
    await tick("2026-10-05T12:00:00.000Z", [
      summary({
        nextSendAt: OneUptimeDate.fromString("2026-09-07T09:00:00.000Z"),
        recurringInterval: every(EventInterval.Day, 1),
      }),
    ]);

    const written: Date = OneUptimeDate.fromString(
      writtenNextSends()[0]!.nextSendAt,
    );

    expect(written.toISOString()).toBe("2026-10-06T09:00:00.000Z");

    // The query a minute later asks for next sends before then.
    const aMinuteLater: Date = OneUptimeDate.fromString(
      "2026-10-05T12:01:00.000Z",
    );
    expect(written.getTime()).toBeGreaterThan(aMinuteLater.getTime());
  });

  test("rolls the next send back to the due one when posting fails, so the next tick tries again", async () => {
    service.sendSummary.mockRejectedValueOnce(
      new Error("Slack is down") as never,
    );

    await tick("2026-10-12T09:00:30.000Z", [
      summary({
        nextSendAt: OneUptimeDate.fromString("2026-10-12T09:00:00.000Z"),
        recurringInterval: every(EventInterval.Week, 1),
      }),
    ]);

    expect(writtenNextSends()).toEqual([
      { id: FIRST_SUMMARY_ID, nextSendAt: "2026-10-19T09:00:00.000Z" },
      { id: FIRST_SUMMARY_ID, nextSendAt: "2026-10-12T09:00:00.000Z" },
    ]);
  });

  test("posts the other summaries when one fails", async () => {
    service.sendSummary.mockRejectedValueOnce(
      new Error("Slack is down") as never,
    );

    await tick("2026-10-12T09:00:30.000Z", [
      summary({
        id: FIRST_SUMMARY_ID,
        nextSendAt: OneUptimeDate.fromString("2026-10-12T09:00:00.000Z"),
        recurringInterval: every(EventInterval.Week, 1),
      }),
      summary({
        id: SECOND_SUMMARY_ID,
        nextSendAt: OneUptimeDate.fromString("2026-09-28T09:00:00.000Z"),
        recurringInterval: every(EventInterval.Week, 1),
      }),
    ]);

    expect(postedSummaryIds()).toEqual([FIRST_SUMMARY_ID, SECOND_SUMMARY_ID]);
    expect(writtenNextSends()).toEqual([
      { id: FIRST_SUMMARY_ID, nextSendAt: "2026-10-19T09:00:00.000Z" },
      { id: FIRST_SUMMARY_ID, nextSendAt: "2026-10-12T09:00:00.000Z" },
      { id: SECOND_SUMMARY_ID, nextSendAt: "2026-10-19T09:00:00.000Z" },
    ]);
  });

  test("keeps going when even the roll back fails", async () => {
    service.sendSummary.mockRejectedValueOnce(
      new Error("Slack is down") as never,
    );
    service.updateOneById
      .mockResolvedValueOnce(1 as never)
      .mockRejectedValueOnce(new Error("Database is down") as never);

    await expect(
      tick("2026-10-12T09:00:30.000Z", [
        summary({
          id: FIRST_SUMMARY_ID,
          nextSendAt: OneUptimeDate.fromString("2026-10-12T09:00:00.000Z"),
          recurringInterval: every(EventInterval.Week, 1),
        }),
        summary({
          id: SECOND_SUMMARY_ID,
          nextSendAt: OneUptimeDate.fromString("2026-10-12T09:00:00.000Z"),
          recurringInterval: every(EventInterval.Week, 1),
        }),
      ]),
    ).resolves.toBeUndefined();

    expect(postedSummaryIds()).toEqual([FIRST_SUMMARY_ID, SECOND_SUMMARY_ID]);
  });

  test("reads an interval stored as JSON, as the database hands it back", async () => {
    const stored: WorkspaceNotificationSummary = summary({
      nextSendAt: OneUptimeDate.fromString("2026-10-12T09:00:00.000Z"),
      recurringInterval: every(EventInterval.Week, 1),
    });
    (stored as unknown as { recurringInterval: unknown }).recurringInterval =
      every(EventInterval.Day, 1).toJSON();

    await tick("2026-10-12T09:00:30.000Z", [stored]);

    expect(writtenNextSends()).toEqual([
      { id: FIRST_SUMMARY_ID, nextSendAt: "2026-10-13T09:00:00.000Z" },
    ]);
  });
});

/*
 * The time of day a summary goes out at, all year: its schedule is counted
 * on its own time zone's clock. Stepped in UTC, a summary set up for 09:00
 * in Berlin went out at 08:00 there once the clocks went back on Sunday
 * 25 Oct 2026, and New York's at 08:00 after Sunday 1 Nov.
 */
describe("WorkspaceNotificationSummary:SendSummary, across a daylight saving change", () => {
  test("asks for each summary's first summary date and time zone with its schedule", async () => {
    await tick("2026-10-12T09:00:30.000Z", []);

    const findArgument: { select: Record<string, unknown> } = service.findAllBy
      .mock.calls[0]![0] as { select: Record<string, unknown> };

    expect(findArgument.select["sendFirstReportAt"]).toBe(true);
    expect(findArgument.select["timezone"]).toBe(true);
  });

  test("moves a Monday 09:00 Berlin summary to 09:00 Berlin after the clocks go back, not 08:00", async () => {
    // Created on Mon 5 Oct in Berlin with the defaults: Mondays at 09:00 there.
    const defaults: WorkspaceSummaryScheduleWrite =
      WorkspaceSummaryScheduleUtil.getCreateWrite({
        write: {},
        now: OneUptimeDate.fromString("2026-10-05T12:00:00.000Z"),
        timezone: "Europe/Berlin",
      });

    expect(defaults.timezone).toBe("Europe/Berlin");

    // Its third send, on Mon 19 Oct at 09:00 CEST.
    await tick("2026-10-19T07:00:30.000Z", [
      summary({
        nextSendAt: OneUptimeDate.fromString("2026-10-19T07:00:00.000Z"),
        recurringInterval: defaults.recurringInterval!,
        sendFirstReportAt: defaults.sendFirstReportAt!,
        timezone: defaults.timezone!,
      }),
    ]);

    expect(writtenNextSends()).toEqual([
      { id: FIRST_SUMMARY_ID, nextSendAt: "2026-10-26T08:00:00.000Z" },
    ]);
    expect(wallClock(writtenNextSends()[0]!.nextSendAt, "Europe/Berlin")).toBe(
      "Mon 2026-10-26 09:00 CET",
    );
    expect(postedSummaryIds()).toEqual([FIRST_SUMMARY_ID]);
  });

  test("moves a Monday 09:00 New York summary to 09:00 New York after the clocks go forward", async () => {
    await tick("2027-03-08T14:00:30.000Z", [
      summary({
        nextSendAt: OneUptimeDate.fromString("2027-03-08T14:00:00.000Z"),
        recurringInterval: every(EventInterval.Week, 1),
        sendFirstReportAt: OneUptimeDate.fromString(
          "2026-11-02T14:00:00.000Z",
        ),
        timezone: "America/New_York",
      }),
    ]);

    expect(
      wallClock(writtenNextSends()[0]!.nextSendAt, "America/New_York"),
    ).toBe("Mon 2027-03-15 09:00 EDT");
  });

  test("posts a daily summary at 09:00 on the day the clocks go back", async () => {
    await tick("2026-10-24T07:00:20.000Z", [
      summary({
        nextSendAt: OneUptimeDate.fromString("2026-10-24T07:00:00.000Z"),
        recurringInterval: every(EventInterval.Day, 1),
        sendFirstReportAt: OneUptimeDate.fromString(
          "2026-10-01T07:00:00.000Z",
        ),
        timezone: "Europe/Berlin",
      }),
    ]);

    expect(wallClock(writtenNextSends()[0]!.nextSendAt, "Europe/Berlin")).toBe(
      "Sun 2026-10-25 09:00 CET",
    );
  });

  test("keeps stepping a summary that names no time zone in UTC, as before", async () => {
    await tick("2026-10-19T07:00:30.000Z", [
      summary({
        nextSendAt: OneUptimeDate.fromString("2026-10-19T07:00:00.000Z"),
        recurringInterval: every(EventInterval.Week, 1),
        sendFirstReportAt: OneUptimeDate.fromString(
          "2026-10-12T07:00:00.000Z",
        ),
      }),
    ]);

    expect(writtenNextSends()).toEqual([
      { id: FIRST_SUMMARY_ID, nextSendAt: "2026-10-26T07:00:00.000Z" },
    ]);
  });

  test("brings a summary that drifted an hour while it was stepped in UTC back to its first summary's time of day", async () => {
    /*
     * First summary Mon 15 Jun 2026, 09:00 AEST in Sydney; stepped in UTC,
     * it has gone out at 10:00 there since the clocks went forward on 4 Oct.
     */
    await tick("2026-10-11T23:00:30.000Z", [
      summary({
        nextSendAt: OneUptimeDate.fromString("2026-10-11T23:00:00.000Z"),
        recurringInterval: every(EventInterval.Week, 1),
        sendFirstReportAt: OneUptimeDate.fromString(
          "2026-06-14T23:00:00.000Z",
        ),
        timezone: "Australia/Sydney",
      }),
    ]);

    expect(
      wallClock(writtenNextSends()[0]!.nextSendAt, "Australia/Sydney"),
    ).toBe("Mon 2026-10-19 09:00 AEDT");
  });

  test("keeps a monthly summary on the 31st on each month's last day", async () => {
    await tick("2027-02-28T08:00:30.000Z", [
      summary({
        nextSendAt: OneUptimeDate.fromString("2027-02-28T08:00:00.000Z"),
        recurringInterval: every(EventInterval.Month, 1),
        sendFirstReportAt: OneUptimeDate.fromString(
          "2027-01-31T08:00:00.000Z",
        ),
        timezone: "Europe/Berlin",
      }),
    ]);

    expect(wallClock(writtenNextSends()[0]!.nextSendAt, "Europe/Berlin")).toBe(
      "Wed 2027-03-31 09:00 CEST",
    );
  });

  test("rolls back to the due send when posting fails, whatever the zone", async () => {
    service.sendSummary.mockRejectedValueOnce(
      new Error("Slack is down") as never,
    );

    await tick("2026-10-19T07:00:30.000Z", [
      summary({
        nextSendAt: OneUptimeDate.fromString("2026-10-19T07:00:00.000Z"),
        recurringInterval: every(EventInterval.Week, 1),
        sendFirstReportAt: OneUptimeDate.fromString(
          "2026-10-12T07:00:00.000Z",
        ),
        timezone: "Europe/Berlin",
      }),
    ]);

    expect(writtenNextSends()).toEqual([
      { id: FIRST_SUMMARY_ID, nextSendAt: "2026-10-26T08:00:00.000Z" },
      { id: FIRST_SUMMARY_ID, nextSendAt: "2026-10-19T07:00:00.000Z" },
    ]);
  });
});
