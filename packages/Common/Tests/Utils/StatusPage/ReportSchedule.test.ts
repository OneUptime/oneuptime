/*
 * When a status page's email reports go out, and what a write switching them
 * on or off has to carry.
 *
 * The problem this pins: a status page's report schedule - the first report's
 * date and how often one follows it - had no defaults, so switching reports
 * on meant making a schedule up, and the settings dialog asked for both even
 * to switch reports off. Now reports switched on without a schedule get one:
 * every month, the first on the next 1st of the month at 09:00 in the report
 * timezone, each covering the calendar month before it. A schedule the page
 * has, or the caller sends, is never replaced, and switching reports off
 * needs nothing.
 */

import OneUptimeDate from "../../../Types/Date";
import EventInterval from "../../../Types/Events/EventInterval";
import Recurring from "../../../Types/Events/Recurring";
import PositiveNumber from "../../../Types/PositiveNumber";
import StatusPageReportPeriodType from "../../../Types/StatusPage/StatusPageReportPeriodType";
import Timezone from "../../../Types/Timezone";
import StatusPageReportScheduleUtil, {
  StatusPageReportNextSend,
  StatusPageReportScheduleWrite,
} from "../../../Utils/StatusPage/ReportSchedule";
import { describe, expect, test } from "@jest/globals";

function every(intervalType: EventInterval, intervalCount: number): Recurring {
  const recurring: Recurring = new Recurring();
  recurring.intervalType = intervalType;
  recurring.intervalCount = new PositiveNumber(intervalCount);
  return recurring;
}

function at(iso: string): Date {
  return OneUptimeDate.fromString(iso);
}

function iso(date: Date | undefined): string | undefined {
  return date?.toISOString();
}

// The first default report for a moment and a timezone, as an ISO string.
function firstDefault(now: string, timezone?: unknown): string {
  return StatusPageReportScheduleUtil.getDefaultFirstReportDate({
    timezone: timezone,
    after: at(now),
  }).toISOString();
}

// A write's columns, with dates and intervals as strings, for toEqual.
function describeWrite(
  write: StatusPageReportScheduleWrite,
): Record<string, string | undefined> {
  const described: Record<string, string | undefined> = {};

  if (write.reportStartDateTime) {
    described["reportStartDateTime"] = iso(write.reportStartDateTime);
  }

  if (write.reportRecurringInterval) {
    described["reportRecurringInterval"] =
      write.reportRecurringInterval.toString();
  }

  if (write.reportPeriodType) {
    described["reportPeriodType"] = write.reportPeriodType;
  }

  if (write.sendNextReportBy) {
    described["sendNextReportBy"] = iso(write.sendNextReportBy);
  }

  return described;
}

const NOW: string = "2026-10-04T12:00:00.000Z";

describe("the default schedule", () => {
  test("is every month", () => {
    const recurring: Recurring =
      StatusPageReportScheduleUtil.getDefaultRecurringInterval();

    expect(recurring.intervalType).toBe(EventInterval.Month);
    expect(recurring.intervalCount.toNumber()).toBe(1);
  });

  test("covers the calendar month before each report", () => {
    expect(StatusPageReportScheduleUtil.DEFAULT_PERIOD_TYPE).toBe(
      StatusPageReportPeriodType.PreviousCalendarPeriod,
    );
  });

  test("hands out a new interval each time, so changing one changes no other", () => {
    const first: Recurring =
      StatusPageReportScheduleUtil.getDefaultRecurringInterval();
    first.intervalCount = new PositiveNumber(3);

    expect(
      StatusPageReportScheduleUtil.getDefaultRecurringInterval().intervalCount.toNumber(),
    ).toBe(1);
  });
});

