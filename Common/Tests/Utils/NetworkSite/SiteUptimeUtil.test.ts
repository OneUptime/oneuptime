import SiteUptimeUtil, {
  DailyUptimeEntry,
  SiteMaintenanceWindow,
  SiteStatusTimelineRow,
} from "../../../Utils/NetworkSite/SiteUptimeUtil";

const WINDOW_START: Date = new Date("2026-07-22T00:00:00Z");
const WINDOW_END: Date = new Date("2026-07-23T00:00:00Z"); // 24h window

function hoursAfterStart(hours: number): Date {
  return new Date(WINDOW_START.getTime() + hours * 60 * 60 * 1000);
}

function row(data: {
  startsAt: Date;
  endsAt: Date | null;
  isOperationalState: boolean;
  priority?: number;
}): SiteStatusTimelineRow {
  return {
    monitorStatusId: data.isOperationalState ? "operational" : "down",
    startsAt: data.startsAt,
    endsAt: data.endsAt,
    priority: data.priority ?? (data.isOperationalState ? 1 : 3),
    isOperationalState: data.isOperationalState,
  };
}

describe("SiteUptimeUtil.calculateUptimePercent", () => {
  it("is 100 with no timeline rows", () => {
    expect(
      SiteUptimeUtil.calculateUptimePercent([], WINDOW_START, WINDOW_END),
    ).toBe(100);
  });

  it("is 100 when every row is operational", () => {
    expect(
      SiteUptimeUtil.calculateUptimePercent(
        [
          row({
            startsAt: WINDOW_START,
            endsAt: null,
            isOperationalState: true,
          }),
        ],
        WINDOW_START,
        WINDOW_END,
      ),
    ).toBe(100);
  });

  it("is 0 when a non-operational row covers the whole window", () => {
    expect(
      SiteUptimeUtil.calculateUptimePercent(
        [
          row({
            startsAt: WINDOW_START,
            endsAt: WINDOW_END,
            isOperationalState: false,
          }),
        ],
        WINDOW_START,
        WINDOW_END,
      ),
    ).toBe(0);
  });

  it("an open row (endsAt null) extends to the window end", () => {
    // Down from hour 18 onwards -> 6h down of 24h -> 75% up.
    expect(
      SiteUptimeUtil.calculateUptimePercent(
        [
          row({
            startsAt: hoursAfterStart(18),
            endsAt: null,
            isOperationalState: false,
          }),
        ],
        WINDOW_START,
        WINDOW_END,
      ),
    ).toBe(75);
  });

  it("clamps rows that extend beyond both window edges", () => {
    // Down row spans well beyond the window on both sides -> 0% up.
    expect(
      SiteUptimeUtil.calculateUptimePercent(
        [
          row({
            startsAt: new Date("2026-07-20T00:00:00Z"),
            endsAt: new Date("2026-07-25T00:00:00Z"),
            isOperationalState: false,
          }),
        ],
        WINDOW_START,
        WINDOW_END,
      ),
    ).toBe(0);
  });

  it("clamps a row that starts before the window", () => {
    // Down until hour 6 -> 18h up of 24h -> 75%.
    expect(
      SiteUptimeUtil.calculateUptimePercent(
        [
          row({
            startsAt: new Date("2026-07-21T12:00:00Z"),
            endsAt: hoursAfterStart(6),
            isOperationalState: false,
          }),
        ],
        WINDOW_START,
        WINDOW_END,
      ),
    ).toBe(75);
  });

  it("ignores rows entirely outside the window", () => {
    expect(
      SiteUptimeUtil.calculateUptimePercent(
        [
          row({
            startsAt: new Date("2026-07-20T00:00:00Z"),
            endsAt: new Date("2026-07-21T00:00:00Z"),
            isOperationalState: false,
          }),
          row({
            startsAt: new Date("2026-07-24T00:00:00Z"),
            endsAt: new Date("2026-07-25T00:00:00Z"),
            isOperationalState: false,
          }),
        ],
        WINDOW_START,
        WINDOW_END,
      ),
    ).toBe(100);
  });

  it("merges overlapping down rows so no second is counted twice", () => {
    // [2h, 8h] and [6h, 12h] overlap -> merged 10h down -> ~58.33% up.
    const percent: number = SiteUptimeUtil.calculateUptimePercent(
      [
        row({
          startsAt: hoursAfterStart(2),
          endsAt: hoursAfterStart(8),
          isOperationalState: false,
        }),
        row({
          startsAt: hoursAfterStart(6),
          endsAt: hoursAfterStart(12),
          isOperationalState: false,
        }),
      ],
      WINDOW_START,
      WINDOW_END,
    );
    expect(percent).toBeCloseTo(((24 - 10) / 24) * 100, 10);
  });

  it("merges a row contained inside another", () => {
    const percent: number = SiteUptimeUtil.calculateUptimePercent(
      [
        row({
          startsAt: hoursAfterStart(2),
          endsAt: hoursAfterStart(12),
          isOperationalState: false,
        }),
        row({
          startsAt: hoursAfterStart(4),
          endsAt: hoursAfterStart(6),
          isOperationalState: false,
        }),
      ],
      WINDOW_START,
      WINDOW_END,
    );
    expect(percent).toBeCloseTo(((24 - 10) / 24) * 100, 10);
  });

  it("sums disjoint down rows", () => {
    // 3h + 3h down -> 18h up -> 75%.
    const percent: number = SiteUptimeUtil.calculateUptimePercent(
      [
        row({
          startsAt: hoursAfterStart(1),
          endsAt: hoursAfterStart(4),
          isOperationalState: false,
        }),
        row({
          startsAt: hoursAfterStart(10),
          endsAt: hoursAfterStart(13),
          isOperationalState: false,
        }),
      ],
      WINDOW_START,
      WINDOW_END,
    );
    expect(percent).toBe(75);
  });

  it("interleaves operational and non-operational rows correctly", () => {
    // Operational rows never subtract, whatever they overlap.
    const percent: number = SiteUptimeUtil.calculateUptimePercent(
      [
        row({
          startsAt: WINDOW_START,
          endsAt: hoursAfterStart(12),
          isOperationalState: true,
        }),
        row({
          startsAt: hoursAfterStart(12),
          endsAt: hoursAfterStart(18),
          isOperationalState: false,
        }),
        row({
          startsAt: hoursAfterStart(18),
          endsAt: null,
          isOperationalState: true,
        }),
      ],
      WINDOW_START,
      WINDOW_END,
    );
    expect(percent).toBe(75);
  });

  it("a zero-length down row contributes nothing", () => {
    expect(
      SiteUptimeUtil.calculateUptimePercent(
        [
          row({
            startsAt: hoursAfterStart(5),
            endsAt: hoursAfterStart(5),
            isOperationalState: false,
          }),
        ],
        WINDOW_START,
        WINDOW_END,
      ),
    ).toBe(100);
  });

  it("returns 100 for a zero-length or inverted window", () => {
    expect(
      SiteUptimeUtil.calculateUptimePercent([], WINDOW_START, WINDOW_START),
    ).toBe(100);
    expect(
      SiteUptimeUtil.calculateUptimePercent([], WINDOW_END, WINDOW_START),
    ).toBe(100);
  });

  it("an open down row starting exactly at windowEnd contributes nothing", () => {
    expect(
      SiteUptimeUtil.calculateUptimePercent(
        [
          row({
            startsAt: WINDOW_END,
            endsAt: null,
            isOperationalState: false,
          }),
        ],
        WINDOW_START,
        WINDOW_END,
      ),
    ).toBe(100);
  });

  it("non-operational status of ANY priority counts as down (degraded too)", () => {
    expect(
      SiteUptimeUtil.calculateUptimePercent(
        [
          row({
            startsAt: WINDOW_START,
            endsAt: hoursAfterStart(6),
            isOperationalState: false,
            priority: 2, // degraded
          }),
        ],
        WINDOW_START,
        WINDOW_END,
      ),
    ).toBe(75);
  });
});

