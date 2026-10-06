/*
 * A workspace summary - the recurring incident, alert or episode summary
 * posted to Slack or Microsoft Teams - goes out at the same time of day all
 * year, in its own time zone.
 *
 * The problem this pins: a summary's schedule stepped in UTC calendar units,
 * as it had no time zone. A summary set up for 09:00 in Berlin (07:00 UTC in
 * summer) went out at 07:00 UTC every week - 08:00 in Berlin once the clocks
 * went back on 25 Oct 2026, and an hour late again after they went forward.
 * A summary now has a time zone (WorkspaceNotificationSummary.timezone), and
 * every step - the default first summary, the next send, the one after a
 * send, a reschedule - is counted on that zone's wall clock. A summary that
 * names none is read in UTC, as every summary was before.
 *
 * The clocks change, in the cases below:
 *   - Berlin: back on Sun 25 Oct 2026 (CEST -> CET), forward on
 *     Sun 28 Mar 2027 (CET -> CEST);
 *   - New York: back on Sun 1 Nov 2026 (EDT -> EST), forward on
 *     Sun 14 Mar 2027 (EST -> EDT);
 *   - Sydney: forward on Sun 4 Oct 2026 (AEST -> AEDT).
 */

import OneUptimeDate from "../../../Types/Date";
import EventInterval from "../../../Types/Events/EventInterval";
import Recurring from "../../../Types/Events/Recurring";
import PositiveNumber from "../../../Types/PositiveNumber";
import Timezone from "../../../Types/Timezone";
import WorkspaceSummaryScheduleUtil, {
  WorkspaceSummaryScheduleWrite,
} from "../../../Utils/Workspace/WorkspaceSummarySchedule";
import { describe, expect, test } from "@jest/globals";

const BERLIN: string = "Europe/Berlin";
const NEW_YORK: string = "America/New_York";
const SYDNEY: string = "Australia/Sydney";

function every(intervalType: EventInterval, intervalCount: number): Recurring {
  const recurring: Recurring = new Recurring();
  recurring.intervalType = intervalType;
  recurring.intervalCount = new PositiveNumber(intervalCount);
  return recurring;
}

function at(iso: string): Date {
  return OneUptimeDate.fromString(iso);
}

// The wall clock an instant reads in a zone, for readable expectations.
function wallClock(date: Date | undefined, timezone: string): string {
  if (!date) {
    return "nothing";
  }

  return OneUptimeDate.getDateAsCustomFormattedStringInTimezone({
    date: date,
    format: "ddd YYYY-MM-DD HH:mm z",
    timezone: timezone,
  });
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

  if (write.timezone) {
    described["timezone"] = write.timezone;
  }

  return described;
}

