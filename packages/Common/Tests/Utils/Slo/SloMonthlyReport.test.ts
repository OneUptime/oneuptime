import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
import { Green, Red } from "../../../Types/BrandColors";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import SliType from "../../../Types/ServiceLevelObjective/SliType";
import SloMultiMonitorMode from "../../../Types/ServiceLevelObjective/SloMultiMonitorMode";
import {
  SLO_MONTHLY_REPORT_DEFAULT_MONTHS,
  SLO_MONTHLY_REPORT_OPTION_ERRORS,
  SLO_MONTHLY_REPORT_UNAVAILABLE_MESSAGES,
  SloJudgedFigures,
  SloMonitorUptimeMonthlyFigures,
  SloMonthVerdict,
  SloMonthlyFigures,
  SloMonthlyReport,
  SloMonthlyReportPeriod,
  SloMonthlyReportPeriodKind,
  SloMonthlyReportSummary,
  SloMonthlyReportUnavailableReason,
  SloMonthlyReportUnit,
  SloReportMonth,
  buildSloMonthlyReport,
  buildSloMonthlyReportCsv,
  buildUnavailableSloMonthlyReport,
  computeMonitorUptimeMonthlyFigures,
  getRequestMonthlyFigures,
  getSloErrorBudgetUsedPercentage,
  getSloMonthVerdict,
  getSloMonthlyReportFilename,
  getSloMonthlyReportPeriodQuery,
  getSloMonthlyReportSummary,
  getSloMonthlyReportTimezone,
  getSloReportMonths,
  getTimelinesInMonth,
  isSameSloMonthlyReportPeriod,
  judgeSloMonthlyFigures,
  parseSloMonthlyReport,
  parseSloMonthlyReportPeriod,
  sloMonthlyReportToJSON,
  sumSloMonthlyFigures,
  toSloCsvField,
} from "../../../Utils/Slo/SloMonthlyReport";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * An SLO's monthly report (#5476): which months a period covers, in the
 * SLO's timezone; each month measured from its monitors' status timelines
 * exactly as the evaluation worker measures a window; each month and the
 * total judged against the target; and the report read back from JSON and
 * written as a CSV file. "Now" is pinned, as SloUtil's tests pin it: the
 * month still running is measured up to it.
 */

const NOW: Date = new Date("2026-11-16T12:00:00.000Z");

const HOUR: number = 3600;
const DAY: number = 86400;

const SLO_ID: string = "5476aaaa-0000-4000-8000-000000000001";

const MONITOR_A_ID: ObjectID = new ObjectID(
  "5476aaaa-0000-4000-8000-0000000000a1",
);
const MONITOR_B_ID: ObjectID = new ObjectID(
  "5476aaaa-0000-4000-8000-0000000000b2",
);
const OFFLINE_STATUS_ID: ObjectID = new ObjectID(
  "5476aaaa-0000-4000-8000-0000000000f1",
);
const OPERATIONAL_STATUS_ID: ObjectID = new ObjectID(
  "5476aaaa-0000-4000-8000-0000000000f2",
);

const offlineStatus: MonitorStatus = new MonitorStatus();
offlineStatus.id = OFFLINE_STATUS_ID;
offlineStatus.name = "Offline";
offlineStatus.priority = 2;
offlineStatus.color = Red;

const DOWNTIME_STATUSES: Array<MonitorStatus> = [offlineStatus];

type RowFunction = (
  monitorId: ObjectID,
  startsAt: string,
  endsAt?: string | undefined,
  isMonitoringOff?: boolean | undefined,
) => MonitorStatusTimeline;

const row: (statusId: ObjectID, name: string) => RowFunction = (
  statusId: ObjectID,
  name: string,
): RowFunction => {
  return (
    monitorId: ObjectID,
    startsAt: string,
    endsAt?: string | undefined,
    isMonitoringOff?: boolean | undefined,
  ): MonitorStatusTimeline => {
    const status: MonitorStatus = new MonitorStatus();
    status.id = statusId;
    status.name = name;
    status.priority = name === "Offline" ? 2 : 1;
    status.color = name === "Offline" ? Red : Green;

    const timeline: MonitorStatusTimeline = new MonitorStatusTimeline();
    timeline.monitorId = monitorId;
    timeline.monitorStatusId = statusId;
    timeline.monitorStatus = status;
    timeline.startsAt = new Date(startsAt);

    // An open row has no end, as the database keeps it.
    if (endsAt) {
      timeline.endsAt = new Date(endsAt);
    }

    if (isMonitoringOff) {
      timeline.isMonitoringOff = true;
    }

    return timeline;
  };
};

const operational: RowFunction = row(OPERATIONAL_STATUS_ID, "Operational");
const offline: RowFunction = row(OFFLINE_STATUS_ID, "Offline");

const lastMonths: (months: number) => SloMonthlyReportPeriod = (
  months: number,
): SloMonthlyReportPeriod => {
  return { kind: SloMonthlyReportPeriodKind.LastMonths, months: months };
};

const year: (value: number) => SloMonthlyReportPeriod = (
  value: number,
): SloMonthlyReportPeriod => {
  return { kind: SloMonthlyReportPeriodKind.Year, year: value };
};

const iso: (months: Array<SloReportMonth>) => Array<string> = (
  months: Array<SloReportMonth>,
): Array<string> => {
  return months.map((month: SloReportMonth): string => {
    return `${month.startDate.toISOString()}..${month.endDate.toISOString()}${month.isMonthToDate ? " (to date)" : ""}`;
  });
};

const figures: (total: number, bad: number) => SloMonthlyFigures = (
  total: number,
  bad: number,
): SloMonthlyFigures => {
  return {
    total: total,
    bad: bad,
    sliPercentage: total > 0 ? ((total - bad) / total) * 100 : null,
  };
};

const NO_DATA: SloMonthlyFigures = { total: 0, bad: 0, sliPercentage: null };

