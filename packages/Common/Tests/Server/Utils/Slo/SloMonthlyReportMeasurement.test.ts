import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "../../../../Models/DatabaseModels/MonitorStatusTimeline";
import Service from "../../../../Models/DatabaseModels/Service";
import ServiceLevelObjective from "../../../../Models/DatabaseModels/ServiceLevelObjective";
import MonitorStatusService from "../../../../Server/Services/MonitorStatusService";
import MonitorStatusTimelineService from "../../../../Server/Services/MonitorStatusTimelineService";
import SloMonthlyReportMeasurement, {
  SLO_MONTHLY_REPORT_SELECT,
} from "../../../../Server/Utils/Slo/SloMonthlyReportMeasurement";
import SloRequestCounting from "../../../../Server/Utils/Slo/SloRequestCounting";
import OneUptimeDate from "../../../../Types/Date";
import ObjectID from "../../../../Types/ObjectID";
import SliType from "../../../../Types/ServiceLevelObjective/SliType";
import SloMultiMonitorMode from "../../../../Types/ServiceLevelObjective/SloMultiMonitorMode";
import {
  SloMonthVerdict,
  SloMonthlyReport,
  SloMonthlyReportPeriod,
  SloMonthlyReportPeriodKind,
  SloMonthlyReportUnavailableReason,
  SloMonthlyReportUnit,
  SloReportMonth,
  getSloReportMonths,
} from "../../../../Utils/Slo/SloMonthlyReport";
import { SloRequestCountingRange } from "../../../../Utils/Slo/SloRequestSli";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * An SLO's monthly report, measured when it is asked for: a Monitor Uptime
 * SLO's months from its monitors' status timelines, read once for the whole
 * period; a request SLO's from the counts the worker keeps, summed month by
 * month inside what its current counting covers; and, for an SLO that
 * measures nothing yet, why - before anything is read.
 */

const NOW: Date = new Date("2026-11-16T12:00:00.000Z");
const HOUR: number = 3600;
const DAY: number = 86400;

const PROJECT_ID: ObjectID = new ObjectID(
  "54760000-0000-4000-8000-000000000001",
);
const SLO_ID: ObjectID = new ObjectID("54760000-0000-4000-8000-000000000002");
const MONITOR_A: ObjectID = new ObjectID(
  "54760000-0000-4000-8000-0000000000a1",
);
const MONITOR_B: ObjectID = new ObjectID(
  "54760000-0000-4000-8000-0000000000b2",
);
const SERVICE_ID: ObjectID = new ObjectID(
  "54760000-0000-4000-8000-0000000000c3",
);

const LAST_3_MONTHS: SloMonthlyReportPeriod = {
  kind: SloMonthlyReportPeriodKind.LastMonths,
  months: 3,
};

const offline: MonitorStatus = new MonitorStatus(
  new ObjectID("54760000-0000-4000-8000-0000000000f1"),
);
offline.name = "Offline";
offline.isOperationalState = false;
offline.priority = 2;

const operational: MonitorStatus = new MonitorStatus(
  new ObjectID("54760000-0000-4000-8000-0000000000f2"),
);
operational.name = "Operational";
operational.isOperationalState = true;
operational.priority = 1;

function row(
  monitorId: ObjectID,
  status: MonitorStatus,
  startsAt: string,
  endsAt?: string,
): MonitorStatusTimeline {
  const timeline: MonitorStatusTimeline = new MonitorStatusTimeline();
  timeline.monitorId = monitorId;
  timeline.monitorStatusId = status.id!;
  timeline.monitorStatus = status;
  timeline.startsAt = new Date(startsAt);

  if (endsAt) {
    timeline.endsAt = new Date(endsAt);
  }

  return timeline;
}

/*
 * Monitor A: up since September 1st, down for an hour on October 10th.
 * Monitor B: created on October 1st, up ever since.
 */
const TIMELINES: Record<string, Array<MonitorStatusTimeline>> = {
  [MONITOR_A.toString()]: [
    row(
      MONITOR_A,
      operational,
      "2026-09-01T00:00:00.000Z",
      "2026-10-10T00:00:00.000Z",
    ),
    row(
      MONITOR_A,
      offline,
      "2026-10-10T00:00:00.000Z",
      "2026-10-10T01:00:00.000Z",
    ),
    row(MONITOR_A, operational, "2026-10-10T01:00:00.000Z"),
  ],
  [MONITOR_B.toString()]: [
    row(MONITOR_B, operational, "2026-10-01T00:00:00.000Z"),
  ],
};

