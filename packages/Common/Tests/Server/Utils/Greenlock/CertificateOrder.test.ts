/**
 * CertificateOrder.orderIfMissing - the one door a custom domain's first
 * certificate is ordered through.
 *
 * A status page domain's first certificate can now be ordered from three
 * places: Check now (verify-cname orders the moment the record is found),
 * the 15-minute order sweep, and the sweep that re-orders a certificate that
 * went missing. They run on different replicas, and the two sweeps start on
 * the same tick. What this pins is that, between all of them, a name is
 * ordered once:
 *
 *   - concurrently: one order per name at a time, through a Redis lock taken
 *     without waiting. A caller that finds it taken orders nothing;
 *   - one after the other: with the lock held, the certificate table is read
 *     again, and a name that has a certificate - ordered by whoever held the
 *     lock a moment ago, or a domain re-verified after a CNAME blip - is only
 *     recorded as ordered.
 *
 * Redis is replaced by an in-memory lock with the same "taken, give up"
 * behaviour, and the certificate table by a map.
 */

import CertificateOrder, {
  CertificateOrderOutcome,
} from "../../../../Server/Utils/Greenlock/CertificateOrder";
import GreenlockUtil from "../../../../Server/Utils/Greenlock/Greenlock";
import Semaphore, {
  SemaphoreLockTimeoutError,
  SemaphoreMutex,
} from "../../../../Server/Infrastructure/Semaphore";
import AcmeCertificate from "../../../../Models/DatabaseModels/AcmeCertificate";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

type LockCall = {
  key: string;
  namespace: string;
  lockTimeout?: number | undefined;
  acquireAttemptsLimit?: number | undefined;
  onLockLost?: ((err: Error) => void) | undefined;
};

type Locks = {
  calls: Array<LockCall>;
  held: Set<string>;
  released: Array<string>;
};

// An in-memory stand-in for the Redis lock: a held key refuses at once.
function useInMemoryLocks(options?: {
  failWith?: Error | undefined;
  failRelease?: boolean | undefined;
}): Locks {
  const locks: Locks = { calls: [], held: new Set<string>(), released: [] };

  jest.spyOn(Semaphore, "lock").mockImplementation((async (data: LockCall) => {
    locks.calls.push(data);

    if (options?.failWith) {
      throw options.failWith;
    }

    const key: string = `${data.namespace}-${data.key}`;

    if (locks.held.has(key)) {
      throw new SemaphoreLockTimeoutError(`Acquire mutex ${key} timeout`);
    }

    locks.held.add(key);

    return { key: key } as unknown as SemaphoreMutex;
  }) as never);

  jest.spyOn(Semaphore, "release").mockImplementation((async (
    mutex: SemaphoreMutex,
  ) => {
    const key: string = (mutex as unknown as { key: string }).key;
    locks.released.push(key);
    locks.held.delete(key);

    if (options?.failRelease) {
      throw new Error("Valkey went away");
    }
  }) as never);

  return locks;
}

// The certificate table, by name: a name maps to its expiry, or null for a row without one.
function useCertificates(
  table: Map<string, Date | null>,
): Array<Array<string>> {
  const lookups: Array<Array<string>> = [];

  jest
    .spyOn(GreenlockUtil, "findCertificatesByDomain")
    .mockImplementation((async (domains: Array<string>) => {
      lookups.push([...domains]);

      const found: Map<string, AcmeCertificate> = new Map();

      for (const domain of domains) {
        const expiresAt: Date | null | undefined = table.get(domain);

        // A row without an expiry is no certificate, as the real lookup says.
        if (expiresAt) {
          found.set(domain, { domain, expiresAt } as AcmeCertificate);
        }
      }

      return found;
    }) as never);

  return lookups;
}

const IN_SIXTY_DAYS: Date = new Date(Date.now() + 60 * 24 * 3600 * 1000);

