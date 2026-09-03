import fs from "fs";
import path from "path";
import { afterAll, beforeEach, describe, expect, test } from "@jest/globals";
import { EVERY_HOUR } from "Common/Utils/CronTime";

/*
 * The hosted reconciliation pass turns the seven-day instance freshness rule
 * into the license-wide count shown by the admin dashboard. Reports update the
 * count immediately, but time passing does not write anything; without this
 * job an abandoned instance therefore consumes seats forever.
 *
 * The suite captures the side-effect-only cron registration and drives its
 * handler directly. It pins the billing gate, deliberately narrow reads,
 * freshness boundary, cross-instance deduplication, legacy fallback, no-op
 * behavior, atomic compare-and-set guard, and per-license failure isolation.
 */

type CronHandler = () => Promise<void>;

interface CronOptions {
  schedule: string;
  runOnStartup: boolean;
}

interface CapturedJob {
  options: CronOptions;
  handler: CronHandler;
}

interface EnterpriseLicenseServiceMock {
  findBy: jest.Mock;
  findOneById: jest.Mock;
  runWithUsageAggregationLock: jest.Mock;
  updateColumnsByIdWithoutHooks: jest.Mock;
}

interface EnterpriseLicenseInstanceServiceMock {
  findBy: jest.Mock;
}

const mockCapturedJobs: Record<string, CapturedJob> = {};
const mockEnterpriseLicenseService: EnterpriseLicenseServiceMock = {
  findBy: jest.fn(),
  findOneById: jest.fn(),
  runWithUsageAggregationLock: jest.fn(),
  updateColumnsByIdWithoutHooks: jest.fn(),
};
const mockEnterpriseLicenseInstanceService: EnterpriseLicenseInstanceServiceMock =
  {
    findBy: jest.fn(),
  };

let mockBillingEnabled: boolean = true;

jest.mock("../../../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(
      (
        jobName: string,
        options: CronOptions,
        runFunction: CronHandler,
      ): void => {
        mockCapturedJobs[jobName] = {
          options: options,
          handler: runFunction,
        };
      },
    ),
  };
});

jest.mock("Common/Server/Services/EnterpriseLicenseService", () => {
  return {
    __esModule: true,
    default: mockEnterpriseLicenseService,
  };
});

jest.mock("Common/Server/Services/EnterpriseLicenseInstanceService", () => {
  return {
    __esModule: true,
    default: mockEnterpriseLicenseInstanceService,
  };
});

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

/* Two rows make pagination behavior exhaustive without 10,000-row fixtures. */
jest.mock("Common/Types/Database/LimitMax", () => {
  return {
    __esModule: true,
    default: 2,
  };
});

jest.mock("Common/Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/EnvironmentConfig",
  ) as Record<string, unknown>;

  const mocked: Record<string, unknown> = {
    ...actual,
    __esModule: true,
    IsDevelopment: false,
  };

  Object.defineProperty(mocked, "IsBillingEnabled", {
    get: (): boolean => {
      return mockBillingEnabled;
    },
  });

  return mocked;
});

// Imported for its RunCron registration side effect, after all mocks above.
import "../../../../FeatureSet/Workers/Jobs/EnterpriseLicense/ReconcileInstanceUsage";
import EnterpriseLicense from "Common/Models/DatabaseModels/EnterpriseLicense";
import EnterpriseLicenseInstance from "Common/Models/DatabaseModels/EnterpriseLicenseInstance";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import EnterpriseLicenseUserCountSource from "Common/Types/EnterpriseLicense/EnterpriseLicenseUserCountSource";
import logger from "Common/Server/Utils/Logger";

const JOB_NAME: string = "EnterpriseLicense:ReconcileInstanceUsage";
const NOW: Date = new Date("2026-09-02T12:00:00.000Z");

const mockCurrentDate: jest.SpiedFunction<typeof OneUptimeDate.getCurrentDate> =
  jest.spyOn(OneUptimeDate, "getCurrentDate");

interface FindByArgs {
  query: Record<string, unknown>;
  select: Record<string, boolean>;
  sort: Record<string, SortOrder>;
  skip: number;
  limit: number;
  props: Record<string, unknown>;
}

