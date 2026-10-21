/*
 * When a workspace summary - a recurring incident, alert or episode summary
 * posted to Slack or Microsoft Teams - goes out, and what a write creating or
 * rescheduling one has to carry.
 *
 * The problem this pins: a summary's How Often had no default, so the form
 * could not be saved until one was made up; a summary created through the
 * API without a next send was never sent at all; a first summary dated in
 * the past was sent a summary a minute until the schedule caught up; and
 * editing How Often or the first summary's date kept the next send it had.
 * Now a summary left without a schedule goes out every week, the first one
 * at 09:00 at the start of the next week, and its next send always follows
 * its schedule.
 *
 * "Now" is Monday 5 Oct 2026, 12:00 UTC: the next Monday 09:00 UTC is
 * 12 Oct.
 */

import OneUptimeDate from "../../../Types/Date";
import EventInterval from "../../../Types/Events/EventInterval";
import Recurring from "../../../Types/Events/Recurring";
import PositiveNumber from "../../../Types/PositiveNumber";
import WorkspaceSummaryScheduleUtil, {
  WorkspaceSummaryScheduleWrite,
} from "../../../Utils/Workspace/WorkspaceSummarySchedule";
import { describe, expect, test } from "@jest/globals";

const NOW: Date = OneUptimeDate.fromString("2026-10-05T12:00:00.000Z");

function every(intervalType: EventInterval, intervalCount: number): Recurring {
  const recurring: Recurring = new Recurring();
  recurring.intervalType = intervalType;
  recurring.intervalCount = new PositiveNumber(intervalCount);
  return recurring;
}

function at(iso: string): Date {
  return OneUptimeDate.fromString(iso);
}

// A write's columns, dates as ISO strings and intervals as text, for toEqual.
function describeWrite(
  write: WorkspaceSummaryScheduleWrite,
): Record<string, string | undefined> {
  const described: Record<string, string | undefined> = {};

  if (write.recurringInterval) {
    described["recurringInterval"] =
      `${write.recurringInterval.intervalCount.toNumber()} ${write.recurringInterval.intervalType}`;
  }

  if (write.sendFirstReportAt) {
    described["sendFirstReportAt"] = write.sendFirstReportAt.toISOString();
  }

  if (write.nextSendAt) {
    described["nextSendAt"] = write.nextSendAt.toISOString();
  }

  return described;
}

describe("the default schedule", () => {
  test("is every week", () => {
    const recurring: Recurring =
      WorkspaceSummaryScheduleUtil.getDefaultRecurringInterval();

    expect(recurring.intervalType).toBe(EventInterval.Week);
    expect(recurring.intervalCount.toNumber()).toBe(1);
    expect(WorkspaceSummaryScheduleUtil.DEFAULT_INTERVAL_TYPE).toBe(
      EventInterval.Week,
    );
    expect(WorkspaceSummaryScheduleUtil.DEFAULT_SEND_HOUR).toBe(9);
  });

  test("hands out a new interval each time, so changing one changes no other", () => {
    const first: Recurring =
      WorkspaceSummaryScheduleUtil.getDefaultRecurringInterval();
    first.intervalCount = new PositiveNumber(3);

    expect(
      WorkspaceSummaryScheduleUtil.getDefaultRecurringInterval().intervalCount.toNumber(),
    ).toBe(1);
  });

  test.each([
    // [interval, timezone, first summary]
    [EventInterval.Week, undefined, "2026-10-12T09:00:00.000Z"],
    [EventInterval.Day, undefined, "2026-10-06T09:00:00.000Z"],
    [EventInterval.Month, undefined, "2026-11-01T09:00:00.000Z"],
    [EventInterval.Year, undefined, "2027-01-01T09:00:00.000Z"],
    [EventInterval.Hour, undefined, "2026-10-05T13:00:00.000Z"],
    // 09:00 on the wall clock there: 07:00 UTC in Berlin (CEST).
    [EventInterval.Week, "Europe/Berlin", "2026-10-12T07:00:00.000Z"],
    // 08:00 in New York: this Monday's 09:00 is still ahead.
    [EventInterval.Week, "America/New_York", "2026-10-05T13:00:00.000Z"],
    // A zone moment does not know reads as UTC.
    [EventInterval.Week, "Mars/Olympus_Mons", "2026-10-12T09:00:00.000Z"],
  ])(
    "starts a %s summary in %s at %s",
    (
      intervalType: EventInterval,
      timezone: string | undefined,
      expected: string,
    ) => {
      expect(
        WorkspaceSummaryScheduleUtil.getDefaultFirstSendDate({
          timezone: timezone,
          after: NOW,
          intervalType: intervalType,
        }).toISOString(),
      ).toBe(expected);
    },
  );

  test("starts weekly when told no interval", () => {
    expect(
      WorkspaceSummaryScheduleUtil.getDefaultFirstSendDate({
        after: NOW,
      }).toISOString(),
    ).toBe("2026-10-12T09:00:00.000Z");
  });

  test("keeps 09:00 on the wall clock across a daylight saving change", () => {
    // Berlin leaves summer time on Sunday 25 Oct 2026.
    expect(
      WorkspaceSummaryScheduleUtil.getDefaultFirstSendDate({
        timezone: "Europe/Berlin",
        after: at("2026-10-20T12:00:00.000Z"),
        intervalType: EventInterval.Week,
      }).toISOString(),
    ).toBe("2026-10-26T08:00:00.000Z");
  });
});

