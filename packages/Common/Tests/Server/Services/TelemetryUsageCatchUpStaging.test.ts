/*
 * IsBillingEnabled is a module-load `const` in the real EnvironmentConfig, and
 * the service's constructor schedules a cleanup job when it is true. A getter
 * laid over the otherwise real module keeps it false while the service module
 * loads and lets these tests flip it on afterwards (the same pattern as
 * TelemetryUsageBillingSloExclusion.test.ts).
 */
let mockIsBillingEnabled: boolean = false;

jest.mock("../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;

  const mocked: Record<string, unknown> = {
    ...actual,
    __esModule: true,
  };

  Object.defineProperty(mocked, "IsBillingEnabled", {
    get: (): boolean => {
      return mockIsBillingEnabled;
    },
  });

  return mocked;
});

import ExceptionInstanceService from "../../../Server/Services/ExceptionInstanceService";
import LogService from "../../../Server/Services/LogService";
import MetricService from "../../../Server/Services/MetricService";
import ProfileSampleService from "../../../Server/Services/ProfileSampleService";
import ProfileService from "../../../Server/Services/ProfileService";
import RumSessionService from "../../../Server/Services/RumSessionService";
import SecurityEventService from "../../../Server/Services/SecurityEventService";
import SpanService from "../../../Server/Services/SpanService";
import TelemetryUsageBillingService, {
  TELEMETRY_BILLING_EXCLUDED_METRIC_NAMES,
  TELEMETRY_USAGE_STAGING_LOOKBACK_IN_DAYS,
} from "../../../Server/Services/TelemetryUsageBillingService";
import TelemetryUsageBilling from "../../../Models/DatabaseModels/TelemetryUsageBilling";
import OneUptimeDate from "../../../Types/Date";
import ProductType from "../../../Types/MeteredPlan/ProductType";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Staging used to target only "yesterday", so any day the daily billing run
 * did not reach - a deploy or crash mid-run, a run still going past midnight
 * UTC, a usage scan over its time cap - was never billed. These tests pin the
 * catch-up: every complete UTC day of the last week that has telemetry and
 * nothing staged gets staged, oldest first, and one failing day neither stops
 * the others nor goes unreported.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

// A billing run at its usual 08:00 UTC.
const NOW: Date = new Date("2026-10-23T08:00:00.000Z");

// The window's days as staging names them (TelemetryUsageBilling.day).
const WINDOW_DAY_STRINGS: Array<string> = [
  "Oct 16, 2026",
  "Oct 17, 2026",
  "Oct 18, 2026",
  "Oct 19, 2026",
  "Oct 20, 2026",
  "Oct 21, 2026",
  "Oct 22, 2026",
];