/*
 * Maintenance exclusion and the daily strip (issue #3431).
 *
 * The rule under test, stated once: a maintenance window is subtracted from
 * BOTH sides of the fraction. Subtracting it only from the downtime would
 * report a planned outage as perfect uptime; subtracting it from neither is
 * the behaviour the issue was filed about.
 */

const MS_IN_AN_HOUR: number = 60 * 60 * 1000;

function maintenance(
  fromHour: number,
  toHour: number | null,
): SiteMaintenanceWindow {
  return {
    startsAt: hoursAfterStart(fromHour),
    endsAt: toHour === null ? null : hoursAfterStart(toHour),
  };
}

describe("SiteUptimeUtil.calculateUptimePercent with maintenance", () => {
  it("excludes maintenance downtime from BOTH the outage and the measured period", () => {
    /*
     * Two hours down, entirely inside a two-hour window. The day becomes 22
     * hours long with nothing wrong in it — 100%, not 91.7% (down counted)
     * and not 100% of 24 hours either, which would be the same number by
     * accident here. The next test separates those two readings.
     */
    expect(
      SiteUptimeUtil.calculateUptimePercent(
        [
          row({
            startsAt: hoursAfterStart(2),
            endsAt: hoursAfterStart(4),
            isOperationalState: false,
          }),
        ],
        WINDOW_START,
        WINDOW_END,
        [maintenance(2, 4)],
      ),
    ).toBe(100);
  });

  it("shrinks the denominator, so unplanned downtime beside a window weighs MORE", () => {
    /*
     * One hour of real outage in a day that also had 12 hours of planned
     * work. Measured against the remaining 12 hours that is 91.67%, not the
     * 95.83% you would get by leaving the denominator at 24. The site was
     * only being watched for half the day; the failure should count against
     * the half that was watched.
     */
    const percent: number = SiteUptimeUtil.calculateUptimePercent(
      [
        row({
          startsAt: hoursAfterStart(20),
          endsAt: hoursAfterStart(21),
          isOperationalState: false,
        }),
      ],
      WINDOW_START,
      WINDOW_END,
      [maintenance(0, 12)],
    );

    expect(percent).toBeCloseTo((11 / 12) * 100, 6);
  });

  it("counts only the part of an outage that falls outside the window", () => {
    /*
     * Down 02:00-06:00, maintenance 02:00-04:00. Two hours count, out of a
     * 22-hour measured period.
     */
    const percent: number = SiteUptimeUtil.calculateUptimePercent(
      [
        row({
          startsAt: hoursAfterStart(2),
          endsAt: hoursAfterStart(6),
          isOperationalState: false,
        }),
      ],
      WINDOW_START,
      WINDOW_END,
      [maintenance(2, 4)],
    );

    expect(percent).toBeCloseTo((20 / 22) * 100, 6);
  });

  it("reports 100 when the whole window is maintenance", () => {
    /*
     * Nothing left to measure. Zero would be a lie (nothing unplanned
     * failed) and NaN would poison every consumer.
     */
    expect(
      SiteUptimeUtil.calculateUptimePercent(
        [
          row({
            startsAt: WINDOW_START,
            endsAt: WINDOW_END,
            isOperationalState: false,
          }),
        ],
        WINDOW_START,
        WINDOW_END,
        [maintenance(-5, 30)],
      ),
    ).toBe(100);
  });

  it("merges overlapping windows instead of double-subtracting them", () => {
    /*
     * 00:00-06:00 and 04:00-08:00 overlap. Subtracting both lengths would
     * remove 10 hours from a 24-hour day rather than 8, and the whole
     * fraction would be wrong.
     */
    const percent: number = SiteUptimeUtil.calculateUptimePercent(
      [
        row({
          startsAt: hoursAfterStart(10),
          endsAt: hoursAfterStart(12),
          isOperationalState: false,
        }),
      ],
      WINDOW_START,
      WINDOW_END,
      [maintenance(0, 6), maintenance(4, 8)],
    );

    expect(percent).toBeCloseTo((14 / 16) * 100, 6);
  });

  it("an open-ended window runs to the end of the measured period", () => {
    expect(
      SiteUptimeUtil.calculateUptimePercent(
        [
          row({
            startsAt: hoursAfterStart(20),
            endsAt: null,
            isOperationalState: false,
          }),
        ],
        WINDOW_START,
        WINDOW_END,
        [maintenance(20, null)],
      ),
    ).toBe(100);
  });

  it("is unchanged by a window that does not overlap the measured period", () => {
    const withoutWindow: number = SiteUptimeUtil.calculateUptimePercent(
      [
        row({
          startsAt: hoursAfterStart(2),
          endsAt: hoursAfterStart(4),
          isOperationalState: false,
        }),
      ],
      WINDOW_START,
      WINDOW_END,
    );

    const withWindow: number = SiteUptimeUtil.calculateUptimePercent(
      [
        row({
          startsAt: hoursAfterStart(2),
          endsAt: hoursAfterStart(4),
          isOperationalState: false,
        }),
      ],
      WINDOW_START,
      WINDOW_END,
      [maintenance(-10, -5)],
    );

    expect(withWindow).toBe(withoutWindow);
  });
});

