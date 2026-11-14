import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * Today's ingestion budgets as the status API answers them (issue #5917):
 * every signal's budget and rate and where each was set, what the counters
 * say, for the project and each key with a budget of its own - and never a
 * 0 standing in for a counter that could not be read.
 */

jest.mock(
  "../../../../Server/Utils/Telemetry/TelemetryIngestionBudgetSettings",
  () => {
    return {
      __esModule: true,
      default: {
        getInstanceSettings: jest.fn(),
        getProjectOverrides: jest.fn(),
      },
    };
  },
);

jest.mock(
  "../../../../Server/Utils/Telemetry/TelemetryIngestionBudgetCounter",
  () => {
    return {
      __esModule: true,
      default: { readDayCounters: jest.fn() },
    };
  },
);

jest.mock("../../../../Server/Services/TelemetryIngestionKeyService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
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

import TelemetryIngestionBudgetStatusReader, {
  buildTelemetryIngestionBudgetSignalStatus,
} from "../../../../Server/Utils/Telemetry/TelemetryIngestionBudgetStatusReader";
import TelemetryIngestionBudgetSettings from "../../../../Server/Utils/Telemetry/TelemetryIngestionBudgetSettings";
import TelemetryIngestionBudgetCounter, {
  TelemetryIngestionBudgetDayCounters,
  TelemetryIngestionBudgetDayKeyParts,
} from "../../../../Server/Utils/Telemetry/TelemetryIngestionBudgetCounter";
import TelemetryIngestionKeyService from "../../../../Server/Services/TelemetryIngestionKeyService";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../../Types/JSON";
import ProductType from "../../../../Types/MeteredPlan/ProductType";
import ObjectID from "../../../../Types/ObjectID";
import {
  getEmptyTelemetryIngestionBudgetStoredSettings,
  readTelemetryIngestionBudgetStatus,
  TELEMETRY_INGESTION_BUDGET_BYTES_PER_GB,
  TELEMETRY_INGESTION_BUDGET_BYTES_PER_MB,
  TelemetryIngestionBudgetLimitSource,
  TelemetryIngestionBudgetScope,
  TelemetryIngestionBudgetScopeStatus,
  TelemetryIngestionBudgetSignalStatus,
  TelemetryIngestionBudgetState,
  TelemetryIngestionBudgetStatus,
  TelemetryIngestionBudgetStoredSettings,
} from "../../../../Types/Telemetry/TelemetryIngestionBudget";

type MockFn = jest.Mock;

const GB: number = TELEMETRY_INGESTION_BUDGET_BYTES_PER_GB;
const MB: number = TELEMETRY_INGESTION_BUDGET_BYTES_PER_MB;
const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111191",
);
const KEY_ID: string = "11111111-1111-4111-8111-111111111192";
const OTHER_KEY_ID: string = "11111111-1111-4111-8111-111111111193";
const NOW: Date = new Date("2026-11-09T12:00:00Z");

const counters: (
  overrides?: Partial<TelemetryIngestionBudgetDayCounters>,
) => TelemetryIngestionBudgetDayCounters = (
  overrides?: Partial<TelemetryIngestionBudgetDayCounters>,
): TelemetryIngestionBudgetDayCounters => {
  return {
    usedBytes: 0,
    droppedBytes: 0,
    droppedRequests: 0,
    throttledRequests: 0,
    warningCrossedAt: null,
    exhaustedAt: null,
    warningNoticeSentAt: null,
    exhaustedNoticeSentAt: null,
    ...(overrides || {}),
  };
};

const withLogs: (
  daily: number | null,
  rate?: number | null,
) => TelemetryIngestionBudgetStoredSettings = (
  daily: number | null,
  rate: number | null = null,
): TelemetryIngestionBudgetStoredSettings => {
  const stored: TelemetryIngestionBudgetStoredSettings =
    getEmptyTelemetryIngestionBudgetStoredSettings();
  stored[ProductType.Logs] = {
    dailyBudgetInGB: daily,
    rateLimitInMBPerSecond: rate,
  };
  return stored;
};