describe("the next send of a schedule", () => {
  test("is nothing without both halves", () => {
    expect(
      WorkspaceSummaryScheduleUtil.getNextSendDate({
        sendFirstReportAt: undefined,
        recurringInterval: every(EventInterval.Week, 1),
        now: NOW,
      }),
    ).toBeUndefined();
    expect(
      WorkspaceSummaryScheduleUtil.getNextSendDate({
        sendFirstReportAt: at("2026-10-12T09:00:00.000Z"),
        recurringInterval: undefined,
        now: NOW,
      }),
    ).toBeUndefined();
  });

  test("is the first summary while that is ahead", () => {
    expect(
      WorkspaceSummaryScheduleUtil.getNextSendDate({
        sendFirstReportAt: at("2026-10-20T15:30:00.000Z"),
        recurringInterval: every(EventInterval.Day, 1),
        now: NOW,
      })?.toISOString(),
    ).toBe("2026-10-20T15:30:00.000Z");
  });

  test("is the first occurrence after now for a first summary in the past", () => {
    // Tuesdays at 10:00, from 1 Sep: the next one is Tuesday 6 Oct.
    expect(
      WorkspaceSummaryScheduleUtil.getNextSendDate({
        sendFirstReportAt: at("2026-09-01T10:00:00.000Z"),
        recurringInterval: every(EventInterval.Week, 1),
        now: NOW,
      })?.toISOString(),
    ).toBe("2026-10-06T10:00:00.000Z");
  });

  test("never answers now itself: an occurrence at this instant is past", () => {
    expect(
      WorkspaceSummaryScheduleUtil.getNextSendDate({
        sendFirstReportAt: NOW,
        recurringInterval: every(EventInterval.Day, 1),
        now: NOW,
      })?.toISOString(),
    ).toBe("2026-10-06T12:00:00.000Z");
  });

  test("keeps a monthly summary on the 1st", () => {
    expect(
      WorkspaceSummaryScheduleUtil.getNextSendDate({
        sendFirstReportAt: at("2026-01-01T09:00:00.000Z"),
        recurringInterval: every(EventInterval.Month, 1),
        now: NOW,
      })?.toISOString(),
    ).toBe("2026-11-01T09:00:00.000Z");
  });

  test("reads a schedule stored as JSON as well as one in hand", () => {
    expect(
      WorkspaceSummaryScheduleUtil.getNextSendDate({
        sendFirstReportAt: "2026-09-01T10:00:00.000Z",
        recurringInterval: every(EventInterval.Week, 2).toJSON(),
        now: NOW,
      })?.toISOString(),
    ).toBe("2026-10-13T10:00:00.000Z");
  });
});

describe("what a write that cannot be stored says", () => {
  test("names a first summary date that is not one", () => {
    expect(
      WorkspaceSummaryScheduleUtil.getWriteProblem({
        sendFirstReportAt: "next tuesday",
      }),
    ).toContain("sendFirstReportAt is not a date and time");
  });

  test("names an interval that is not one", () => {
    expect(
      WorkspaceSummaryScheduleUtil.getWriteProblem({
        recurringInterval: { _type: "Recurring" },
      }),
    ).toContain("recurringInterval is not a recurring interval");
    expect(
      WorkspaceSummaryScheduleUtil.getWriteProblem({
        recurringInterval: {
          _type: "Recurring",
          value: { intervalType: "Fortnight", intervalCount: 1 },
        },
      }),
    ).toContain("recurringInterval is not a recurring interval");
  });

  test("has nothing to say about a schedule left out, cleared or readable", () => {
    expect(WorkspaceSummaryScheduleUtil.getWriteProblem({})).toBeNull();
    expect(
      WorkspaceSummaryScheduleUtil.getWriteProblem({
        sendFirstReportAt: null,
        recurringInterval: null,
      }),
    ).toBeNull();
    expect(
      WorkspaceSummaryScheduleUtil.getWriteProblem({ sendFirstReportAt: "" }),
    ).toBeNull();
    expect(
      WorkspaceSummaryScheduleUtil.getWriteProblem({
        sendFirstReportAt: "2026-10-12T09:00:00.000Z",
        recurringInterval: every(EventInterval.Day, 1).toJSON(),
      }),
    ).toBeNull();
  });
});