describe("the report worker's next send, in the summary's time zone", () => {
  test("a weekly summary at 09:00 in Berlin still goes out at 09:00 there after the clocks go back", () => {
    // Sent Mon 19 Oct, 09:00 CEST; the clocks go back on Sun 25 Oct.
    const next: Date = WorkspaceSummaryScheduleUtil.getNextSendAfterDue({
      dueAt: at("2026-10-19T07:00:00.000Z"),
      recurringInterval: every(EventInterval.Week, 1),
      sendFirstReportAt: at("2026-10-12T07:00:00.000Z"),
      timezone: BERLIN,
      now: at("2026-10-19T07:00:30.000Z"),
    });

    expect(wallClock(next, BERLIN)).toBe("Mon 2026-10-26 09:00 CET");
    // 08:00 UTC now, not the 07:00 UTC it was stepped to before.
    expect(next.toISOString()).toBe("2026-10-26T08:00:00.000Z");
  });

  test("and at 09:00 there after the clocks go forward", () => {
    const next: Date = WorkspaceSummaryScheduleUtil.getNextSendAfterDue({
      dueAt: at("2027-03-22T08:00:00.000Z"),
      recurringInterval: every(EventInterval.Week, 1),
      sendFirstReportAt: at("2026-11-02T08:00:00.000Z"),
      timezone: BERLIN,
      now: at("2027-03-22T08:00:30.000Z"),
    });

    expect(wallClock(next, BERLIN)).toBe("Mon 2027-03-29 09:00 CEST");
    expect(next.toISOString()).toBe("2027-03-29T07:00:00.000Z");
  });

  test("a daily summary goes out at 09:00 on the day the clocks go back, and the day after", () => {
    const sunday: Date = WorkspaceSummaryScheduleUtil.getNextSendAfterDue({
      dueAt: at("2026-10-24T07:00:00.000Z"),
      recurringInterval: every(EventInterval.Day, 1),
      sendFirstReportAt: at("2026-10-01T07:00:00.000Z"),
      timezone: BERLIN,
      now: at("2026-10-24T07:00:20.000Z"),
    });

    expect(wallClock(sunday, BERLIN)).toBe("Sun 2026-10-25 09:00 CET");

    const monday: Date = WorkspaceSummaryScheduleUtil.getNextSendAfterDue({
      dueAt: sunday,
      recurringInterval: every(EventInterval.Day, 1),
      sendFirstReportAt: at("2026-10-01T07:00:00.000Z"),
      timezone: BERLIN,
      now: OneUptimeDate.addRemoveSeconds(sunday, 20),
    });

    expect(wallClock(monday, BERLIN)).toBe("Mon 2026-10-26 09:00 CET");
  });

  test("a daily summary at 02:30, a time the night the clocks go forward skips, goes out that night and is back at 02:30 the night after", () => {
    // Berlin skips 02:00-03:00 on Sun 28 Mar 2027.
    const anchor: Date = at("2027-03-20T01:30:00.000Z"); // 02:30 CET

    const skippedNight: Date =
      WorkspaceSummaryScheduleUtil.getNextSendAfterDue({
        dueAt: at("2027-03-27T01:30:00.000Z"),
        recurringInterval: every(EventInterval.Day, 1),
        sendFirstReportAt: anchor,
        timezone: BERLIN,
        now: at("2027-03-27T01:30:20.000Z"),
      });

    // Once that night, within the hour the clocks skip.
    expect(skippedNight.getTime()).toBeGreaterThan(
      at("2027-03-27T01:30:20.000Z").getTime(),
    );
    expect(
      Math.abs(
        skippedNight.getTime() - at("2027-03-28T01:00:00.000Z").getTime(),
      ),
    ).toBeLessThanOrEqual(60 * 60 * 1000);

    const nightAfter: Date = WorkspaceSummaryScheduleUtil.getNextSendAfterDue(
      {
        dueAt: skippedNight,
        recurringInterval: every(EventInterval.Day, 1),
        sendFirstReportAt: anchor,
        timezone: BERLIN,
        now: OneUptimeDate.addRemoveSeconds(skippedNight, 20),
      },
    );

    // Back at 02:30, not left at whatever the skipped night moved it to.
    expect(wallClock(nightAfter, BERLIN)).toBe("Mon 2027-03-29 02:30 CEST");
  });

  test("a weekly summary at 09:00 in New York keeps 09:00 there through both changes", () => {
    const afterFallBack: Date =
      WorkspaceSummaryScheduleUtil.getNextSendAfterDue({
        dueAt: at("2026-10-26T13:00:00.000Z"),
        recurringInterval: every(EventInterval.Week, 1),
        sendFirstReportAt: at("2026-10-05T13:00:00.000Z"),
        timezone: NEW_YORK,
        now: at("2026-10-26T13:00:30.000Z"),
      });

    expect(wallClock(afterFallBack, NEW_YORK)).toBe(
      "Mon 2026-11-02 09:00 EST",
    );

    const afterSpringForward: Date =
      WorkspaceSummaryScheduleUtil.getNextSendAfterDue({
        dueAt: at("2027-03-08T14:00:00.000Z"),
        recurringInterval: every(EventInterval.Week, 1),
        sendFirstReportAt: at("2026-10-05T13:00:00.000Z"),
        timezone: NEW_YORK,
        now: at("2027-03-08T14:00:30.000Z"),
      });

    expect(wallClock(afterSpringForward, NEW_YORK)).toBe(
      "Mon 2027-03-15 09:00 EDT",
    );
  });

  test("a weekly summary at 09:00 in Sydney keeps 09:00 there when its clocks go forward in October", () => {
    const next: Date = WorkspaceSummaryScheduleUtil.getNextSendAfterDue({
      dueAt: at("2026-09-27T23:00:00.000Z"),
      recurringInterval: every(EventInterval.Week, 1),
      sendFirstReportAt: at("2026-09-20T23:00:00.000Z"),
      timezone: SYDNEY,
      now: at("2026-09-27T23:00:30.000Z"),
    });

    expect(wallClock(next, SYDNEY)).toBe("Mon 2026-10-05 09:00 AEDT");
    expect(next.toISOString()).toBe("2026-10-04T22:00:00.000Z");
  });

  test("an hourly summary stays an hour apart through the hour the clocks repeat", () => {
    const next: Date = WorkspaceSummaryScheduleUtil.getNextSendAfterDue({
      dueAt: at("2026-10-25T00:00:00.000Z"), // 02:00 CEST
      recurringInterval: every(EventInterval.Hour, 1),
      sendFirstReportAt: at("2026-10-24T22:00:00.000Z"),
      timezone: BERLIN,
      now: at("2026-10-25T00:00:30.000Z"),
    });

    // The second 02:00 that night: an hour later, not two.
    expect(next.toISOString()).toBe("2026-10-25T01:00:00.000Z");
    expect(wallClock(next, BERLIN)).toBe("Sun 2026-10-25 02:00 CET");
  });

  test("a monthly summary on the 31st stays on the last day of each month, not on the 28th after February", () => {
    const anchor: Date = at("2027-01-31T08:00:00.000Z"); // 09:00 CET

    const afterFebruary: Date =
      WorkspaceSummaryScheduleUtil.getNextSendAfterDue({
        dueAt: at("2027-02-28T08:00:00.000Z"),
        recurringInterval: every(EventInterval.Month, 1),
        sendFirstReportAt: anchor,
        timezone: BERLIN,
        now: at("2027-02-28T08:00:30.000Z"),
      });

    expect(wallClock(afterFebruary, BERLIN)).toBe("Wed 2027-03-31 09:00 CEST");
  });

  test("a summary that drifted an hour while it was stepped in UTC goes back to its first summary's time of day", () => {
    /*
     * First summary Mon 15 Jun 2026, 09:00 AEST in Sydney. Stepped in UTC,
     * it has gone out at 10:00 there since the clocks went forward on
     * 4 Oct: due Mon 12 Oct at 10:00 AEDT.
     */
    const next: Date = WorkspaceSummaryScheduleUtil.getNextSendAfterDue({
      dueAt: at("2026-10-11T23:00:00.000Z"),
      recurringInterval: every(EventInterval.Week, 1),
      sendFirstReportAt: at("2026-06-14T23:00:00.000Z"),
      timezone: SYDNEY,
      now: at("2026-10-11T23:00:30.000Z"),
    });

    expect(wallClock(next, SYDNEY)).toBe("Mon 2026-10-19 09:00 AEDT");
    expect(next.toISOString()).toBe("2026-10-18T22:00:00.000Z");
  });

  test("a summary with no first summary date steps from the send that was due, on its zone's clock", () => {
    const next: Date = WorkspaceSummaryScheduleUtil.getNextSendAfterDue({
      dueAt: at("2026-10-19T07:00:00.000Z"),
      recurringInterval: every(EventInterval.Week, 1),
      sendFirstReportAt: null,
      timezone: BERLIN,
      now: at("2026-10-19T07:00:30.000Z"),
    });

    expect(wallClock(next, BERLIN)).toBe("Mon 2026-10-26 09:00 CET");
  });

  test("a summary that names no time zone keeps stepping in UTC, as every summary did before", () => {
    for (const timezone of [undefined, null, ""]) {
      const next: Date = WorkspaceSummaryScheduleUtil.getNextSendAfterDue({
        dueAt: at("2026-10-19T07:00:00.000Z"),
        recurringInterval: every(EventInterval.Week, 1),
        sendFirstReportAt: at("2026-10-12T07:00:00.000Z"),
        timezone: timezone,
        now: at("2026-10-19T07:00:30.000Z"),
      });

      expect(next.toISOString()).toBe("2026-10-26T07:00:00.000Z");
    }
  });

  test("a summary held at a send of its own off the schedule goes back to the schedule after it", () => {
    // Sent early through the API on Wed 21 Oct at 15:00; the schedule is Mondays 09:00 Berlin.
    const next: Date = WorkspaceSummaryScheduleUtil.getNextSendAfterDue({
      dueAt: at("2026-10-21T13:00:00.000Z"),
      recurringInterval: every(EventInterval.Week, 1),
      sendFirstReportAt: at("2026-10-12T07:00:00.000Z"),
      timezone: BERLIN,
      now: at("2026-10-21T13:00:30.000Z"),
    });

    expect(wallClock(next, BERLIN)).toBe("Mon 2026-10-26 09:00 CET");
  });

  test("a summary whose first send is still ahead goes out then", () => {
    const next: Date = WorkspaceSummaryScheduleUtil.getNextSendAfterDue({
      dueAt: at("2026-10-05T11:59:00.000Z"),
      recurringInterval: every(EventInterval.Week, 1),
      sendFirstReportAt: at("2026-10-12T07:00:00.000Z"),
      timezone: BERLIN,
      now: at("2026-10-05T12:00:00.000Z"),
    });

    expect(next.toISOString()).toBe("2026-10-12T07:00:00.000Z");
  });

  test("never answers the send that was due, or anything before now", () => {
    const now: Date = at("2026-10-19T07:00:30.000Z");

    const next: Date = WorkspaceSummaryScheduleUtil.getNextSendAfterDue({
      dueAt: at("2026-10-19T07:00:00.000Z"),
      recurringInterval: every(EventInterval.Week, 1),
      sendFirstReportAt: at("2026-10-19T07:00:00.000Z"),
      timezone: BERLIN,
      now: now,
    });

    expect(next.getTime()).toBeGreaterThan(now.getTime());
  });
});