beforeEach(() => {
  jest.clearAllMocks();
  (
    TelemetryIngestionBudgetSettings.getInstanceSettings as unknown as MockFn
  ).mockResolvedValue({
    budgets: withLogs(10, 5),
    warningPercent: 80,
    resetTime: "00:00",
    timezone: "UTC",
  } as never);
  (
    TelemetryIngestionBudgetSettings.getProjectOverrides as unknown as MockFn
  ).mockResolvedValue(null as never);
  (TelemetryIngestionKeyService.findBy as unknown as MockFn).mockResolvedValue(
    [] as never,
  );
  (
    TelemetryIngestionBudgetCounter.readDayCounters as unknown as MockFn
  ).mockImplementation((async (
    days: Array<TelemetryIngestionBudgetDayKeyParts>,
  ) => {
    return days.map((day: TelemetryIngestionBudgetDayKeyParts) => {
      return day.signalSlug === "logs" && day.scope === "project"
        ? counters({ usedBytes: 9 * GB, droppedBytes: 3, droppedRequests: 1 })
        : counters();
    });
  }) as never);
});

describe("buildTelemetryIngestionBudgetSignalStatus", () => {
  test("puts the limits, the counts, the percent and the state together", () => {
    const status: TelemetryIngestionBudgetSignalStatus =
      buildTelemetryIngestionBudgetSignalStatus({
        signal: ProductType.Logs,
        limits: {
          dailyBudget: {
            bytes: 10 * GB,
            source: TelemetryIngestionBudgetLimitSource.Instance,
          },
          rateLimit: { bytes: null, source: null },
        },
        counters: counters({
          usedBytes: 10 * GB,
          throttledRequests: 4,
          exhaustedAt: new Date("2026-11-09T10:00:00Z"),
        }),
        warningPercent: 80,
      });

    expect(status).toEqual({
      signal: ProductType.Logs,
      dailyBudgetBytes: 10 * GB,
      dailyBudgetSource: TelemetryIngestionBudgetLimitSource.Instance,
      rateLimitBytesPerSecond: null,
      rateLimitSource: null,
      usedBytes: 10 * GB,
      droppedBytes: 0,
      droppedRequests: 0,
      throttledRequests: 4,
      percentUsed: 100,
      state: TelemetryIngestionBudgetState.Exhausted,
      warningCrossedAt: null,
      exhaustedAt: "2026-11-09T10:00:00.000Z",
    });
  });

  test("answers null for every figure it could not read, and an unknown state", () => {
    const status: TelemetryIngestionBudgetSignalStatus =
      buildTelemetryIngestionBudgetSignalStatus({
        signal: ProductType.Traces,
        limits: {
          dailyBudget: {
            bytes: GB,
            source: TelemetryIngestionBudgetLimitSource.Project,
          },
          rateLimit: { bytes: null, source: null },
        },
        counters: null,
        warningPercent: 80,
      });

    expect(status.usedBytes).toBe(null);
    expect(status.droppedBytes).toBe(null);
    expect(status.percentUsed).toBe(null);
    expect(status.state).toBe(TelemetryIngestionBudgetState.Unknown);
  });
});