interface CompareAndSetArgs {
  id: ObjectID;
  data: Record<string, unknown>;
  expectedData: Record<string, unknown>;
}

interface MakeLicenseData {
  currentUserCount?: number | undefined;
  userCountUpdatedAt?: Date | undefined;
  userCountSource?: EnterpriseLicenseUserCountSource | undefined;
  legacyUserCount?: number | undefined;
  legacyUserCountUpdatedAt?: Date | undefined;
}

type MakeLicenseFunction = (data?: MakeLicenseData) => EnterpriseLicense;

const licensesById: Map<string, EnterpriseLicense> = new Map<
  string,
  EnterpriseLicense
>();

const makeLicense: MakeLicenseFunction = (
  data?: MakeLicenseData,
): EnterpriseLicense => {
  const license: EnterpriseLicense = new EnterpriseLicense(ObjectID.generate());

  if (data?.currentUserCount !== undefined) {
    license.currentUserCount = data.currentUserCount;
  }

  if (data?.userCountUpdatedAt !== undefined) {
    license.userCountUpdatedAt = data.userCountUpdatedAt;
  }

  if (data?.userCountSource !== undefined) {
    license.userCountSource = data.userCountSource;
  }

  if (data?.legacyUserCount !== undefined) {
    license.legacyUserCount = data.legacyUserCount;
  }

  if (data?.legacyUserCountUpdatedAt !== undefined) {
    license.legacyUserCountUpdatedAt = data.legacyUserCountUpdatedAt;
  }

  licensesById.set(license.id!.toString(), license);

  return license;
};

interface MakeInstanceData {
  createdAt?: Date | undefined;
  daysSinceReport?: number | undefined;
  lastReportedAt?: Date | undefined;
  userCount?: number | undefined;
  userEmailHashes?: Array<string> | undefined;
}

type MakeInstanceFunction = (
  data: MakeInstanceData,
) => EnterpriseLicenseInstance;

const makeInstance: MakeInstanceFunction = (
  data: MakeInstanceData,
): EnterpriseLicenseInstance => {
  const instance: EnterpriseLicenseInstance = new EnterpriseLicenseInstance();

  if (data.createdAt !== undefined) {
    instance.createdAt = data.createdAt;
  }

  if (data.lastReportedAt !== undefined) {
    instance.lastReportedAt = data.lastReportedAt;
  } else if (data.daysSinceReport !== undefined) {
    instance.lastReportedAt = OneUptimeDate.addRemoveDays(
      NOW,
      -data.daysSinceReport,
    );
  }

  if (data.userCount !== undefined) {
    instance.userCount = data.userCount;
  }

  if (data.userEmailHashes !== undefined) {
    instance.userEmailHashes = data.userEmailHashes;
  }

  return instance;
};

const runTick: CronHandler = async (): Promise<void> => {
  const captured: CapturedJob | undefined = mockCapturedJobs[JOB_NAME];

  if (!captured) {
    throw new Error(
      "EnterpriseLicense:ReconcileInstanceUsage did not register a cron handler.",
    );
  }

  await captured.handler();
};

const firstLicenseRead: () => FindByArgs = (): FindByArgs => {
  return mockEnterpriseLicenseService.findBy.mock.calls[0]![0] as FindByArgs;
};

const firstInstanceRead: () => FindByArgs = (): FindByArgs => {
  return mockEnterpriseLicenseInstanceService.findBy.mock
    .calls[0]![0] as FindByArgs;
};

const compareAndSetCalls: () => Array<CompareAndSetArgs> =
  (): Array<CompareAndSetArgs> => {
    return mockEnterpriseLicenseService.updateColumnsByIdWithoutHooks.mock.calls.map(
      (call: Array<unknown>): CompareAndSetArgs => {
        return call[0] as CompareAndSetArgs;
      },
    );
  };