describe("SloMonthlyReport", () => {
  beforeAll(() => {
    jest.useFakeTimers({ now: NOW });
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  describe("parseSloMonthlyReportPeriod", () => {
    test("asks for nothing: the last 12 months, the Dashboard's default", () => {
      expect(parseSloMonthlyReportPeriod({ now: NOW })).toEqual(
        lastMonths(SLO_MONTHLY_REPORT_DEFAULT_MONTHS),
      );
      expect(
        parseSloMonthlyReportPeriod({ months: "", year: "", now: NOW }),
      ).toEqual(lastMonths(12));
    });

    test.each([
      ["3", 3],
      ["6", 6],
      [" 9 ", 9],
      [12, 12],
      ["1", 1],
      ["24", 24],
    ])("reads months=%p as the last %p months", (value: unknown, n: number) => {
      expect(parseSloMonthlyReportPeriod({ months: value, now: NOW })).toEqual(
        lastMonths(n),
      );
    });

    test.each([["0"], ["25"], ["-1"], ["2.5"], [2.5], ["six"], [true]])(
      "refuses months=%p with what to send instead",
      (value: unknown) => {
        expect(() => {
          parseSloMonthlyReportPeriod({ months: value, now: NOW });
        }).toThrow(
          new BadDataException(SLO_MONTHLY_REPORT_OPTION_ERRORS.months),
        );
      },
    );

    test("reads a calendar year, from 2000 to a year past the current one", () => {
      expect(parseSloMonthlyReportPeriod({ year: "2025", now: NOW })).toEqual(
        year(2025),
      );
      expect(parseSloMonthlyReportPeriod({ year: 2000, now: NOW })).toEqual(
        year(2000),
      );
      // In a zone ahead of UTC, the new year starts a few hours earlier.
      expect(parseSloMonthlyReportPeriod({ year: "2027", now: NOW })).toEqual(
        year(2027),
      );
    });

    test.each([["1999"], ["2028"], ["20x5"], ["-2025"]])(
      "refuses year=%p",
      (value: unknown) => {
        expect(() => {
          parseSloMonthlyReportPeriod({ year: value, now: NOW });
        }).toThrow(new BadDataException(SLO_MONTHLY_REPORT_OPTION_ERRORS.year));
      },
    );

    test("refuses months and year together", () => {
      expect(() => {
        parseSloMonthlyReportPeriod({ months: "6", year: "2025", now: NOW });
      }).toThrow(new BadDataException(SLO_MONTHLY_REPORT_OPTION_ERRORS.both));
    });

    test("every refusal is a sentence", () => {
      for (const message of Object.values(SLO_MONTHLY_REPORT_OPTION_ERRORS)) {
        expect(message).toMatch(/^[A-Z]/);
        expect(message.endsWith(".")).toBe(true);
      }
    });

    test("writes a period back as the query the API reads", () => {
      expect(getSloMonthlyReportPeriodQuery(lastMonths(6))).toEqual({
        months: "6",
      });
      expect(getSloMonthlyReportPeriodQuery(year(2025))).toEqual({
        year: "2025",
      });
      expect(
        parseSloMonthlyReportPeriod({
          ...getSloMonthlyReportPeriodQuery(year(2025)),
          now: NOW,
        }),
      ).toEqual(year(2025));
    });

    test("tells two periods apart", () => {
      expect(isSameSloMonthlyReportPeriod(lastMonths(6), lastMonths(6))).toBe(
        true,
      );
      expect(isSameSloMonthlyReportPeriod(lastMonths(6), lastMonths(3))).toBe(
        false,
      );
      expect(isSameSloMonthlyReportPeriod(year(2025), year(2025))).toBe(true);
      expect(isSameSloMonthlyReportPeriod(year(2025), lastMonths(12))).toBe(
        false,
      );
      expect(isSameSloMonthlyReportPeriod(lastMonths(12), year(2025))).toBe(
        false,
      );
    });
  });

  describe("getSloReportMonths", () => {
    test("the last 3 months end with the month to date", () => {
      expect(
        iso(getSloReportMonths({ period: lastMonths(3), now: NOW })),
      ).toEqual([
        "2026-09-01T00:00:00.000Z..2026-10-01T00:00:00.000Z",
        "2026-10-01T00:00:00.000Z..2026-11-01T00:00:00.000Z",
        "2026-11-01T00:00:00.000Z..2026-12-01T00:00:00.000Z (to date)",
      ]);
    });

    test("the last 12 months reach back into last year, oldest first", () => {
      const months: Array<SloReportMonth> = getSloReportMonths({
        period: lastMonths(12),
        now: NOW,
      });

      expect(months).toHaveLength(12);
      expect(months[0]!.startDate.toISOString()).toBe(
        "2025-12-01T00:00:00.000Z",
      );
      expect(months[11]!.startDate.toISOString()).toBe(
        "2026-11-01T00:00:00.000Z",
      );
      expect(
        months.filter((month: SloReportMonth): boolean => {
          return month.isMonthToDate;
        }),
      ).toHaveLength(1);
    });

    test("a past year is its twelve months, none of them to date", () => {
      const months: Array<SloReportMonth> = getSloReportMonths({
        period: year(2025),
        now: NOW,
      });

      expect(months).toHaveLength(12);
      expect(months[0]!.startDate.toISOString()).toBe(
        "2025-01-01T00:00:00.000Z",
      );
      expect(months[11]!.endDate.toISOString()).toBe(
        "2026-01-01T00:00:00.000Z",
      );
      expect(
        months.some((month: SloReportMonth): boolean => {
          return month.isMonthToDate;
        }),
      ).toBe(false);
    });

    test("this year stops at the month to date", () => {
      const months: Array<SloReportMonth> = getSloReportMonths({
        period: year(2026),
        now: NOW,
      });

      expect(months).toHaveLength(11);
      expect(months[10]!.isMonthToDate).toBe(true);
      expect(months[10]!.startDate.toISOString()).toBe(
        "2026-11-01T00:00:00.000Z",
      );
    });

    test("a year that has not started has no months", () => {
      expect(getSloReportMonths({ period: year(2027), now: NOW })).toEqual([]);
    });

    test("the months are cut in the SLO's timezone, through daylight saving time", () => {
      const months: Array<SloReportMonth> = getSloReportMonths({
        period: year(2026),
        timezone: "Europe/Berlin",
        now: NOW,
      });

      // CET in winter (UTC+1), CEST in summer (UTC+2).
      expect(months[0]!.startDate.toISOString()).toBe(
        "2025-12-31T23:00:00.000Z",
      );
      expect(months[3]!.startDate.toISOString()).toBe(
        "2026-03-31T22:00:00.000Z",
      );
      expect(months[10]!.startDate.toISOString()).toBe(
        "2026-10-31T23:00:00.000Z",
      );

      // March is an hour short, October an hour long: real seconds.
      expect(
        (months[2]!.endDate.getTime() - months[2]!.startDate.getTime()) / 1000,
      ).toBe(31 * DAY - HOUR);
      expect(
        (months[9]!.endDate.getTime() - months[9]!.startDate.getTime()) / 1000,
      ).toBe(31 * DAY + HOUR);

      // Each month ends where the next one starts.
      for (let index: number = 1; index < months.length; index++) {
        expect(months[index]!.startDate.getTime()).toBe(
          months[index - 1]!.endDate.getTime(),
        );
      }
    });

    test("a timezone ahead of UTC is already in next month's first hours", () => {
      const months: Array<SloReportMonth> = getSloReportMonths({
        period: lastMonths(1),
        timezone: "Pacific/Kiritimati",
        now: new Date("2026-11-30T11:00:00.000Z"),
      });

      // 11:00 UTC on November 30th is 01:00 on December 1st in Kiritimati (UTC+14).
      expect(iso(months)).toEqual([
        "2026-11-30T10:00:00.000Z..2026-12-31T10:00:00.000Z (to date)",
      ]);
    });

    test("the first instant of a month starts it: the month before is over", () => {
      const months: Array<SloReportMonth> = getSloReportMonths({
        period: lastMonths(2),
        now: new Date("2026-11-01T00:00:00.000Z"),
      });

      expect(iso(months)).toEqual([
        "2026-10-01T00:00:00.000Z..2026-11-01T00:00:00.000Z",
        "2026-11-01T00:00:00.000Z..2026-12-01T00:00:00.000Z (to date)",
      ]);
    });

    test("a timezone the server does not know cuts the months in UTC", () => {
      expect(getSloMonthlyReportTimezone("Mars/Olympus_Mons")).toBe("UTC");
      expect(getSloMonthlyReportTimezone(undefined)).toBe("UTC");
      expect(getSloMonthlyReportTimezone("")).toBe("UTC");
      expect(getSloMonthlyReportTimezone(" Asia/Tokyo ")).toBe("Asia/Tokyo");

      expect(
        iso(
          getSloReportMonths({
            period: lastMonths(1),
            timezone: "Mars/Olympus_Mons",
            now: NOW,
          }),
        ),
      ).toEqual([
        "2026-11-01T00:00:00.000Z..2026-12-01T00:00:00.000Z (to date)",
      ]);
    });
  });

  describe("getTimelinesInMonth", () => {
    const october: { startDate: Date; endDate: Date } = {
      startDate: new Date("2026-10-01T00:00:00.000Z"),
      endDate: new Date("2026-11-01T00:00:00.000Z"),
    };

    test("keeps the rows that hold time inside the month, and an open row that started before it", () => {
      const kept: Array<MonitorStatusTimeline> = getTimelinesInMonth(
        [
          operational(
            MONITOR_A_ID,
            "2026-09-01T00:00:00.000Z",
            "2026-10-05T00:00:00.000Z",
          ),
          offline(
            MONITOR_A_ID,
            "2026-10-05T00:00:00.000Z",
            "2026-10-05T01:00:00.000Z",
          ),
          operational(MONITOR_A_ID, "2026-10-05T01:00:00.000Z"),
        ],
        october,
      );

      expect(kept).toHaveLength(3);
    });

    test("leaves out a row that only touches the month at either end", () => {
      const kept: Array<MonitorStatusTimeline> = getTimelinesInMonth(
        [
          operational(
            MONITOR_A_ID,
            "2026-09-01T00:00:00.000Z",
            "2026-10-01T00:00:00.000Z",
          ),
          operational(MONITOR_A_ID, "2026-11-01T00:00:00.000Z"),
        ],
        october,
      );

      expect(kept).toEqual([]);
    });
  });

  describe("computeMonitorUptimeMonthlyFigures", () => {
    const months: Array<SloReportMonth> = getSloReportMonths({
      period: lastMonths(6),
      now: NOW,
    });

    // Jun, Jul, Aug, Sep, Oct and Nov 2026.
    const SEPTEMBER: number = 3;
    const OCTOBER: number = 4;
    const NOVEMBER: number = 5;

    /*
     * A monitor first checked on September 15th, down for an hour on
     * October 10th, and up since.
     */
    const monitorA: Array<MonitorStatusTimeline> = [
      operational(
        MONITOR_A_ID,
        "2026-09-15T00:00:00.000Z",
        "2026-10-10T00:00:00.000Z",
      ),
      offline(
        MONITOR_A_ID,
        "2026-10-10T00:00:00.000Z",
        "2026-10-10T01:00:00.000Z",
      ),
      operational(MONITOR_A_ID, "2026-10-10T01:00:00.000Z"),
    ];

    /*
     * Measured once the clock is pinned (the outer beforeAll), not when the
     * file loads: the month to date is measured up to "now".
     */
    let measured: SloMonitorUptimeMonthlyFigures;

    beforeAll(() => {
      measured = computeMonitorUptimeMonthlyFigures({
        perMonitorTimelines: [{ monitorId: MONITOR_A_ID, timelines: monitorA }],
        downtimeStatuses: DOWNTIME_STATUSES,
        mode: SloMultiMonitorMode.AnyDown,
        months: months,
      });
    });

    test("a month before the monitor had any data is no data, never up", () => {
      expect(measured.months.slice(0, SEPTEMBER)).toEqual([
        NO_DATA,
        NO_DATA,
        NO_DATA,
      ]);
    });

    test("the month the monitor started in is measured from its first check", () => {
      expect(measured.months[SEPTEMBER]).toEqual({
        total: 16 * DAY,
        bad: 0,
        sliPercentage: 100,
      });
    });

    test("an hour down in October is an hour of October's 31 days", () => {
      const october: SloMonthlyFigures = measured.months[OCTOBER]!;

      expect(october.total).toBe(31 * DAY);
      expect(october.bad).toBe(HOUR);
      expect(october.sliPercentage).toBeCloseTo(
        ((31 * DAY - HOUR) / (31 * DAY)) * 100,
        10,
      );
    });

    test("the month to date is measured up to now", () => {
      expect(measured.months[NOVEMBER]).toEqual({
        total: 15.5 * DAY,
        bad: 0,
        sliPercentage: 100,
      });
    });

    test("each monitor alone matches the SLO when it is the only one", () => {
      expect(measured.monitors).toHaveLength(1);
      expect(measured.monitors[0]!.monitorId.toString()).toBe(
        MONITOR_A_ID.toString(),
      );
      expect(measured.monitors[0]!.months).toEqual(measured.months);
    });

    test("an outage across midnight on the 1st counts in both months", () => {
      const result: SloMonitorUptimeMonthlyFigures =
        computeMonitorUptimeMonthlyFigures({
          perMonitorTimelines: [
            {
              monitorId: MONITOR_A_ID,
              timelines: [
                operational(
                  MONITOR_A_ID,
                  "2026-09-01T00:00:00.000Z",
                  "2026-09-30T23:30:00.000Z",
                ),
                offline(
                  MONITOR_A_ID,
                  "2026-09-30T23:30:00.000Z",
                  "2026-10-01T00:30:00.000Z",
                ),
                operational(MONITOR_A_ID, "2026-10-01T00:30:00.000Z"),
              ],
            },
          ],
          downtimeStatuses: DOWNTIME_STATUSES,
          mode: SloMultiMonitorMode.AnyDown,
          months: months,
        });

      expect(result.months[SEPTEMBER]!.bad).toBe(1800);
      expect(result.months[SEPTEMBER]!.total).toBe(30 * DAY);
      expect(result.months[OCTOBER]!.bad).toBe(1800);
      expect(result.months[OCTOBER]!.total).toBe(31 * DAY);
    });

    describe("two monitors, down at overlapping times in October", () => {
      /*
       * A is down 10:00-11:00 on October 5th and B 10:30-11:30: an hour
       * and a half of the SLO down when any monitor down counts, two
       * monitor-hours when the monitors are averaged. B was created on
       * October 1st, so it has no September.
       */
      const perMonitorTimelines: Array<{
        monitorId: ObjectID;
        timelines: Array<MonitorStatusTimeline>;
      }> = [
        {
          monitorId: MONITOR_A_ID,
          timelines: [
            operational(
              MONITOR_A_ID,
              "2026-09-01T00:00:00.000Z",
              "2026-10-05T10:00:00.000Z",
            ),
            offline(
              MONITOR_A_ID,
              "2026-10-05T10:00:00.000Z",
              "2026-10-05T11:00:00.000Z",
            ),
            operational(MONITOR_A_ID, "2026-10-05T11:00:00.000Z"),
          ],
        },
        {
          monitorId: MONITOR_B_ID,
          timelines: [
            operational(
              MONITOR_B_ID,
              "2026-10-01T00:00:00.000Z",
              "2026-10-05T10:30:00.000Z",
            ),
            offline(
              MONITOR_B_ID,
              "2026-10-05T10:30:00.000Z",
              "2026-10-05T11:30:00.000Z",
            ),
            operational(MONITOR_B_ID, "2026-10-05T11:30:00.000Z"),
          ],
        },
      ];

      test("any monitor down: the union of their downtime", () => {
        const result: SloMonitorUptimeMonthlyFigures =
          computeMonitorUptimeMonthlyFigures({
            perMonitorTimelines: perMonitorTimelines,
            downtimeStatuses: DOWNTIME_STATUSES,
            mode: SloMultiMonitorMode.AnyDown,
            months: months,
          });

        expect(result.months[OCTOBER]!.bad).toBe(1.5 * HOUR);
        expect(result.months[OCTOBER]!.total).toBe(31 * DAY);
        // September: only A existed, and it was up.
        expect(result.months[SEPTEMBER]).toEqual({
          total: 30 * DAY,
          bad: 0,
          sliPercentage: 100,
        });
      });

      test("monitor seconds averaged: every monitor's own downtime and time", () => {
        const result: SloMonitorUptimeMonthlyFigures =
          computeMonitorUptimeMonthlyFigures({
            perMonitorTimelines: perMonitorTimelines,
            downtimeStatuses: DOWNTIME_STATUSES,
            mode: SloMultiMonitorMode.MonitorSecondsAverage,
            months: months,
          });

        expect(result.months[OCTOBER]!.bad).toBe(2 * HOUR);
        expect(result.months[OCTOBER]!.total).toBe(2 * 31 * DAY);
      });

      test("each monitor alone, in the order they came", () => {
        const result: SloMonitorUptimeMonthlyFigures =
          computeMonitorUptimeMonthlyFigures({
            perMonitorTimelines: perMonitorTimelines,
            downtimeStatuses: DOWNTIME_STATUSES,
            mode: SloMultiMonitorMode.AnyDown,
            months: months,
          });

        expect(
          result.monitors.map(
            (monitor: {
              monitorId: ObjectID;
              months: Array<SloMonthlyFigures>;
            }): string => {
              return monitor.monitorId.toString();
            },
          ),
        ).toEqual([MONITOR_A_ID.toString(), MONITOR_B_ID.toString()]);

        expect(result.monitors[0]!.months[OCTOBER]!.bad).toBe(HOUR);
        expect(result.monitors[1]!.months[OCTOBER]!.bad).toBe(HOUR);
        expect(result.monitors[1]!.months[SEPTEMBER]).toEqual(NO_DATA);
      });
    });

    test("time with monitoring off is neither up nor down", () => {
      const result: SloMonitorUptimeMonthlyFigures =
        computeMonitorUptimeMonthlyFigures({
          perMonitorTimelines: [
            {
              monitorId: MONITOR_A_ID,
              timelines: [
                operational(
                  MONITOR_A_ID,
                  "2026-09-01T00:00:00.000Z",
                  "2026-10-01T00:00:00.000Z",
                ),
                operational(
                  MONITOR_A_ID,
                  "2026-10-01T00:00:00.000Z",
                  "2026-10-11T00:00:00.000Z",
                  true,
                ),
                operational(MONITOR_A_ID, "2026-10-11T00:00:00.000Z"),
              ],
            },
          ],
          downtimeStatuses: DOWNTIME_STATUSES,
          mode: SloMultiMonitorMode.AnyDown,
          months: months,
        });

      expect(result.months[OCTOBER]).toEqual({
        total: 21 * DAY,
        bad: 0,
        sliPercentage: 100,
      });
    });

    test("a status the SLO does not count as downtime is up", () => {
      const result: SloMonitorUptimeMonthlyFigures =
        computeMonitorUptimeMonthlyFigures({
          perMonitorTimelines: [
            { monitorId: MONITOR_A_ID, timelines: monitorA },
          ],
          downtimeStatuses: [],
          mode: SloMultiMonitorMode.AnyDown,
          months: months,
        });

      expect(result.months[OCTOBER]!.bad).toBe(0);
      expect(result.months[OCTOBER]!.sliPercentage).toBe(100);
    });
  });

  describe("getRequestMonthlyFigures and sumSloMonthlyFigures", () => {
    test("a month's requests: the bad ones are those not good", () => {
      expect(
        getRequestMonthlyFigures({ goodCount: 990, totalCount: 1000 }),
      ).toEqual({ total: 1000, bad: 10, sliPercentage: 99 });
    });

    test("no request counted is no data, never 100%", () => {
      expect(getRequestMonthlyFigures({ goodCount: 0, totalCount: 0 })).toEqual(
        NO_DATA,
      );
    });

    test("a good count above the total is held to it", () => {
      expect(
        getRequestMonthlyFigures({ goodCount: 120, totalCount: 100 }),
      ).toEqual({ total: 100, bad: 0, sliPercentage: 100 });
    });

    test("the period is the sum of its months, without the ones without data", () => {
      const sum: SloMonthlyFigures = sumSloMonthlyFigures([
        NO_DATA,
        figures(30 * DAY, 0),
        figures(31 * DAY, HOUR),
      ]);

      expect(sum.total).toBe(61 * DAY);
      expect(sum.bad).toBe(HOUR);
      expect(sum.sliPercentage).toBeCloseTo(
        ((61 * DAY - HOUR) / (61 * DAY)) * 100,
        10,
      );
    });

    test("a period of months without data is no data", () => {
      expect(sumSloMonthlyFigures([NO_DATA, NO_DATA])).toEqual(NO_DATA);
      expect(sumSloMonthlyFigures([])).toEqual(NO_DATA);
    });
  });

  describe("judging a month", () => {
    test("the error budget used: bad seconds against what the target allows", () => {
      // 99.9% of 30 days allows 43m 12s; 21m 36s is half of it.
      expect(
        getSloErrorBudgetUsedPercentage({
          figures: figures(30 * DAY, 1296),
          targetPercentage: 99.9,
        }),
      ).toBeCloseTo(50, 10);
    });

    test("a month still running is held to its whole month's budget", () => {
      expect(
        getSloErrorBudgetUsedPercentage({
          figures: figures(15 * DAY, 1296),
          targetPercentage: 99.9,
          budgetBase: 30 * DAY,
        }),
      ).toBeCloseTo(50, 10);
    });

    test("no budget is read for no data, or for a target out of range", () => {
      expect(
        getSloErrorBudgetUsedPercentage({
          figures: NO_DATA,
          targetPercentage: 99.9,
        }),
      ).toBeNull();
      expect(
        getSloErrorBudgetUsedPercentage({
          figures: figures(DAY, 0),
          targetPercentage: 100,
        }),
      ).toBeNull();
      expect(
        getSloErrorBudgetUsedPercentage({
          figures: figures(DAY, 0),
          targetPercentage: 0,
        }),
      ).toBeNull();
    });

    test.each([
      [99.95, 99.9, false, SloMonthVerdict.Met],
      [99.9, 99.9, false, SloMonthVerdict.Met],
      [99.8999, 99.9, false, SloMonthVerdict.Missed],
      [99.95, 99.9, true, SloMonthVerdict.OnTrack],
      [99.85, 99.9, true, SloMonthVerdict.BelowTarget],
    ])(
      "an SLI of %p against %p (month to date: %p) is %p",
      (
        sliPercentage: number,
        targetPercentage: number,
        isMonthToDate: boolean,
        verdict: SloMonthVerdict,
      ) => {
        expect(
          getSloMonthVerdict({
            sliPercentage: sliPercentage,
            targetPercentage: targetPercentage,
            isMonthToDate: isMonthToDate,
          }),
        ).toBe(verdict);
      },
    );

    test("no data, or a target out of range, has no verdict", () => {
      expect(
        getSloMonthVerdict({
          sliPercentage: null,
          targetPercentage: 99.9,
          isMonthToDate: false,
        }),
      ).toBe(SloMonthVerdict.NoData);
      expect(
        getSloMonthVerdict({
          sliPercentage: 99.99,
          targetPercentage: 100,
          isMonthToDate: false,
        }),
      ).toBe(SloMonthVerdict.NoData);
    });

    test("a month still running is Missed once its downtime is more than the whole month allows", () => {
      // An hour down by the 2nd of a 30-day month: 43m 12s is all it allows.
      const judged: SloJudgedFigures = judgeSloMonthlyFigures({
        figures: figures(2 * DAY, HOUR),
        targetPercentage: 99.9,
        unit: SloMonthlyReportUnit.Seconds,
        isMonthToDate: true,
        secondsLeft: 28 * DAY,
      });

      expect(judged.errorBudgetUsedPercentage).toBeCloseTo(
        (HOUR / (0.001 * 30 * DAY)) * 100,
        8,
      );
      expect(judged.verdict).toBe(SloMonthVerdict.Missed);
    });

    test("a month still running below its target but within its whole budget is Below Target", () => {
      // 20 minutes down by the 2nd: below 99.9% so far, half the month's budget.
      const judged: SloJudgedFigures = judgeSloMonthlyFigures({
        figures: figures(2 * DAY, 1200),
        targetPercentage: 99.9,
        unit: SloMonthlyReportUnit.Seconds,
        isMonthToDate: true,
        secondsLeft: 28 * DAY,
      });

      expect(judged.verdict).toBe(SloMonthVerdict.BelowTarget);
      expect(judged.errorBudgetUsedPercentage).toBeLessThan(100);
    });

    test("a request SLO's month still running is never decided early: more requests can lift it", () => {
      const judged: SloJudgedFigures = judgeSloMonthlyFigures({
        figures: getRequestMonthlyFigures({ goodCount: 900, totalCount: 1000 }),
        targetPercentage: 99.9,
        unit: SloMonthlyReportUnit.Requests,
        isMonthToDate: true,
        secondsLeft: 10 * DAY,
      });

      expect(judged.errorBudgetUsedPercentage).toBeCloseTo(10000, 6);
      expect(judged.verdict).toBe(SloMonthVerdict.BelowTarget);
    });
  });

  describe("buildSloMonthlyReport", () => {
    const months: Array<SloReportMonth> = getSloReportMonths({
      period: lastMonths(3),
      now: NOW,
    });

    const report: SloMonthlyReport = buildSloMonthlyReport({
      sloId: SLO_ID,
      sloName: "Checkout API",
      sliType: SliType.MonitorUptime,
      targetPercentage: 99.9,
      timezone: "UTC",
      period: lastMonths(3),
      months: months,
      figures: [
        figures(16 * DAY, 0),
        figures(31 * DAY, HOUR),
        figures(15.5 * DAY, 0),
      ],
      monitors: [
        {
          monitorId: MONITOR_B_ID,
          name: "Payments",
          months: [NO_DATA, figures(31 * DAY, 0), figures(15.5 * DAY, 0)],
        },
        {
          monitorId: MONITOR_A_ID,
          name: "Checkout",
          months: [
            figures(16 * DAY, 0),
            figures(31 * DAY, HOUR),
            figures(15.5 * DAY, 0),
          ],
        },
      ],
      now: NOW,
    });

    test("judges each month: September met, October missed, November on track", () => {
      expect(
        report.months.map((month: { verdict: SloMonthVerdict }) => {
          return month.verdict;
        }),
      ).toEqual([
        SloMonthVerdict.Met,
        SloMonthVerdict.Missed,
        SloMonthVerdict.OnTrack,
      ]);

      expect(report.months[1]!.errorBudgetUsedPercentage).toBeCloseTo(
        (HOUR / (0.001 * 31 * DAY)) * 100,
        8,
      );
      // November so far, against all of November's 30 days.
      expect(report.months[2]!.errorBudgetUsedPercentage).toBe(0);
    });

    test("the total is the period as one, judged as a period that is still running", () => {
      expect(report.total.total).toBe(62.5 * DAY);
      expect(report.total.bad).toBe(HOUR);
      expect(report.total.sliPercentage).toBeCloseTo(
        ((62.5 * DAY - HOUR) / (62.5 * DAY)) * 100,
        10,
      );
      expect(report.total.includesMonthToDate).toBe(true);
      expect(report.total.verdict).toBe(SloMonthVerdict.OnTrack);
      // The period's budget reaches to the end of November.
      expect(report.total.errorBudgetUsedPercentage).toBeCloseTo(
        (HOUR / (0.001 * (62.5 * DAY + 14.5 * DAY))) * 100,
        8,
      );
    });

    test("lists the monitor that cost the SLO most first", () => {
      expect(
        report.monitors.map((monitor: { name: string }) => {
          return monitor.name;
        }),
      ).toEqual(["Checkout", "Payments"]);
      expect(report.monitors[0]!.months[1]!.verdict).toBe(
        SloMonthVerdict.Missed,
      );
      expect(report.monitors[1]!.months[0]!.verdict).toBe(
        SloMonthVerdict.NoData,
      );
    });

    test("says what it measured, and when", () => {
      expect(report.sloId).toBe(SLO_ID);
      expect(report.sloName).toBe("Checkout API");
      expect(report.unit).toBe(SloMonthlyReportUnit.Seconds);
      expect(report.generatedAt).toEqual(NOW);
      expect(report.unavailableReason).toBeNull();
    });

    test("a request SLO's report counts requests", () => {
      expect(
        buildSloMonthlyReport({
          sloId: SLO_ID,
          sliType: SliType.RequestLatency,
          targetPercentage: 99,
          timezone: "UTC",
          period: lastMonths(1),
          months: getSloReportMonths({ period: lastMonths(1), now: NOW }),
          figures: [
            getRequestMonthlyFigures({ goodCount: 995, totalCount: 1000 }),
          ],
          now: NOW,
        }).unit,
      ).toBe(SloMonthlyReportUnit.Requests);
    });

    test("a past year's total is decided: Met or Missed", () => {
      const pastYear: SloMonthlyReport = buildSloMonthlyReport({
        sloId: SLO_ID,
        sliType: SliType.MonitorUptime,
        targetPercentage: 99.9,
        timezone: "UTC",
        period: year(2025),
        months: getSloReportMonths({ period: year(2025), now: NOW }),
        figures: getSloReportMonths({ period: year(2025), now: NOW }).map(
          (): SloMonthlyFigures => {
            return figures(30 * DAY, 60);
          },
        ),
        now: NOW,
      });

      expect(pastYear.total.includesMonthToDate).toBe(false);
      expect(pastYear.total.verdict).toBe(SloMonthVerdict.Met);
    });
  });

  describe("getSloMonthlyReportSummary", () => {
    test("counts the months that are over and met, and finds the worst", () => {
      const months: Array<SloReportMonth> = getSloReportMonths({
        period: lastMonths(6),
        now: NOW,
      });

      const report: SloMonthlyReport = buildSloMonthlyReport({
        sloId: SLO_ID,
        sliType: SliType.MonitorUptime,
        targetPercentage: 99.9,
        timezone: "UTC",
        period: lastMonths(6),
        months: months,
        figures: [
          NO_DATA,
          NO_DATA,
          figures(31 * DAY, 0),
          figures(30 * DAY, 2 * HOUR),
          figures(31 * DAY, 2 * HOUR),
          // The worst so far, but still running.
          figures(15.5 * DAY, 2 * HOUR),
        ],
        now: NOW,
      });

      const summary: SloMonthlyReportSummary =
        getSloMonthlyReportSummary(report);

      expect(summary.leadingMonthsWithoutData).toBe(2);
      expect(summary.completeMonthCount).toBe(3);
      expect(summary.metMonthCount).toBe(1);
      expect(summary.worstMonth?.monthStart.toISOString()).toBe(
        "2026-11-01T00:00:00.000Z",
      );
    });

    test("between equals, the earliest month is the worst", () => {
      const report: SloMonthlyReport = buildSloMonthlyReport({
        sloId: SLO_ID,
        sliType: SliType.MonitorUptime,
        targetPercentage: 99.9,
        timezone: "UTC",
        period: year(2025),
        months: getSloReportMonths({ period: year(2025), now: NOW }),
        figures: getSloReportMonths({ period: year(2025), now: NOW }).map(
          (): SloMonthlyFigures => {
            return figures(100, 1);
          },
        ),
        now: NOW,
      });

      expect(
        getSloMonthlyReportSummary(report).worstMonth?.monthStart.toISOString(),
      ).toBe("2025-01-01T00:00:00.000Z");
    });

    test("a period without data has no worst month", () => {
      const summary: SloMonthlyReportSummary = getSloMonthlyReportSummary(
        buildSloMonthlyReport({
          sloId: SLO_ID,
          sliType: SliType.MonitorUptime,
          targetPercentage: 99.9,
          timezone: "UTC",
          period: lastMonths(2),
          months: getSloReportMonths({ period: lastMonths(2), now: NOW }),
          figures: [NO_DATA, NO_DATA],
          now: NOW,
        }),
      );

      expect(summary).toEqual({
        completeMonthCount: 0,
        metMonthCount: 0,
        worstMonth: null,
        leadingMonthsWithoutData: 2,
      });
    });
  });

  describe("an SLO with nothing to report", () => {
    test.each(Object.values(SloMonthlyReportUnavailableReason))(
      "%p has no months, and says why in a sentence",
      (reason: SloMonthlyReportUnavailableReason) => {
        const report: SloMonthlyReport = buildUnavailableSloMonthlyReport({
          sloId: SLO_ID,
          sliType: SliType.MonitorUptime,
          targetPercentage: 99.9,
          timezone: "UTC",
          period: lastMonths(12),
          reason: reason,
          now: NOW,
        });

        expect(report.months).toEqual([]);
        expect(report.monitors).toEqual([]);
        expect(report.unavailableReason).toBe(reason);
        expect(report.total.verdict).toBe(SloMonthVerdict.NoData);

        const json: JSONObject = sloMonthlyReportToJSON(report);
        expect(json["unavailableReason"]).toBe(reason);
        expect(json["unavailableMessage"]).toBe(
          SLO_MONTHLY_REPORT_UNAVAILABLE_MESSAGES[reason],
        );
        expect(SLO_MONTHLY_REPORT_UNAVAILABLE_MESSAGES[reason]).toMatch(
          /^[A-Z].*\.$/,
        );
      },
    );

    test("a target out of range is not reported back as the target", () => {
      expect(
        buildUnavailableSloMonthlyReport({
          sloId: SLO_ID,
          sliType: SliType.MonitorUptime,
          targetPercentage: 100,
          timezone: "UTC",
          period: lastMonths(12),
          reason: SloMonthlyReportUnavailableReason.TargetOutOfRange,
          now: NOW,
        }).targetPercentage,
      ).toBeNull();
    });
  });

  describe("JSON", () => {
    const report: SloMonthlyReport = buildSloMonthlyReport({
      sloId: SLO_ID,
      sloName: "Checkout API",
      sliType: SliType.MonitorUptime,
      targetPercentage: 99.9,
      timezone: "Europe/Berlin",
      period: year(2026),
      months: getSloReportMonths({
        period: year(2026),
        timezone: "Europe/Berlin",
        now: NOW,
      }),
      figures: getSloReportMonths({
        period: year(2026),
        timezone: "Europe/Berlin",
        now: NOW,
      }).map((_month: SloReportMonth, index: number): SloMonthlyFigures => {
        return index < 2 ? NO_DATA : figures(30 * DAY, index * 60);
      }),
      monitors: [
        {
          monitorId: MONITOR_A_ID,
          name: "Checkout",
          months: getSloReportMonths({
            period: year(2026),
            timezone: "Europe/Berlin",
            now: NOW,
          }).map((): SloMonthlyFigures => {
            return figures(30 * DAY, 0);
          }),
        },
      ],
      now: NOW,
    });

    test("reads back exactly what was written", () => {
      const json: JSONObject = JSON.parse(
        JSON.stringify(sloMonthlyReportToJSON(report)),
      );

      expect(parseSloMonthlyReport(json)).toEqual(report);
    });

    test("an unmeasured figure is left out of the answer and reads back as null", () => {
      const json: JSONObject = sloMonthlyReportToJSON(report);
      const firstMonth: JSONObject = (json["months"] as Array<JSONObject>)[0]!;

      expect(firstMonth["sliPercentage"]).toBeUndefined();
      expect(firstMonth["errorBudgetUsedPercentage"]).toBeUndefined();
      expect(firstMonth["verdict"]).toBe(SloMonthVerdict.NoData);
      expect(parseSloMonthlyReport(json)?.months[0]?.sliPercentage).toBeNull();
    });

    test("an answer that is not a report is none", () => {
      expect(parseSloMonthlyReport(null)).toBeNull();
      expect(parseSloMonthlyReport("report")).toBeNull();
      expect(parseSloMonthlyReport([])).toBeNull();
      expect(parseSloMonthlyReport({ months: [] })).toBeNull();
    });

    test("a month or a monitor it cannot read is left out, never the whole report", () => {
      const parsed: SloMonthlyReport | null = parseSloMonthlyReport({
        sloId: SLO_ID,
        unit: "Fortnights",
        period: { kind: "Decade" },
        months: [
          { monthStart: "not a date", monthEnd: "2026-02-01T00:00:00.000Z" },
          {
            monthStart: "2026-02-01T00:00:00.000Z",
            monthEnd: "2026-03-01T00:00:00.000Z",
            total: "2419200",
            bad: 60,
            sliPercentage: "99.9975",
            verdict: "Brilliant",
          },
        ],
        monitors: [
          { name: "No id" },
          { monitorId: "m1", name: "Checkout", months: [] },
        ],
      });

      expect(parsed).not.toBeNull();
      expect(parsed!.unit).toBe(SloMonthlyReportUnit.Seconds);
      expect(parsed!.period).toEqual(lastMonths(12));
      expect(parsed!.timezone).toBe("UTC");
      expect(parsed!.months).toHaveLength(1);
      expect(parsed!.months[0]!.total).toBe(2419200);
      expect(parsed!.months[0]!.sliPercentage).toBeCloseTo(99.9975, 10);
      // A verdict it cannot read is not guessed at.
      expect(parsed!.months[0]!.verdict).toBe(SloMonthVerdict.NoData);
      expect(parsed!.monitors).toHaveLength(1);
      // A monitor has exactly one entry per month.
      expect(parsed!.monitors[0]!.months).toHaveLength(1);
    });
  });

  describe("CSV", () => {
    const months: Array<SloReportMonth> = getSloReportMonths({
      period: lastMonths(3),
      timezone: "America/New_York",
      now: NOW,
    });

    const report: SloMonthlyReport = buildSloMonthlyReport({
      sloId: SLO_ID,
      sloName: "Checkout API",
      sliType: SliType.MonitorUptime,
      targetPercentage: 99.9,
      timezone: "America/New_York",
      period: lastMonths(3),
      months: months,
      figures: [
        figures(30 * DAY, 0),
        figures(31 * DAY, HOUR),
        figures(15 * DAY, 0),
      ],
      monitors: [
        {
          monitorId: MONITOR_A_ID,
          name: '=HYPERLINK("http://evil")',
          months: [
            figures(30 * DAY, 0),
            figures(31 * DAY, HOUR),
            figures(15 * DAY, 0),
          ],
        },
        {
          monitorId: MONITOR_B_ID,
          name: "Payments, EU",
          months: [
            figures(30 * DAY, 0),
            figures(31 * DAY, 0),
            figures(15 * DAY, 0),
          ],
        },
      ],
      now: NOW,
    });

    const lines: Array<string> = buildSloMonthlyReportCsv(report).split("\r\n");

    test("has a header, a row per month and the total last", () => {
      expect(lines).toHaveLength(5);
      expect(lines[0]).toBe(
        'Month,Month to date,SLI (%),Target (%),Measured (seconds),Downtime (seconds),Error budget used (%),Result,"\'=HYPERLINK(""http://evil"") SLI (%)","Payments, EU SLI (%)"',
      );
      expect(lines[4]!.startsWith("Total,Yes,")).toBe(true);
    });

    test("names each month as YYYY-MM in the report's timezone", () => {
      expect(
        lines.slice(1, 4).map((line: string): string => {
          return line.split(",")[0]!;
        }),
      ).toEqual(["2026-09", "2026-10", "2026-11"]);
    });

    test("writes figures as a spreadsheet reads them: a dot, no unit", () => {
      expect(lines[2]).toBe(
        `2026-10,No,${(((31 * DAY - HOUR) / (31 * DAY)) * 100).toFixed(4)},99.9000,${31 * DAY},${HOUR},${((HOUR / (0.001 * 31 * DAY)) * 100).toFixed(2)},Missed,${(((31 * DAY - HOUR) / (31 * DAY)) * 100).toFixed(4)},100.0000`,
      );
    });

    test("a request SLO's file counts requests", () => {
      const requests: string = buildSloMonthlyReportCsv(
        buildSloMonthlyReport({
          sloId: SLO_ID,
          sliType: SliType.RequestSuccess,
          targetPercentage: 99,
          timezone: "UTC",
          period: lastMonths(1),
          months: getSloReportMonths({ period: lastMonths(1), now: NOW }),
          figures: [NO_DATA],
          monitors: [],
          now: NOW,
        }),
      );

      const [header, month, total] = requests.split("\r\n");

      expect(header).toBe(
        "Month,Month to date,SLI (%),Target (%),Requests,Bad requests,Error budget used (%),Result",
      );
      expect(month).toBe("2026-11,Yes,,99.0000,0,0,,No data");
      expect(total).toBe("Total,Yes,,99.0000,0,0,,No data");
    });

    test.each([
      ["plain", "plain"],
      ["a,b", '"a,b"'],
      ['say "hi"', '"say ""hi"""'],
      ["line\nbreak", '"line\nbreak"'],
      ["=SUM(A1:A2)", "'=SUM(A1:A2)"],
      ["+1", "'+1"],
      ["@cmd", "'@cmd"],
      ["-5", "-5"],
    ])("writes the field %p as %p", (value: string, written: string) => {
      expect(toSloCsvField(value)).toBe(written);
    });

    test("names the file after the SLO and its period", () => {
      expect(
        getSloMonthlyReportFilename({
          sloName: "Checkout API (EU)",
          period: year(2025),
        }),
      ).toBe("checkout-api-eu-monthly-report-2025.csv");
      expect(
        getSloMonthlyReportFilename({
          sloName: "",
          period: lastMonths(6),
        }),
      ).toBe("slo-monthly-report-last-6-months.csv");
    });
  });
});