describe("TelemetryIngestionBudgetStatusReader.getProjectStatus", () => {
  test("answers the day, the reset and every signal of the project", async () => {
    const status: TelemetryIngestionBudgetStatus =
      await TelemetryIngestionBudgetStatusReader.getProjectStatus({
        projectId: PROJECT_ID,
        now: NOW,
      });

    expect(status.dayStartsAt).toBe("2026-11-09T00:00:00.000Z");
    expect(status.resetsAt).toBe("2026-11-10T00:00:00.000Z");
    expect(status.warningPercent).toBe(80);
    expect(status.countersAvailable).toBe(true);
    expect(status.project.scope).toBe(TelemetryIngestionBudgetScope.Project);
    expect(status.project.signals).toHaveLength(5);

    const logs: TelemetryIngestionBudgetSignalStatus =
      status.project.signals[0]!;

    expect(logs.signal).toBe(ProductType.Logs);
    expect(logs.dailyBudgetBytes).toBe(10 * GB);
    expect(logs.rateLimitBytesPerSecond).toBe(5 * MB);
    expect(logs.usedBytes).toBe(9 * GB);
    expect(logs.percentUsed).toBe(90);
    expect(logs.state).toBe(TelemetryIngestionBudgetState.Warning);
    expect(logs.droppedRequests).toBe(1);
    expect(status.project.signals[1]!.state).toBe(
      TelemetryIngestionBudgetState.NoBudget,
    );
    expect(status.ingestionKeys).toEqual([]);
  });

  test("reads the settings fresh, so a budget just saved is the one shown", async () => {
    await TelemetryIngestionBudgetStatusReader.getProjectStatus({
      projectId: PROJECT_ID,
      now: NOW,
    });

    expect(
      TelemetryIngestionBudgetSettings.getInstanceSettings,
    ).toHaveBeenCalledWith({ fresh: true });
    expect(
      TelemetryIngestionBudgetSettings.getProjectOverrides,
    ).toHaveBeenCalledWith(PROJECT_ID, { fresh: true });
  });

  test("falls back to the cache when a fresh read fails", async () => {
    (
      TelemetryIngestionBudgetSettings.getInstanceSettings as unknown as MockFn
    ).mockRejectedValueOnce(new Error("Postgres is down") as never);

    const status: TelemetryIngestionBudgetStatus =
      await TelemetryIngestionBudgetStatusReader.getProjectStatus({
        projectId: PROJECT_ID,
        now: NOW,
      });

    expect(status.project.signals[0]!.dailyBudgetBytes).toBe(10 * GB);
    expect(
      TelemetryIngestionBudgetSettings.getInstanceSettings,
    ).toHaveBeenCalledTimes(2);
  });

  test("lists the keys with budgets of their own, by name, each held to the project's", async () => {
    (
      TelemetryIngestionKeyService.findBy as unknown as MockFn
    ).mockResolvedValue([
      {
        id: new ObjectID(OTHER_KEY_ID),
        name: "zeta",
        logsDailyIngestionBudgetInGB: 1,
      },
      {
        id: new ObjectID(KEY_ID),
        name: "alpha",
        logsDailyIngestionBudgetInGB: 50,
      },
      {
        id: new ObjectID("11111111-1111-4111-8111-111111111194"),
        name: "plain",
      },
    ] as never);

    const status: TelemetryIngestionBudgetStatus =
      await TelemetryIngestionBudgetStatusReader.getProjectStatus({
        projectId: PROJECT_ID,
        now: NOW,
      });

    expect(
      status.ingestionKeys.map((key: TelemetryIngestionBudgetScopeStatus) => {
        return key.ingestionKeyName;
      }),
    ).toEqual(["alpha", "zeta"]);

    const alpha: TelemetryIngestionBudgetSignalStatus =
      status.ingestionKeys[0]!.signals[0]!;

    // 50 GB of its own, held to the project's 10.
    expect(alpha.dailyBudgetBytes).toBe(10 * GB);
    expect(alpha.dailyBudgetSource).toBe(
      TelemetryIngestionBudgetLimitSource.Instance,
    );
    expect(status.ingestionKeys[1]!.signals[0]!.dailyBudgetBytes).toBe(GB);
    expect(status.ingestionKeys[1]!.ingestionKeyId).toBe(OTHER_KEY_ID);
  });

  test("reads every scope's counters for today in one batch, project first", async () => {
    (
      TelemetryIngestionKeyService.findBy as unknown as MockFn
    ).mockResolvedValue([
      {
        id: new ObjectID(KEY_ID),
        name: "k",
        tracesDailyIngestionBudgetInGB: 2,
      },
    ] as never);

    await TelemetryIngestionBudgetStatusReader.getProjectStatus({
      projectId: PROJECT_ID,
      now: NOW,
    });

    const days: Array<TelemetryIngestionBudgetDayKeyParts> = (
      TelemetryIngestionBudgetCounter.readDayCounters as unknown as MockFn
    ).mock.calls[0]![0] as Array<TelemetryIngestionBudgetDayKeyParts>;

    expect(days).toHaveLength(10);
    expect(days[0]).toEqual({
      dayId: "20261109T0000Z",
      scope: TelemetryIngestionBudgetScope.Project,
      scopeId: PROJECT_ID.toString(),
      signalSlug: "logs",
    });
    expect(days[5]!.scope).toBe(TelemetryIngestionBudgetScope.IngestionKey);
    expect(days[5]!.scopeId).toBe(KEY_ID);
  });

  test("says the counters could not be read, rather than showing zeros", async () => {
    (
      TelemetryIngestionBudgetCounter.readDayCounters as unknown as MockFn
    ).mockResolvedValue(null as never);

    const status: TelemetryIngestionBudgetStatus =
      await TelemetryIngestionBudgetStatusReader.getProjectStatus({
        projectId: PROJECT_ID,
        now: NOW,
      });

    expect(status.countersAvailable).toBe(false);
    expect(status.project.signals[0]!.usedBytes).toBe(null);
    expect(status.project.signals[0]!.state).toBe(
      TelemetryIngestionBudgetState.Unknown,
    );
  });

  test("names the worst state of a scope", () => {
    const scope: (
      states: Array<TelemetryIngestionBudgetState>,
    ) => TelemetryIngestionBudgetScopeStatus = (
      states: Array<TelemetryIngestionBudgetState>,
    ): TelemetryIngestionBudgetScopeStatus => {
      return {
        scope: TelemetryIngestionBudgetScope.Project,
        signals: states.map((state: TelemetryIngestionBudgetState) => {
          return { state: state } as TelemetryIngestionBudgetSignalStatus;
        }),
      };
    };

    expect(
      TelemetryIngestionBudgetStatusReader.getWorstState(
        scope([
          TelemetryIngestionBudgetState.Ok,
          TelemetryIngestionBudgetState.Exhausted,
          TelemetryIngestionBudgetState.Warning,
        ]),
      ),
    ).toBe(TelemetryIngestionBudgetState.Exhausted);
    expect(
      TelemetryIngestionBudgetStatusReader.getWorstState(
        scope([
          TelemetryIngestionBudgetState.NoBudget,
          TelemetryIngestionBudgetState.Warning,
        ]),
      ),
    ).toBe(TelemetryIngestionBudgetState.Warning);
    expect(
      TelemetryIngestionBudgetStatusReader.getWorstState(
        scope([TelemetryIngestionBudgetState.NoBudget]),
      ),
    ).toBe(TelemetryIngestionBudgetState.Ok);
  });
});

