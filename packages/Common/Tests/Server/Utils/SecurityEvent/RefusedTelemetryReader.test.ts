import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import Redis from "../../../../Server/Infrastructure/Redis";
import SecurityLogSourceService from "../../../../Server/Services/SecurityLogSourceService";
import SecurityTelemetrySourceService from "../../../../Server/Services/SecurityTelemetrySourceService";
import logger from "../../../../Server/Utils/Logger";
import RefusedTelemetryReader, {
  REFUSED_TELEMETRY_STATUS_CACHE_TTL_MS,
} from "../../../../Server/Utils/SecurityEvent/RefusedTelemetryReader";
import TelemetryIngestionBudgetStatusReader from "../../../../Server/Utils/Telemetry/TelemetryIngestionBudgetStatusReader";
import { JSONObject } from "../../../../Types/JSON";
import ProductType from "../../../../Types/MeteredPlan/ProductType";
import ObjectID from "../../../../Types/ObjectID";
import { SecurityTelemetrySourceKind } from "../../../../Types/SecurityEvent/SecurityTelemetrySource";
import {
  TelemetryIngestionBudgetScope,
  TelemetryIngestionBudgetSignalStatus,
  TelemetryIngestionBudgetState,
  TelemetryIngestionBudgetStatus,
} from "../../../../Types/Telemetry/TelemetryIngestionBudget";
import {
  RefusedTelemetry,
  RefusedTelemetryKind,
  RefusedTelemetryRecord,
  writeRefusedTelemetryRecord,
} from "../../../../Utils/SecurityEvent/RefusedTelemetry";