describe("the next send of a schedule, in the summary's time zone", () => {
  test("is the first 09:00 Berlin occurrence after now, once the clocks have gone back", () => {
    const next: Date | undefined = WorkspaceSummaryScheduleUtil.getNextSendDate(
      {
        sendFirstReportAt: at("2026-10-12T07:00:00.000Z"),
        recurringInterval: every(EventInterval.Week, 1),
        timezone: BERLIN,
        now: at("2026-10-28T12:00:00.000Z"),
      },
    );

    expect(wallClock(next, BERLIN)).toBe("Mon 2026-11-02 09:00 CET");
  });

  test("is in UTC for a summary that names no time zone", () => {
    expect(
      WorkspaceSummaryScheduleUtil.getNextSendDate({
        sendFirstReportAt: at("2026-10-12T07:00:00.000Z"),
        recurringInterval: every(EventInterval.Week, 1),
        now: at("2026-10-28T12:00:00.000Z"),
      })?.toISOString(),
    ).toBe("2026-11-02T07:00:00.000Z");
  });
});

describe("a new summary's time zone", () => {
  const NOW: Date = at("2026-10-05T12:00:00.000Z");

  test("is the one the write names, kept as it is, and its first summary is 09:00 there", () => {
    expect(
      describeWrite(
        WorkspaceSummaryScheduleUtil.getCreateWrite({
          write: { timezone: NEW_YORK },
          now: NOW,
          timezone: BERLIN,
        }),
      ),
    ).toEqual({
      recurringInterval: "1 Week",
      // It is 08:00 in New York: this Monday's 09:00 there is still ahead.
      sendFirstReportAt: "2026-10-05T13:00:00.000Z",
      nextSendAt: "2026-10-05T13:00:00.000Z",
    });
  });

  test("is the creator's for a write that names none, and the write carries it", () => {
    expect(
      describeWrite(
        WorkspaceSummaryScheduleUtil.getCreateWrite({
          write: {},
          now: NOW,
          timezone: BERLIN,
        }),
      ),
    ).toEqual({
      recurringInterval: "1 Week",
      sendFirstReportAt: "2026-10-12T07:00:00.000Z",
      nextSendAt: "2026-10-12T07:00:00.000Z",
      timezone: BERLIN,
    });
  });

  test("is UTC when neither the write nor the creator names one", () => {
    for (const write of [{}, { timezone: null }]) {
      expect(
        describeWrite(
          WorkspaceSummaryScheduleUtil.getCreateWrite({
            write: write,
            now: NOW,
          }),
        ),
      ).toEqual({
        recurringInterval: "1 Week",
        sendFirstReportAt: "2026-10-12T09:00:00.000Z",
        nextSendAt: "2026-10-12T09:00:00.000Z",
        timezone: Timezone.UTC,
      });
    }
  });

  test("is UTC when the creator's is not a time zone at all", () => {
    expect(
      WorkspaceSummaryScheduleUtil.getCreateWrite({
        write: {},
        now: NOW,
        timezone: "Mars/Olympus_Mons",
      }).timezone,
    ).toBe(Timezone.UTC);
  });

  test("decides where a first summary dated in the past goes next: 09:00 Berlin after the clocks change", () => {
    // Mondays 09:00 CEST from 7 Sep; created on 28 Oct, after the clocks went back.
    expect(
      describeWrite(
        WorkspaceSummaryScheduleUtil.getCreateWrite({
          write: {
            recurringInterval: every(EventInterval.Week, 1),
            sendFirstReportAt: at("2026-09-07T07:00:00.000Z"),
            timezone: BERLIN,
          },
          now: at("2026-10-28T12:00:00.000Z"),
        }),
      ),
    ).toEqual({ nextSendAt: "2026-11-02T08:00:00.000Z" });
  });

  test("keeps a legacy name as the caller wrote it, and reads it as its current zone", () => {
    const write: WorkspaceSummaryScheduleWrite =
      WorkspaceSummaryScheduleUtil.getCreateWrite({
        write: { timezone: "US/Pacific-New" },
        now: NOW,
      });

    // Nothing to add: the write's own name is stored.
    expect(write.timezone).toBeUndefined();
    // 09:00 in Los Angeles: 16:00 UTC on Mon 12 Oct (PDT).
    expect(write.sendFirstReportAt?.toISOString()).toBe(
      "2026-10-12T16:00:00.000Z",
    );
  });
});