/*
 * Issue #6486: the Dashboard and the Admin Dashboard read every answer of
 * the status API through readTelemetryIngestionBudgetStatus, which reads an
 * answer that is not a status as none (the explorers' banner draws nothing,
 * the budget card says the read failed). So every answer this server writes
 * must read back as itself once it has crossed the wire - sent as JSON and
 * parsed as the browser's API client parses it - or a used-up budget would
 * go untold, and a field added to the status later but not to the reader
 * would be dropped without a word.
 */
describe("what the Dashboard reads back of each answer", () => {
  // As the API sends it and the browser's API client hands it over.
  const overTheWire: (status: TelemetryIngestionBudgetStatus) => unknown = (
    status: TelemetryIngestionBudgetStatus,
  ): unknown => {
    return new HTTPResponse<JSONObject>(
      200,
      JSON.parse(JSON.stringify(status)) as JSONObject,
      {},
    ).data;
  };

  const readsBackAsItself: (status: TelemetryIngestionBudgetStatus) => void = (
    status: TelemetryIngestionBudgetStatus,
  ): void => {
    const read: TelemetryIngestionBudgetStatus | null =
      readTelemetryIngestionBudgetStatus(overTheWire(status));

    // Field for field: nothing dropped, and nothing added as undefined.
    expect(read).toStrictEqual(status);
  };

  test("a busy day in a time zone of its own: used up, past warning, keys of their own", async () => {
    (
      TelemetryIngestionBudgetSettings.getInstanceSettings as unknown as MockFn
    ).mockResolvedValue({
      budgets: withLogs(10, 5),
      warningPercent: 75,
      resetTime: "05:30",
      timezone: "Asia/Kolkata",
    } as never);
    (
      TelemetryIngestionBudgetSettings.getProjectOverrides as unknown as MockFn
    ).mockResolvedValue(withLogs(2) as never);
    (
      TelemetryIngestionKeyService.findBy as unknown as MockFn
    ).mockResolvedValue([
      {
        id: new ObjectID(KEY_ID),
        name: "Edge collector",
        logsDailyIngestionBudgetInGB: 1,
      },
      {
        id: new ObjectID(OTHER_KEY_ID),
        name: "",
        tracesDailyIngestionBudgetInGB: 2,
      },
    ] as never);
    (
      TelemetryIngestionBudgetCounter.readDayCounters as unknown as MockFn
    ).mockImplementation((async (
      days: Array<TelemetryIngestionBudgetDayKeyParts>,
    ) => {
      return days.map((day: TelemetryIngestionBudgetDayKeyParts) => {
        if (day.signalSlug !== "logs") {
          return counters({ usedBytes: 3 * MB, throttledRequests: 2 });
        }

        return counters({
          usedBytes: 2 * GB,
          droppedBytes: GB,
          droppedRequests: 40,
          warningCrossedAt: new Date("2026-11-09T06:30:00Z"),
          exhaustedAt: new Date("2026-11-09T09:45:00Z"),
        });
      });
    }) as never);

    const status: TelemetryIngestionBudgetStatus =
      await TelemetryIngestionBudgetStatusReader.getProjectStatus({
        projectId: PROJECT_ID,
        now: NOW,
      });

    // The answer is the busy one this test means it to be.
    expect(status.timezone).toBe("Asia/Kolkata");
    expect(status.resetTime).toBe("05:30");
    expect(status.warningPercent).toBe(75);
    expect(status.project.signals[0]!.state).toBe(
      TelemetryIngestionBudgetState.Exhausted,
    );
    expect(status.project.signals[0]!.dailyBudgetSource).toBe(
      TelemetryIngestionBudgetLimitSource.Project,
    );
    expect(status.project.signals[0]!.exhaustedAt).toBe(
      "2026-11-09T09:45:00.000Z",
    );
    expect(status.ingestionKeys).toHaveLength(2);
    expect(status.ingestionKeys[0]!.ingestionKeyName).toBe("");

    readsBackAsItself(status);
  });

  test("a project with no budget, the default", async () => {
    (
      TelemetryIngestionBudgetSettings.getInstanceSettings as unknown as MockFn
    ).mockResolvedValue({
      budgets: getEmptyTelemetryIngestionBudgetStoredSettings(),
      warningPercent: 80,
      resetTime: "00:00",
      timezone: "UTC",
    } as never);

    const status: TelemetryIngestionBudgetStatus =
      await TelemetryIngestionBudgetStatusReader.getProjectStatus({
        projectId: PROJECT_ID,
        now: NOW,
      });

    expect(status.project.signals[0]!.state).toBe(
      TelemetryIngestionBudgetState.NoBudget,
    );

    readsBackAsItself(status);
  });

  test("counters that could not be read: every figure null", async () => {
    (
      TelemetryIngestionBudgetCounter.readDayCounters as unknown as MockFn
    ).mockResolvedValue(null as never);

    const status: TelemetryIngestionBudgetStatus =
      await TelemetryIngestionBudgetStatusReader.getProjectStatus({
        projectId: PROJECT_ID,
        now: NOW,
      });

    expect(status.countersAvailable).toBe(false);

    readsBackAsItself(status);
  });
});
