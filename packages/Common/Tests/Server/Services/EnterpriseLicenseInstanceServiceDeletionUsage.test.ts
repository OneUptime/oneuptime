import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

interface UsageLockRequest {
  licenseId: import("../../../Types/ObjectID").default;
  fn: () => Promise<number>;
}

interface EnterpriseLicenseServiceMock {
  runWithUsageAggregationLock: jest.Mock;
  findOneById: jest.Mock;
  updateOneById: jest.Mock;
}

const mockEnterpriseLicenseService: EnterpriseLicenseServiceMock = {
  runWithUsageAggregationLock: jest.fn() as unknown as jest.Mock,
  findOneById: jest.fn() as unknown as jest.Mock,
  updateOneById: jest.fn() as unknown as jest.Mock,
};

jest.mock("../../../Server/Services/EnterpriseLicenseService", () => {
  return {
    __esModule: true,
    default: mockEnterpriseLicenseService,
  };
});

import EnterpriseLicenseInstanceService from "../../../Server/Services/EnterpriseLicenseInstanceService";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import DeleteById from "../../../Server/Types/Database/DeleteById";
import EnterpriseLicense from "../../../Models/DatabaseModels/EnterpriseLicense";
import EnterpriseLicenseInstance from "../../../Models/DatabaseModels/EnterpriseLicenseInstance";
import User from "../../../Models/DatabaseModels/User";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import EnterpriseLicenseUserCountSource from "../../../Types/EnterpriseLicense/EnterpriseLicenseUserCountSource";
import EnterpriseLicenseUsageUtil from "../../../Utils/EnterpriseLicense/EnterpriseLicenseUsage";
import { getJestSpyOn } from "../../Spy";

const LICENSE_ID: ObjectID = new ObjectID(
  "550e8400-e29b-41d4-a716-446655440081",
);
const INSTANCE_ID: ObjectID = new ObjectID(
  "550e8400-e29b-41d4-a716-446655440082",
);
const NOW: Date = new Date("2026-09-02T12:00:00.000Z");
const ONE_DAY_AGO: Date = OneUptimeDate.addRemoveDays(NOW, -1);
const EXACTLY_ONE_WEEK_AGO: Date = OneUptimeDate.addRemoveDays(NOW, -7);

type MakeInstanceFunction = (
  data?: Partial<{
    enterpriseLicenseId: ObjectID | undefined;
    createdAt: Date | undefined;
    lastReportedAt: Date | undefined;
    userCount: number | undefined;
    userEmailHashes: Array<string> | undefined;
  }>,
) => EnterpriseLicenseInstance;

const makeInstance: MakeInstanceFunction = (
  data: Parameters<MakeInstanceFunction>[0],
): EnterpriseLicenseInstance => {
  return {
    id: ObjectID.generate(),
    enterpriseLicenseId: data?.enterpriseLicenseId || LICENSE_ID,
    createdAt: data?.createdAt,
    lastReportedAt: data?.lastReportedAt,
    userCount: data?.userCount,
    userEmailHashes: data?.userEmailHashes,
  } as unknown as EnterpriseLicenseInstance;
};

type MakeLicenseFunction = (
  data?: Partial<{
    currentUserCount: number;
    userCountUpdatedAt: Date;
    userCountSource: EnterpriseLicenseUserCountSource;
    legacyUserCount: number;
    legacyUserCountUpdatedAt: Date;
  }>,
) => EnterpriseLicense;

const makeLicense: MakeLicenseFunction = (
  data: Parameters<MakeLicenseFunction>[0],
): EnterpriseLicense => {
  return {
    id: LICENSE_ID,
    currentUserCount: data?.currentUserCount,
    userCountUpdatedAt: data?.userCountUpdatedAt,
    userCountSource: data?.userCountSource,
    legacyUserCount: data?.legacyUserCount,
    legacyUserCountUpdatedAt: data?.legacyUserCountUpdatedAt,
  } as unknown as EnterpriseLicense;
};

