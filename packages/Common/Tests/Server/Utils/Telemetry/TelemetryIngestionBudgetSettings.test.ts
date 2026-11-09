import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The budget settings the ingest path reads (issue #5917), cached in
 * process: ingest must not cost a Postgres read per request, a project with
 * nothing set must cost no more than a map lookup, a change must apply at
 * once on the server that saved it and within a minute everywhere else, and
 * a failed read must admit telemetry (fail open) without turning an outage
 * into a query per request. A read made to check a write is fresh and fails
 * closed.
 */

jest.mock("../../../../Server/Services/GlobalConfigService", () => {
  return { __esModule: true, default: { findOneById: jest.fn() } };
});

jest.mock("../../../../Server/Services/ProjectService", () => {
  return { __esModule: true, default: { findOneById: jest.fn() } };
});

jest.mock("../../../../Server/Utils/Logger", () => {
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

import GlobalConfigService from "../../../../Server/Services/GlobalConfigService";
import ProjectService from "../../../../Server/Services/ProjectService";
import logger from "../../../../Server/Utils/Logger";
import TelemetryIngestionBudgetSettings, {
  getDefaultTelemetryIngestionBudgetInstanceSettings,
  readTelemetryIngestionBudgetInstanceSettings,
  TELEMETRY_INGESTION_BUDGET_SETTINGS_TTL_MS,
  TelemetryIngestionBudgetInstanceSettings,
} from "../../../../Server/Utils/Telemetry/TelemetryIngestionBudgetSettings";
import ProductType from "../../../../Types/MeteredPlan/ProductType";
import ObjectID from "../../../../Types/ObjectID";
import {
  TELEMETRY_INGESTION_BUDGET_COLUMN_NAMES,
  TelemetryIngestionBudgetStoredSettings,
} from "../../../../Types/Telemetry/TelemetryIngestionBudget";

type MockFn = jest.Mock;

const globalConfigRead: MockFn =
  GlobalConfigService.findOneById as unknown as MockFn;
const projectRead: MockFn = ProjectService.findOneById as unknown as MockFn;

const PROJECT_A: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-1111111111a1",
);
const PROJECT_B: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-1111111111b2",
);

const FAILED_READ_TTL_MS: number = 10 * 1000;

/*
 * Time is ours: each test starts a day after the last, so the cache entries
 * and the log throttle one test leaves behind are long expired in the next.
 */
let now: number = Date.UTC(2026, 10, 9, 12, 0, 0);

beforeEach(() => {
  jest.clearAllMocks();
  now += 24 * 60 * 60 * 1000;
  jest.spyOn(Date, "now").mockImplementation(() => {
    return now;
  });
  TelemetryIngestionBudgetSettings.clearInstanceCache();
  TelemetryIngestionBudgetSettings.clearProjectCache();
  globalConfigRead.mockResolvedValue(null as never);
  projectRead.mockResolvedValue(null as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const advance: (ms: number) => void = (ms: number): void => {
  now += ms;
};

describe("readTelemetryIngestionBudgetInstanceSettings", () => {
  test("reads nothing set as no budgets, warning at 80%, reset at 00:00 UTC", () => {
    const defaults: TelemetryIngestionBudgetInstanceSettings =
      getDefaultTelemetryIngestionBudgetInstanceSettings();

    expect(readTelemetryIngestionBudgetInstanceSettings(null)).toEqual(
      defaults,
    );
    expect(defaults.warningPercent).toBe(80);
    expect(defaults.resetTime).toBe("00:00");
    expect(defaults.timezone).toBe("UTC");
    expect(defaults.budgets[ProductType.Logs]).toEqual({
      dailyBudgetInGB: null,
      rateLimitInMBPerSecond: null,
    });
  });

  test("reads a row's values, and garbage as the defaults rather than a block", () => {
    expect(
      readTelemetryIngestionBudgetInstanceSettings({
        logsDailyIngestionBudgetInGB: "12.5",
        tracesIngestionRateLimitInMBPerSecond: 4,
        telemetryIngestionBudgetWarningPercent: 90,
        telemetryIngestionBudgetResetTime: "06:30",
        telemetryIngestionBudgetResetTimezone: "Europe/Berlin",
      }),
    ).toEqual(
      expect.objectContaining({
        warningPercent: 90,
        resetTime: "06:30",
        timezone: "Europe/Berlin",
      }),
    );

    const garbage: TelemetryIngestionBudgetInstanceSettings =
      readTelemetryIngestionBudgetInstanceSettings({
        logsDailyIngestionBudgetInGB: -1,
        telemetryIngestionBudgetWarningPercent: 250,
        telemetryIngestionBudgetResetTime: "noon",
        telemetryIngestionBudgetResetTimezone: "Moon/Base",
      });

    expect(garbage).toEqual(
      getDefaultTelemetryIngestionBudgetInstanceSettings(),
    );
  });
});

describe("TelemetryIngestionBudgetSettings.getInstanceSettings", () => {
  test("reads GlobalConfig once, the budget columns only, and keeps it for a minute", async () => {
    globalConfigRead.mockResolvedValue({
      logsDailyIngestionBudgetInGB: 10,
    } as never);

    const first: TelemetryIngestionBudgetInstanceSettings =
      await TelemetryIngestionBudgetSettings.getInstanceSettings();
    advance(TELEMETRY_INGESTION_BUDGET_SETTINGS_TTL_MS - 1);
    await TelemetryIngestionBudgetSettings.getInstanceSettings();

    expect(first.budgets[ProductType.Logs].dailyBudgetInGB).toBe(10);
    expect(globalConfigRead).toHaveBeenCalledTimes(1);

    const call: Record<string, unknown> = globalConfigRead.mock
      .calls[0]![0] as Record<string, unknown>;
    expect((call["id"] as ObjectID).toString()).toBe(
      ObjectID.getZeroObjectID().toString(),
    );
    expect(
      Object.keys(call["select"] as Record<string, boolean>).sort(),
    ).toEqual(
      [
        ...TELEMETRY_INGESTION_BUDGET_COLUMN_NAMES,
        "telemetryIngestionBudgetWarningPercent",
        "telemetryIngestionBudgetResetTime",
        "telemetryIngestionBudgetResetTimezone",
      ].sort(),
    );
    expect(call["props"]).toEqual({ isRoot: true });

    advance(2);
    await TelemetryIngestionBudgetSettings.getInstanceSettings();
    expect(globalConfigRead).toHaveBeenCalledTimes(2);
  });

  test("requests that miss together share one read", async () => {
    let release: (row: unknown) => void = (): void => {};
    globalConfigRead.mockImplementation(() => {
      return new Promise((resolve: (row: unknown) => void) => {
        release = resolve;
      });
    });

    const reads: Array<Promise<TelemetryIngestionBudgetInstanceSettings>> = [
      TelemetryIngestionBudgetSettings.getInstanceSettings(),
      TelemetryIngestionBudgetSettings.getInstanceSettings(),
      TelemetryIngestionBudgetSettings.getInstanceSettings(),
    ];
    release({ metricsDailyIngestionBudgetInGB: 3 });
    const settings: Array<TelemetryIngestionBudgetInstanceSettings> =
      await Promise.all(reads);

    expect(globalConfigRead).toHaveBeenCalledTimes(1);
    for (const each of settings) {
      expect(each.budgets[ProductType.Metrics].dailyBudgetInGB).toBe(3);
    }
  });

  test("a save on this server applies at once: clearInstanceCache forgets it", async () => {
    globalConfigRead.mockResolvedValueOnce({
      logsDailyIngestionBudgetInGB: 10,
    } as never);
    globalConfigRead.mockResolvedValueOnce({
      logsDailyIngestionBudgetInGB: 20,
    } as never);

    await TelemetryIngestionBudgetSettings.getInstanceSettings();
    TelemetryIngestionBudgetSettings.clearInstanceCache();
    const after: TelemetryIngestionBudgetInstanceSettings =
      await TelemetryIngestionBudgetSettings.getInstanceSettings();

    expect(after.budgets[ProductType.Logs].dailyBudgetInGB).toBe(20);
  });

  test("fails open: a failed read is no budget, remembered for a few seconds, and logged once", async () => {
    globalConfigRead.mockRejectedValue(new Error("Postgres is down") as never);

    const settings: TelemetryIngestionBudgetInstanceSettings =
      await TelemetryIngestionBudgetSettings.getInstanceSettings();

    expect(settings).toEqual(
      getDefaultTelemetryIngestionBudgetInstanceSettings(),
    );

    advance(FAILED_READ_TTL_MS - 1);
    await TelemetryIngestionBudgetSettings.getInstanceSettings();
    expect(globalConfigRead).toHaveBeenCalledTimes(1);

    advance(2);
    await TelemetryIngestionBudgetSettings.getInstanceSettings();
    expect(globalConfigRead).toHaveBeenCalledTimes(2);

    // Two failures within a minute: one warning about it, not two.
    const warnings: Array<unknown> = (
      logger.warn as unknown as MockFn
    ).mock.calls
      .map((args: Array<unknown>) => {
        return args[0];
      })
      .filter((message: unknown) => {
        return (
          typeof message === "string" &&
          message.includes("telemetry is admitted without a budget")
        );
      });
    expect(warnings).toHaveLength(1);
  });

  test("a fresh read skips the cache, and throws rather than pass a write unchecked", async () => {
    globalConfigRead.mockResolvedValue({
      logsDailyIngestionBudgetInGB: 10,
    } as never);
    await TelemetryIngestionBudgetSettings.getInstanceSettings();

    globalConfigRead.mockResolvedValue({
      logsDailyIngestionBudgetInGB: 5,
    } as never);
    const fresh: TelemetryIngestionBudgetInstanceSettings =
      await TelemetryIngestionBudgetSettings.getInstanceSettings({
        fresh: true,
      });
    expect(fresh.budgets[ProductType.Logs].dailyBudgetInGB).toBe(5);
    expect(globalConfigRead).toHaveBeenCalledTimes(2);

    globalConfigRead.mockRejectedValue(new Error("Postgres is down") as never);
    await expect(
      TelemetryIngestionBudgetSettings.getInstanceSettings({ fresh: true }),
    ).rejects.toThrow("Postgres is down");
  });
});

describe("TelemetryIngestionBudgetSettings.getProjectOverrides", () => {
  test("a project with nothing set is null, and that answer is cached too", async () => {
    projectRead.mockResolvedValue({
      logsDailyIngestionBudgetInGB: null,
    } as never);

    expect(
      await TelemetryIngestionBudgetSettings.getProjectOverrides(PROJECT_A),
    ).toBe(null);
    expect(
      await TelemetryIngestionBudgetSettings.getProjectOverrides(PROJECT_A),
    ).toBe(null);
    expect(projectRead).toHaveBeenCalledTimes(1);

    const call: Record<string, unknown> = projectRead.mock
      .calls[0]![0] as Record<string, unknown>;
    expect(
      Object.keys(call["select"] as Record<string, boolean>).sort(),
    ).toEqual([...TELEMETRY_INGESTION_BUDGET_COLUMN_NAMES].sort());
    expect(call["props"]).toEqual({ isRoot: true });
  });

  test("a project's override, and 0 (no limit for this project) counts as one", async () => {
    projectRead.mockResolvedValueOnce({
      tracesDailyIngestionBudgetInGB: 7,
    } as never);
    projectRead.mockResolvedValueOnce({
      logsDailyIngestionBudgetInGB: 0,
    } as never);

    const a: TelemetryIngestionBudgetStoredSettings | null =
      await TelemetryIngestionBudgetSettings.getProjectOverrides(PROJECT_A);
    const b: TelemetryIngestionBudgetStoredSettings | null =
      await TelemetryIngestionBudgetSettings.getProjectOverrides(PROJECT_B);

    expect(a?.[ProductType.Traces].dailyBudgetInGB).toBe(7);
    expect(b?.[ProductType.Logs].dailyBudgetInGB).toBe(0);
  });

  test("keeps each project for a minute, and clearProjectCache forgets one or all", async () => {
    projectRead.mockResolvedValue({ logsDailyIngestionBudgetInGB: 1 } as never);

    await TelemetryIngestionBudgetSettings.getProjectOverrides(PROJECT_A);
    await TelemetryIngestionBudgetSettings.getProjectOverrides(PROJECT_B);
    advance(TELEMETRY_INGESTION_BUDGET_SETTINGS_TTL_MS - 1);
    await TelemetryIngestionBudgetSettings.getProjectOverrides(PROJECT_A);
    expect(projectRead).toHaveBeenCalledTimes(2);

    TelemetryIngestionBudgetSettings.clearProjectCache(PROJECT_A);
    await TelemetryIngestionBudgetSettings.getProjectOverrides(PROJECT_A);
    await TelemetryIngestionBudgetSettings.getProjectOverrides(PROJECT_B);
    expect(projectRead).toHaveBeenCalledTimes(3);

    TelemetryIngestionBudgetSettings.clearProjectCache();
    await TelemetryIngestionBudgetSettings.getProjectOverrides(PROJECT_A);
    await TelemetryIngestionBudgetSettings.getProjectOverrides(PROJECT_B);
    expect(projectRead).toHaveBeenCalledTimes(5);

    advance(TELEMETRY_INGESTION_BUDGET_SETTINGS_TTL_MS + 1);
    await TelemetryIngestionBudgetSettings.getProjectOverrides(PROJECT_A);
    expect(projectRead).toHaveBeenCalledTimes(6);
  });

  test("concurrent misses for one project share a read; another project reads its own", async () => {
    projectRead.mockResolvedValue({ logsDailyIngestionBudgetInGB: 1 } as never);

    await Promise.all([
      TelemetryIngestionBudgetSettings.getProjectOverrides(PROJECT_A),
      TelemetryIngestionBudgetSettings.getProjectOverrides(PROJECT_A),
      TelemetryIngestionBudgetSettings.getProjectOverrides(PROJECT_B),
    ]);

    expect(projectRead).toHaveBeenCalledTimes(2);
  });

  test("fails open for a few seconds, and a fresh read throws instead", async () => {
    projectRead.mockRejectedValue(new Error("Postgres is down") as never);

    expect(
      await TelemetryIngestionBudgetSettings.getProjectOverrides(PROJECT_A),
    ).toBe(null);
    advance(FAILED_READ_TTL_MS - 1);
    await TelemetryIngestionBudgetSettings.getProjectOverrides(PROJECT_A);
    expect(projectRead).toHaveBeenCalledTimes(1);

    advance(2);
    await TelemetryIngestionBudgetSettings.getProjectOverrides(PROJECT_A);
    expect(projectRead).toHaveBeenCalledTimes(2);

    await expect(
      TelemetryIngestionBudgetSettings.getProjectOverrides(PROJECT_A, {
        fresh: true,
      }),
    ).rejects.toThrow("Postgres is down");
  });
});
