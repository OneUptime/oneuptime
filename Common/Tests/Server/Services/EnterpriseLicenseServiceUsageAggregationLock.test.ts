jest.mock("../../../Server/Infrastructure/Semaphore", () => {
  return {
    __esModule: true,
    default: {
      lock: jest.fn(),
      release: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      error: jest.fn(),
    },
  };
});

import EnterpriseLicenseService, {
  ENTERPRISE_LICENSE_USAGE_AGGREGATION_LOCK_NAMESPACE,
  ENTERPRISE_LICENSE_USAGE_AGGREGATION_LOCK_OPTIONS,
} from "../../../Server/Services/EnterpriseLicenseService";
import Semaphore from "../../../Server/Infrastructure/Semaphore";
import logger from "../../../Server/Utils/Logger";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

interface FakeMutex {
  key: string;
}

interface LockRequest {
  key: string;
  namespace: string;
}

class FakeSemaphore {
  private readonly heldKeys: Set<string> = new Set<string>();
  private readonly waitersByKey: Map<string, Array<() => void>> = new Map<
    string,
    Array<() => void>
  >();

  public async lock(data: LockRequest): Promise<FakeMutex> {
    const key: string = `${data.namespace}-${data.key}`;

    if (this.heldKeys.has(key)) {
      await new Promise<void>((resolve: () => void) => {
        const waiters: Array<() => void> = this.waitersByKey.get(key) || [];
        waiters.push(resolve);
        this.waitersByKey.set(key, waiters);
      });
    } else {
      this.heldKeys.add(key);
    }

    return { key };
  }

  public async release(mutex: FakeMutex): Promise<void> {
    const waiters: Array<() => void> | undefined = this.waitersByKey.get(
      mutex.key,
    );
    const next: (() => void) | undefined = waiters?.shift();

    if (next) {
      next();
      return;
    }

    this.waitersByKey.delete(mutex.key);
    this.heldKeys.delete(mutex.key);
  }
}

interface Gate {
  promise: Promise<void>;
  open: () => void;
}

function createGate(): Gate {
  let open: () => void = (): void => {};
  const promise: Promise<void> = new Promise<void>((resolve: () => void) => {
    open = resolve;
  });

  return { promise, open };
}

const lockMock: jest.Mock = Semaphore.lock as unknown as jest.Mock;
const releaseMock: jest.Mock = Semaphore.release as unknown as jest.Mock;
const loggerErrorMock: jest.Mock = logger.error as unknown as jest.Mock;

function installFakeSemaphore(): void {
  const fakeSemaphore: FakeSemaphore = new FakeSemaphore();

  lockMock.mockImplementation(async (data: LockRequest) => {
    return await fakeSemaphore.lock(data);
  });
  releaseMock.mockImplementation(async (mutex: unknown) => {
    await fakeSemaphore.release(mutex as FakeMutex);
  });
}

