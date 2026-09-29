import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorService from "../../../../Server/Services/MonitorService";
import MonitorRuleCriteriaCache from "../../../../Server/Utils/Rules/MonitorRuleCriteriaCache";
import ObjectID from "../../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

jest.mock("../../../../Server/Services/MonitorService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
    },
  };
});

const MONITOR_A_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const MONITOR_B_ID: ObjectID = new ObjectID(
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
);

describe("MonitorRuleCriteriaCache", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("coalesces concurrent and sequential reads for one monitor", async () => {
    const monitor: Monitor = { id: MONITOR_A_ID } as Monitor;
    const findOneById: SpyInstance<typeof MonitorService.findOneById> = jest
      .spyOn(MonitorService, "findOneById")
      .mockResolvedValue(monitor);
    const cache: MonitorRuleCriteriaCache = new MonitorRuleCriteriaCache();

    const [first, second, third]: Array<Monitor | null> = await Promise.all([
      cache.getMonitor(MONITOR_A_ID),
      cache.getMonitor(new ObjectID(MONITOR_A_ID.toString())),
      cache.getMonitor(MONITOR_A_ID),
    ]);

    expect(first).toBe(monitor);
    expect(second).toBe(monitor);
    expect(third).toBe(monitor);
    expect(findOneById).toHaveBeenCalledTimes(1);
  });

  it("caches misses, keeps IDs separate, and scopes entries to one evaluation", async () => {
    const monitorB: Monitor = { id: MONITOR_B_ID } as Monitor;
    const findOneById: SpyInstance<typeof MonitorService.findOneById> = jest
      .spyOn(MonitorService, "findOneById")
      .mockImplementation(
        async (
          data: Parameters<typeof MonitorService.findOneById>[0],
        ): Promise<Monitor | null> => {
          return data.id.toString() === MONITOR_A_ID.toString()
            ? null
            : monitorB;
        },
      );
    const firstEvaluation: MonitorRuleCriteriaCache =
      new MonitorRuleCriteriaCache();

    await expect(firstEvaluation.getMonitor(MONITOR_A_ID)).resolves.toBeNull();
    await expect(firstEvaluation.getMonitor(MONITOR_A_ID)).resolves.toBeNull();
    await expect(firstEvaluation.getMonitor(MONITOR_B_ID)).resolves.toBe(
      monitorB,
    );
    expect(findOneById).toHaveBeenCalledTimes(2);

    const secondEvaluation: MonitorRuleCriteriaCache =
      new MonitorRuleCriteriaCache();
    await expect(secondEvaluation.getMonitor(MONITOR_A_ID)).resolves.toBeNull();
    expect(findOneById).toHaveBeenCalledTimes(3);
  });

  it("retains a rejected read so repeated filters cannot create a retry storm", async () => {
    const readError: Error = new Error("monitor read failed");
    const findOneById: SpyInstance<typeof MonitorService.findOneById> = jest
      .spyOn(MonitorService, "findOneById")
      .mockRejectedValue(readError);
    const cache: MonitorRuleCriteriaCache = new MonitorRuleCriteriaCache();

    await expect(cache.getMonitor(MONITOR_A_ID)).rejects.toBe(readError);
    await expect(cache.getMonitor(MONITOR_A_ID)).rejects.toBe(readError);
    expect(findOneById).toHaveBeenCalledTimes(1);
  });
});