/*
 * How Security Events reads what a budget or a rate refused (#10431):
 * through the same reader the Usage page uses, with the settings the ingest
 * gate decides by, once per project for a short while however many of its
 * sources ask, never while Valkey is down - and never so that a read that
 * fails costs what the sources already knew.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0192f1a0-0000-7000-8000-0000000e1431",
);
const NOW: Date = new Date("2026-11-20T15:00:00.000Z");

const signal: (
  data: Partial<TelemetryIngestionBudgetSignalStatus> & {
    signal: TelemetryIngestionBudgetSignalStatus["signal"];
  },
) => TelemetryIngestionBudgetSignalStatus = (
  data: Partial<TelemetryIngestionBudgetSignalStatus> & {
    signal: TelemetryIngestionBudgetSignalStatus["signal"];
  },
): TelemetryIngestionBudgetSignalStatus => {
  return {
    dailyBudgetBytes: 1000,
    dailyBudgetSource: null,
    rateLimitBytesPerSecond: null,
    rateLimitSource: null,
    usedBytes: 0,
    droppedBytes: 0,
    droppedRequests: 0,
    throttledRequests: 0,
    percentUsed: 0,
    state: TelemetryIngestionBudgetState.Ok,
    warningCrossedAt: null,
    exhaustedAt: null,
    ...data,
  };
};

// The project's logs budget used up at 14:02, its traces' fine.
const usedUpStatus: (
  countersAvailable?: boolean,
) => TelemetryIngestionBudgetStatus = (
  countersAvailable: boolean = true,
): TelemetryIngestionBudgetStatus => {
  return {
    dayStartsAt: "2026-11-20T00:00:00.000Z",
    resetsAt: "2026-11-21T00:00:00.000Z",
    resetTime: "00:00",
    timezone: "UTC",
    warningPercent: 80,
    countersAvailable,
    project: {
      scope: TelemetryIngestionBudgetScope.Project,
      signals: [
        signal({
          signal: ProductType.Logs,
          usedBytes: 1000,
          droppedBytes: 52_428_800,
          droppedRequests: 1200,
          state: TelemetryIngestionBudgetState.Exhausted,
          exhaustedAt: "2026-11-20T14:02:00.000Z",
        }),
        signal({ signal: ProductType.Traces }),
      ],
    },
    ingestionKeys: [],
    teamsAndLabels: [],
  };
};

let getProjectStatus: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  RefusedTelemetryReader.clearCache();
  jest.spyOn(Redis, "isConnected").mockReturnValue(true);
  getProjectStatus = jest
    .spyOn(TelemetryIngestionBudgetStatusReader, "getProjectStatus")
    .mockResolvedValue(usedUpStatus());
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("RefusedTelemetryReader.readBudgetStatus", () => {
  test("reads through the status reader, with the settings the ingest gate decides by", async () => {
    const status: TelemetryIngestionBudgetStatus | null =
      await RefusedTelemetryReader.readBudgetStatus({
        projectId: PROJECT_ID,
        now: NOW,
      });

    expect(status).toEqual(usedUpStatus());
    expect(getProjectStatus).toHaveBeenCalledTimes(1);
    expect(getProjectStatus.mock.calls[0]![0]).toEqual({
      projectId: PROJECT_ID,
      now: NOW,
      readsSettingsAsIngestDoes: true,
    });
  });

  test("one read serves the project's sources for a while, then it is read again", async () => {
    jest.useFakeTimers({ now: NOW });

    await RefusedTelemetryReader.readBudgetStatus({
      projectId: PROJECT_ID,
      now: NOW,
    });
    await RefusedTelemetryReader.readBudgetStatus({
      projectId: PROJECT_ID,
      now: NOW,
    });

    expect(getProjectStatus).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(REFUSED_TELEMETRY_STATUS_CACHE_TTL_MS + 1);

    await RefusedTelemetryReader.readBudgetStatus({
      projectId: PROJECT_ID,
      now: NOW,
    });

    expect(getProjectStatus).toHaveBeenCalledTimes(2);
  });

  test("counters that could not be read are asked for again next time", async () => {
    getProjectStatus.mockResolvedValue(usedUpStatus(false));

    await RefusedTelemetryReader.readBudgetStatus({
      projectId: PROJECT_ID,
      now: NOW,
    });
    await RefusedTelemetryReader.readBudgetStatus({
      projectId: PROJECT_ID,
      now: NOW,
    });

    expect(getProjectStatus).toHaveBeenCalledTimes(2);
  });

  test("reads nothing while Valkey is down: there are no counters, and nothing is refused", async () => {
    jest.spyOn(Redis, "isConnected").mockReturnValue(false);

    expect(
      await RefusedTelemetryReader.readBudgetStatus({
        projectId: PROJECT_ID,
        now: NOW,
      }),
    ).toBeNull();
    expect(getProjectStatus).not.toHaveBeenCalled();
  });

  test("a read that fails is no read, never a throw", async () => {
    getProjectStatus.mockRejectedValue(new Error("Postgres is down"));
    jest.spyOn(logger, "warn").mockImplementation((): void => {
      return undefined;
    });

    await expect(
      RefusedTelemetryReader.readBudgetStatus({
        projectId: PROJECT_ID,
        now: NOW,
      }),
    ).resolves.toBeNull();
  });
});

describe("RefusedTelemetryReader.observe", () => {
  test("folds the counters as they are into what the source knew", async () => {
    const record: RefusedTelemetryRecord = await RefusedTelemetryReader.observe(
      {
        projectId: PROJECT_ID,
        signal: ProductType.Logs,
        lastScanResult: { logsRead: 0 },
        now: NOW,
      },
    );

    expect(record.refusals).toEqual([
      {
        signal: ProductType.Logs,
        kind: RefusedTelemetryKind.BudgetUsedUp,
        scope: TelemetryIngestionBudgetScope.Project,
        scopeId: PROJECT_ID.toString(),
        scopeName: "",
        from: "2026-11-20T14:02:00.000Z",
        to: null,
        refusedBytes: 52_428_800,
        refusedRequests: 1200,
      },
    ]);
    expect(record.observation?.observedAt).toBe(NOW.toISOString());
  });

  test("the traces' source learns nothing from the logs' counters", async () => {
    const record: RefusedTelemetryRecord = await RefusedTelemetryReader.observe(
      {
        projectId: PROJECT_ID,
        signal: ProductType.Traces,
        lastScanResult: undefined,
        now: NOW,
      },
    );

    expect(record.refusals).toEqual([]);
  });

  test("without counters, what the source knew is kept as it was", async () => {
    jest.spyOn(Redis, "isConnected").mockReturnValue(false);

    const known: RefusedTelemetry = {
      signal: ProductType.Logs,
      kind: RefusedTelemetryKind.BudgetUsedUp,
      scope: TelemetryIngestionBudgetScope.Project,
      scopeId: PROJECT_ID.toString(),
      scopeName: "",
      from: "2026-11-20T09:00:00.000Z",
      to: null,
      refusedBytes: 10,
      refusedRequests: 1,
    };

    const record: RefusedTelemetryRecord = await RefusedTelemetryReader.observe(
      {
        projectId: PROJECT_ID,
        signal: ProductType.Logs,
        lastScanResult: writeRefusedTelemetryRecord({
          observation: null,
          refusals: [known],
        }),
        now: NOW,
      },
    );

    expect(record.refusals).toEqual([known]);
  });
});

describe("RefusedTelemetryReader.readForProject", () => {
  const refusalOf: (
    signalOf: RefusedTelemetry["signal"],
  ) => RefusedTelemetry = (
    signalOf: RefusedTelemetry["signal"],
  ): RefusedTelemetry => {
    return {
      signal: signalOf,
      kind: RefusedTelemetryKind.RateLimited,
      scope: TelemetryIngestionBudgetScope.Project,
      scopeId: PROJECT_ID.toString(),
      scopeName: "",
      from: "2026-11-18T09:00:00.000Z",
      to: "2026-11-18T09:20:00.000Z",
      refusedBytes: 0,
      refusedRequests: 12,
    };
  };

  test("reads both sources as OneUptime, on or off, with the counters as they are folded in", async () => {
    const logSource: ReturnType<typeof jest.spyOn> = jest
      .spyOn(SecurityLogSourceService, "findOneBy")
      .mockResolvedValue({
        lastScanResult: writeRefusedTelemetryRecord({
          observation: null,
          refusals: [refusalOf(ProductType.Logs)],
        }),
      } as never);
    const tracesSource: ReturnType<typeof jest.spyOn> = jest
      .spyOn(SecurityTelemetrySourceService, "findOneBy")
      .mockResolvedValue({
        lastScanResult: writeRefusedTelemetryRecord({
          observation: null,
          refusals: [refusalOf(ProductType.Traces)],
        }),
      } as never);

    const refusals: Array<RefusedTelemetry> =
      await RefusedTelemetryReader.readForProject({
        projectId: PROJECT_ID,
        now: NOW,
      });

    // What each kept, and the logs' used-up budget the counters say now.
    expect(
      refusals.map((refusal: RefusedTelemetry): Array<string | null> => {
        return [refusal.signal, refusal.kind, refusal.to];
      }),
    ).toEqual([
      [
        ProductType.Logs,
        RefusedTelemetryKind.RateLimited,
        "2026-11-18T09:20:00.000Z",
      ],
      [ProductType.Logs, RefusedTelemetryKind.BudgetUsedUp, null],
      [
        ProductType.Traces,
        RefusedTelemetryKind.RateLimited,
        "2026-11-18T09:20:00.000Z",
      ],
    ]);

    const logQuery: JSONObject = logSource.mock.calls[0]![0] as JSONObject;
    expect(logQuery["query"]).toEqual({ projectId: PROJECT_ID });
    expect(logQuery["props"]).toEqual({ isRoot: true });

    const tracesQuery: JSONObject = tracesSource.mock
      .calls[0]![0] as JSONObject;
    expect(tracesQuery["query"]).toEqual({
      projectId: PROJECT_ID,
      kind: SecurityTelemetrySourceKind.Traces,
    });
  });

  test("a project with neither source has nothing refused to say", async () => {
    jest.spyOn(SecurityLogSourceService, "findOneBy").mockResolvedValue(null);
    jest
      .spyOn(SecurityTelemetrySourceService, "findOneBy")
      .mockResolvedValue(null);

    expect(
      await RefusedTelemetryReader.readForProject({
        projectId: PROJECT_ID,
        now: NOW,
      }),
    ).toEqual([]);
  });

  test("sources that cannot be read say nothing, never a throw", async () => {
    jest
      .spyOn(SecurityLogSourceService, "findOneBy")
      .mockRejectedValue(new Error("Postgres is down"));
    jest
      .spyOn(SecurityTelemetrySourceService, "findOneBy")
      .mockResolvedValue(null);
    jest.spyOn(logger, "warn").mockImplementation((): void => {
      return undefined;
    });

    await expect(
      RefusedTelemetryReader.readForProject({
        projectId: PROJECT_ID,
        now: NOW,
      }),
    ).resolves.toEqual([]);
  });
});