describe("the default first report: the next 1st of the month at 09:00", () => {
  test("in UTC, from the middle of a month", () => {
    expect(firstDefault(NOW, Timezone.UTC)).toBe("2026-11-01T09:00:00.000Z");
  });

  test("is this month's 1st while it is still before 09:00 on it", () => {
    expect(firstDefault("2026-11-01T08:59:59.999Z", Timezone.UTC)).toBe(
      "2026-11-01T09:00:00.000Z",
    );
  });

  test("is next month's at 09:00 sharp, and after it", () => {
    expect(firstDefault("2026-11-01T09:00:00.000Z", Timezone.UTC)).toBe(
      "2026-12-01T09:00:00.000Z",
    );
    expect(firstDefault("2026-11-01T09:00:00.001Z", Timezone.UTC)).toBe(
      "2026-12-01T09:00:00.000Z",
    );
  });

  test("rolls over into the next year from December", () => {
    expect(firstDefault("2026-12-15T10:00:00.000Z", Timezone.UTC)).toBe(
      "2027-01-01T09:00:00.000Z",
    );
    expect(firstDefault("2026-12-31T23:59:59.999Z", Timezone.UTC)).toBe(
      "2027-01-01T09:00:00.000Z",
    );
  });

  test("handles February in a leap year and out of one", () => {
    expect(firstDefault("2028-01-31T12:00:00.000Z", Timezone.UTC)).toBe(
      "2028-02-01T09:00:00.000Z",
    );
    expect(firstDefault("2028-02-29T12:00:00.000Z", Timezone.UTC)).toBe(
      "2028-03-01T09:00:00.000Z",
    );
    expect(firstDefault("2027-02-28T12:00:00.000Z", Timezone.UTC)).toBe(
      "2027-03-01T09:00:00.000Z",
    );
  });

  test("is 09:00 in the report's timezone, not the server's", () => {
    // India, UTC+5:30.
    expect(firstDefault(NOW, Timezone.AsiaKolkata)).toBe(
      "2026-11-01T03:30:00.000Z",
    );
    // Nepal, UTC+5:45.
    expect(firstDefault(NOW, Timezone.AsiaKathmandu)).toBe(
      "2026-11-01T03:15:00.000Z",
    );
  });

  test("holds 09:00 across daylight saving: New York is back on standard time on 1 Nov 2026", () => {
    // 09:00 EST (UTC-5): daylight saving ended at 02:00 that morning.
    expect(firstDefault(NOW, Timezone.AmericaNew_York)).toBe(
      "2026-11-01T14:00:00.000Z",
    );
    // 09:00 EDT (UTC-4) in the summer.
    expect(firstDefault("2026-06-10T12:00:00.000Z", Timezone.AmericaNew_York)).toBe(
      "2026-07-01T13:00:00.000Z",
    );
  });

  test("goes by the month in the report's timezone, which can be ahead of UTC's", () => {
    /*
     * 12:00 UTC on 31 Oct is 01:00 on 1 Nov in Auckland (UTC+13 in its
     * summer): November there already, and its 09:00 still to come.
     */
    expect(
      firstDefault("2026-10-31T12:00:00.000Z", Timezone.PacificAuckland),
    ).toBe("2026-10-31T20:00:00.000Z");

    // 10:00 on 1 Nov in Auckland: past it, so 1 Dec at 09:00 there.
    expect(
      firstDefault("2026-10-31T21:00:00.000Z", Timezone.PacificAuckland),
    ).toBe("2026-11-30T20:00:00.000Z");
  });

  test("goes by the month in the report's timezone, which can be behind UTC's", () => {
    /*
     * 05:00 UTC on 1 Nov is still 22:00 on 31 Oct in Los Angeles, so its 1
     * Nov at 09:00 is to come - on standard time (UTC-8) by then.
     */
    expect(
      firstDefault("2026-11-01T05:00:00.000Z", Timezone.AmericaLos_Angeles),
    ).toBe("2026-11-01T17:00:00.000Z");
  });

  test("falls back to UTC for a timezone it does not know, or none", () => {
    expect(firstDefault(NOW, "Not/A_Timezone")).toBe("2026-11-01T09:00:00.000Z");
    expect(firstDefault(NOW, undefined)).toBe("2026-11-01T09:00:00.000Z");
    expect(firstDefault(NOW, null)).toBe("2026-11-01T09:00:00.000Z");
    expect(firstDefault(NOW, "")).toBe("2026-11-01T09:00:00.000Z");
  });

  test("is always in the future when no moment is given", () => {
    const first: Date = StatusPageReportScheduleUtil.getDefaultFirstReportDate();

    expect(first.getTime()).toBeGreaterThan(Date.now());
    expect(first.getUTCDate()).toBe(1);
    expect(first.getUTCHours()).toBe(9);
    expect(first.getUTCMinutes()).toBe(0);
  });
});

