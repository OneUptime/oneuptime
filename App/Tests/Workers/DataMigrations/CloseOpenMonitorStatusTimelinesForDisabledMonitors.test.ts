import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import logger from "Common/Server/Utils/Logger";
import MonitorActiveMonitoringTimelineReconciler, {
  ActiveMonitoringTimelineRepairResult,
} from "Common/Server/Utils/Monitor/MonitorActiveMonitoringTimelineReconciler";
import ObjectID from "Common/Types/ObjectID";
import CloseOpenMonitorStatusTimelinesForDisabledMonitors from "../../../FeatureSet/Workers/DataMigrations/CloseOpenMonitorStatusTimelinesForDisabledMonitors";

jest.mock(
  "Common/Server/Utils/Monitor/MonitorActiveMonitoringTimelineReconciler",
  () => {
    return {
      __esModule: true,
      default: {
        repairMismatches: jest.fn(),
      },
    };
  },
);

jest.mock("Common/Server/Utils/Logger", () => {
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

const mockedReconciler: { repairMismatches: jest.Mock } =
  MonitorActiveMonitoringTimelineReconciler as unknown as {
    repairMismatches: jest.Mock;
  };
const mockedLogger: { debug: jest.Mock } = logger as unknown as {
  debug: jest.Mock;
};

function repairResult(
  overrides: Partial<ActiveMonitoringTimelineRepairResult> = {},
): ActiveMonitoringTimelineRepairResult {
  return {
    failedMonitorIds: [],
    monitorsExamined: 0,
    paused: 0,
    resumed: 0,
    ...overrides,
  };
}

describe("CloseOpenMonitorStatusTimelinesForDisabledMonitors", () => {
  const migration: CloseOpenMonitorStatusTimelinesForDisabledMonitors =
    new CloseOpenMonitorStatusTimelinesForDisabledMonitors();

  beforeEach(() => {
    jest.clearAllMocks();
    mockedReconciler.repairMismatches.mockResolvedValue(
      repairResult() as never,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("delegates repair to the shared reconciler and logs successful counts", async () => {
    mockedReconciler.repairMismatches.mockResolvedValue(
      repairResult({
        monitorsExamined: 7,
        paused: 4,
        resumed: 3,
      }) as never,
    );

    await expect(migration.migrate()).resolves.toBeUndefined();

    expect(mockedReconciler.repairMismatches).toHaveBeenCalledTimes(1);
    expect(mockedReconciler.repairMismatches).toHaveBeenCalledWith();
    expect(mockedLogger.debug).toHaveBeenCalledTimes(1);
    expect(mockedLogger.debug).toHaveBeenCalledWith(
      "CloseOpenMonitorStatusTimelinesForDisabledMonitors: examined 7 mismatched monitor(s), paused 4, resumed 3.",
    );
  });

  test("treats a no-op repair as a successful migration", async () => {
    await expect(migration.migrate()).resolves.toBeUndefined();

    expect(mockedReconciler.repairMismatches).toHaveBeenCalledTimes(1);
    expect(mockedLogger.debug).toHaveBeenCalledWith(
      "CloseOpenMonitorStatusTimelinesForDisabledMonitors: examined 0 mismatched monitor(s), paused 0, resumed 0.",
    );
  });

  test("throws with every failed monitor ID so the migration remains retryable", async () => {
    const firstMonitorId: ObjectID = new ObjectID(
      "11111111-1111-4111-8111-111111111111",
    );
    const secondMonitorId: ObjectID = new ObjectID(
      "22222222-2222-4222-8222-222222222222",
    );
    mockedReconciler.repairMismatches.mockResolvedValueOnce(
      repairResult({
        failedMonitorIds: [firstMonitorId, secondMonitorId],
        monitorsExamined: 5,
        paused: 2,
        resumed: 1,
      }) as never,
    );

    await expect(migration.migrate()).rejects.toThrow(
      `Failed to reconcile active-monitoring timelines for 2 monitor(s): ${firstMonitorId.toString()}, ${secondMonitorId.toString()}. Not marking this migration executed so it can be retried safely.`,
    );

    expect(mockedLogger.debug).toHaveBeenCalledWith(
      "CloseOpenMonitorStatusTimelinesForDisabledMonitors: examined 5 mismatched monitor(s), paused 2, resumed 1.",
    );
  });

  test("can be retried safely after a repair result reports failures", async () => {
    const failedMonitorId: ObjectID = new ObjectID(
      "33333333-3333-4333-8333-333333333333",
    );
    mockedReconciler.repairMismatches
      .mockResolvedValueOnce(
        repairResult({ failedMonitorIds: [failedMonitorId] }) as never,
      )
      .mockResolvedValueOnce(
        repairResult({ monitorsExamined: 1, paused: 1 }) as never,
      );

    await expect(migration.migrate()).rejects.toThrow(
      "Not marking this migration executed so it can be retried safely.",
    );
    await expect(migration.migrate()).resolves.toBeUndefined();

    expect(mockedReconciler.repairMismatches).toHaveBeenCalledTimes(2);
    expect(mockedLogger.debug).toHaveBeenNthCalledWith(
      2,
      "CloseOpenMonitorStatusTimelinesForDisabledMonitors: examined 1 mismatched monitor(s), paused 1, resumed 0.",
    );
  });

  test("propagates a shared reconciler failure without logging completion", async () => {
    const databaseFailure: Error = new Error("database unavailable");
    mockedReconciler.repairMismatches.mockRejectedValue(
      databaseFailure as never,
    );

    await expect(migration.migrate()).rejects.toBe(databaseFailure);

    expect(mockedLogger.debug).not.toHaveBeenCalled();
  });

  test("rollback is intentionally a no-op", async () => {
    await expect(migration.rollback()).resolves.toBeUndefined();

    expect(mockedReconciler.repairMismatches).not.toHaveBeenCalled();
    expect(mockedLogger.debug).not.toHaveBeenCalled();
  });
});