describe("SiteUptimeUtil.isUnderMaintenanceAt", () => {
  it("is true inside a window and false on its closing edge", () => {
    expect(
      SiteUptimeUtil.isUnderMaintenanceAt(
        [maintenance(2, 4)],
        hoursAfterStart(3),
      ),
    ).toBe(true);
    // Half-open, matching how every other interval here is treated.
    expect(
      SiteUptimeUtil.isUnderMaintenanceAt(
        [maintenance(2, 4)],
        hoursAfterStart(4),
      ),
    ).toBe(false);
    expect(
      SiteUptimeUtil.isUnderMaintenanceAt(
        [maintenance(2, 4)],
        hoursAfterStart(2),
      ),
    ).toBe(true);
  });

  it("treats an open-ended window as still running", () => {
    expect(
      SiteUptimeUtil.isUnderMaintenanceAt(
        [maintenance(2, null)],
        hoursAfterStart(500),
      ),
    ).toBe(true);
  });

  it("is false with no windows", () => {
    expect(SiteUptimeUtil.isUnderMaintenanceAt([], hoursAfterStart(3))).toBe(
      false,
    );
  });
});

describe("SiteUptimeUtil.calculateDailyUptime", () => {
  /*
   * The strip exists because a 30-day average cannot show a bad day: a full
   * day of outage moves it by 3.3 points. These pin that the per-day
   * numbers actually separate the bad day out.
   */
  it("returns one entry per day, oldest first, each 24 hours long", () => {
    const entries: Array<DailyUptimeEntry> =
      SiteUptimeUtil.calculateDailyUptime({
        rows: [
          row({
            startsAt: new Date(WINDOW_END.getTime() - 30 * 24 * MS_IN_AN_HOUR),
            endsAt: null,
            isOperationalState: true,
          }),
        ],
        days: 7,
        endDate: WINDOW_END,
      });

    expect(entries).toHaveLength(7);
    expect(entries[6]!.dayEnd.getTime()).toBe(WINDOW_END.getTime());
    expect(entries[0]!.dayStart.getTime()).toBe(
      WINDOW_END.getTime() - 7 * 24 * MS_IN_AN_HOUR,
    );
    for (const entry of entries) {
      expect(entry.dayEnd.getTime() - entry.dayStart.getTime()).toBe(
        24 * MS_IN_AN_HOUR,
      );
    }
  });

  it("isolates one bad day that the 30-day average would bury", () => {
    /*
     * Down for the whole of the day that ended 3 days ago. The 30-day
     * figure reads 96.7% — noise. The strip reads 0% for that one bar.
     */
    const badDayEnd: Date = new Date(
      WINDOW_END.getTime() - 3 * 24 * MS_IN_AN_HOUR,
    );
    const badDayStart: Date = new Date(
      badDayEnd.getTime() - 24 * MS_IN_AN_HOUR,
    );

    const rows: Array<SiteStatusTimelineRow> = [
      row({
        startsAt: new Date(WINDOW_END.getTime() - 30 * 24 * MS_IN_AN_HOUR),
        endsAt: badDayStart,
        isOperationalState: true,
      }),
      row({
        startsAt: badDayStart,
        endsAt: badDayEnd,
        isOperationalState: false,
      }),
      row({ startsAt: badDayEnd, endsAt: null, isOperationalState: true }),
    ];

    const monthly: number = SiteUptimeUtil.calculateUptimePercent(
      rows,
      new Date(WINDOW_END.getTime() - 30 * 24 * MS_IN_AN_HOUR),
      WINDOW_END,
    );
    expect(monthly).toBeCloseTo((29 / 30) * 100, 6);

    const entries: Array<DailyUptimeEntry> =
      SiteUptimeUtil.calculateDailyUptime({
        rows: rows,
        days: 30,
        endDate: WINDOW_END,
      });

    // entries[26] is the day ending 3 days before the window end.
    const badEntry: DailyUptimeEntry = entries[26]!;
    expect(badEntry.dayEnd.getTime()).toBe(badDayEnd.getTime());
    expect(badEntry.uptimePercent).toBe(0);
    expect(entries[27]!.uptimePercent).toBe(100);
  });

  it("marks a day entirely inside a maintenance window rather than calling it perfect", () => {
    const rows: Array<SiteStatusTimelineRow> = [
      row({
        startsAt: new Date(WINDOW_END.getTime() - 5 * 24 * MS_IN_AN_HOUR),
        endsAt: null,
        isOperationalState: false,
      }),
    ];

    const entries: Array<DailyUptimeEntry> =
      SiteUptimeUtil.calculateDailyUptime({
        rows: rows,
        days: 3,
        endDate: WINDOW_END,
        maintenanceWindows: [
          {
            startsAt: new Date(WINDOW_END.getTime() - 2 * 24 * MS_IN_AN_HOUR),
            endsAt: new Date(WINDOW_END.getTime() - 1 * 24 * MS_IN_AN_HOUR),
          },
        ],
      });

    const maintainedDay: DailyUptimeEntry = entries[1]!;
    expect(maintainedDay.isFullyMaintained).toBe(true);
    expect(maintainedDay.uptimePercent).toBeNull();
    expect(maintainedDay.maintenanceInMs).toBe(24 * MS_IN_AN_HOUR);
    // The neighbouring days are still measured, and still down.
    expect(entries[0]!.uptimePercent).toBe(0);
    expect(entries[2]!.uptimePercent).toBe(0);
  });

  it("reports days before the timeline begins as uncovered, not as 100%", () => {
    /*
     * A site attached yesterday must not draw a solid green month. "We were
     * not watching" is a different fact from "nothing was wrong".
     */
    const entries: Array<DailyUptimeEntry> =
      SiteUptimeUtil.calculateDailyUptime({
        rows: [
          row({
            startsAt: new Date(WINDOW_END.getTime() - 1 * 24 * MS_IN_AN_HOUR),
            endsAt: null,
            isOperationalState: true,
          }),
        ],
        days: 5,
        endDate: WINDOW_END,
      });

    expect(entries[0]!.hasTimelineCoverage).toBe(false);
    expect(entries[0]!.uptimePercent).toBeNull();
    expect(entries[4]!.hasTimelineCoverage).toBe(true);
    expect(entries[4]!.uptimePercent).toBe(100);
  });

  it("subtracts a partial maintenance window from a day's denominator", () => {
    /*
     * Six hours of maintenance and three hours of unplanned outage in the
     * last day: 15 good hours out of 18 measured, not 21 out of 24.
     */
    const dayStart: Date = new Date(WINDOW_END.getTime() - 24 * MS_IN_AN_HOUR);

    const entries: Array<DailyUptimeEntry> =
      SiteUptimeUtil.calculateDailyUptime({
        rows: [
          row({
            startsAt: new Date(WINDOW_END.getTime() - 10 * 24 * MS_IN_AN_HOUR),
            endsAt: new Date(dayStart.getTime() + 6 * MS_IN_AN_HOUR),
            isOperationalState: true,
          }),
          row({
            startsAt: new Date(dayStart.getTime() + 6 * MS_IN_AN_HOUR),
            endsAt: new Date(dayStart.getTime() + 9 * MS_IN_AN_HOUR),
            isOperationalState: false,
          }),
          row({
            startsAt: new Date(dayStart.getTime() + 9 * MS_IN_AN_HOUR),
            endsAt: null,
            isOperationalState: true,
          }),
        ],
        days: 1,
        endDate: WINDOW_END,
        maintenanceWindows: [
          {
            startsAt: dayStart,
            endsAt: new Date(dayStart.getTime() + 6 * MS_IN_AN_HOUR),
          },
        ],
      });

    const entry: DailyUptimeEntry = entries[0]!;
    expect(entry.isFullyMaintained).toBe(false);
    expect(entry.maintenanceInMs).toBe(6 * MS_IN_AN_HOUR);
    expect(entry.downtimeInMs).toBe(3 * MS_IN_AN_HOUR);
    expect(entry.uptimePercent).toBeCloseTo((15 / 18) * 100, 6);
  });

  it("returns nothing for a non-positive day count", () => {
    expect(
      SiteUptimeUtil.calculateDailyUptime({
        rows: [],
        days: 0,
        endDate: WINDOW_END,
      }),
    ).toEqual([]);
  });
});