describe("EnterpriseLicense:ReconcileInstanceUsage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    licensesById.clear();

    mockBillingEnabled = true;
    mockCurrentDate.mockReturnValue(NOW);
    mockEnterpriseLicenseService.findBy.mockResolvedValue([]);
    mockEnterpriseLicenseService.findOneById.mockImplementation(
      async (args: { id: ObjectID }): Promise<EnterpriseLicense | null> => {
        return licensesById.get(args.id.toString()) || null;
      },
    );
    mockEnterpriseLicenseService.runWithUsageAggregationLock.mockImplementation(
      async (data: { fn: () => Promise<void> }): Promise<void> => {
        await data.fn();
      },
    );
    mockEnterpriseLicenseService.updateColumnsByIdWithoutHooks.mockResolvedValue(
      undefined,
    );
    mockEnterpriseLicenseInstanceService.findBy.mockResolvedValue([]);
  });

  afterAll(() => {
    mockCurrentDate.mockRestore();
  });

  describe("registration", () => {
    test("is wired into the worker entry point", () => {
      const workersIndex: string = fs.readFileSync(
        path.join(
          __dirname,
          "..",
          "..",
          "..",
          "..",
          "FeatureSet",
          "Workers",
          "Index.ts",
        ),
        "utf8",
      );

      expect(workersIndex).toContain(
        'import "./Jobs/EnterpriseLicense/ReconcileInstanceUsage"',
      );
    });

    test("runs hourly in production and immediately after startup", () => {
      expect(mockCapturedJobs[JOB_NAME]).toEqual({
        options: {
          schedule: EVERY_HOUR,
          runOnStartup: true,
        },
        handler: expect.any(Function),
      });
    });

    test("uses the five-minute development schedule", () => {
      const jobSource: string = fs.readFileSync(
        path.join(
          __dirname,
          "..",
          "..",
          "..",
          "..",
          "FeatureSet",
          "Workers",
          "Jobs",
          "EnterpriseLicense",
          "ReconcileInstanceUsage.ts",
        ),
        "utf8",
      );

      expect(jobSource).toContain(
        "schedule: IsDevelopment ? EVERY_FIVE_MINUTE : EVERY_HOUR",
      );
    });
  });

  test("does nothing outside hosted billing deployments", async () => {
    mockBillingEnabled = false;

    await runTick();

    expect(mockEnterpriseLicenseService.findBy).not.toHaveBeenCalled();
    expect(mockEnterpriseLicenseInstanceService.findBy).not.toHaveBeenCalled();
    expect(
      mockEnterpriseLicenseService.updateColumnsByIdWithoutHooks,
    ).not.toHaveBeenCalled();
    expect(mockCurrentDate).not.toHaveBeenCalled();
  });

  test("reads only the license columns needed to reconcile safely", async () => {
    await runTick();

    expect(firstLicenseRead()).toEqual({
      query: {},
      select: {
        _id: true,
        currentUserCount: true,
        userCountUpdatedAt: true,
        userCountSource: true,
        legacyUserCount: true,
        legacyUserCountUpdatedAt: true,
      },
      sort: {
        createdAt: SortOrder.Ascending,
        _id: SortOrder.Ascending,
      },
      skip: 0,
      limit: LIMIT_MAX,
      props: {
        isRoot: true,
      },
    });
  });

  test("reads usage and lastReportedAt for each license without an activity column", async () => {
    const license: EnterpriseLicense = makeLicense({ currentUserCount: 3 });
    mockEnterpriseLicenseService.findBy.mockResolvedValue([license]);

    await runTick();

    expect(firstInstanceRead()).toEqual({
      query: {
        enterpriseLicenseId: license.id,
      },
      select: {
        createdAt: true,
        userCount: true,
        userEmailHashes: true,
        lastReportedAt: true,
      },
      sort: {
        createdAt: SortOrder.Ascending,
      },
      skip: 0,
      limit: LIMIT_MAX,
      props: {
        isRoot: true,
      },
    });
    expect(firstInstanceRead().select).not.toHaveProperty("isActive");
  });

  test("takes the shared lock before re-reading a registration created during the sweep", async () => {
    const license: EnterpriseLicense = makeLicense({
      currentUserCount: 23,
      userCountUpdatedAt: OneUptimeDate.addRemoveDays(NOW, -8),
    });
    const freshRegistration: EnterpriseLicenseInstance = makeInstance({
      createdAt: OneUptimeDate.addRemoveDays(NOW, -1),
    });
    let instanceRows: Array<EnterpriseLicenseInstance> = [];
    let isInsideUsageLock: boolean = false;

    mockEnterpriseLicenseService.findBy.mockResolvedValue([license]);
    mockEnterpriseLicenseService.runWithUsageAggregationLock.mockImplementation(
      async (data: { fn: () => Promise<void> }): Promise<void> => {
        /* Simulate /validate completing while this license waited for its lock. */
        instanceRows = [freshRegistration];
        isInsideUsageLock = true;

        try {
          await data.fn();
        } finally {
          isInsideUsageLock = false;
        }
      },
    );
    mockEnterpriseLicenseService.findOneById.mockImplementation(
      async (): Promise<EnterpriseLicense> => {
        expect(isInsideUsageLock).toBe(true);
        return license;
      },
    );
    mockEnterpriseLicenseInstanceService.findBy.mockImplementation(
      async (): Promise<Array<EnterpriseLicenseInstance>> => {
        expect(isInsideUsageLock).toBe(true);
        return instanceRows;
      },
    );

    await runTick();

    expect(
      mockEnterpriseLicenseService.runWithUsageAggregationLock,
    ).toHaveBeenCalledWith({
      licenseId: license.id,
      fn: expect.any(Function),
    });
    expect(
      mockEnterpriseLicenseService.updateColumnsByIdWithoutHooks,
    ).not.toHaveBeenCalled();
  });

  test("uses lock acquisition time so a delayed sweep cannot restore expired usage", async () => {
    const beforeBoundary: Date = new Date("2026-09-02T11:59:59.000Z");
    const afterBoundary: Date = new Date("2026-09-02T12:00:01.000Z");
    let currentTime: Date = beforeBoundary;
    const license: EnterpriseLicense = makeLicense({
      currentUserCount: 10,
      userCountSource: EnterpriseLicenseUserCountSource.Instance,
    });
    const instance: EnterpriseLicenseInstance = makeInstance({
      lastReportedAt: new Date("2026-08-26T12:00:00.000Z"),
      userCount: 10,
    });
    let lockCallCount: number = 0;
    let delayedCallback: (() => Promise<void>) | undefined;
    let finishDelayedLock: () => void = (): void => {};
    let markDelayedLockQueued: () => void = (): void => {};
    const delayedLockQueued: Promise<void> = new Promise<void>(
      (resolve: () => void) => {
        markDelayedLockQueued = resolve;
      },
    );

    mockCurrentDate.mockImplementation((): Date => {
      return currentTime;
    });
    mockEnterpriseLicenseService.findBy.mockResolvedValue([license]);
    mockEnterpriseLicenseInstanceService.findBy.mockResolvedValue([instance]);
    mockEnterpriseLicenseService.runWithUsageAggregationLock.mockImplementation(
      (data: { fn: () => Promise<void> }): Promise<void> => {
        lockCallCount += 1;

        if (lockCallCount === 1) {
          delayedCallback = data.fn;
          markDelayedLockQueued();

          return new Promise<void>((resolve: () => void) => {
            finishDelayedLock = resolve;
          });
        }

        return (async (): Promise<void> => {
          /* The newer sweep gets the lock first. */
          await data.fn();
          await delayedCallback!();
          finishDelayedLock();
        })();
      },
    );
    mockEnterpriseLicenseService.updateColumnsByIdWithoutHooks.mockImplementation(
      async (args: CompareAndSetArgs): Promise<void> => {
        license.currentUserCount = args.data["currentUserCount"] as number;
      },
    );

    const delayedSweep: Promise<void> = runTick();
    await delayedLockQueued;

    currentTime = afterBoundary;
    const newerSweep: Promise<void> = runTick();

    await Promise.all([delayedSweep, newerSweep]);

    expect(license.currentUserCount).toBe(0);
    expect(compareAndSetCalls()).toHaveLength(1);
  });

  test("continues through every license page", async () => {
    const licenses: Array<EnterpriseLicense> = [
      makeLicense({ currentUserCount: 0 }),
      makeLicense({ currentUserCount: 0 }),
      makeLicense({ currentUserCount: 0 }),
      makeLicense({ currentUserCount: 0 }),
      makeLicense({ currentUserCount: 0 }),
    ];

    mockEnterpriseLicenseService.findBy
      .mockResolvedValueOnce(licenses.slice(0, 2))
      .mockResolvedValueOnce(licenses.slice(2, 4))
      .mockResolvedValueOnce(licenses.slice(4));

    await runTick();

    expect(
      mockEnterpriseLicenseService.findBy.mock.calls.map(
        (call: Array<unknown>): number => {
          return (call[0] as FindByArgs).skip;
        },
      ),
    ).toEqual([0, 2, 4]);
    expect(mockEnterpriseLicenseInstanceService.findBy).toHaveBeenCalledTimes(
      5,
    );
  });

  test("fetches an empty trailing page after an exact multiple", async () => {
    const licenses: Array<EnterpriseLicense> = [
      makeLicense({ currentUserCount: 0 }),
      makeLicense({ currentUserCount: 0 }),
      makeLicense({ currentUserCount: 0 }),
      makeLicense({ currentUserCount: 0 }),
    ];

    mockEnterpriseLicenseService.findBy
      .mockResolvedValueOnce(licenses.slice(0, 2))
      .mockResolvedValueOnce(licenses.slice(2))
      .mockResolvedValueOnce([]);

    await runTick();

    expect(
      mockEnterpriseLicenseService.findBy.mock.calls.map(
        (call: Array<unknown>): number => {
          return (call[0] as FindByArgs).skip;
        },
      ),
    ).toEqual([0, 2, 4]);
  });

  test("reconciles a license containing only stale instances down to zero", async () => {
    const updatedAt: Date = new Date("2026-08-20T10:00:00.000Z");
    const license: EnterpriseLicense = makeLicense({
      currentUserCount: 8,
      userCountUpdatedAt: updatedAt,
    });
    mockEnterpriseLicenseService.findBy.mockResolvedValue([license]);
    mockEnterpriseLicenseInstanceService.findBy.mockResolvedValue([
      makeInstance({ daysSinceReport: 8, userCount: 5 }),
      makeInstance({ daysSinceReport: 7, userEmailHashes: ["a", "b", "c"] }),
      makeInstance({ userCount: 12 }),
    ]);

    await runTick();

    expect(compareAndSetCalls()).toEqual([
      {
        id: license.id,
        data: {
          currentUserCount: 0,
        },
        expectedData: {
          currentUserCount: 8,
          userCountUpdatedAt: updatedAt,
          userCountSource: null,
          legacyUserCount: null,
          legacyUserCountUpdatedAt: null,
        },
      },
    ]);
  });

  test("preserves a fresh legacy count after every modern instance becomes inactive", async () => {
    const license: EnterpriseLicense = makeLicense({
      currentUserCount: 8,
      userCountUpdatedAt: OneUptimeDate.addRemoveDays(NOW, -7),
      userCountSource: EnterpriseLicenseUserCountSource.Instance,
      legacyUserCount: 8,
      legacyUserCountUpdatedAt: OneUptimeDate.addRemoveDays(NOW, -1),
    });
    mockEnterpriseLicenseService.findBy.mockResolvedValue([license]);
    mockEnterpriseLicenseInstanceService.findBy.mockResolvedValue([
      makeInstance({ daysSinceReport: 7, userCount: 50 }),
    ]);

    await runTick();

    expect(
      mockEnterpriseLicenseService.updateColumnsByIdWithoutHooks,
    ).not.toHaveBeenCalled();
  });

  test("does not preserve an inactive modern aggregate because a newer instance is still registering", async () => {
    const inactiveAt: Date = OneUptimeDate.addRemoveDays(NOW, -7);
    const license: EnterpriseLicense = makeLicense({
      currentUserCount: 50,
      userCountUpdatedAt: inactiveAt,
      userCountSource: EnterpriseLicenseUserCountSource.Instance,
    });
    mockEnterpriseLicenseService.findBy.mockResolvedValue([license]);
    mockEnterpriseLicenseInstanceService.findBy.mockResolvedValue([
      makeInstance({ lastReportedAt: inactiveAt, userCount: 50 }),
      makeInstance({
        createdAt: OneUptimeDate.addRemoveDays(NOW, -1),
        userCount: undefined,
      }),
    ]);

    await runTick();

    expect(compareAndSetCalls()[0]!.data).toEqual({ currentUserCount: 0 });
  });

  test("deduplicates active hashed users, counts legacy users, and ignores stale users", async () => {
    const license: EnterpriseLicense = makeLicense({ currentUserCount: 99 });
    mockEnterpriseLicenseService.findBy.mockResolvedValue([license]);
    mockEnterpriseLicenseInstanceService.findBy.mockResolvedValue([
      makeInstance({
        daysSinceReport: 1,
        userCount: 3,
        userEmailHashes: ["alice", "bob", "carol"],
      }),
      makeInstance({
        daysSinceReport: 2,
        userCount: 4,
        userEmailHashes: ["bob", "dana"],
      }),
      makeInstance({ daysSinceReport: 3, userCount: 5 }),
      makeInstance({
        daysSinceReport: 8,
        userCount: 50,
        userEmailHashes: ["stale-user"],
      }),
    ]);

    await runTick();

    /*
     * Four unique hashes + two overflow users from the second instance +
     * five unhashable legacy users. The stale instance contributes nothing.
     */
    expect(compareAndSetCalls()[0]!.data).toEqual({
      currentUserCount: 11,
    });
  });

  test("preserves a recently reported legacy license-wide count when there are no instance rows", async () => {
    const license: EnterpriseLicense = makeLicense({
      currentUserCount: 23,
      userCountUpdatedAt: OneUptimeDate.addRemoveDays(NOW, -1),
    });
    mockEnterpriseLicenseService.findBy.mockResolvedValue([license]);
    mockEnterpriseLicenseInstanceService.findBy.mockResolvedValue([]);

    await runTick();

    expect(
      mockEnterpriseLicenseService.updateColumnsByIdWithoutHooks,
    ).not.toHaveBeenCalled();
  });

  test("preserves a legacy count when an instance has registered but not reported usage", async () => {
    const license: EnterpriseLicense = makeLicense({
      currentUserCount: 23,
      userCountUpdatedAt: OneUptimeDate.addRemoveDays(NOW, -8),
    });
    mockEnterpriseLicenseService.findBy.mockResolvedValue([license]);
    mockEnterpriseLicenseInstanceService.findBy.mockResolvedValue([
      makeInstance({
        createdAt: OneUptimeDate.addRemoveDays(NOW, -1),
        userCount: undefined,
        userEmailHashes: undefined,
      }),
    ]);

    await runTick();

    expect(
      mockEnterpriseLicenseService.updateColumnsByIdWithoutHooks,
    ).not.toHaveBeenCalled();
  });

  test("drops a legacy count when its report and registration reach the exact one-week boundary", async () => {
    const inactiveAt: Date = OneUptimeDate.addRemoveDays(NOW, -7);
    const license: EnterpriseLicense = makeLicense({
      currentUserCount: 23,
      userCountUpdatedAt: inactiveAt,
    });
    mockEnterpriseLicenseService.findBy.mockResolvedValue([license]);
    mockEnterpriseLicenseInstanceService.findBy.mockResolvedValue([
      makeInstance({
        createdAt: inactiveAt,
        userCount: undefined,
        userEmailHashes: undefined,
      }),
    ]);

    await runTick();

    expect(compareAndSetCalls()[0]!.data).toEqual({ currentUserCount: 0 });
  });

  test("drops an abandoned legacy count even when no instance row was created", async () => {
    const license: EnterpriseLicense = makeLicense({
      currentUserCount: 23,
      userCountUpdatedAt: OneUptimeDate.addRemoveDays(NOW, -7),
    });
    mockEnterpriseLicenseService.findBy.mockResolvedValue([license]);
    mockEnterpriseLicenseInstanceService.findBy.mockResolvedValue([]);

    await runTick();

    expect(compareAndSetCalls()[0]!.data).toEqual({ currentUserCount: 0 });
  });

  test("does not write when the derived count is unchanged", async () => {
    const license: EnterpriseLicense = makeLicense({ currentUserCount: 2 });
    mockEnterpriseLicenseService.findBy.mockResolvedValue([license]);
    mockEnterpriseLicenseInstanceService.findBy.mockResolvedValue([
      makeInstance({
        daysSinceReport: 1,
        userEmailHashes: ["alice", "bob"],
      }),
    ]);

    await runTick();

    expect(
      mockEnterpriseLicenseService.updateColumnsByIdWithoutHooks,
    ).not.toHaveBeenCalled();
  });

  test("CAS guards both prior values and never writes userCountUpdatedAt", async () => {
    const updatedAt: Date = new Date("2026-09-01T11:00:00.000Z");
    const license: EnterpriseLicense = makeLicense({
      currentUserCount: 4,
      userCountUpdatedAt: updatedAt,
    });
    mockEnterpriseLicenseService.findBy.mockResolvedValue([license]);
    mockEnterpriseLicenseInstanceService.findBy.mockResolvedValue([
      makeInstance({ daysSinceReport: 1, userCount: 2 }),
    ]);

    await runTick();

    const update: CompareAndSetArgs = compareAndSetCalls()[0]!;

    expect(update.expectedData).toEqual({
      currentUserCount: 4,
      userCountUpdatedAt: updatedAt,
      userCountSource: null,
      legacyUserCount: null,
      legacyUserCountUpdatedAt: null,
    });
    expect(update.data).toEqual({ currentUserCount: 2 });
    expect(update.data).not.toHaveProperty("userCountUpdatedAt");
  });

  test("uses null-safe CAS expectations for a license with no prior report", async () => {
    const license: EnterpriseLicense = makeLicense();
    mockEnterpriseLicenseService.findBy.mockResolvedValue([license]);
    mockEnterpriseLicenseInstanceService.findBy.mockResolvedValue([
      makeInstance({ daysSinceReport: 1, userCount: 1 }),
    ]);

    await runTick();

    expect(compareAndSetCalls()[0]!.expectedData).toEqual({
      currentUserCount: null,
      userCountUpdatedAt: null,
      userCountSource: null,
      legacyUserCount: null,
      legacyUserCountUpdatedAt: null,
    });
  });

  test("isolates instance-read and CAS-write failures to their licenses", async () => {
    const readFailure: EnterpriseLicense = makeLicense({
      currentUserCount: 7,
    });
    const writeFailure: EnterpriseLicense = makeLicense({
      currentUserCount: 7,
    });
    const healthy: EnterpriseLicense = makeLicense({ currentUserCount: 7 });

    mockEnterpriseLicenseService.findBy
      .mockResolvedValueOnce([readFailure, writeFailure])
      .mockResolvedValueOnce([healthy]);
    mockEnterpriseLicenseInstanceService.findBy.mockImplementation(
      async (args: FindByArgs): Promise<Array<EnterpriseLicenseInstance>> => {
        const licenseId: ObjectID = args.query[
          "enterpriseLicenseId"
        ] as ObjectID;

        if (licenseId.toString() === readFailure.id!.toString()) {
          throw new Error("instance read failed");
        }

        return [makeInstance({ daysSinceReport: 8, userCount: 7 })];
      },
    );
    mockEnterpriseLicenseService.updateColumnsByIdWithoutHooks.mockImplementation(
      async (args: CompareAndSetArgs): Promise<void> => {
        if (args.id.toString() === writeFailure.id!.toString()) {
          throw new Error("CAS write failed");
        }
      },
    );

    await expect(runTick()).resolves.toBeUndefined();

    expect(mockEnterpriseLicenseInstanceService.findBy).toHaveBeenCalledTimes(
      3,
    );
    expect(
      compareAndSetCalls().map((call: CompareAndSetArgs) => {
        return call.id;
      }),
    ).toEqual([writeFailure.id, healthy.id]);
    expect(logger.error).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining(readFailure.id!.toString()),
    );
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining(writeFailure.id!.toString()),
    );
  });
});