function utcMidnight(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

describe("stageUnstagedTelemetryUsageForProject", () => {
  let stagedDays: Array<string>;
  let daysWithLogs: Array<string>;
  let stagedUsageDates: Array<string>;
  let findBy: jest.SpyInstance;
  let logDays: jest.SpyInstance;
  let stage: jest.SpyInstance;

  beforeEach(() => {
    mockIsBillingEnabled = true;
    stagedDays = [];
    daysWithLogs = [];
    stagedUsageDates = [];

    jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);

    findBy = jest
      .spyOn(TelemetryUsageBillingService, "findBy")
      .mockImplementation((async (): Promise<Array<TelemetryUsageBilling>> => {
        return stagedDays.map((day: string): TelemetryUsageBilling => {
          return Object.assign(new TelemetryUsageBilling(), { day: day });
        });
      }) as never);

    logDays = jest
      .spyOn(LogService, "getDaysWithRows")
      .mockImplementation(async (): Promise<Array<string>> => {
        return daysWithLogs;
      });

    stage = jest
      .spyOn(TelemetryUsageBillingService, "stageTelemetryUsageForProject")
      .mockImplementation(
        async (data: { usageDate?: Date | undefined }): Promise<void> => {
          stagedUsageDates.push(data.usageDate!.toISOString());
        },
      );
  });

  afterEach(() => {
    mockIsBillingEnabled = false;
    jest.restoreAllMocks();
  });

  test("looks back a week", () => {
    expect(TELEMETRY_USAGE_STAGING_LOOKBACK_IN_DAYS).toBe(7);
  });

  test("stages every day of the window that has telemetry and nothing staged, oldest first", async () => {
    stagedDays = ["Oct 20, 2026"];
    daysWithLogs = ["2026-10-16", "2026-10-19", "2026-10-20", "2026-10-22"];

    await TelemetryUsageBillingService.stageUnstagedTelemetryUsageForProject({
      projectId: PROJECT_ID,
      productType: ProductType.Logs,
    });

    // Oct 20 is staged already; Oct 17, 18 and 21 have no telemetry.
    expect(stagedUsageDates).toEqual([
      utcMidnight("2026-10-16").toISOString(),
      utcMidnight("2026-10-19").toISOString(),
      utcMidnight("2026-10-22").toISOString(),
    ]);
  });

  test("passes the report's live authorization to every day it stages", async () => {
    daysWithLogs = ["2026-10-18", "2026-10-22"];
    const liveAuthorization: never = {
      projectId: PROJECT_ID.toString(),
      decidedAt: Date.now(),
    } as never;

    await TelemetryUsageBillingService.stageUnstagedTelemetryUsageForProject({
      projectId: PROJECT_ID,
      productType: ProductType.Logs,
      liveAuthorization: liveAuthorization,
    });

    expect(stage).toHaveBeenCalledTimes(2);

    for (const call of stage.mock.calls) {
      expect(call[0]).toEqual(
        expect.objectContaining({
          projectId: PROJECT_ID,
          productType: ProductType.Logs,
          liveAuthorization: liveAuthorization,
        }),
      );
    }
  });

  test("covers exactly the seven complete UTC days before today", async () => {
    // Today is still being written, and eight days ago is outside the window.
    daysWithLogs = ["2026-10-15", "2026-10-23"];

    await TelemetryUsageBillingService.stageUnstagedTelemetryUsageForProject({
      projectId: PROJECT_ID,
      productType: ProductType.Logs,
    });

    expect(stage).not.toHaveBeenCalled();

    const dayQuery: Record<string, unknown> = findBy.mock.calls[0]![0].query;
    expect(dayQuery["projectId"]).toBe(PROJECT_ID);
    expect(dayQuery["productType"]).toBe(ProductType.Logs);
    expect(JSON.stringify(dayQuery["day"])).toEqual(
      expect.stringContaining(JSON.stringify(WINDOW_DAY_STRINGS)),
    );

    expect(logDays).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      startDate: new Date("2026-10-16T00:00:00.000Z"),
      endDate: new Date("2026-10-22T23:59:59.999Z"),
      timestampColumnName: "time",
    });
  });

  test("keeps UTC days when the server's own timezone is not UTC", async () => {
    jest
      .spyOn(OneUptimeDate, "getCurrentDate")
      .mockReturnValue(new Date("2026-11-02T00:30:00.000Z"));
    jest
      .spyOn(OneUptimeDate, "getCurrentTimezone")
      .mockReturnValue("America/Los_Angeles" as never);
    daysWithLogs = ["2026-10-26", "2026-11-01"];

    await TelemetryUsageBillingService.stageUnstagedTelemetryUsageForProject({
      projectId: PROJECT_ID,
      productType: ProductType.Logs,
    });

    // The window crosses the US daylight-saving change and stays on UTC midnights.
    expect(stagedUsageDates).toEqual([
      "2026-10-26T00:00:00.000Z",
      "2026-11-01T00:00:00.000Z",
    ]);
  });

  test("a fully staged window costs no ClickHouse query", async () => {
    stagedDays = [...WINDOW_DAY_STRINGS];

    await TelemetryUsageBillingService.stageUnstagedTelemetryUsageForProject({
      projectId: PROJECT_ID,
      productType: ProductType.Logs,
    });

    expect(logDays).not.toHaveBeenCalled();
    expect(stage).not.toHaveBeenCalled();
  });

  test("a project with no telemetry costs one cheap query and no usage scan", async () => {
    const usageScan: jest.SpyInstance = jest
      .spyOn(LogService, "groupTelemetryUsageByService")
      .mockResolvedValue([]);

    await TelemetryUsageBillingService.stageUnstagedTelemetryUsageForProject({
      projectId: PROJECT_ID,
      productType: ProductType.Logs,
    });

    expect(logDays).toHaveBeenCalledTimes(1);
    expect(stage).not.toHaveBeenCalled();
    expect(usageScan).not.toHaveBeenCalled();
  });

  test("a day that fails does not stop the others, and the failure is thrown after them", async () => {
    daysWithLogs = ["2026-10-17", "2026-10-19", "2026-10-22"];
    const timeout: Error = new Error("Timeout exceeded: elapsed 120 seconds");

    stage.mockImplementation(
      async (data: { usageDate?: Date | undefined }): Promise<void> => {
        if (data.usageDate!.toISOString().startsWith("2026-10-19")) {
          throw timeout;
        }

        stagedUsageDates.push(data.usageDate!.toISOString());
      },
    );

    await expect(
      TelemetryUsageBillingService.stageUnstagedTelemetryUsageForProject({
        projectId: PROJECT_ID,
        productType: ProductType.Logs,
      }),
    ).rejects.toBe(timeout);

    expect(stagedUsageDates).toEqual([
      utcMidnight("2026-10-17").toISOString(),
      utcMidnight("2026-10-22").toISOString(),
    ]);
  });

  test("a day that failed is staged by a later run, while it is in the window", async () => {
    daysWithLogs = ["2026-10-19"];

    // Nothing was staged for Oct 19 when the earlier run failed on it.
    await TelemetryUsageBillingService.stageUnstagedTelemetryUsageForProject({
      projectId: PROJECT_ID,
      productType: ProductType.Logs,
    });

    expect(stagedUsageDates).toEqual([utcMidnight("2026-10-19").toISOString()]);
  });

  test("stages nothing when billing is off", async () => {
    mockIsBillingEnabled = false;
    daysWithLogs = ["2026-10-22"];

    await TelemetryUsageBillingService.stageUnstagedTelemetryUsageForProject({
      projectId: PROJECT_ID,
      productType: ProductType.Logs,
    });

    expect(findBy).not.toHaveBeenCalled();
    expect(logDays).not.toHaveBeenCalled();
    expect(stage).not.toHaveBeenCalled();
  });

  test("leaves out the days before the billing cutoff it is handed", async () => {
    daysWithLogs = ["2026-10-17", "2026-10-20", "2026-10-22"];

    await TelemetryUsageBillingService.stageUnstagedTelemetryUsageForProject({
      projectId: PROJECT_ID,
      productType: ProductType.Logs,
      billingStartsAt: new Date("2026-10-20T00:00:00.000Z"),
    });

    // The cutoff day itself is billed, as stageTelemetryUsageForProject bills it.
    expect(stagedUsageDates).toEqual([
      utcMidnight("2026-10-20").toISOString(),
      utcMidnight("2026-10-22").toISOString(),
    ]);
    expect(JSON.stringify(findBy.mock.calls[0]![0].query.day)).toEqual(
      expect.stringContaining(
        JSON.stringify(["Oct 20, 2026", "Oct 21, 2026", "Oct 22, 2026"]),
      ),
    );
    expect(logDays.mock.calls[0]![0].startDate).toEqual(
      new Date("2026-10-20T00:00:00.000Z"),
    );
  });

  test("a cutoff after yesterday stages and queries nothing", async () => {
    daysWithLogs = ["2026-10-22"];

    await TelemetryUsageBillingService.stageUnstagedTelemetryUsageForProject({
      projectId: PROJECT_ID,
      productType: ProductType.Logs,
      billingStartsAt: new Date("2026-10-23T00:00:00.000Z"),
    });

    expect(findBy).not.toHaveBeenCalled();
    expect(logDays).not.toHaveBeenCalled();
    expect(stage).not.toHaveBeenCalled();
  });
});