describe("an update that changes a summary's time zone", () => {
  const STORED: {
    recurringInterval: Recurring;
    sendFirstReportAt: Date;
    nextSendAt: Date;
    isEnabled: boolean;
    timezone: string | null;
  } = {
    recurringInterval: every(EventInterval.Week, 1),
    // Mon 7 Sep, 09:00 CEST.
    sendFirstReportAt: at("2026-09-07T07:00:00.000Z"),
    // Stepped in UTC: 08:00 in Berlin once the clocks went back.
    nextSendAt: at("2026-11-02T07:00:00.000Z"),
    isEnabled: true,
    timezone: null,
  };

  const NOW: Date = at("2026-10-28T12:00:00.000Z");

  test("is a schedule write", () => {
    expect(
      WorkspaceSummaryScheduleUtil.isScheduleWrite({ timezone: BERLIN }),
    ).toBe(true);
    expect(WorkspaceSummaryScheduleUtil.isRescheduleWrite({ timezone: null })).toBe(
      true,
    );
  });

  test("moves the next send to the first summary's time of day in the new zone", () => {
    expect(
      describeWrite(
        WorkspaceSummaryScheduleUtil.getUpdateWrite({
          write: { timezone: BERLIN },
          stored: STORED,
          now: NOW,
        }),
      ),
    ).toEqual({ nextSendAt: "2026-11-02T08:00:00.000Z" });
  });

  test("of a summary with no first summary date keeps the time of day of the send it has coming, on the new zone's clock", () => {
    const write: WorkspaceSummaryScheduleWrite =
      WorkspaceSummaryScheduleUtil.getUpdateWrite({
        write: { timezone: BERLIN },
        stored: {
          ...STORED,
          sendFirstReportAt: null,
          // Thu 29 Oct, 10:15 CET.
          nextSendAt: at("2026-10-29T09:15:00.000Z"),
        },
        now: NOW,
      });

    expect(wallClock(write.nextSendAt, BERLIN)).toBe(
      "Thu 2026-10-29 10:15 CET",
    );
  });

  test("that sends the zone it has back - the edit form's every save - adds nothing", () => {
    expect(
      WorkspaceSummaryScheduleUtil.getUpdateWrite({
        write: { timezone: BERLIN, sendFirstReportAt: STORED.sendFirstReportAt },
        stored: { ...STORED, timezone: BERLIN },
        now: NOW,
      }),
    ).toEqual({});
  });

  test("from no zone to UTC, or back, is no change: both are read in UTC", () => {
    expect(
      WorkspaceSummaryScheduleUtil.getUpdateWrite({
        write: { timezone: Timezone.UTC },
        stored: STORED,
        now: NOW,
      }),
    ).toEqual({});
    expect(
      WorkspaceSummaryScheduleUtil.getUpdateWrite({
        write: { timezone: null },
        stored: { ...STORED, timezone: Timezone.UTC },
        now: NOW,
      }),
    ).toEqual({});
  });

  test("with a new interval too counts both on the new zone's clock", () => {
    expect(
      describeWrite(
        WorkspaceSummaryScheduleUtil.getUpdateWrite({
          write: {
            timezone: BERLIN,
            recurringInterval: every(EventInterval.Day, 1),
          },
          stored: STORED,
          now: NOW,
        }),
      ),
    ).toEqual({ nextSendAt: "2026-10-29T08:00:00.000Z" });
  });

  test("of a summary with nothing coming at all starts at 09:00 at the next period's start in its zone", () => {
    expect(
      describeWrite(
        WorkspaceSummaryScheduleUtil.getUpdateWrite({
          write: { recurringInterval: every(EventInterval.Month, 1) },
          stored: {
            ...STORED,
            sendFirstReportAt: null,
            nextSendAt: null,
            timezone: NEW_YORK,
          },
          now: NOW,
        }),
      ),
    ).toEqual({ nextSendAt: "2026-11-01T14:00:00.000Z" });
  });
});