describe("EnterpriseLicenseService usage aggregation lock", () => {
  beforeEach(() => {
    lockMock.mockReset();
    releaseMock.mockReset();
    loggerErrorMock.mockReset();
    lockMock.mockResolvedValue({ key: "mutex" });
    releaseMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test("uses the stable per-license key, namespace, and bounded timeout options", async () => {
    const licenseId: ObjectID = ObjectID.generate();
    const mutex: FakeMutex = { key: "returned-mutex" };
    lockMock.mockResolvedValue(mutex);

    await EnterpriseLicenseService.runWithUsageAggregationLock({
      licenseId,
      fn: async (): Promise<void> => {},
    });

    expect(ENTERPRISE_LICENSE_USAGE_AGGREGATION_LOCK_NAMESPACE).toBe(
      "EnterpriseLicenseService.usageAggregation",
    );
    expect(ENTERPRISE_LICENSE_USAGE_AGGREGATION_LOCK_OPTIONS).toEqual({
      namespace: "EnterpriseLicenseService.usageAggregation",
      lockTimeout: 60_000,
      acquireTimeout: 10_000,
    });
    expect(
      Object.isFrozen(ENTERPRISE_LICENSE_USAGE_AGGREGATION_LOCK_OPTIONS),
    ).toBe(true);
    expect(
      ENTERPRISE_LICENSE_USAGE_AGGREGATION_LOCK_OPTIONS.acquireTimeout,
    ).toBeLessThan(
      ENTERPRISE_LICENSE_USAGE_AGGREGATION_LOCK_OPTIONS.lockTimeout,
    );
    expect(lockMock).toHaveBeenCalledWith({
      key: licenseId.toString(),
      namespace: "EnterpriseLicenseService.usageAggregation",
      lockTimeout: 60_000,
      acquireTimeout: 10_000,
    });
    expect(releaseMock).toHaveBeenCalledWith(mutex);
  });

  test("returns the callback value after releasing the mutex", async () => {
    const result: { users: number } =
      await EnterpriseLicenseService.runWithUsageAggregationLock({
        licenseId: ObjectID.generate(),
        fn: async (): Promise<{ users: number }> => {
          return { users: 17 };
        },
      });

    expect(result).toEqual({ users: 17 });
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  test("serializes concurrent callbacks for the same license", async () => {
    installFakeSemaphore();
    const licenseId: ObjectID = ObjectID.generate();
    const firstStarted: Gate = createGate();
    const allowFirstToFinish: Gate = createGate();
    const events: Array<string> = [];

    const first: Promise<string> =
      EnterpriseLicenseService.runWithUsageAggregationLock({
        licenseId,
        fn: async (): Promise<string> => {
          events.push("first:start");
          firstStarted.open();
          await allowFirstToFinish.promise;
          events.push("first:end");
          return "first";
        },
      });

    await firstStarted.promise;

    const secondCallback: ReturnType<typeof jest.fn<() => Promise<string>>> =
      jest.fn(async (): Promise<string> => {
        events.push("second:start");
        return "second";
      });
    const second: Promise<string> =
      EnterpriseLicenseService.runWithUsageAggregationLock({
        licenseId,
        fn: secondCallback,
      });

    await Promise.resolve();
    await Promise.resolve();
    expect(secondCallback).not.toHaveBeenCalled();

    allowFirstToFinish.open();

    await expect(first).resolves.toBe("first");
    await expect(second).resolves.toBe("second");
    expect(events).toEqual(["first:start", "first:end", "second:start"]);
  });

  test("allows callbacks for different licenses to run concurrently", async () => {
    installFakeSemaphore();
    const allowCallbacksToFinish: Gate = createGate();
    const bothCallbacksStarted: Gate = createGate();
    const started: Set<string> = new Set<string>();

    const callback: (name: string) => Promise<string> = async (
      name: string,
    ): Promise<string> => {
      started.add(name);
      if (started.size === 2) {
        bothCallbacksStarted.open();
      }
      await allowCallbacksToFinish.promise;
      return name;
    };

    const first: Promise<string> =
      EnterpriseLicenseService.runWithUsageAggregationLock({
        licenseId: ObjectID.generate(),
        fn: async (): Promise<string> => {
          return await callback("first");
        },
      });
    const second: Promise<string> =
      EnterpriseLicenseService.runWithUsageAggregationLock({
        licenseId: ObjectID.generate(),
        fn: async (): Promise<string> => {
          return await callback("second");
        },
      });

    await bothCallbacksStarted.promise;
    expect(started).toEqual(new Set<string>(["first", "second"]));

    allowCallbacksToFinish.open();
    await expect(Promise.all([first, second])).resolves.toEqual([
      "first",
      "second",
    ]);
  });

  test("releases the mutex when the callback throws", async () => {
    const callbackError: Error = new Error("aggregation failed");

    await expect(
      EnterpriseLicenseService.runWithUsageAggregationLock({
        licenseId: ObjectID.generate(),
        fn: async (): Promise<never> => {
          throw callbackError;
        },
      }),
    ).rejects.toBe(callbackError);

    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  test("fails closed without invoking or releasing when acquisition fails", async () => {
    const acquireError: Error = new Error("Redis unavailable");
    const callback: ReturnType<typeof jest.fn<() => Promise<void>>> = jest.fn(
      async (): Promise<void> => {},
    );
    lockMock.mockRejectedValue(acquireError);

    await expect(
      EnterpriseLicenseService.runWithUsageAggregationLock({
        licenseId: ObjectID.generate(),
        fn: callback,
      }),
    ).rejects.toBe(acquireError);

    expect(callback).not.toHaveBeenCalled();
    expect(releaseMock).not.toHaveBeenCalled();
  });

  test("does not mask a successful callback when release fails", async () => {
    const licenseId: ObjectID = ObjectID.generate();
    const releaseError: Error = new Error("release failed");
    releaseMock.mockRejectedValue(releaseError);

    await expect(
      EnterpriseLicenseService.runWithUsageAggregationLock({
        licenseId,
        fn: async (): Promise<string> => {
          return "complete";
        },
      }),
    ).resolves.toBe("complete");

    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.stringContaining(licenseId.toString()),
    );
    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.stringContaining(releaseError.toString()),
    );
  });

  test("does not mask a callback error when release also fails", async () => {
    const callbackError: Error = new Error("callback failed");
    releaseMock.mockRejectedValue(new Error("release failed"));

    await expect(
      EnterpriseLicenseService.runWithUsageAggregationLock({
        licenseId: ObjectID.generate(),
        fn: async (): Promise<never> => {
          throw callbackError;
        },
      }),
    ).rejects.toBe(callbackError);

    expect(loggerErrorMock).toHaveBeenCalledTimes(1);
  });
});