describe("a new summary", () => {
  test("left without a schedule goes out every week, the first next Monday at 09:00", () => {
    expect(
      describeWrite(
        WorkspaceSummaryScheduleUtil.getCreateWrite({ write: {}, now: NOW }),
      ),
    ).toEqual({
      recurringInterval: "1 Week",
      sendFirstReportAt: "2026-10-12T09:00:00.000Z",
      nextSendAt: "2026-10-12T09:00:00.000Z",
    });
  });

  test("reads 09:00 in the time zone it is given", () => {
    expect(
      describeWrite(
        WorkspaceSummaryScheduleUtil.getCreateWrite({
          write: {},
          now: NOW,
          timezone: "Europe/Berlin",
        }),
      ),
    ).toEqual({
      recurringInterval: "1 Week",
      sendFirstReportAt: "2026-10-12T07:00:00.000Z",
      nextSendAt: "2026-10-12T07:00:00.000Z",
    });
  });

  test("with how often but no first summary starts at the next period of that interval", () => {
    expect(
      describeWrite(
        WorkspaceSummaryScheduleUtil.getCreateWrite({
          write: { recurringInterval: every(EventInterval.Day, 1) },
          now: NOW,
        }),
      ),
    ).toEqual({
      sendFirstReportAt: "2026-10-06T09:00:00.000Z",
      nextSendAt: "2026-10-06T09:00:00.000Z",
    });
  });

  test("keeps the first summary it was given, and sends it then", () => {
    expect(
      describeWrite(
        WorkspaceSummaryScheduleUtil.getCreateWrite({
          write: {
            recurringInterval: every(EventInterval.Week, 1),
            sendFirstReportAt: at("2026-10-07T16:45:00.000Z"),
          },
          now: NOW,
        }),
      ),
    ).toEqual({ nextSendAt: "2026-10-07T16:45:00.000Z" });
  });

  test("with a first summary in the past goes out at the next occurrence, not now", () => {
    expect(
      describeWrite(
        WorkspaceSummaryScheduleUtil.getCreateWrite({
          write: {
            recurringInterval: every(EventInterval.Week, 1),
            sendFirstReportAt: "2026-09-01T10:00:00.000Z",
          },
          now: NOW,
        }),
      ),
    ).toEqual({ nextSendAt: "2026-10-06T10:00:00.000Z" });
  });

  test("keeps a next send the caller set itself", () => {
    expect(
      describeWrite(
        WorkspaceSummaryScheduleUtil.getCreateWrite({
          write: {
            recurringInterval: every(EventInterval.Week, 1),
            sendFirstReportAt: at("2026-10-12T09:00:00.000Z"),
            nextSendAt: at("2026-10-05T12:30:00.000Z"),
          },
          now: NOW,
        }),
      ),
    ).toEqual({});
  });

  test("a schedule read from its JSON needs nothing added", () => {
    expect(
      describeWrite(
        WorkspaceSummaryScheduleUtil.getCreateWrite({
          write: {
            recurringInterval: every(EventInterval.Month, 1).toJSON(),
            sendFirstReportAt: "2026-11-01T09:00:00.000Z",
          },
          now: NOW,
        }),
      ),
    ).toEqual({ nextSendAt: "2026-11-01T09:00:00.000Z" });
  });
});