describe("the catch-up reads the tables each product's usage scan reads", () => {
  interface DayQuerySpies {
    spans: jest.SpyInstance;
    exceptions: jest.SpyInstance;
    logs: jest.SpyInstance;
    metrics: jest.SpyInstance;
    securityEvents: jest.SpyInstance;
    profiles: jest.SpyInstance;
    profileSamples: jest.SpyInstance;
    sessionReplay: jest.SpyInstance;
  }

  let dayQueries: DayQuerySpies;

  beforeEach(() => {
    mockIsBillingEnabled = true;

    jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
    jest
      .spyOn(TelemetryUsageBillingService, "findBy")
      .mockResolvedValue([] as Array<TelemetryUsageBilling> as never);
    jest
      .spyOn(TelemetryUsageBillingService, "stageTelemetryUsageForProject")
      .mockResolvedValue(undefined);

    dayQueries = {
      spans: jest.spyOn(SpanService, "getDaysWithRows").mockResolvedValue([]),
      exceptions: jest
        .spyOn(ExceptionInstanceService, "getDaysWithRows")
        .mockResolvedValue([]),
      logs: jest.spyOn(LogService, "getDaysWithRows").mockResolvedValue([]),
      metrics: jest
        .spyOn(MetricService, "getDaysWithRows")
        .mockResolvedValue([]),
      securityEvents: jest
        .spyOn(SecurityEventService, "getDaysWithRows")
        .mockResolvedValue([]),
      profiles: jest
        .spyOn(ProfileService, "getDaysWithRows")
        .mockResolvedValue([]),
      profileSamples: jest
        .spyOn(ProfileSampleService, "getDaysWithRows")
        .mockResolvedValue([]),
      sessionReplay: jest
        .spyOn(RumSessionService, "getDaysWithRows")
        .mockResolvedValue([]),
    };
  });

  afterEach(() => {
    mockIsBillingEnabled = false;
    jest.restoreAllMocks();
  });

  test.each([
    [ProductType.Traces, { spans: "startTime", exceptions: "time" }],
    [ProductType.Logs, { logs: "time" }],
    [ProductType.Metrics, { metrics: "time" }],
    [ProductType.SecurityEvents, { securityEvents: "time" }],
    [ProductType.SessionReplay, { sessionReplay: "startTime" }],
    [ProductType.Profiles, { profiles: "startTime", profileSamples: "time" }],
  ])(
    "%s",
    async (productType: ProductType, expected: Record<string, string>) => {
      await TelemetryUsageBillingService.stageUnstagedTelemetryUsageForProject({
        projectId: PROJECT_ID,
        productType: productType,
      });

      for (const [name, spy] of Object.entries(dayQueries) as Array<
        [string, jest.SpyInstance]
      >) {
        if (!(name in expected)) {
          expect(spy).not.toHaveBeenCalled();
          continue;
        }

        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy.mock.calls[0]![0].timestampColumnName).toBe(expected[name]);
      }
    },
  );

  test("leaves out the session replay budget series for metrics, as the usage scan does", async () => {
    await TelemetryUsageBillingService.stageUnstagedTelemetryUsageForProject({
      projectId: PROJECT_ID,
      productType: ProductType.Metrics,
    });

    expect(
      [...dayQueries.metrics.mock.calls[0]![0].excludeNames].sort(),
    ).toEqual([...TELEMETRY_BILLING_EXCLUDED_METRIC_NAMES].sort());
  });

  test("stages a traces day that only exceptions have", async () => {
    dayQueries.exceptions.mockResolvedValue(["2026-10-21"]);
    const stage: jest.SpyInstance = jest.spyOn(
      TelemetryUsageBillingService,
      "stageTelemetryUsageForProject",
    );

    await TelemetryUsageBillingService.stageUnstagedTelemetryUsageForProject({
      projectId: PROJECT_ID,
      productType: ProductType.Traces,
    });

    expect(stage).toHaveBeenCalledTimes(1);
    expect(stage.mock.calls[0]![0].usageDate).toEqual(
      utcMidnight("2026-10-21"),
    );
  });
});