describe("the next report", () => {
  test("follows a monthly schedule on the 1st, month after month", () => {
    const next: (after: string) => string | undefined = (
      after: string,
    ): string | undefined => {
      return iso(
        StatusPageReportScheduleUtil.getNextReportDate({
          reportStartDateTime: at("2026-11-01T09:00:00.000Z"),
          reportRecurringInterval: every(EventInterval.Month, 1),
          reportTimezone: Timezone.UTC,
          after: at(after),
        }),
      );
    };

    expect(next(NOW)).toBe("2026-11-01T09:00:00.000Z");
    expect(next("2026-11-01T09:00:30.000Z")).toBe("2026-12-01T09:00:00.000Z");
    expect(next("2027-01-15T00:00:00.000Z")).toBe("2027-02-01T09:00:00.000Z");
    expect(next("2027-02-01T09:00:00.000Z")).toBe("2027-03-01T09:00:00.000Z");
  });

  test("keeps 09:00 in the report's timezone through daylight saving", () => {
    const next: (after: string) => string | undefined = (
      after: string,
    ): string | undefined => {
      return iso(
        StatusPageReportScheduleUtil.getNextReportDate({
          reportStartDateTime: at("2026-11-01T14:00:00.000Z"),
          reportRecurringInterval: every(EventInterval.Month, 1),
          reportTimezone: Timezone.AmericaNew_York,
          after: at(after),
        }),
      );
    };

    expect(next("2026-11-02T00:00:00.000Z")).toBe("2026-12-01T14:00:00.000Z");
    // Daylight saving again from 14 Mar 2027: 09:00 EDT.
    expect(next("2027-03-02T00:00:00.000Z")).toBe("2027-04-01T13:00:00.000Z");
  });

  test("reads an interval as JSON, as the column holds it", () => {
    expect(
      iso(
        StatusPageReportScheduleUtil.getNextReportDate({
          reportStartDateTime: "2026-10-05T09:00:00.000Z",
          reportRecurringInterval: every(EventInterval.Week, 1).toJSON(),
          reportTimezone: Timezone.UTC,
          after: at("2026-10-05T09:00:01.000Z"),
        }),
      ),
    ).toBe("2026-10-12T09:00:00.000Z");
  });

  test("is not there without a whole schedule", () => {
    expect(
      StatusPageReportScheduleUtil.getNextReportDate({
        reportStartDateTime: at("2026-11-01T09:00:00.000Z"),
        reportTimezone: Timezone.UTC,
        after: at(NOW),
      }),
    ).toBeUndefined();
    expect(
      StatusPageReportScheduleUtil.getNextReportDate({
        reportRecurringInterval: every(EventInterval.Month, 1),
        after: at(NOW),
      }),
    ).toBeUndefined();
    expect(
      StatusPageReportScheduleUtil.getNextReportDate({
        reportStartDateTime: "not a date",
        reportRecurringInterval: { not: "an interval" },
        after: at(NOW),
      }),
    ).toBeUndefined();
  });
});

describe("the next report a saved page shows", () => {
  const page: {
    reportStartDateTime: Date;
    reportRecurringInterval: Recurring;
    reportTimezone: Timezone;
  } = {
    reportStartDateTime: at("2026-11-01T09:00:00.000Z"),
    reportRecurringInterval: every(EventInterval.Month, 1),
    reportTimezone: Timezone.UTC,
  };

  test("is the time the server worked out, while it is ahead", () => {
    const next: StatusPageReportNextSend =
      StatusPageReportScheduleUtil.getNextSend(
        { ...page, sendNextReportBy: at("2026-11-01T09:00:00.000Z") },
        at(NOW),
      );

    expect(iso(next.sendAt)).toBe("2026-11-01T09:00:00.000Z");
    expect(next.timezone).toBe(Timezone.UTC);
  });

  test("is the schedule's next one once that time has passed", () => {
    const next: StatusPageReportNextSend =
      StatusPageReportScheduleUtil.getNextSend(
        { ...page, sendNextReportBy: at("2026-11-01T09:00:00.000Z") },
        at("2026-11-01T09:00:40.000Z"),
      );

    expect(iso(next.sendAt)).toBe("2026-12-01T09:00:00.000Z");
  });

  test("is worked out from the schedule when the server has none yet", () => {
    expect(
      iso(StatusPageReportScheduleUtil.getNextSend(page, at(NOW)).sendAt),
    ).toBe("2026-11-01T09:00:00.000Z");
  });

  test("is not there without a schedule, and is read in the page's timezone", () => {
    const next: StatusPageReportNextSend =
      StatusPageReportScheduleUtil.getNextSend(
        { reportTimezone: Timezone.AsiaKolkata },
        at(NOW),
      );

    expect(next.sendAt).toBeUndefined();
    expect(next.timezone).toBe(Timezone.AsiaKolkata);
  });
});