describe("which time zones a summary takes", () => {
  test.each([
    [BERLIN, BERLIN],
    [Timezone.UTC, Timezone.UTC],
    [NEW_YORK, NEW_YORK],
    ["Etc/GMT-2", "Etc/GMT-2"],
    // Legacy names the tz database keeps for old configurations.
    ["US/Eastern", "US/Eastern"],
    ["Asia/Calcutta", "Asia/Calcutta"],
    // One the bundled tz database has since dropped is read as its current zone.
    ["US/Pacific-New", "America/Los_Angeles"],
  ])("reads %s as %s", (value: string, expected: string) => {
    expect(WorkspaceSummaryScheduleUtil.toTimezone(value)).toBe(expected);
    expect(WorkspaceSummaryScheduleUtil.getTimezone(value)).toBe(expected);
    expect(
      WorkspaceSummaryScheduleUtil.getWriteProblem({ timezone: value }),
    ).toBeNull();
  });

  test.each([
    ["a made-up zone", "Mars/Olympus_Mons"],
    ["an offset that is not a zone name", "GMT+2"],
    ["an empty name", ""],
    ["a blank name", "   "],
    ["a number", 2],
    ["an object", { name: BERLIN }],
  ])(
    "refuses %s with a message that says how to send one",
    (_what: string, value: unknown) => {
      expect(WorkspaceSummaryScheduleUtil.toTimezone(value)).toBeUndefined();
      expect(WorkspaceSummaryScheduleUtil.getTimezone(value)).toBe(
        Timezone.UTC,
      );

      const problem: string | null =
        WorkspaceSummaryScheduleUtil.getWriteProblem({
          timezone: value as string,
        });

      expect(problem).toContain("timezone is not a time zone");
      expect(problem).toContain("Europe/Berlin");
    },
  );

  test("has nothing to say about a write that leaves the zone out or clears it", () => {
    expect(WorkspaceSummaryScheduleUtil.getWriteProblem({})).toBeNull();
    expect(
      WorkspaceSummaryScheduleUtil.getWriteProblem({ timezone: null }),
    ).toBeNull();
    expect(WorkspaceSummaryScheduleUtil.getTimezone(null)).toBe(Timezone.UTC);
    expect(WorkspaceSummaryScheduleUtil.getTimezone(undefined)).toBe(
      Timezone.UTC,
    );
  });

  test("defaults to UTC", () => {
    expect(WorkspaceSummaryScheduleUtil.DEFAULT_TIMEZONE).toBe(Timezone.UTC);
  });
});
