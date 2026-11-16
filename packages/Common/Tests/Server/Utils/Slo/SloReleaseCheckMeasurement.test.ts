import DataMigration from "../../../../Models/DatabaseModels/DataMigration";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "../../../../Models/DatabaseModels/MonitorStatusTimeline";
import Service from "../../../../Models/DatabaseModels/Service";
import ServiceLevelObjective from "../../../../Models/DatabaseModels/ServiceLevelObjective";
import { Results } from "../../../../Server/Services/AnalyticsDatabaseService";
import DataMigrationService from "../../../../Server/Services/DataMigrationService";
import MonitorService from "../../../../Server/Services/MonitorService";
import MonitorStatusService from "../../../../Server/Services/MonitorStatusService";
import MonitorStatusTimelineService from "../../../../Server/Services/MonitorStatusTimelineService";
import SpanService from "../../../../Server/Services/SpanService";
import { Statement } from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import SloReleaseCheckMeasurement, {
  SLO_RELEASE_CHECK_MEASUREMENT_ERRORS,
  SLO_RELEASE_CHECK_SELECT,
} from "../../../../Server/Utils/Slo/SloReleaseCheckMeasurement";
import SloRequestCounting from "../../../../Server/Utils/Slo/SloRequestCounting";
import OneUptimeDate from "../../../../Types/Date";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../Types/ObjectID";
import { JSONObject } from "../../../../Types/JSON";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import SliType from "../../../../Types/ServiceLevelObjective/SliType";
import {
  SloReleaseCheckMeasurement as SloReleaseCheckMeasurementResult,
  SloReleaseCheckOptions,
  parseSloReleaseCheckOptions,
} from "../../../../Utils/Slo/SloReleaseCheck";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { SpyInstance } from "jest-mock";

/*
 * What the release check measures over its window: a request SLO's
 * requests, counted from the spans as they are now and optionally for one
 * release; a Monitor Uptime SLO's monitors, as the worker measures them.
 * An SLO that cannot be measured is refused with what to fix.
 */

const NOW: Date = new Date("2026-07-19T12:00:00.000Z");
const MINUTE: number = 60 * 1000;
const WHITESPACE: RegExp = /\s+/g;

const PROJECT_ID: ObjectID = new ObjectID(
  "9d000000-0000-4000-8000-000000000001",
);
const SLO_ID: ObjectID = new ObjectID("9d000000-0000-4000-8000-000000000002");
const SERVICE_ID: ObjectID = new ObjectID(
  "9d000000-0000-4000-8000-000000000003",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "9d000000-0000-4000-8000-000000000004",
);

function makeSlo(
  fields: Partial<ServiceLevelObjective>,
): ServiceLevelObjective {
  const slo: ServiceLevelObjective = new ServiceLevelObjective(SLO_ID);
  slo.projectId = PROJECT_ID;
  slo.targetPercentage = 99.9;
  slo.sliType = SliType.RequestSuccess;
  slo.services = [new Service(SERVICE_ID)];
  slo.monitors = [];
  Object.assign(slo, fields);
  return slo;
}

function optionsOf(
  input: Record<string, unknown> = {},
): SloReleaseCheckOptions {
  return parseSloReleaseCheckOptions(input as never);
}

function resultOf(rows: Array<Record<string, unknown>>): Results {
  return {
    json: (): Promise<unknown> => {
      return Promise.resolve({ data: rows });
    },
  } as unknown as Results;
}

async function expectRefused(
  promise: Promise<unknown>,
  message: string,
): Promise<void> {
  await expect(promise).rejects.toThrow(BadDataException);
  await expect(promise).rejects.toThrow(message);
}

