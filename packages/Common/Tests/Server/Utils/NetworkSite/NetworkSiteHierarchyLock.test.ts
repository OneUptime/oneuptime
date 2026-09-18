const lockMock: jest.Mock = jest.fn();
const releaseMock: jest.Mock = jest.fn();
const loggerErrorMock: jest.Mock = jest.fn();

jest.mock("../../../../Server/Infrastructure/Semaphore", () => {
  return {
    __esModule: true,
    default: {
      lock: (...args: Array<unknown>) => {
        return lockMock(...args);
      },
      release: (...args: Array<unknown>) => {
        return releaseMock(...args);
      },
    },
  };
});

jest.mock("../../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      error: (...args: Array<unknown>) => {
        return loggerErrorMock(...args);
      },
    },
  };
});

import NetworkSiteHierarchyLock, {
  NETWORK_SITE_HIERARCHY_LOCK_ERROR_MESSAGE,
  NETWORK_SITE_HIERARCHY_LOCK_NAMESPACE,
  NETWORK_SITE_HIERARCHY_ROOT_SCOPE_ERROR_MESSAGE,
} from "../../../../Server/Utils/NetworkSite/NetworkSiteHierarchyLock";
import QueryHelper from "../../../../Server/Types/Database/QueryHelper";
import ServerException from "../../../../Types/Exception/ServerException";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

const PROJECT_A: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const PROJECT_B: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