describe("what a write has to carry", () => {
  const now: Date = at(NOW);

  test("switching reports on for a page with no schedule fills in the default one", () => {
    const write: StatusPageReportScheduleWrite =
      StatusPageReportScheduleUtil.getScheduleWrite({
        write: { isReportEnabled: true },
        stored: { isReportEnabled: false, reportTimezone: Timezone.UTC },
        now: now,
      });

    expect(describeWrite(write)).toEqual({
      reportStartDateTime: "2026-11-01T09:00:00.000Z",
      reportRecurringInterval: "1 Month",
      reportPeriodType: StatusPageReportPeriodType.PreviousCalendarPeriod,
      sendNextReportBy: "2026-11-01T09:00:00.000Z",
    });
  });

  test("the default first report is in the page's own timezone", () => {
    const write: StatusPageReportScheduleWrite =
      StatusPageReportScheduleUtil.getScheduleWrite({
        write: { isReportEnabled: true },
        stored: { reportTimezone: Timezone.AmericaNew_York },
        now: now,
      });

    expect(iso(write.reportStartDateTime)).toBe("2026-11-01T14:00:00.000Z");
    expect(iso(write.sendNextReportBy)).toBe("2026-11-01T14:00:00.000Z");
  });

  test("or in the timezone the write sends with it", () => {
    const write: StatusPageReportScheduleWrite =
      StatusPageReportScheduleUtil.getScheduleWrite({
        write: { isReportEnabled: true, reportTimezone: Timezone.AsiaKolkata },
        stored: { reportTimezone: Timezone.UTC },
        now: now,
      });

    expect(iso(write.reportStartDateTime)).toBe("2026-11-01T03:30:00.000Z");
  });

  test("a schedule the page already has is kept: only the next send is worked out again", () => {
    const write: StatusPageReportScheduleWrite =
      StatusPageReportScheduleUtil.getScheduleWrite({
        write: { isReportEnabled: true },
        stored: {
          isReportEnabled: false,
          reportStartDateTime: at("2026-01-05T08:00:00.000Z"),
          reportRecurringInterval: every(EventInterval.Week, 2),
          reportTimezone: Timezone.UTC,
          reportPeriodType: StatusPageReportPeriodType.Rolling,
          // Due a month ago, while reports were off: not sent at once now.
          sendNextReportBy: at("2026-09-07T08:00:00.000Z"),
        },
        now: now,
      });

    expect(describeWrite(write)).toEqual({
      // Every other Monday from 5 Jan 2026: 12 Oct is the next.
      sendNextReportBy: "2026-10-12T08:00:00.000Z",
    });
  });

  test("a schedule the caller sends is kept", () => {
    const write: StatusPageReportScheduleWrite =
      StatusPageReportScheduleUtil.getScheduleWrite({
        write: {
          isReportEnabled: true,
          reportStartDateTime: at("2026-10-10T07:30:00.000Z"),
          reportRecurringInterval: every(EventInterval.Day, 1),
        },
        stored: { isReportEnabled: false },
        now: now,
      });

    expect(describeWrite(write)).toEqual({
      sendNextReportBy: "2026-10-10T07:30:00.000Z",
    });
  });

  test("a reporting period the caller sends is kept", () => {
    const write: StatusPageReportScheduleWrite =
      StatusPageReportScheduleUtil.getScheduleWrite({
        write: {
          isReportEnabled: true,
          reportPeriodType: StatusPageReportPeriodType.Rolling,
        },
        stored: {},
        now: now,
      });

    expect(write.reportPeriodType).toBeUndefined();
    expect(iso(write.reportStartDateTime)).toBe("2026-11-01T09:00:00.000Z");
    expect(write.reportRecurringInterval?.toString()).toBe("1 Month");
  });

  test("half a schedule gets only its missing half, and keeps its reporting period", () => {
    const withStartOnly: StatusPageReportScheduleWrite =
      StatusPageReportScheduleUtil.getScheduleWrite({
        write: { isReportEnabled: true },
        stored: { reportStartDateTime: at("2026-10-15T10:00:00.000Z") },
        now: now,
      });

    expect(describeWrite(withStartOnly)).toEqual({
      reportRecurringInterval: "1 Month",
      sendNextReportBy: "2026-10-15T10:00:00.000Z",
    });

    const withIntervalOnly: StatusPageReportScheduleWrite =
      StatusPageReportScheduleUtil.getScheduleWrite({
        write: { isReportEnabled: true },
        stored: { reportRecurringInterval: every(EventInterval.Week, 1) },
        now: now,
      });

    expect(describeWrite(withIntervalOnly)).toEqual({
      reportStartDateTime: "2026-11-01T09:00:00.000Z",
      sendNextReportBy: "2026-11-01T09:00:00.000Z",
    });
  });

  test("switching reports off needs nothing, with or without a schedule", () => {
    expect(
      StatusPageReportScheduleUtil.getScheduleWrite({
        write: { isReportEnabled: false },
        stored: { isReportEnabled: true },
        now: now,
      }),
    ).toEqual({});

    expect(
      StatusPageReportScheduleUtil.getScheduleWrite({
        write: { isReportEnabled: false },
        stored: {
          isReportEnabled: true,
          reportStartDateTime: at("2026-11-01T09:00:00.000Z"),
          reportRecurringInterval: every(EventInterval.Month, 1),
        },
        now: now,
      }),
    ).toEqual({});
  });

  test("switching on a page that is already on adds nothing, so a report that is due is not skipped", () => {
    expect(
      StatusPageReportScheduleUtil.getScheduleWrite({
        write: { isReportEnabled: true },
        stored: {
          isReportEnabled: true,
          reportStartDateTime: at("2026-10-01T09:00:00.000Z"),
          reportRecurringInterval: every(EventInterval.Day, 1),
          sendNextReportBy: at("2026-10-04T09:00:00.000Z"),
        },
        now: at("2026-10-04T09:00:20.000Z"),
      }),
    ).toEqual({});
  });

  test("a page that is on without a schedule gets the default with any write to its reports", () => {
    expect(
      describeWrite(
        StatusPageReportScheduleUtil.getScheduleWrite({
          write: { isReportEnabled: true },
          stored: { isReportEnabled: true },
          now: now,
        }),
      ),
    ).toEqual({
      reportStartDateTime: "2026-11-01T09:00:00.000Z",
      reportRecurringInterval: "1 Month",
      reportPeriodType: StatusPageReportPeriodType.PreviousCalendarPeriod,
      sendNextReportBy: "2026-11-01T09:00:00.000Z",
    });

    // A timezone alone, while on: the schedule follows it.
    expect(
      describeWrite(
        StatusPageReportScheduleUtil.getScheduleWrite({
          write: { reportTimezone: Timezone.AsiaKolkata },
          stored: { isReportEnabled: true },
          now: now,
        }),
      ),
    ).toEqual({
      reportStartDateTime: "2026-11-01T03:30:00.000Z",
      reportRecurringInterval: "1 Month",
      reportPeriodType: StatusPageReportPeriodType.PreviousCalendarPeriod,
      sendNextReportBy: "2026-11-01T03:30:00.000Z",
    });
  });

  test("clearing the first report date while reports are on puts the default one back", () => {
    const write: StatusPageReportScheduleWrite =
      StatusPageReportScheduleUtil.getScheduleWrite({
        write: { reportStartDateTime: null },
        stored: {
          isReportEnabled: true,
          reportStartDateTime: at("2026-10-15T10:00:00.000Z"),
          reportRecurringInterval: every(EventInterval.Week, 1),
        },
        now: now,
      });

    expect(describeWrite(write)).toEqual({
      reportStartDateTime: "2026-11-01T09:00:00.000Z",
      sendNextReportBy: "2026-11-01T09:00:00.000Z",
    });
  });

  test("rescheduling while on works the next send out again", () => {
    const write: StatusPageReportScheduleWrite =
      StatusPageReportScheduleUtil.getScheduleWrite({
        write: {
          reportStartDateTime: at("2026-10-05T09:00:00.000Z"),
          reportRecurringInterval: every(EventInterval.Week, 1),
          reportTimezone: Timezone.UTC,
          reportPeriodType: StatusPageReportPeriodType.PreviousCalendarPeriod,
        },
        stored: {
          isReportEnabled: true,
          reportStartDateTime: at("2026-11-01T09:00:00.000Z"),
          reportRecurringInterval: every(EventInterval.Month, 1),
        },
        now: now,
      });

    expect(describeWrite(write)).toEqual({
      sendNextReportBy: "2026-10-05T09:00:00.000Z",
    });
  });

  test("while reports are off, a schedule is stored as sent and never filled in", () => {
    expect(
      StatusPageReportScheduleUtil.getScheduleWrite({
        write: { reportStartDateTime: at("2026-10-15T10:00:00.000Z") },
        stored: { isReportEnabled: false },
        now: now,
      }),
    ).toEqual({});

    expect(
      describeWrite(
        StatusPageReportScheduleUtil.getScheduleWrite({
          write: {
            reportStartDateTime: at("2026-10-15T10:00:00.000Z"),
            reportRecurringInterval: every(EventInterval.Month, 1),
          },
          stored: { isReportEnabled: false },
          now: now,
        }),
      ),
    ).toEqual({ sendNextReportBy: "2026-10-15T10:00:00.000Z" });
  });

  test("the report worker moving the next send on keeps the schedule's own dates", () => {
    const write: StatusPageReportScheduleWrite =
      StatusPageReportScheduleUtil.getScheduleWrite({
        write: { sendNextReportBy: at("2026-12-01T09:00:00.000Z") },
        stored: {
          isReportEnabled: true,
          reportStartDateTime: at("2026-11-01T09:00:00.000Z"),
          reportRecurringInterval: every(EventInterval.Month, 1),
          reportTimezone: Timezone.UTC,
        },
        now: at("2026-11-01T09:00:30.000Z"),
      });

    expect(describeWrite(write)).toEqual({
      sendNextReportBy: "2026-12-01T09:00:00.000Z",
    });
  });

  test("a write that does not touch reports carries nothing", () => {
    expect(
      StatusPageReportScheduleUtil.getScheduleWrite({
        write: {},
        stored: { isReportEnabled: true },
        now: now,
      }),
    ).toEqual({});
    expect(
      StatusPageReportScheduleUtil.isReportWrite({
        reportPeriodType: StatusPageReportPeriodType.Rolling,
      }),
    ).toBe(false);
  });

  test("an interval the page holds that cannot be read counts as missing", () => {
    const write: StatusPageReportScheduleWrite =
      StatusPageReportScheduleUtil.getScheduleWrite({
        write: { isReportEnabled: true },
        stored: {
          reportStartDateTime: at("2026-10-15T10:00:00.000Z"),
          reportRecurringInterval: { _type: "Something else" },
        },
        now: now,
      });

    expect(describeWrite(write)).toEqual({
      reportRecurringInterval: "1 Month",
      sendNextReportBy: "2026-10-15T10:00:00.000Z",
    });
  });

  test("a create with reports on and nothing else gets the whole default", () => {
    expect(
      describeWrite(
        StatusPageReportScheduleUtil.getScheduleWrite({
          write: { isReportEnabled: true },
          now: now,
        }),
      ),
    ).toEqual({
      reportStartDateTime: "2026-11-01T09:00:00.000Z",
      reportRecurringInterval: "1 Month",
      reportPeriodType: StatusPageReportPeriodType.PreviousCalendarPeriod,
      sendNextReportBy: "2026-11-01T09:00:00.000Z",
    });
  });
});