describe("SloReleaseCheckMeasurement - a request SLO", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("counts the window's requests and reads their burn", async () => {
    const count: SpyInstance<typeof SloRequestCounting.countRecentRequests> =
      jest
        .spyOn(SloRequestCounting, "countRecentRequests")
        .mockResolvedValue({ goodCount: 995, totalCount: 1000 });

    const measurement: SloReleaseCheckMeasurementResult =
      await SloReleaseCheckMeasurement.measure({
        slo: makeSlo({}),
        options: optionsOf({ windowInMinutes: 15, serviceVersion: "2.0.1" }),
        now: NOW,
      });

    expect(measurement.burnRate).toBeCloseTo(5, 6);
    expect(measurement.sliPercentage).toBeCloseTo(99.5, 6);
    expect(measurement.goodRequestCount).toBe(995);
    expect(measurement.totalRequestCount).toBe(1000);

    const args: Parameters<typeof SloRequestCounting.countRecentRequests>[0] =
      count.mock.calls[0]![0];

    expect(args.range).toEqual({
      from: new Date(NOW.getTime() - 15 * MINUTE),
      to: NOW,
    });
    expect(args.serviceVersion).toBe("2.0.1");
    expect(args.config.sliType).toBe(SliType.RequestSuccess);
    expect(args.config.latencyThresholdInMilliseconds).toBeNull();
    expect(args.config.serviceIds.map(String)).toEqual([SERVICE_ID.toString()]);
  });

  test("a Request Latency SLO counts against its threshold", async () => {
    const count: SpyInstance<typeof SloRequestCounting.countRecentRequests> =
      jest
        .spyOn(SloRequestCounting, "countRecentRequests")
        .mockResolvedValue({ goodCount: 10, totalCount: 10 });

    await SloReleaseCheckMeasurement.measure({
      slo: makeSlo({
        sliType: SliType.RequestLatency,
        latencyThresholdInMilliseconds: 250,
      }),
      options: optionsOf(),
      now: NOW,
    });

    expect(count.mock.calls[0]![0].config.latencyThresholdInMilliseconds).toBe(
      250,
    );
  });

  /*
   * A release is judged on the requests the SLO counts (#8444): its
   * request filter reaches the recent count, beside the release's version.
   */
  test("judges the same requests the SLO counts: its request filter, beside the version", async () => {
    const count: SpyInstance<typeof SloRequestCounting.countRecentRequests> =
      jest
        .spyOn(SloRequestCounting, "countRecentRequests")
        .mockResolvedValue({ goodCount: 10, totalCount: 10 });

    await SloReleaseCheckMeasurement.measure({
      slo: makeSlo({ requestFilter: "-@http.route:/health" }),
      options: optionsOf({ serviceVersion: "2.0.1" }),
      now: NOW,
    });

    const args: Parameters<typeof SloRequestCounting.countRecentRequests>[0] =
      count.mock.calls[0]![0];

    expect(args.config.requestFilter).toBe("-@http.route:/health");
    expect(args.serviceVersion).toBe("2.0.1");
  });

  test("the check reads the SLO's request filter", () => {
    expect(SLO_RELEASE_CHECK_SELECT.requestFilter).toBe(true);
  });

  test("no requests: no SLI, and no burn", async () => {
    jest
      .spyOn(SloRequestCounting, "countRecentRequests")
      .mockResolvedValue({ goodCount: 0, totalCount: 0 });

    const measurement: SloReleaseCheckMeasurementResult =
      await SloReleaseCheckMeasurement.measure({
        slo: makeSlo({}),
        options: optionsOf(),
        now: NOW,
      });

    expect(measurement.sliPercentage).toBeNull();
    expect(measurement.burnRate).toBe(0);
    expect(measurement.totalRequestCount).toBe(0);
  });

  test("an SLO without services, or a latency SLO without a threshold, is refused", async () => {
    await expectRefused(
      SloReleaseCheckMeasurement.measure({
        slo: makeSlo({ services: [] }),
        options: optionsOf(),
        now: NOW,
      }),
      SLO_RELEASE_CHECK_MEASUREMENT_ERRORS.noServices,
    );

    await expectRefused(
      SloReleaseCheckMeasurement.measure({
        slo: makeSlo({ sliType: SliType.RequestLatency }),
        options: optionsOf(),
        now: NOW,
      }),
      SLO_RELEASE_CHECK_MEASUREMENT_ERRORS.noLatencyThreshold,
    );
  });

  test("a target out of range, or an SLI type OneUptime does not measure, is refused", async () => {
    await expectRefused(
      SloReleaseCheckMeasurement.measure({
        slo: makeSlo({ targetPercentage: 100 }),
        options: optionsOf(),
        now: NOW,
      }),
      SLO_RELEASE_CHECK_MEASUREMENT_ERRORS.target,
    );

    await expectRefused(
      SloReleaseCheckMeasurement.measure({
        slo: makeSlo({ sliType: "Availability" as SliType }),
        options: optionsOf(),
        now: NOW,
      }),
      SLO_RELEASE_CHECK_MEASUREMENT_ERRORS.notMeasured,
    );
  });

  test("the count itself: entry spans of the SLO's services, now, and the release's version", async () => {
    const query: SpyInstance<typeof SpanService.executeQuery> = jest
      .spyOn(SpanService, "executeQuery")
      .mockResolvedValue(
        resultOf([{ totalCount: "40", badCount: "2" }]) as never,
      );

    const measurement: SloReleaseCheckMeasurementResult =
      await SloReleaseCheckMeasurement.measure({
        slo: makeSlo({}),
        options: optionsOf({ serviceVersion: "2.0.1" }),
        now: NOW,
      });

    expect(measurement.totalRequestCount).toBe(40);
    expect(measurement.goodRequestCount).toBe(38);

    const statement: Statement = query.mock.calls[0]![0] as Statement;
    const sql: string = statement.query.replace(WHITESPACE, " ");

    expect(sql).toMatch(
      /^SELECT count\(\) AS totalCount, countIf\(statusCode = /,
    );
    expect(sql).not.toContain("GROUP BY");
    expect(sql).toContain("AND isEntrySpan = 1");
    expect(sql).toMatch(/AND attributes\[\{p\d+:String\}\] = \{p\d+:String\}/);
    expect(Object.values(statement.query_params)).toContain(
      "resource.service.version",
    );
    expect(Object.values(statement.query_params)).toContain("2.0.1");
  });

  test("without a version, the count reads every release", async () => {
    const query: SpyInstance<typeof SpanService.executeQuery> = jest
      .spyOn(SpanService, "executeQuery")
      .mockResolvedValue(resultOf([]) as never);

    const measurement: SloReleaseCheckMeasurementResult =
      await SloReleaseCheckMeasurement.measure({
        slo: makeSlo({}),
        options: optionsOf(),
        now: NOW,
      });

    expect(measurement.totalRequestCount).toBe(0);
    expect(
      (query.mock.calls[0]![0] as Statement).query.replace(WHITESPACE, " "),
    ).not.toContain("attributes[");
  });
});