describe("SiteUptimeUtil.subtractIntervals", () => {
  it("punches every hole out of every interval", () => {
    expect(
      SiteUptimeUtil.subtractIntervals(
        [{ startInMs: 0, endInMs: 100 }],
        [
          { startInMs: 10, endInMs: 20 },
          { startInMs: 50, endInMs: 60 },
        ],
      ),
    ).toEqual([
      { startInMs: 0, endInMs: 10 },
      { startInMs: 20, endInMs: 50 },
      { startInMs: 60, endInMs: 100 },
    ]);
  });

  it("merges overlapping holes before subtracting", () => {
    expect(
      SiteUptimeUtil.subtractIntervals(
        [{ startInMs: 0, endInMs: 100 }],
        [
          { startInMs: 10, endInMs: 40 },
          { startInMs: 30, endInMs: 60 },
        ],
      ),
    ).toEqual([
      { startInMs: 0, endInMs: 10 },
      { startInMs: 60, endInMs: 100 },
    ]);
  });

  it("returns the interval untouched when no hole overlaps it", () => {
    expect(
      SiteUptimeUtil.subtractIntervals(
        [{ startInMs: 0, endInMs: 100 }],
        [{ startInMs: 200, endInMs: 300 }],
      ),
    ).toEqual([{ startInMs: 0, endInMs: 100 }]);
  });

  it("removes an interval entirely covered by a hole", () => {
    expect(
      SiteUptimeUtil.subtractIntervals(
        [{ startInMs: 10, endInMs: 20 }],
        [{ startInMs: 0, endInMs: 100 }],
      ),
    ).toEqual([]);
  });
});