describe("EnterpriseLicenseInstanceService deletion usage reconciliation", () => {
  let resolvedInstance: EnterpriseLicenseInstance | null;
  let remainingInstances: Array<EnterpriseLicenseInstance>;
  let license: EnterpriseLicense | null;
  let deleteAffected: number;
  let operationEvents: Array<string>;
  let deleteOneBySpy: jest.SpyInstance;
  let findOneByIdSpy: jest.SpyInstance;
  let findBySpy: jest.SpyInstance;
  let permissionSpy: jest.SpyInstance;
  let currentDateSpy: jest.SpyInstance;
  let deleteInput: DeleteById;

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();

    resolvedInstance = makeInstance({
      lastReportedAt: ONE_DAY_AGO,
    });
    remainingInstances = [];
    license = makeLicense({
      currentUserCount: 9,
      userCountUpdatedAt: NOW,
      userCountSource: EnterpriseLicenseUserCountSource.Instance,
    });
    deleteAffected = 1;
    operationEvents = [];

    permissionSpy = getJestSpyOn(
      ModelPermission,
      "checkDeletePermissionByModel",
    ).mockResolvedValue(undefined as never);
    currentDateSpy = getJestSpyOn(
      OneUptimeDate,
      "getCurrentDate",
    ).mockReturnValue(NOW);
    findOneByIdSpy = getJestSpyOn(
      EnterpriseLicenseInstanceService,
      "findOneById",
    ).mockImplementation(
      async (request: { select?: Record<string, boolean> }) => {
        if (request.select?.["enterpriseLicenseId"]) {
          operationEvents.push("instance:ownership-read");
        } else if (request.select?.["lastReportedAt"]) {
          operationEvents.push("instance:locked-read");
        } else {
          operationEvents.push("instance:permission-read");
        }

        return resolvedInstance;
      },
    );
    deleteOneBySpy = getJestSpyOn(
      EnterpriseLicenseInstanceService,
      "deleteOneBy",
    ).mockImplementation(async () => {
      operationEvents.push("instance:delete");
      return deleteAffected;
    });
    findBySpy = getJestSpyOn(
      EnterpriseLicenseInstanceService,
      "findBy",
    ).mockImplementation(async () => {
      operationEvents.push("instances:read");
      return remainingInstances;
    });

    mockEnterpriseLicenseService.runWithUsageAggregationLock.mockReset();
    mockEnterpriseLicenseService.runWithUsageAggregationLock.mockImplementation(
      async (request: UsageLockRequest): Promise<number> => {
        operationEvents.push("lock:start");
        try {
          return await request.fn();
        } finally {
          operationEvents.push("lock:end");
        }
      },
    );
    mockEnterpriseLicenseService.findOneById.mockReset();
    mockEnterpriseLicenseService.findOneById.mockImplementation(
      async (request: { select: Record<string, boolean> }) => {
        if (
          request.select["userCountSource"] &&
          Object.keys(request.select).length === 1
        ) {
          operationEvents.push("license:source-read");
        } else {
          operationEvents.push("license:usage-read");
        }

        return license;
      },
    );
    mockEnterpriseLicenseService.updateOneById.mockReset();
    mockEnterpriseLicenseService.updateOneById.mockImplementation(
      async (request: {
        data: Partial<{
          currentUserCount: number;
          userCountSource: EnterpriseLicenseUserCountSource;
        }>;
      }) => {
        if (request.data.currentUserCount === undefined) {
          operationEvents.push("license:source-marker");

          if (license && request.data.userCountSource) {
            license.userCountSource = request.data.userCountSource;
          }
        } else {
          operationEvents.push("license:aggregate-update");
        }
      },
    );

    const deletedByUser: User = new User();
    deletedByUser._id = "550e8400-e29b-41d4-a716-446655440083";
    deleteInput = {
      id: INSTANCE_ID,
      deletedByUser,
      deletionReason: "Instance decommissioned",
      props: {
        isMasterAdmin: true,
      },
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("deletes under the license lock and reconciles the last modern instance to zero", async () => {
    await expect(
      EnterpriseLicenseInstanceService.deleteOneById(deleteInput),
    ).resolves.toBe(1);

    expect(operationEvents).toEqual([
      "instance:ownership-read",
      "lock:start",
      "instance:locked-read",
      "license:source-read",
      "instance:delete",
      "instances:read",
      "license:usage-read",
      "license:aggregate-update",
      "lock:end",
    ]);
    expect(
      mockEnterpriseLicenseService.runWithUsageAggregationLock,
    ).toHaveBeenCalledWith({
      licenseId: LICENSE_ID,
      fn: expect.any(Function),
    });
    expect(findOneByIdSpy).toHaveBeenNthCalledWith(1, {
      id: INSTANCE_ID,
      select: {
        enterpriseLicenseId: true,
      },
      props: {
        isRoot: true,
      },
    });
    expect(findOneByIdSpy).toHaveBeenNthCalledWith(2, {
      id: INSTANCE_ID,
      select: {
        lastReportedAt: true,
      },
      props: {
        isRoot: true,
      },
    });
    expect(mockEnterpriseLicenseService.updateOneById).toHaveBeenCalledWith({
      id: LICENSE_ID,
      data: {
        currentUserCount: 0,
        userCountSource: EnterpriseLicenseUserCountSource.Instance,
      },
      props: {
        isRoot: true,
        ignoreHooks: true,
      },
    });
    expect(currentDateSpy).toHaveBeenCalledTimes(1);
  });

  test("recomputes the deduplicated aggregate from the remaining active modern instances", async () => {
    remainingInstances = [
      makeInstance({
        lastReportedAt: ONE_DAY_AGO,
        userCount: 2,
        userEmailHashes: ["alice", "shared"],
      }),
      makeInstance({
        lastReportedAt: ONE_DAY_AGO,
        userCount: 2,
        userEmailHashes: ["shared", "bob"],
      }),
    ];

    await EnterpriseLicenseInstanceService.deleteOneById(deleteInput);

    expect(mockEnterpriseLicenseService.updateOneById).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          currentUserCount: 3,
          userCountSource: EnterpriseLicenseUserCountSource.Instance,
        },
      }),
    );
    expect(findBySpy).toHaveBeenCalledWith({
      query: {
        enterpriseLicenseId: LICENSE_ID,
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
  });

  test("excludes remaining instances at the exact inactivity boundary", async () => {
    remainingInstances = [
      makeInstance({
        lastReportedAt: ONE_DAY_AGO,
        userCount: 1,
        userEmailHashes: ["active"],
      }),
      makeInstance({
        lastReportedAt: EXACTLY_ONE_WEEK_AGO,
        userCount: 50,
        userEmailHashes: ["inactive"],
      }),
    ];

    await EnterpriseLicenseInstanceService.deleteOneById(deleteInput);

    expect(mockEnterpriseLicenseService.updateOneById).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          currentUserCount: 1,
          userCountSource: EnterpriseLicenseUserCountSource.Instance,
        },
      }),
    );
  });

  test("falls back to a fresh explicitly-provenanced legacy report when no active modern report remains", async () => {
    remainingInstances = [
      makeInstance({
        lastReportedAt: EXACTLY_ONE_WEEK_AGO,
        userCount: 50,
      }),
    ];
    license = makeLicense({
      currentUserCount: 50,
      userCountUpdatedAt: NOW,
      legacyUserCount: 7,
      legacyUserCountUpdatedAt: ONE_DAY_AGO,
    });

    await EnterpriseLicenseInstanceService.deleteOneById(deleteInput);

    expect(mockEnterpriseLicenseService.updateOneById).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          currentUserCount: 7,
          userCountSource: EnterpriseLicenseUserCountSource.Legacy,
        },
      }),
    );
    expect(mockEnterpriseLicenseService.findOneById).toHaveBeenCalledWith({
      id: LICENSE_ID,
      select: {
        currentUserCount: true,
        userCountUpdatedAt: true,
        userCountSource: true,
        legacyUserCount: true,
        legacyUserCountUpdatedAt: true,
      },
      props: {
        isRoot: true,
      },
    });
  });

  test("does not let the newer modern aggregate timestamp extend legacy freshness after deletion", async () => {
    const legacyReportedAt: Date = OneUptimeDate.addRemoveDays(NOW, -6);
    const modernReportedAt: Date = ONE_DAY_AGO;
    license = makeLicense({
      currentUserCount: 50,
      userCountUpdatedAt: modernReportedAt,
      userCountSource: EnterpriseLicenseUserCountSource.Instance,
      legacyUserCount: 7,
      legacyUserCountUpdatedAt: legacyReportedAt,
    });

    await EnterpriseLicenseInstanceService.deleteOneById(deleteInput);

    const updateData: {
      currentUserCount: number;
      userCountSource: EnterpriseLicenseUserCountSource;
    } = (
      mockEnterpriseLicenseService.updateOneById.mock.calls[0]![0] as {
        data: {
          currentUserCount: number;
          userCountSource: EnterpriseLicenseUserCountSource;
        };
      }
    ).data;

    expect(updateData).toEqual({
      currentUserCount: 7,
      userCountSource: EnterpriseLicenseUserCountSource.Legacy,
    });
    expect(updateData).not.toHaveProperty("userCountUpdatedAt");
    expect(updateData).not.toHaveProperty("legacyUserCountUpdatedAt");

    const legacyExpiryBoundary: Date = OneUptimeDate.addRemoveDays(
      legacyReportedAt,
      7,
    );
    expect(
      EnterpriseLicenseUsageUtil.getEffectiveUserCount({
        instances: [],
        storedUserCount: updateData.currentUserCount,
        storedUserCountUpdatedAt: modernReportedAt,
        storedUserCountSource: updateData.userCountSource,
        legacyUserCount: license.legacyUserCount,
        legacyUserCountUpdatedAt: license.legacyUserCountUpdatedAt,
        now: legacyExpiryBoundary,
      }),
    ).toBe(0);
  });

  test("preserves DatabaseService permission and deletion metadata handling when the row is already absent", async () => {
    resolvedInstance = null;
    deleteAffected = 0;

    await expect(
      EnterpriseLicenseInstanceService.deleteOneById(deleteInput),
    ).resolves.toBe(0);

    expect(permissionSpy).toHaveBeenCalledTimes(2);
    expect(deleteOneBySpy).toHaveBeenCalledWith({
      query: {
        _id: INSTANCE_ID.toString(),
      },
      deletedByUser: deleteInput.deletedByUser,
      deletionReason: "Instance decommissioned",
      props: deleteInput.props,
    });
    expect(operationEvents).toEqual([
      "instance:ownership-read",
      "instance:delete",
    ]);
    expect(
      mockEnterpriseLicenseService.runWithUsageAggregationLock,
    ).not.toHaveBeenCalled();
    expect(findBySpy).not.toHaveBeenCalled();
    expect(mockEnterpriseLicenseService.updateOneById).not.toHaveBeenCalled();
  });

  test("preserves a fresh pre-migration legacy count when deleting its sole registration-only row", async () => {
    resolvedInstance = makeInstance({
      createdAt: ONE_DAY_AGO,
      lastReportedAt: undefined,
    });
    license = makeLicense({
      currentUserCount: 12,
      userCountUpdatedAt: ONE_DAY_AGO,
    });

    await EnterpriseLicenseInstanceService.deleteOneById(deleteInput);

    expect(mockEnterpriseLicenseService.updateOneById).toHaveBeenCalledWith({
      id: LICENSE_ID,
      data: {
        currentUserCount: 12,
        userCountSource: EnterpriseLicenseUserCountSource.Legacy,
      },
      props: {
        isRoot: true,
        ignoreHooks: true,
      },
    });
  });

  test("does not resurrect an instance aggregate marked as modern when deleting a registration-only row", async () => {
    resolvedInstance = makeInstance({
      createdAt: ONE_DAY_AGO,
      lastReportedAt: undefined,
    });
    license = makeLicense({
      currentUserCount: 12,
      userCountUpdatedAt: ONE_DAY_AGO,
      userCountSource: EnterpriseLicenseUserCountSource.Instance,
    });

    await EnterpriseLicenseInstanceService.deleteOneById(deleteInput);

    expect(mockEnterpriseLicenseService.updateOneById).toHaveBeenCalledWith({
      id: LICENSE_ID,
      data: {
        currentUserCount: 0,
        userCountSource: EnterpriseLicenseUserCountSource.Instance,
      },
      props: {
        isRoot: true,
        ignoreHooks: true,
      },
    });
  });

  test("persists zero for a stale pre-migration count after deleting its sole registration-only row", async () => {
    resolvedInstance = makeInstance({
      createdAt: EXACTLY_ONE_WEEK_AGO,
      lastReportedAt: undefined,
    });
    license = makeLicense({
      currentUserCount: 12,
      userCountUpdatedAt: EXACTLY_ONE_WEEK_AGO,
    });

    await EnterpriseLicenseInstanceService.deleteOneById(deleteInput);

    expect(mockEnterpriseLicenseService.updateOneById).toHaveBeenCalledWith({
      id: LICENSE_ID,
      data: {
        currentUserCount: 0,
      },
      props: {
        isRoot: true,
        ignoreHooks: true,
      },
    });
  });

  test("does not reconcile when the locked delete loses a race and affects no row", async () => {
    deleteAffected = 0;

    await expect(
      EnterpriseLicenseInstanceService.deleteOneById(deleteInput),
    ).resolves.toBe(0);

    expect(operationEvents).toEqual([
      "instance:ownership-read",
      "lock:start",
      "instance:locked-read",
      "license:source-read",
      "instance:delete",
      "lock:end",
    ]);
    expect(findBySpy).not.toHaveBeenCalled();
    expect(mockEnterpriseLicenseService.findOneById).toHaveBeenCalledTimes(1);
    expect(mockEnterpriseLicenseService.updateOneById).not.toHaveBeenCalled();
  });

  test("propagates delete failures, releases the lock, and performs no reconciliation", async () => {
    const deleteError: Error = new Error("delete failed");
    deleteOneBySpy.mockImplementation(async () => {
      operationEvents.push("instance:delete");
      throw deleteError;
    });

    await expect(
      EnterpriseLicenseInstanceService.deleteOneById(deleteInput),
    ).rejects.toBe(deleteError);

    expect(operationEvents).toEqual([
      "instance:ownership-read",
      "lock:start",
      "instance:locked-read",
      "license:source-read",
      "instance:delete",
      "lock:end",
    ]);
    expect(findBySpy).not.toHaveBeenCalled();
    expect(mockEnterpriseLicenseService.findOneById).toHaveBeenCalledTimes(1);
    expect(mockEnterpriseLicenseService.updateOneById).not.toHaveBeenCalled();
  });

  test("persists an upgrade-era modern marker before deletion when the aggregate update later fails", async () => {
    const aggregateError: Error = new Error("aggregate update failed");
    license = makeLicense({
      currentUserCount: 9,
      userCountUpdatedAt: NOW,
    });
    mockEnterpriseLicenseService.updateOneById.mockImplementation(
      async (request: {
        data: Partial<{
          currentUserCount: number;
          userCountSource: EnterpriseLicenseUserCountSource;
        }>;
      }) => {
        if (request.data.currentUserCount === undefined) {
          operationEvents.push("license:source-marker");
          license!.userCountSource = EnterpriseLicenseUserCountSource.Instance;
          return;
        }

        operationEvents.push("license:aggregate-update");
        throw aggregateError;
      },
    );

    await expect(
      EnterpriseLicenseInstanceService.deleteOneById(deleteInput),
    ).rejects.toBe(aggregateError);

    expect(operationEvents).toEqual([
      "instance:ownership-read",
      "lock:start",
      "instance:locked-read",
      "license:source-read",
      "license:source-marker",
      "instance:delete",
      "instances:read",
      "license:usage-read",
      "license:aggregate-update",
      "lock:end",
    ]);
    expect(
      mockEnterpriseLicenseService.updateOneById.mock.calls.map(
        (call: Array<unknown>): unknown => {
          return (call[0] as { data: unknown }).data;
        },
      ),
    ).toEqual([
      {
        userCountSource: EnterpriseLicenseUserCountSource.Instance,
      },
      {
        currentUserCount: 0,
        userCountSource: EnterpriseLicenseUserCountSource.Instance,
      },
    ]);
    expect(license?.userCountSource).toBe(
      EnterpriseLicenseUserCountSource.Instance,
    );
  });

  test("persists zero when deleting the only reported row from an otherwise empty license", async () => {
    license = makeLicense();

    await expect(
      EnterpriseLicenseInstanceService.deleteOneById(deleteInput),
    ).resolves.toBe(1);

    expect(mockEnterpriseLicenseService.updateOneById).toHaveBeenCalledTimes(2);
    expect(
      mockEnterpriseLicenseService.updateOneById.mock.calls.map(
        (call: Array<unknown>): unknown => {
          return (call[0] as { data: unknown }).data;
        },
      ),
    ).toEqual([
      {
        userCountSource: EnterpriseLicenseUserCountSource.Instance,
      },
      {
        currentUserCount: 0,
        userCountSource: EnterpriseLicenseUserCountSource.Instance,
      },
    ]);
    expect(operationEvents).toEqual([
      "instance:ownership-read",
      "lock:start",
      "instance:locked-read",
      "license:source-read",
      "license:source-marker",
      "instance:delete",
      "instances:read",
      "license:usage-read",
      "license:aggregate-update",
      "lock:end",
    ]);
  });

  test("does not delete or reconcile when DatabaseService refuses permission", async () => {
    const permissionError: Error = new Error("not allowed");
    permissionSpy.mockRejectedValue(permissionError);

    await expect(
      EnterpriseLicenseInstanceService.deleteOneById(deleteInput),
    ).rejects.toBe(permissionError);

    expect(deleteOneBySpy).not.toHaveBeenCalled();
    expect(findBySpy).not.toHaveBeenCalled();
    expect(mockEnterpriseLicenseService.updateOneById).not.toHaveBeenCalled();
    expect(operationEvents).toEqual([]);
    expect(
      mockEnterpriseLicenseService.runWithUsageAggregationLock,
    ).not.toHaveBeenCalled();
  });
});