describe("SloReleaseCheckMeasurement - a Monitor Uptime SLO", () => {
  const offline: MonitorStatus = new MonitorStatus(
    new ObjectID("9d000000-0000-4000-8000-0000000000f1"),
  );
  offline.name = "Offline";
  offline.isOperationalState = false;
  offline.isOfflineState = true;
  offline.priority = 2;

  const operational: MonitorStatus = new MonitorStatus(
    new ObjectID("9d000000-0000-4000-8000-0000000000f2"),
  );
  operational.name = "Operational";
  operational.isOperationalState = true;
  operational.isOfflineState = false;
  operational.priority = 1;

  function row(
    status: MonitorStatus,
    startsAt: Date,
    endsAt?: Date,
  ): MonitorStatusTimeline {
    const timeline: MonitorStatusTimeline = new MonitorStatusTimeline();
    timeline.monitorId = MONITOR_ID;
    timeline.monitorStatusId = status.id!;
    timeline.monitorStatus = status;
    timeline.startsAt = startsAt;

    if (endsAt) {
      timeline.endsAt = endsAt;
    }

    return timeline;
  }

  beforeEach(() => {
    jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
    jest.spyOn(MonitorStatusService, "findBy").mockResolvedValue([offline]);

    /*
     * The upgrade has not put Monitor.firstMeasuredAt right for history yet
     * (issue #9031): the monitors count from the start, as they always did.
     */
    jest.spyOn(DataMigrationService, "findOneBy").mockResolvedValue(null);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function monitorSlo(): ServiceLevelObjective {
    return makeSlo({
      sliType: SliType.MonitorUptime,
      monitors: [new Monitor(MONITOR_ID)],
    });
  }

  test("reads the window's downtime from the monitors' timelines", async () => {
    // Up until 2 minutes ago, Offline since: 2 of the last 10 minutes down.
    const timelines: SpyInstance<
      typeof MonitorStatusTimelineService.findAllBy
    > = jest
      .spyOn(MonitorStatusTimelineService, "findAllBy")
      .mockResolvedValue([
        row(
          operational,
          new Date(NOW.getTime() - 60 * MINUTE),
          new Date(NOW.getTime() - 2 * MINUTE),
        ),
        row(offline, new Date(NOW.getTime() - 2 * MINUTE)),
      ]);

    const measurement: SloReleaseCheckMeasurementResult =
      await SloReleaseCheckMeasurement.measure({
        slo: monitorSlo(),
        options: optionsOf(),
        now: NOW,
      });

    expect(measurement.measuredSeconds).toBe(600);
    expect(measurement.sliPercentage).toBeCloseTo(80, 6);
    // 20% down against 0.1% allowed.
    expect(measurement.burnRate).toBeCloseTo(200, 6);
    expect(timelines).toHaveBeenCalledTimes(1);
  });

  /*
   * The time before the monitor's first check (issue #9031), once the
   * upgrade has put first checks right: what a status page leaves out of
   * uptime is no time for the release either.
   */
  describe("once the upgrade has put first checks right", () => {
    function monitorRow(firstMeasuredAt: Date | null): Monitor {
      const monitor: Monitor = new Monitor(MONITOR_ID);
      monitor.monitorType = MonitorType.Website;
      (monitor as unknown as { firstMeasuredAt: Date | null }).firstMeasuredAt =
        firstMeasuredAt;
      return monitor;
    }

    beforeEach(() => {
      jest
        .spyOn(DataMigrationService, "findOneBy")
        .mockResolvedValue(new DataMigration());
    });

    test("a monitor nothing has checked yet measures nothing: no SLI, and no burn", async () => {
      jest
        .spyOn(MonitorService, "findBy")
        .mockResolvedValue([monitorRow(null)]);
      jest
        .spyOn(MonitorStatusTimelineService, "findAllBy")
        .mockResolvedValue([
          row(operational, new Date(NOW.getTime() - 120 * MINUTE)),
        ]);

      const measurement: SloReleaseCheckMeasurementResult =
        await SloReleaseCheckMeasurement.measure({
          slo: monitorSlo(),
          options: optionsOf(),
          now: NOW,
        });

      expect(measurement.measuredSeconds).toBe(0);
      expect(measurement.sliPercentage).toBeNull();
      expect(measurement.burnRate).toBe(0);
    });

    test("a monitor first checked four minutes ago is judged on those four minutes", async () => {
      jest
        .spyOn(MonitorService, "findBy")
        .mockResolvedValue([monitorRow(new Date(NOW.getTime() - 4 * MINUTE))]);
      jest
        .spyOn(MonitorStatusTimelineService, "findAllBy")
        .mockResolvedValue([
          row(
            operational,
            new Date(NOW.getTime() - 60 * MINUTE),
            new Date(NOW.getTime() - 2 * MINUTE),
          ),
          row(offline, new Date(NOW.getTime() - 2 * MINUTE)),
        ]);

      const measurement: SloReleaseCheckMeasurementResult =
        await SloReleaseCheckMeasurement.measure({
          slo: monitorSlo(),
          options: optionsOf(),
          now: NOW,
        });

      expect(measurement.measuredSeconds).toBe(240);
      expect(measurement.sliPercentage).toBeCloseTo(50, 6);
    });

    test("a monitor checked when it was created reads exactly as before", async () => {
      jest
        .spyOn(MonitorService, "findBy")
        .mockResolvedValue([monitorRow(new Date(NOW.getTime() - 60 * MINUTE))]);
      jest
        .spyOn(MonitorStatusTimelineService, "findAllBy")
        .mockResolvedValue([
          row(
            operational,
            new Date(NOW.getTime() - 60 * MINUTE),
            new Date(NOW.getTime() - 2 * MINUTE),
          ),
          row(offline, new Date(NOW.getTime() - 2 * MINUTE)),
        ]);

      const measurement: SloReleaseCheckMeasurementResult =
        await SloReleaseCheckMeasurement.measure({
          slo: monitorSlo(),
          options: optionsOf(),
          now: NOW,
        });

      expect(measurement.measuredSeconds).toBe(600);
      expect(measurement.sliPercentage).toBeCloseTo(80, 6);
    });
  });

  test("no status in the window measures nothing", async () => {
    jest.spyOn(MonitorStatusTimelineService, "findAllBy").mockResolvedValue([]);

    const measurement: SloReleaseCheckMeasurementResult =
      await SloReleaseCheckMeasurement.measure({
        slo: monitorSlo(),
        options: optionsOf(),
        now: NOW,
      });

    expect(measurement.measuredSeconds).toBe(0);
    expect(measurement.sliPercentage).toBeNull();
  });

  test("no monitors, or a version asked of an uptime SLO, is refused", async () => {
    await expectRefused(
      SloReleaseCheckMeasurement.measure({
        slo: makeSlo({ sliType: SliType.MonitorUptime, monitors: [] }),
        options: optionsOf(),
        now: NOW,
      }),
      SLO_RELEASE_CHECK_MEASUREMENT_ERRORS.noMonitors,
    );

    await expectRefused(
      SloReleaseCheckMeasurement.measure({
        slo: monitorSlo(),
        options: optionsOf({ serviceVersion: "1.0.0" }),
        now: NOW,
      }),
      SLO_RELEASE_CHECK_MEASUREMENT_ERRORS.versionForMonitors,
    );
  });

  test("every refusal says what to do next", () => {
    for (const message of Object.values(SLO_RELEASE_CHECK_MEASUREMENT_ERRORS)) {
      expect(message).toMatch(/\.$/);
      expect(message.split(". ").length).toBeGreaterThan(1);
    }
  });
});

/*
 * A Metric SLO's release (#8445) is judged on its metric's events in the
 * window, as the SLO counts them: the same metric, kind and good
 * condition, with the canary's version, and never a request filter.
 */
describe("SloReleaseCheckMeasurement - a Metric SLO", () => {
  const COUNTER: JSONObject = {
    metricName: "http_requests_total",
    kind: "Counter",
    goodFilter: "@http.response.status_code:<500",
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("counts its metric's recent events, with the release's version", async () => {
    const count: SpyInstance<typeof SloRequestCounting.countRecentRequests> =
      jest
        .spyOn(SloRequestCounting, "countRecentRequests")
        .mockResolvedValue({ goodCount: 990, totalCount: 1000 });

    const measurement: SloReleaseCheckMeasurementResult =
      await SloReleaseCheckMeasurement.measure({
        slo: makeSlo({
          sliType: SliType.Metric,
          metricQueryConfig: COUNTER,
          requestFilter: "@http.route:/checkout*",
        }),
        options: optionsOf({ serviceVersion: "2.0.1" }),
        now: NOW,
      });

    const args: Parameters<typeof SloRequestCounting.countRecentRequests>[0] =
      count.mock.calls[0]![0];

    expect(args.config.sliType).toBe(SliType.Metric);
    expect(args.config.metricQueryConfig).toEqual(COUNTER);
    expect(args.config.requestFilter).toBeNull();
    expect(args.serviceVersion).toBe("2.0.1");
    expect(measurement.totalRequestCount).toBe(1000);
    // 1% bad against a 0.1% budget: burning ten times too fast.
    expect(measurement.burnRate).toBeCloseTo(10, 6);
  });

  test("no services is refused, saying there are no events to check", async () => {
    await expectRefused(
      SloReleaseCheckMeasurement.measure({
        slo: makeSlo({
          sliType: SliType.Metric,
          metricQueryConfig: COUNTER,
          services: [],
        }),
        options: optionsOf(),
        now: NOW,
      }),
      SLO_RELEASE_CHECK_MEASUREMENT_ERRORS.noServicesForMetric,
    );
  });

  test("a metric it cannot count is refused, saying what is missing", async () => {
    await expectRefused(
      SloReleaseCheckMeasurement.measure({
        slo: makeSlo({ sliType: SliType.Metric }),
        options: optionsOf(),
        now: NOW,
      }),
      "Choose the metric this SLO counts",
    );
  });

  test("reads the metric with the SLO", () => {
    expect(SLO_RELEASE_CHECK_SELECT.metricQueryConfig).toBe(true);
  });
});