describe("NetworkSiteHierarchyLock", () => {
  beforeEach(() => {
    lockMock.mockReset();
    releaseMock.mockReset();
    loggerErrorMock.mockReset();

    lockMock.mockImplementation(async (data: { key: string }) => {
      return { key: data.key };
    });
    releaseMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("deduplicates and acquires project locks in sorted order, then releases in reverse", async () => {
    const operation: jest.Mock = jest.fn().mockResolvedValue("written");

    await expect(
      NetworkSiteHierarchyLock.runExclusive({
        projectIds: [PROJECT_B, PROJECT_A, PROJECT_B.toString().toUpperCase()],
        operation,
      }),
    ).resolves.toBe("written");

    expect(
      lockMock.mock.calls.map((call: Array<unknown>) => {
        return call[0];
      }),
    ).toEqual([
      expect.objectContaining({
        key: PROJECT_A.toString(),
        namespace: NETWORK_SITE_HIERARCHY_LOCK_NAMESPACE,
      }),
      expect.objectContaining({
        key: PROJECT_B.toString(),
        namespace: NETWORK_SITE_HIERARCHY_LOCK_NAMESPACE,
      }),
    ]);
    expect(
      releaseMock.mock.calls.map((call: Array<unknown>) => {
        return call[0];
      }),
    ).toEqual([{ key: PROJECT_B.toString() }, { key: PROJECT_A.toString() }]);

    expect(lockMock.mock.invocationCallOrder[1]!).toBeLessThan(
      operation.mock.invocationCallOrder[0]!,
    );
    expect(operation.mock.invocationCallOrder[0]!).toBeLessThan(
      releaseMock.mock.invocationCallOrder[0]!,
    );
  });

  it("serializes two mutations that use the same project key", async () => {
    const firstMutex: { key: string } = { key: "first" };
    const secondMutex: { key: string } = { key: "second" };
    let allowFirstToFinish: (() => void) | undefined;
    let grantSecondLock: ((mutex: { key: string }) => void) | undefined;

    const firstOperationGate: Promise<void> = new Promise<void>(
      (resolve: () => void) => {
        allowFirstToFinish = resolve;
      },
    );
    const secondLockGate: Promise<{ key: string }> = new Promise(
      (resolve: (mutex: { key: string }) => void) => {
        grantSecondLock = resolve;
      },
    );

    lockMock
      .mockResolvedValueOnce(firstMutex)
      .mockReturnValueOnce(secondLockGate);
    releaseMock.mockImplementation(async (mutex: { key: string }) => {
      if (mutex === firstMutex) {
        grantSecondLock!(secondMutex);
      }
    });

    const events: Array<string> = [];
    const first: Promise<string> = NetworkSiteHierarchyLock.runExclusive({
      projectIds: [PROJECT_A],
      operation: async (): Promise<string> => {
        events.push("first-start");
        await firstOperationGate;
        events.push("first-end");
        return "first";
      },
    });

    await Promise.resolve();

    const second: Promise<string> = NetworkSiteHierarchyLock.runExclusive({
      projectIds: [PROJECT_A],
      operation: async (): Promise<string> => {
        events.push("second-start");
        return "second";
      },
    });

    await Promise.resolve();
    expect(events).toEqual(["first-start"]);

    allowFirstToFinish!();

    await expect(first).resolves.toBe("first");
    await expect(second).resolves.toBe("second");
    expect(events).toEqual(["first-start", "first-end", "second-start"]);
  });

  it("releases every acquired lock when the protected operation throws", async () => {
    const mutationError: Error = new Error("write failed");

    await expect(
      NetworkSiteHierarchyLock.runExclusive({
        projectIds: [PROJECT_A, PROJECT_B],
        operation: async (): Promise<never> => {
          throw mutationError;
        },
      }),
    ).rejects.toBe(mutationError);

    expect(releaseMock).toHaveBeenCalledTimes(2);
  });

  it("fails closed and releases earlier locks when a later acquisition fails", async () => {
    const firstMutex: { key: string } = { key: PROJECT_A.toString() };
    const operation: jest.Mock = jest.fn();

    lockMock
      .mockResolvedValueOnce(firstMutex)
      .mockRejectedValueOnce(new Error("redis unavailable"));

    await expect(
      NetworkSiteHierarchyLock.runExclusive({
        projectIds: [PROJECT_B, PROJECT_A],
        operation,
      }),
    ).rejects.toEqual(
      new ServerException(NETWORK_SITE_HIERARCHY_LOCK_ERROR_MESSAGE),
    );

    expect(operation).not.toHaveBeenCalled();
    expect(releaseMock).toHaveBeenCalledTimes(1);
    expect(releaseMock).toHaveBeenCalledWith(firstMutex);
  });

  it("does not let a release failure mask success or the original write error", async () => {
    releaseMock.mockRejectedValue(new Error("release failed"));

    await expect(
      NetworkSiteHierarchyLock.runExclusive({
        projectIds: [PROJECT_A],
        operation: async (): Promise<string> => {
          return "saved";
        },
      }),
    ).resolves.toBe("saved");

    const writeError: Error = new Error("original write failure");

    await expect(
      NetworkSiteHierarchyLock.runExclusive({
        projectIds: [PROJECT_A],
        operation: async (): Promise<never> => {
          throw writeError;
        },
      }),
    ).rejects.toBe(writeError);

    expect(loggerErrorMock).toHaveBeenCalledTimes(2);
  });

  it("runs a zero-target mutation without taking an unrelated lock", async () => {
    const operation: jest.Mock = jest.fn().mockResolvedValue(0);

    await expect(
      NetworkSiteHierarchyLock.runExclusive({ projectIds: [], operation }),
    ).resolves.toBe(0);

    expect(lockMock).not.toHaveBeenCalled();
    expect(releaseMock).not.toHaveBeenCalled();
  });

  it("accepts only literal project or closed row-ID scopes for root mutations", () => {
    for (const query of [
      { projectId: PROJECT_A },
      { project: PROJECT_A.toString() },
      { _id: PROJECT_A },
      { _id: [PROJECT_A, PROJECT_B.toString()] },
    ]) {
      expect(() => {
        NetworkSiteHierarchyLock.assertSafeRootMutationScope({
          query,
          props: { isRoot: true },
        });
      }).not.toThrow();
    }

    expect(
      NetworkSiteHierarchyLock.getExplicitProjectIds({
        project: PROJECT_A.toString(),
      }),
    ).toEqual([PROJECT_A.toString()]);
  });

  it("rejects raw project and row-ID predicates for an unscoped root mutation", () => {
    for (const query of [
      { projectId: QueryHelper.any([PROJECT_A]) },
      { _id: QueryHelper.any([PROJECT_A]) },
    ]) {
      expect(() => {
        NetworkSiteHierarchyLock.assertSafeRootMutationScope({
          query,
          props: { isRoot: true },
        });
      }).toThrow(NETWORK_SITE_HIERARCHY_ROOT_SCOPE_ERROR_MESSAGE);
    }
  });

  it("does not treat a root update's tenantId as a closed query scope", () => {
    expect(() => {
      NetworkSiteHierarchyLock.assertSafeRootMutationScope({
        query: {
          projectId: QueryHelper.any([PROJECT_A]),
          _id: QueryHelper.any([PROJECT_B]),
        },
        props: { isRoot: true, tenantId: PROJECT_A },
      });
    }).toThrow(NETWORK_SITE_HIERARCHY_ROOT_SCOPE_ERROR_MESSAGE);
  });

  it("accepts a root delete tenant scope only when its permission path enforces it", () => {
    expect(() => {
      NetworkSiteHierarchyLock.assertSafeRootMutationScope({
        query: {
          projectId: QueryHelper.any([PROJECT_A]),
          _id: QueryHelper.any([PROJECT_B]),
        },
        props: { isRoot: true, tenantId: PROJECT_A },
        tenantScopeIsClosed: true,
      });
    }).not.toThrow();
  });

  it("does not treat a multi-tenant delete's tenantId as a closed scope", () => {
    expect(() => {
      NetworkSiteHierarchyLock.assertSafeRootMutationScope({
        query: { name: "Any matching row" },
        props: {
          isRoot: true,
          tenantId: PROJECT_A,
          isMultiTenantRequest: true,
        },
        tenantScopeIsClosed: true,
      });
    }).toThrow(NETWORK_SITE_HIERARCHY_ROOT_SCOPE_ERROR_MESSAGE);
  });
});