function makeSlo(
  fields: Partial<ServiceLevelObjective>,
): ServiceLevelObjective {
  const slo: ServiceLevelObjective = new ServiceLevelObjective(SLO_ID);
  slo.projectId = PROJECT_ID;
  slo.name = "Checkout";
  slo.targetPercentage = 99.9;
  slo.sliType = SliType.MonitorUptime;
  slo.multiMonitorMode = SloMultiMonitorMode.AnyDown;
  slo.monitors = [new Monitor(MONITOR_A), new Monitor(MONITOR_B)];
  slo.services = [];
  slo.downtimeMonitorStatuses = [];
  Object.assign(slo, fields);
  return slo;
}

async function measure(
  slo: ServiceLevelObjective,
  readMonitorNames?: (ids: Array<ObjectID>) => Promise<Map<string, string>>,
  period: SloMonthlyReportPeriod = LAST_3_MONTHS,
): Promise<SloMonthlyReport> {
  return await SloMonthlyReportMeasurement.measure({
    slo: slo,
    period: period,
    now: NOW,
    readMonitorNames: readMonitorNames,
  });
}

describe("SloMonthlyReportMeasurement", () => {
  let timelineReads: jest.SpiedFunction<
    typeof MonitorStatusTimelineService.findAllBy
  >;

  beforeEach(() => {
    jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
    jest.spyOn(MonitorStatusService, "findBy").mockResolvedValue([offline]);

    timelineReads = jest
      .spyOn(MonitorStatusTimelineService, "findAllBy")
      .mockImplementation(
        async (data: {
          query: Record<string, unknown>;
        }): Promise<Array<MonitorStatusTimeline>> => {
          return TIMELINES[(data.query["monitorId"] as ObjectID).toString()]!;
        },
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("reads only what the report needs of the SLO", () => {
    expect(Object.keys(SLO_MONTHLY_REPORT_SELECT).sort()).toEqual(
      [
        "_id",
        "projectId",
        "name",
        "sliType",
        "targetPercentage",
        "timezone",
        "multiMonitorMode",
        "latencyThresholdInMilliseconds",
        "firstAccumulatedBucketStartAt",
        "lastAccumulatedBucketEndAt",
        "services",
        "monitors",
        "downtimeMonitorStatuses",
      ].sort(),
    );
  });

  describe("a Monitor Uptime SLO", () => {
    test("measures each month from its monitors' timelines, read once for the whole period", async () => {
      const report: SloMonthlyReport = await measure(makeSlo({}));

      expect(report.unit).toBe(SloMonthlyReportUnit.Seconds);
      expect(report.unavailableReason).toBeNull();
      expect(report.sloName).toBe("Checkout");
      expect(report.timezone).toBe("UTC");

      expect(
        report.months.map((month: { verdict: SloMonthVerdict }) => {
          return month.verdict;
        }),
      ).toEqual([
        SloMonthVerdict.Met,
        SloMonthVerdict.Missed,
        SloMonthVerdict.OnTrack,
      ]);

      // October: A's hour down, any monitor down counting.
      expect(report.months[1]!.bad).toBe(HOUR);
      expect(report.months[1]!.total).toBe(31 * DAY);

      // One read per monitor, over the whole period up to now.
      expect(timelineReads).toHaveBeenCalledTimes(2);
      const query: Record<string, unknown> = timelineReads.mock.calls[0]![0]
        .query as Record<string, unknown>;
      expect(query["projectId"]).toEqual(PROJECT_ID);
    });

    test("names in the breakdown only the monitors the reader may read", async () => {
      const report: SloMonthlyReport = await measure(
        makeSlo({}),
        async (ids: Array<ObjectID>): Promise<Map<string, string>> => {
          expect(
            ids.map((id: ObjectID): string => {
              return id.toString();
            }),
          ).toEqual([MONITOR_A.toString(), MONITOR_B.toString()]);

          return new Map<string, string>([[MONITOR_A.toString(), "Payments"]]);
        },
      );

      expect(report.monitors).toHaveLength(1);
      expect(report.monitors[0]!.name).toBe("Payments");
      expect(report.monitors[0]!.months[1]!.verdict).toBe(
        SloMonthVerdict.Missed,
      );
      // The SLO itself still counts both monitors: B has no September.
      expect(report.months[0]!.total).toBe(30 * DAY);
    });

    test("lists every monitor it can name, worst first", async () => {
      const report: SloMonthlyReport = await measure(
        makeSlo({}),
        async (): Promise<Map<string, string>> => {
          return new Map<string, string>([
            [MONITOR_B.toString(), "Search"],
            [MONITOR_A.toString(), "Payments"],
          ]);
        },
      );

      expect(
        report.monitors.map((monitor: { name: string }) => {
          return monitor.name;
        }),
      ).toEqual(["Payments", "Search"]);
      expect(report.monitors[1]!.months[0]!.verdict).toBe(
        SloMonthVerdict.NoData,
      );
    });

    test("with no reader of names, has no breakdown", async () => {
      expect((await measure(makeSlo({}))).monitors).toEqual([]);
    });

    test("monitor seconds averaged counts every monitor's own time", async () => {
      const report: SloMonthlyReport = await measure(
        makeSlo({
          multiMonitorMode: SloMultiMonitorMode.MonitorSecondsAverage,
        }),
      );

      // October: A and B each measured for 31 days, A down an hour.
      expect(report.months[1]!.total).toBe(2 * 31 * DAY);
      expect(report.months[1]!.bad).toBe(HOUR);
    });

    test("cuts the months in the SLO's timezone", async () => {
      const report: SloMonthlyReport = await measure(
        makeSlo({ timezone: "Asia/Kolkata" }),
      );

      expect(report.timezone).toBe("Asia/Kolkata");
      expect(report.months[0]!.monthStart.toISOString()).toBe(
        "2026-08-31T18:30:00.000Z",
      );
    });

    test("a year that has not started reads nothing", async () => {
      const report: SloMonthlyReport = await measure(makeSlo({}), undefined, {
        kind: SloMonthlyReportPeriodKind.Year,
        year: 2027,
      });

      expect(report.months).toEqual([]);
      expect(timelineReads).not.toHaveBeenCalled();
    });

    test("an SLO from before SLI types measures monitor uptime", async () => {
      const slo: ServiceLevelObjective = makeSlo({});
      delete (slo as { sliType?: SliType }).sliType;

      const report: SloMonthlyReport = await measure(slo);

      expect(report.sliType).toBe(SliType.MonitorUptime);
      expect(report.months).toHaveLength(3);
    });
  });

  describe("a request SLO", () => {
    const requestSlo: (
      fields?: Partial<ServiceLevelObjective>,
    ) => ServiceLevelObjective = (
      fields: Partial<ServiceLevelObjective> = {},
    ): ServiceLevelObjective => {
      return makeSlo({
        sliType: SliType.RequestSuccess,
        services: [new Service(SERVICE_ID)],
        monitors: [],
        firstAccumulatedBucketStartAt: new Date("2026-10-15T00:00:00.000Z"),
        lastAccumulatedBucketEndAt: new Date("2026-11-16T11:55:00.000Z"),
        ...fields,
      });
    };

    test("sums its counted requests month by month, inside what its counting covers", async () => {
      const sums: jest.SpiedFunction<typeof SloRequestCounting.readRangeSums> =
        jest.spyOn(SloRequestCounting, "readRangeSums").mockResolvedValue([
          { goodCount: 0, totalCount: 0 },
          { goodCount: 9990, totalCount: 10000 },
          { goodCount: 4990, totalCount: 5000 },
        ]);

      const report: SloMonthlyReport = await measure(requestSlo());

      expect(report.unit).toBe(SloMonthlyReportUnit.Requests);
      expect(report.monitors).toEqual([]);
      expect(timelineReads).not.toHaveBeenCalled();

      const ranges: Array<SloRequestCountingRange> =
        sums.mock.calls[0]![0].ranges;

      expect(
        ranges.map((range: SloRequestCountingRange): string => {
          return `${range.from.toISOString()}..${range.to.toISOString()}`;
        }),
      ).toEqual([
        // September is before the counting starts: an empty range.
        "2026-10-15T00:00:00.000Z..2026-10-01T00:00:00.000Z",
        "2026-10-15T00:00:00.000Z..2026-11-01T00:00:00.000Z",
        "2026-11-01T00:00:00.000Z..2026-11-16T11:55:00.000Z",
      ]);

      expect(report.months[0]!.verdict).toBe(SloMonthVerdict.NoData);
      expect(report.months[1]!.sliPercentage).toBeCloseTo(99.9, 10);
      expect(report.months[1]!.verdict).toBe(SloMonthVerdict.Met);
      expect(report.months[2]!.verdict).toBe(SloMonthVerdict.BelowTarget);
    });

    test("an SLO whose requests were never counted reads as no data in every month", async () => {
      const sums: jest.SpiedFunction<typeof SloRequestCounting.readRangeSums> =
        jest.spyOn(SloRequestCounting, "readRangeSums").mockResolvedValue([
          { goodCount: 0, totalCount: 0 },
          { goodCount: 0, totalCount: 0 },
          { goodCount: 0, totalCount: 0 },
        ]);

      const neverCounted: ServiceLevelObjective = requestSlo();
      delete neverCounted.firstAccumulatedBucketStartAt;
      delete neverCounted.lastAccumulatedBucketEndAt;

      const report: SloMonthlyReport = await measure(neverCounted);

      for (const range of sums.mock.calls[0]![0].ranges) {
        expect(range.from.getTime()).toBe(range.to.getTime());
      }

      expect(
        report.months.every((month: { verdict: SloMonthVerdict }) => {
          return month.verdict === SloMonthVerdict.NoData;
        }),
      ).toBe(true);
    });

    test("getRequestRanges keeps every month, clipped to the counting", () => {
      const months: Array<SloReportMonth> = getSloReportMonths({
        period: LAST_3_MONTHS,
        now: NOW,
      });

      expect(
        SloMonthlyReportMeasurement.getRequestRanges({
          months: months,
          firstAccumulatedBucketStartAt: new Date("2026-08-01T00:00:00.000Z"),
          lastAccumulatedBucketEndAt: new Date("2026-12-01T00:00:00.000Z"),
        }),
      ).toEqual(
        months.map((month: SloReportMonth): SloRequestCountingRange => {
          return { from: month.startDate, to: month.endDate };
        }),
      );
    });
  });

  describe("an SLO that measures nothing yet says why, and reads nothing", () => {
    test.each([
      [
        "no monitors",
        { monitors: [] } as Partial<ServiceLevelObjective>,
        SloMonthlyReportUnavailableReason.NoMonitors,
      ],
      [
        "a request SLO without services",
        {
          sliType: SliType.RequestSuccess,
          services: [],
        } as Partial<ServiceLevelObjective>,
        SloMonthlyReportUnavailableReason.NoServices,
      ],
      [
        "a Request Latency SLO without a threshold",
        // No latency threshold is set: makeSlo sets none.
        {
          sliType: SliType.RequestLatency,
          services: [new Service(SERVICE_ID)],
        } as Partial<ServiceLevelObjective>,
        SloMonthlyReportUnavailableReason.NoLatencyThreshold,
      ],
      [
        "an SLI type OneUptime does not measure",
        { sliType: SliType.Metric } as Partial<ServiceLevelObjective>,
        SloMonthlyReportUnavailableReason.NotMeasured,
      ],
      [
        "a target of 100%",
        { targetPercentage: 100 } as Partial<ServiceLevelObjective>,
        SloMonthlyReportUnavailableReason.TargetOutOfRange,
      ],
    ])(
      "%s",
      async (
        _name: string,
        fields: Partial<ServiceLevelObjective>,
        reason: SloMonthlyReportUnavailableReason,
      ) => {
        const sums: jest.SpiedFunction<
          typeof SloRequestCounting.readRangeSums
        > = jest.spyOn(SloRequestCounting, "readRangeSums");

        const report: SloMonthlyReport = await measure(makeSlo(fields));

        expect(report.unavailableReason).toBe(reason);
        expect(report.months).toEqual([]);
        expect(timelineReads).not.toHaveBeenCalled();
        expect(sums).not.toHaveBeenCalled();
      },
    );
  });
});