describe("an update of a summary", () => {
  const STORED_WEEKLY: {
    recurringInterval: Recurring;
    sendFirstReportAt: Date;
    nextSendAt: Date;
  } = {
    recurringInterval: every(EventInterval.Week, 1),
    sendFirstReportAt: at("2026-09-07T09:00:00.000Z"),
    nextSendAt: at("2026-10-12T09:00:00.000Z"),
  };

  test("that leaves the schedule out adds nothing", () => {
    expect(
      WorkspaceSummaryScheduleUtil.isScheduleWrite({ nextSendAt: NOW }),
    ).toBe(false);
    expect(
      WorkspaceSummaryScheduleUtil.getUpdateWrite({
        write: {},
        stored: STORED_WEEKLY,
        now: NOW,
      }),
    ).toEqual({});
  });

  test("from the report worker, which moves the next send itself, adds nothing", () => {
    expect(
      WorkspaceSummaryScheduleUtil.getUpdateWrite({
        write: {
          recurringInterval: every(EventInterval.Day, 1),
          nextSendAt: at("2026-10-19T09:00:00.000Z"),
        },
        stored: STORED_WEEKLY,
        now: NOW,
      }),
    ).toEqual({});
  });

  test("that sends the schedule back unchanged - the edit form's every save - adds nothing", () => {
    expect(
      WorkspaceSummaryScheduleUtil.isScheduleWrite({
        recurringInterval: every(EventInterval.Week, 1).toJSON(),
        sendFirstReportAt: "2026-09-07T09:00:00.000Z",
      }),
    ).toBe(true);
    expect(
      WorkspaceSummaryScheduleUtil.getUpdateWrite({
        write: {
          recurringInterval: every(EventInterval.Week, 1).toJSON(),
          sendFirstReportAt: "2026-09-07T09:00:00.000Z",
        },
        stored: STORED_WEEKLY,
        now: NOW,
      }),
    ).toEqual({});
  });

  test("that makes it daily goes out at the next daily occurrence of its first summary", () => {
    expect(
      describeWrite(
        WorkspaceSummaryScheduleUtil.getUpdateWrite({
          write: { recurringInterval: every(EventInterval.Day, 1) },
          stored: STORED_WEEKLY,
          now: NOW,
        }),
      ),
    ).toEqual({ nextSendAt: "2026-10-06T09:00:00.000Z" });
  });

  test("that moves the first summary later sends it then", () => {
    expect(
      describeWrite(
        WorkspaceSummaryScheduleUtil.getUpdateWrite({
          write: { sendFirstReportAt: at("2026-10-21T17:00:00.000Z") },
          stored: STORED_WEEKLY,
          now: NOW,
        }),
      ),
    ).toEqual({ nextSendAt: "2026-10-21T17:00:00.000Z" });
  });

  test("of a summary with no first summary date keeps the time of day of the send it has coming", () => {
    // Made before the dashboard sent a first summary: due Friday at 14:37.
    expect(
      describeWrite(
        WorkspaceSummaryScheduleUtil.getUpdateWrite({
          write: { recurringInterval: every(EventInterval.Day, 1) },
          stored: {
            recurringInterval: every(EventInterval.Week, 1),
            sendFirstReportAt: null,
            nextSendAt: at("2026-10-09T14:37:00.000Z"),
          },
          now: NOW,
        }),
      ),
    ).toEqual({ nextSendAt: "2026-10-05T14:37:00.000Z" });
  });

  test("of a summary whose send it had coming has passed moves on from it", () => {
    expect(
      describeWrite(
        WorkspaceSummaryScheduleUtil.getUpdateWrite({
          write: { recurringInterval: every(EventInterval.Week, 2) },
          stored: {
            recurringInterval: every(EventInterval.Week, 1),
            sendFirstReportAt: null,
            nextSendAt: at("2026-09-28T08:00:00.000Z"),
          },
          now: NOW,
        }),
      ),
    ).toEqual({ nextSendAt: "2026-10-12T08:00:00.000Z" });
  });

  test("of a summary with nothing coming at all starts at the default first summary", () => {
    expect(
      describeWrite(
        WorkspaceSummaryScheduleUtil.getUpdateWrite({
          write: { recurringInterval: every(EventInterval.Month, 1) },
          stored: {
            recurringInterval: every(EventInterval.Week, 1),
            sendFirstReportAt: null,
            nextSendAt: null,
          },
          now: NOW,
        }),
      ),
    ).toEqual({ nextSendAt: "2026-11-01T09:00:00.000Z" });
  });

  test("that clears the first summary date keeps the send it had coming", () => {
    expect(
      describeWrite(
        WorkspaceSummaryScheduleUtil.getUpdateWrite({
          write: { sendFirstReportAt: null },
          stored: STORED_WEEKLY,
          now: NOW,
        }),
      ),
    ).toEqual({ nextSendAt: "2026-10-12T09:00:00.000Z" });
  });

  test("with an interval that cannot be read adds nothing (the write is refused first)", () => {
    expect(
      WorkspaceSummaryScheduleUtil.getUpdateWrite({
        write: { recurringInterval: { _type: "Recurring" } },
        stored: STORED_WEEKLY,
        now: NOW,
      }),
    ).toEqual({});
  });
});