describe("reading the columns", () => {
  test("a page has a schedule only with both halves", () => {
    expect(
      StatusPageReportScheduleUtil.hasSchedule({
        reportStartDateTime: at(NOW),
        reportRecurringInterval: every(EventInterval.Month, 1),
      }),
    ).toBe(true);
    expect(
      StatusPageReportScheduleUtil.hasSchedule({
        reportStartDateTime: at(NOW),
      }),
    ).toBe(false);
    expect(
      StatusPageReportScheduleUtil.hasSchedule({
        reportRecurringInterval: every(EventInterval.Month, 1),
      }),
    ).toBe(false);
  });

  test("dates and intervals that cannot be read are nothing", () => {
    expect(StatusPageReportScheduleUtil.toDate("")).toBeUndefined();
    expect(StatusPageReportScheduleUtil.toDate(null)).toBeUndefined();
    expect(StatusPageReportScheduleUtil.toDate("soon")).toBeUndefined();
    expect(iso(StatusPageReportScheduleUtil.toDate(NOW))).toBe(NOW);
    expect(StatusPageReportScheduleUtil.toRecurring(null)).toBeUndefined();
    expect(StatusPageReportScheduleUtil.toRecurring({})).toBeUndefined();
    expect(
      StatusPageReportScheduleUtil.toRecurring(
        every(EventInterval.Year, 1).toJSON(),
      )?.toString(),
    ).toBe("1 Year");
  });

  test("a timezone moment does not know reads as UTC", () => {
    expect(StatusPageReportScheduleUtil.getTimezone("Asia/Kolkata")).toBe(
      Timezone.AsiaKolkata,
    );
    expect(StatusPageReportScheduleUtil.getTimezone("Mars/Olympus")).toBe(
      Timezone.UTC,
    );
    expect(StatusPageReportScheduleUtil.getTimezone(42)).toBe(Timezone.UTC);
  });
});
