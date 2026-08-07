import DatabaseNotConnectedException from "../../../../Types/Exception/DatabaseNotConnectedException";
import ObjectID from "../../../../Types/ObjectID";
import PostgresAppInstance from "../../../../Server/Infrastructure/PostgresDatabase";
import MonitorStatusTimelineService from "../../../../Server/Services/MonitorStatusTimelineService";
import logger from "../../../../Server/Utils/Logger";
import MonitorActiveMonitoringTimelineReconciler, {
  ActiveMonitoringTimelineRepairResult,
} from "../../../../Server/Utils/Monitor/MonitorActiveMonitoringTimelineReconciler";

jest.mock("../../../../Server/Infrastructure/PostgresDatabase", () => {
  return {
    __esModule: true,
    default: {
      getDataSource: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Services/MonitorStatusTimelineService", () => {
  return {
    __esModule: true,
    default: {
      reconcileActiveMonitoring: jest.fn(),
    },
  };
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

const mockedPostgresAppInstance: { getDataSource: jest.Mock } =
  PostgresAppInstance as unknown as { getDataSource: jest.Mock };
const mockedMonitorStatusTimelineService: {
  reconcileActiveMonitoring: jest.Mock;
} = MonitorStatusTimelineService as unknown as {
  reconcileActiveMonitoring: jest.Mock;
};
const mockedLogger: { error: jest.Mock } = logger as unknown as {
  error: jest.Mock;
};
const mockedDataSource: { query: jest.Mock } = {
  query: jest.fn(),
};

const FIRST_MONITOR_ID: string = "11111111-1111-4111-8111-111111111111";
const SECOND_MONITOR_ID: string = "22222222-2222-4222-8222-222222222222";
const THIRD_MONITOR_ID: string = "33333333-3333-4333-8333-333333333333";

function mismatchRow(
  monitorId: string,
  stateUpdatedAt: Date | string,
  disableActiveMonitoring: boolean = false,
): {
  disableActiveMonitoring: boolean;
  monitorId: string;
  stateUpdatedAt: Date | string;
} {
  return {
    disableActiveMonitoring,
    monitorId,
    stateUpdatedAt,
  };
}

function generatedMonitorId(index: number): string {
  return `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`;
}

describe("MonitorActiveMonitoringTimelineReconciler.repairMismatches", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedPostgresAppInstance.getDataSource.mockReturnValue(
      mockedDataSource as never,
    );
    mockedDataSource.query.mockResolvedValue([] as never);
    mockedMonitorStatusTimelineService.reconcileActiveMonitoring.mockResolvedValue(
      {
        didPause: false,
        didResume: false,
        monitorWasFound: true,
        stateMatchedExpectation: true,
      } as never,
    );
  });

  test("throws before querying when Postgres is unavailable", async () => {
    mockedPostgresAppInstance.getDataSource.mockReturnValue(null);

    await expect(
      MonitorActiveMonitoringTimelineReconciler.repairMismatches(),
    ).rejects.toBeInstanceOf(DatabaseNotConnectedException);

    expect(mockedDataSource.query).not.toHaveBeenCalled();
    expect(
      mockedMonitorStatusTimelineService.reconcileActiveMonitoring,
    ).not.toHaveBeenCalled();
  });

  test("returns an empty result when no mismatched monitors exist", async () => {
    const result: ActiveMonitoringTimelineRepairResult =
      await MonitorActiveMonitoringTimelineReconciler.repairMismatches();

    expect(result).toEqual({
      failedMonitorIds: [],
      monitorsExamined: 0,
      paused: 0,
      resumed: 0,
    });
    expect(mockedDataSource.query).toHaveBeenCalledTimes(1);
    expect(mockedDataSource.query.mock.calls[0]![1]).toEqual([null, "100"]);
  });

  test("queries both mismatch directions with soft-delete, open-row, and keyset guards", async () => {
    await MonitorActiveMonitoringTimelineReconciler.repairMismatches();

    const sql: string = mockedDataSource.query.mock.calls[0]![0] as string;
    const normalizedSql: string = sql.replace(/\s+/g, " ").trim();

    expect(normalizedSql).toContain('m."deletedAt" IS NULL');
    expect(normalizedSql).toContain(
      'm."disableActiveMonitoring" AS "disableActiveMonitoring"',
    );
    expect(normalizedSql).toContain('($1::uuid IS NULL OR m."_id" > $1::uuid)');
    expect(normalizedSql).toContain(
      'm."disableActiveMonitoring" = true AND EXISTS',
    );
    expect(normalizedSql).toContain(
      'm."disableActiveMonitoring" = false AND NOT EXISTS',
    );
    expect(normalizedSql).toContain('t."monitorId" = m."_id"');
    expect(normalizedSql).toContain('t."deletedAt" IS NULL');
    expect(normalizedSql).toContain('t."endsAt" IS NULL');
    expect(normalizedSql).toContain('ORDER BY m."_id" ASC LIMIT $2');
    expect(mockedDataSource.query.mock.calls[0]![1]).toEqual([null, "100"]);
  });

  test("advances the keyset cursor after a full batch", async () => {
    const fullBatch: Array<{
      disableActiveMonitoring: boolean;
      monitorId: string;
      stateUpdatedAt: string;
    }> = Array.from({ length: 100 }, (_value: unknown, index: number) => {
      return {
        disableActiveMonitoring: false,
        monitorId: generatedMonitorId(index + 1),
        stateUpdatedAt: "2026-07-31T10:00:00.000Z",
      };
    });
    const finalRow: {
      disableActiveMonitoring: boolean;
      monitorId: string;
      stateUpdatedAt: string;
    } = {
      disableActiveMonitoring: true,
      monitorId: generatedMonitorId(101),
      stateUpdatedAt: "2026-07-31T10:01:00.000Z",
    };

    mockedDataSource.query
      .mockResolvedValueOnce(fullBatch as never)
      .mockResolvedValueOnce([finalRow] as never);

    const result: ActiveMonitoringTimelineRepairResult =
      await MonitorActiveMonitoringTimelineReconciler.repairMismatches();

    expect(mockedDataSource.query).toHaveBeenCalledTimes(2);
    expect(mockedDataSource.query.mock.calls[0]![1]).toEqual([null, "100"]);
    expect(mockedDataSource.query.mock.calls[1]![1]).toEqual([
      generatedMonitorId(100),
      "100",
    ]);
    expect(result.monitorsExamined).toBe(101);
    expect(
      mockedMonitorStatusTimelineService.reconcileActiveMonitoring,
    ).toHaveBeenCalledTimes(101);
  });

  test("bounds recurring repair work to the configured number of batches", async () => {
    const fullBatch: Array<{
      disableActiveMonitoring: boolean;
      monitorId: string;
      stateUpdatedAt: string;
    }> = Array.from({ length: 100 }, (_value: unknown, index: number) => {
      return {
        disableActiveMonitoring: false,
        monitorId: generatedMonitorId(index + 1),
        stateUpdatedAt: "2026-07-31T10:00:00.000Z",
      };
    });
    mockedDataSource.query.mockResolvedValue(fullBatch as never);

    const result: ActiveMonitoringTimelineRepairResult =
      await MonitorActiveMonitoringTimelineReconciler.repairMismatches({
        maximumBatches: 1,
      });

    expect(mockedDataSource.query).toHaveBeenCalledTimes(1);
    expect(result.monitorsExamined).toBe(100);
    expect(
      mockedMonitorStatusTimelineService.reconcileActiveMonitoring,
    ).toHaveBeenCalledTimes(100);
  });

  test("terminates immediately after a short batch", async () => {
    mockedDataSource.query.mockResolvedValueOnce([
      mismatchRow(FIRST_MONITOR_ID, "2026-07-31T10:00:00.000Z"),
      mismatchRow(SECOND_MONITOR_ID, "2026-07-31T10:01:00.000Z"),
    ] as never);

    const result: ActiveMonitoringTimelineRepairResult =
      await MonitorActiveMonitoringTimelineReconciler.repairMismatches();

    expect(mockedDataSource.query).toHaveBeenCalledTimes(1);
    expect(result.monitorsExamined).toBe(2);
  });

  test("counts pause and resume repairs independently", async () => {
    mockedDataSource.query.mockResolvedValueOnce([
      mismatchRow(FIRST_MONITOR_ID, "2026-07-31T10:00:00.000Z"),
      mismatchRow(SECOND_MONITOR_ID, "2026-07-31T10:01:00.000Z"),
      mismatchRow(THIRD_MONITOR_ID, "2026-07-31T10:02:00.000Z"),
    ] as never);
    mockedMonitorStatusTimelineService.reconcileActiveMonitoring
      .mockResolvedValueOnce({ didPause: true, didResume: false } as never)
      .mockResolvedValueOnce({ didPause: false, didResume: true } as never)
      .mockResolvedValueOnce({ didPause: true, didResume: true } as never);

    const result: ActiveMonitoringTimelineRepairResult =
      await MonitorActiveMonitoringTimelineReconciler.repairMismatches();

    expect(result).toMatchObject({
      monitorsExamined: 3,
      paused: 2,
      resumed: 2,
    });
  });

  test("passes each persisted state snapshot so a later opposite write can be reconstructed", async () => {
    const persistedDate: Date = new Date("2026-07-31T10:15:30.000Z");
    const serializedPersistedDate: string = "2026-07-31T11:16:31.000Z";
    mockedDataSource.query.mockResolvedValueOnce([
      mismatchRow(FIRST_MONITOR_ID, persistedDate, true),
      mismatchRow(SECOND_MONITOR_ID, serializedPersistedDate, false),
    ] as never);

    await MonitorActiveMonitoringTimelineReconciler.repairMismatches();

    expect(
      mockedMonitorStatusTimelineService.reconcileActiveMonitoring,
    ).toHaveBeenNthCalledWith(1, {
      monitorId: new ObjectID(FIRST_MONITOR_ID),
      expectedDisableActiveMonitoring: true,
      reconciledAt: persistedDate,
    });
    expect(
      mockedMonitorStatusTimelineService.reconcileActiveMonitoring,
    ).toHaveBeenNthCalledWith(2, {
      monitorId: new ObjectID(SECOND_MONITOR_ID),
      expectedDisableActiveMonitoring: false,
      reconciledAt: new Date(serializedPersistedDate),
    });

    const firstArgs: { reconciledAt: Date } = mockedMonitorStatusTimelineService
      .reconcileActiveMonitoring.mock.calls[0]![0] as { reconciledAt: Date };
    expect(firstArgs.reconciledAt).toBe(persistedDate);
  });

  test("isolates per-monitor failures, continues the batch, and collects failed IDs", async () => {
    const firstFailure: Error = new Error("first reconciliation failed");
    const thirdFailure: Error = new Error("third reconciliation failed");
    mockedDataSource.query.mockResolvedValueOnce([
      mismatchRow(FIRST_MONITOR_ID, "2026-07-31T10:00:00.000Z"),
      mismatchRow(SECOND_MONITOR_ID, "2026-07-31T10:01:00.000Z"),
      mismatchRow(THIRD_MONITOR_ID, "2026-07-31T10:02:00.000Z"),
    ] as never);
    mockedMonitorStatusTimelineService.reconcileActiveMonitoring
      .mockRejectedValueOnce(firstFailure as never)
      .mockResolvedValueOnce({ didPause: true, didResume: false } as never)
      .mockRejectedValueOnce(thirdFailure as never);

    const result: ActiveMonitoringTimelineRepairResult =
      await MonitorActiveMonitoringTimelineReconciler.repairMismatches();

    expect(
      mockedMonitorStatusTimelineService.reconcileActiveMonitoring,
    ).toHaveBeenCalledTimes(3);
    expect(result.monitorsExamined).toBe(3);
    expect(result.paused).toBe(1);
    expect(result.resumed).toBe(0);
    expect(
      result.failedMonitorIds.map((monitorId: ObjectID) => {
        return monitorId.toString();
      }),
    ).toEqual([FIRST_MONITOR_ID, THIRD_MONITOR_ID]);
    expect(mockedLogger.error).toHaveBeenCalledWith(
      `MonitorActiveMonitoringTimelineReconciler: failed to reconcile monitor ${FIRST_MONITOR_ID}.`,
    );
    expect(mockedLogger.error).toHaveBeenCalledWith(firstFailure);
    expect(mockedLogger.error).toHaveBeenCalledWith(
      `MonitorActiveMonitoringTimelineReconciler: failed to reconcile monitor ${THIRD_MONITOR_ID}.`,
    );
    expect(mockedLogger.error).toHaveBeenCalledWith(thirdFailure);
  });
});