describe("switching a summary back on", () => {
  const STORED_WEEKLY_ON: {
    recurringInterval: Recurring;
    sendFirstReportAt: Date;
    nextSendAt: Date;
    isEnabled: boolean;
  } = {
    recurringInterval: every(EventInterval.Week, 1),
    sendFirstReportAt: at("2026-09-07T09:00:00.000Z"),
    nextSendAt: at("2026-10-12T09:00:00.000Z"),
    isEnabled: true,
  };

  test("is an update that may move the next send; switching it off is not", () => {
    expect(
      WorkspaceSummaryScheduleUtil.isRescheduleWrite({ isEnabled: true }),
    ).toBe(true);
    expect(
      WorkspaceSummaryScheduleUtil.isRescheduleWrite({ isEnabled: false }),
    ).toBe(false);
    expect(WorkspaceSummaryScheduleUtil.isRescheduleWrite({})).toBe(false);
  });

  test("after months off sends at the schedule's next occurrence, not at once for the time it missed", () => {
    expect(
      describeWrite(
        WorkspaceSummaryScheduleUtil.getUpdateWrite({
          write: { isEnabled: true },
          stored: {
            recurringInterval: every(EventInterval.Week, 1),
            sendFirstReportAt: at("2026-06-01T09:00:00.000Z"),
            nextSendAt: at("2026-07-06T09:00:00.000Z"),
            isEnabled: false,
          },
          now: NOW,
        }),
      ),
    ).toEqual({ nextSendAt: "2026-10-12T09:00:00.000Z" });
  });

  test("with no first summary date of its own keeps the time of day it had", () => {
    expect(
      describeWrite(
        WorkspaceSummaryScheduleUtil.getUpdateWrite({
          write: { isEnabled: true },
          stored: {
            recurringInterval: every(EventInterval.Day, 1),
            sendFirstReportAt: null,
            nextSendAt: at("2026-08-01T15:20:00.000Z"),
            isEnabled: false,
          },
          now: NOW,
        }),
      ),
    ).toEqual({ nextSendAt: "2026-10-05T15:20:00.000Z" });
  });

  test("that was on already - every save of the edit form - adds nothing", () => {
    expect(
      WorkspaceSummaryScheduleUtil.getUpdateWrite({
        write: { isEnabled: true },
        stored: STORED_WEEKLY_ON,
        now: NOW,
      }),
    ).toEqual({});
  });

  test("switching it off adds nothing: an off summary is not sent at all", () => {
    expect(
      WorkspaceSummaryScheduleUtil.getUpdateWrite({
        write: { isEnabled: false },
        stored: STORED_WEEKLY_ON,
        now: NOW,
      }),
    ).toEqual({});
  });
});

describe("the report worker's next send, once it has sent", () => {
  test("is one interval on from the send that was due", () => {
    expect(
      WorkspaceSummaryScheduleUtil.getNextSendAfterDue({
        dueAt: at("2026-10-05T11:59:00.000Z"),
        recurringInterval: every(EventInterval.Week, 1),
        now: NOW,
      }).toISOString(),
    ).toBe("2026-10-12T11:59:00.000Z");
  });

  test("is the next occurrence still ahead after a send long past - one summary, not a burst", () => {
    // Due three months ago: a weekly summary at Monday 09:00.
    expect(
      WorkspaceSummaryScheduleUtil.getNextSendAfterDue({
        dueAt: at("2026-07-06T09:00:00.000Z"),
        recurringInterval: every(EventInterval.Week, 1),
        now: NOW,
      }).toISOString(),
    ).toBe("2026-10-12T09:00:00.000Z");
  });

  test("keeps a monthly summary on its day", () => {
    expect(
      WorkspaceSummaryScheduleUtil.getNextSendAfterDue({
        dueAt: at("2026-10-01T09:00:00.000Z"),
        recurringInterval: every(EventInterval.Month, 1).toJSON(),
        now: NOW,
      }).toISOString(),
    ).toBe("2026-11-01T09:00:00.000Z");
  });

  test("throws for an interval that cannot be read, which the worker retries", () => {
    expect(() => {
      WorkspaceSummaryScheduleUtil.getNextSendAfterDue({
        dueAt: at("2026-10-05T11:59:00.000Z"),
        recurringInterval: { _type: "Recurring" },
        now: NOW,
      });
    }).toThrow();
  });
});