describe("CertificateOrder.orderIfMissing", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("orders a name that has no certificate, and releases the lock", async () => {
    const locks: Locks = useInMemoryLocks();
    useCertificates(new Map());
    const order: jest.Mock = jest.fn(async () => {});
    const recordAsOrdered: jest.Mock = jest.fn(async () => {});

    const outcome: CertificateOrderOutcome =
      await CertificateOrder.orderIfMissing({
        domain: "status.acme.com",
        order: order as never,
        recordAsOrdered: recordAsOrdered as never,
      });

    expect(outcome).toBe(CertificateOrderOutcome.Ordered);
    expect(order).toHaveBeenCalledTimes(1);
    expect(recordAsOrdered).not.toHaveBeenCalled();
    expect(locks.held.size).toBe(0);
    expect(locks.released).toEqual([
      `${CertificateOrder.LOCK_NAMESPACE}-status.acme.com`,
    ]);
  });

  /*
   * The CNAME blip: a check that failed for a moment marked the domain
   * unordered, and it is verified again. Its certificate is still good.
   */
  test("a name that has a certificate is recorded as ordered, never ordered again", async () => {
    useInMemoryLocks();
    useCertificates(new Map([["status.acme.com", IN_SIXTY_DAYS]]));
    const order: jest.Mock = jest.fn(async () => {});
    const recordAsOrdered: jest.Mock = jest.fn(async () => {});

    const outcome: CertificateOrderOutcome =
      await CertificateOrder.orderIfMissing({
        domain: "status.acme.com",
        order: order as never,
        recordAsOrdered: recordAsOrdered as never,
      });

    expect(outcome).toBe(CertificateOrderOutcome.AlreadyIssued);
    expect(order).not.toHaveBeenCalled();
    expect(recordAsOrdered).toHaveBeenCalledTimes(1);
  });

  test("a certificate row without an expiry is no certificate: the name is ordered", async () => {
    useInMemoryLocks();
    useCertificates(new Map([["status.acme.com", null]]));
    const order: jest.Mock = jest.fn(async () => {});

    const outcome: CertificateOrderOutcome =
      await CertificateOrder.orderIfMissing({
        domain: "status.acme.com",
        order: order as never,
        recordAsOrdered: jest.fn(async () => {}) as never,
      });

    expect(outcome).toBe(CertificateOrderOutcome.Ordered);
    expect(order).toHaveBeenCalledTimes(1);
  });

  test("takes the lock on the name without waiting, and for long enough to outlive a slow order", async () => {
    const locks: Locks = useInMemoryLocks();
    useCertificates(new Map());

    await CertificateOrder.orderIfMissing({
      domain: "  Status.ACME.com ",
      order: jest.fn(async () => {}) as never,
      recordAsOrdered: jest.fn(async () => {}) as never,
    });

    expect(locks.calls).toHaveLength(1);
    expect(locks.calls[0]!.key).toBe("status.acme.com");
    expect(locks.calls[0]!.namespace).toBe(CertificateOrder.LOCK_NAMESPACE);
    // One attempt: an order already running is the one we would place.
    expect(locks.calls[0]!.acquireAttemptsLimit).toBe(1);
    expect(locks.calls[0]!.lockTimeout).toBe(
      CertificateOrder.LOCK_TIMEOUT_IN_MS,
    );
    expect(CertificateOrder.LOCK_TIMEOUT_IN_MS).toBeGreaterThanOrEqual(60_000);
    // A lost lock is logged, not thrown from a timer nothing can catch.
    expect(typeof locks.calls[0]!.onLockLost).toBe("function");
    expect(() => {
      locks.calls[0]!.onLockLost!(new Error("lost"));
    }).not.toThrow();
  });

  test("looks the certificate up by the normalized name", async () => {
    useInMemoryLocks();
    const lookups: Array<Array<string>> = useCertificates(
      new Map([["status.acme.com", IN_SIXTY_DAYS]]),
    );

    const outcome: CertificateOrderOutcome =
      await CertificateOrder.orderIfMissing({
        domain: "STATUS.acme.com",
        order: jest.fn(async () => {}) as never,
        recordAsOrdered: jest.fn(async () => {}) as never,
      });

    expect(lookups).toEqual([["status.acme.com"]]);
    expect(outcome).toBe(CertificateOrderOutcome.AlreadyIssued);
  });

  test("a name whose lock is taken is not ordered, looked up or recorded", async () => {
    const locks: Locks = useInMemoryLocks();
    const lookups: Array<Array<string>> = useCertificates(new Map());
    locks.held.add(`${CertificateOrder.LOCK_NAMESPACE}-status.acme.com`);
    const order: jest.Mock = jest.fn(async () => {});
    const recordAsOrdered: jest.Mock = jest.fn(async () => {});

    const outcome: CertificateOrderOutcome =
      await CertificateOrder.orderIfMissing({
        domain: "status.acme.com",
        order: order as never,
        recordAsOrdered: recordAsOrdered as never,
      });

    expect(outcome).toBe(CertificateOrderOutcome.NotOrderedNow);
    expect(order).not.toHaveBeenCalled();
    expect(recordAsOrdered).not.toHaveBeenCalled();
    expect(lookups).toEqual([]);
    // Someone else's lock is not ours to release.
    expect(locks.released).toEqual([]);
  });

  /*
   * Without Redis the order is left to the sweeps: ordering without the lock
   * is exactly what can put two orders on one name.
   */
  test("when the lock cannot be taken at all, nothing is ordered", async () => {
    useInMemoryLocks({ failWith: new Error("Redis client is not connected") });
    useCertificates(new Map());
    const order: jest.Mock = jest.fn(async () => {});

    const outcome: CertificateOrderOutcome =
      await CertificateOrder.orderIfMissing({
        domain: "status.acme.com",
        order: order as never,
        recordAsOrdered: jest.fn(async () => {}) as never,
      });

    expect(outcome).toBe(CertificateOrderOutcome.NotOrderedNow);
    expect(order).not.toHaveBeenCalled();
  });

  test("an order that fails throws to the caller, and the lock is still released", async () => {
    const locks: Locks = useInMemoryLocks();
    useCertificates(new Map());

    await expect(
      CertificateOrder.orderIfMissing({
        domain: "status.acme.com",
        order: jest.fn(async () => {
          throw new Error("CAA record forbids letsencrypt.org");
        }) as never,
        recordAsOrdered: jest.fn(async () => {}) as never,
      }),
    ).rejects.toThrow("CAA record forbids letsencrypt.org");

    expect(locks.held.size).toBe(0);
  });

  test("a release that fails does not fail an order that succeeded", async () => {
    useInMemoryLocks({ failRelease: true });
    useCertificates(new Map());

    await expect(
      CertificateOrder.orderIfMissing({
        domain: "status.acme.com",
        order: jest.fn(async () => {}) as never,
        recordAsOrdered: jest.fn(async () => {}) as never,
      }),
    ).resolves.toBe(CertificateOrderOutcome.Ordered);
  });

  /*
   * Check now and the order sweep, at the same moment, for the same name:
   * one order, not two.
   */
  test("two callers at once: one orders, the other orders nothing", async () => {
    useInMemoryLocks();
    useCertificates(new Map());

    let finishOrder: () => void = (): void => {};
    const orders: Array<string> = [];

    const slowOrder: () => Promise<void> = (): Promise<void> => {
      orders.push("ordered");
      return new Promise<void>((resolve: () => void) => {
        finishOrder = resolve;
      });
    };

    const first: Promise<CertificateOrderOutcome> =
      CertificateOrder.orderIfMissing({
        domain: "status.acme.com",
        order: slowOrder,
        recordAsOrdered: jest.fn(async () => {}) as never,
      });

    // Let the first caller take the lock and start ordering.
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });

    const second: CertificateOrderOutcome =
      await CertificateOrder.orderIfMissing({
        domain: "status.acme.com",
        order: slowOrder,
        recordAsOrdered: jest.fn(async () => {}) as never,
      });

    finishOrder();

    expect(await first).toBe(CertificateOrderOutcome.Ordered);
    expect(second).toBe(CertificateOrderOutcome.NotOrderedNow);
    expect(orders).toEqual(["ordered"]);
  });

  /*
   * The sweep read the domain as unordered before Check now ordered it, and
   * reaches it after the order finished and the lock was released.
   */
  test("one caller after the other: the second finds the certificate the first ordered", async () => {
    useInMemoryLocks();
    const table: Map<string, Date | null> = new Map();
    useCertificates(table);

    const order: jest.Mock = jest.fn(async () => {
      table.set("status.acme.com", IN_SIXTY_DAYS);
    });
    const recordAsOrdered: jest.Mock = jest.fn(async () => {});

    const first: CertificateOrderOutcome =
      await CertificateOrder.orderIfMissing({
        domain: "status.acme.com",
        order: order as never,
        recordAsOrdered: recordAsOrdered as never,
      });

    const second: CertificateOrderOutcome =
      await CertificateOrder.orderIfMissing({
        domain: "status.acme.com",
        order: order as never,
        recordAsOrdered: recordAsOrdered as never,
      });

    expect(first).toBe(CertificateOrderOutcome.Ordered);
    expect(second).toBe(CertificateOrderOutcome.AlreadyIssued);
    expect(order).toHaveBeenCalledTimes(1);
    expect(recordAsOrdered).toHaveBeenCalledTimes(1);
  });

  test("different names do not wait on each other", async () => {
    useInMemoryLocks();
    useCertificates(new Map());

    let finishFirst: () => void = (): void => {};
    const ordered: Array<string> = [];

    const first: Promise<CertificateOrderOutcome> =
      CertificateOrder.orderIfMissing({
        domain: "a.acme.com",
        order: (): Promise<void> => {
          ordered.push("a.acme.com");
          return new Promise<void>((resolve: () => void) => {
            finishFirst = resolve;
          });
        },
        recordAsOrdered: jest.fn(async () => {}) as never,
      });

    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });

    const second: CertificateOrderOutcome =
      await CertificateOrder.orderIfMissing({
        domain: "b.acme.com",
        order: async (): Promise<void> => {
          ordered.push("b.acme.com");
        },
        recordAsOrdered: jest.fn(async () => {}) as never,
      });

    finishFirst();

    expect(await first).toBe(CertificateOrderOutcome.Ordered);
    expect(second).toBe(CertificateOrderOutcome.Ordered);
    expect(ordered).toEqual(["a.acme.com", "b.acme.com"]);
  });
});
