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
  CustomDomainCertificateState,
} from "../../../../Server/Utils/Greenlock/CertificateOrder";
import CertificateOrderLock, {
  CertificateOrderLockHandle,
} from "../../../../Server/Utils/Greenlock/CertificateOrderLock";
import CertificateOrderFailures from "../../../../Server/Utils/Greenlock/CertificateOrderFailures";
import GreenlockUtil from "../../../../Server/Utils/Greenlock/Greenlock";
import { useInMemoryRedis } from "./InMemoryRedis";
import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import Semaphore, {
  SemaphoreLockTimeoutError,
  SemaphoreMutex,
} from "../../../../Server/Infrastructure/Semaphore";
import AcmeCertificate from "../../../../Models/DatabaseModels/AcmeCertificate";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { Mock } from "jest-mock";

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
    const order: Mock<() => Promise<void>> = jest.fn(async () => {});
    const recordAsOrdered: Mock<() => Promise<void>> = jest.fn(async () => {});

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
    const order: Mock<() => Promise<void>> = jest.fn(async () => {});
    const recordAsOrdered: Mock<() => Promise<void>> = jest.fn(async () => {});

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
    const order: Mock<() => Promise<void>> = jest.fn(async () => {});

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
    const order: Mock<() => Promise<void>> = jest.fn(async () => {});
    const recordAsOrdered: Mock<() => Promise<void>> = jest.fn(async () => {});

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
    const order: Mock<() => Promise<void>> = jest.fn(async () => {});

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

    const order: Mock<() => Promise<void>> = jest.fn(async () => {
      table.set("status.acme.com", IN_SIXTY_DAYS);
    });
    const recordAsOrdered: Mock<() => Promise<void>> = jest.fn(async () => {});

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

describe("CertificateOrder.orderIfMissing with a budget", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("asks mayOrder only when an order is about to be placed, and orders when it says yes", async () => {
    useInMemoryLocks();
    useCertificates(new Map());
    const order: Mock<() => Promise<void>> = jest.fn(async () => {});
    const mayOrder: Mock<() => Promise<boolean>> = jest.fn(async () => {
      return true;
    });

    const outcome: CertificateOrderOutcome =
      await CertificateOrder.orderIfMissing({
        domain: "status.acme.com",
        order: order as never,
        recordAsOrdered: jest.fn(async () => {}) as never,
        mayOrder: mayOrder as never,
      });

    expect(outcome).toBe(CertificateOrderOutcome.Ordered);
    expect(mayOrder).toHaveBeenCalledTimes(1);
    expect(order).toHaveBeenCalledTimes(1);
  });

  test("a spent budget orders nothing, says so, and releases the lock", async () => {
    const locks: Locks = useInMemoryLocks();
    useCertificates(new Map());
    const order: Mock<() => Promise<void>> = jest.fn(async () => {});

    const outcome: CertificateOrderOutcome =
      await CertificateOrder.orderIfMissing({
        domain: "status.acme.com",
        order: order as never,
        recordAsOrdered: jest.fn(async () => {}) as never,
        mayOrder: (async (): Promise<boolean> => {
          return false;
        }) as never,
      });

    expect(outcome).toBe(CertificateOrderOutcome.LimitReached);
    expect(order).not.toHaveBeenCalled();
    expect(locks.held.size).toBe(0);
  });

  // Recording an existing certificate costs no order, so it takes no budget.
  test("a name that has a certificate never asks the budget", async () => {
    useInMemoryLocks();
    useCertificates(new Map([["status.acme.com", IN_SIXTY_DAYS]]));
    const mayOrder: Mock<() => Promise<boolean>> = jest.fn(async () => {
      return true;
    });

    await CertificateOrder.orderIfMissing({
      domain: "status.acme.com",
      order: jest.fn(async () => {}) as never,
      recordAsOrdered: jest.fn(async () => {}) as never,
      mayOrder: mayOrder as never,
    });

    expect(mayOrder).not.toHaveBeenCalled();
  });
});

describe("CertificateOrder.orderIfMissing and the order it places", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * The order goes on under the lock orderIfMissing holds: GreenlockUtil
   * .orderCert is handed it, rather than taking it again - which would find
   * it held, by its own caller, and order nothing.
   */
  test("hands the order the name's lock, held while it orders", async () => {
    useInMemoryRedis();
    useCertificates(new Map());

    let handed: CertificateOrderLockHandle | undefined = undefined;
    let heldDuringTheOrder: boolean = false;

    await CertificateOrder.orderIfMissing({
      domain: "Status.Acme.com",
      recordAsOrdered: jest.fn(async () => {}) as never,
      order: async (lock: CertificateOrderLockHandle): Promise<void> => {
        handed = lock;
        heldDuringTheOrder = CertificateOrderLock.isHeldFor(
          lock,
          "status.acme.com",
        );
      },
    });

    expect(heldDuringTheOrder).toBe(true);
    // Released once the order is done.
    expect(
      CertificateOrderLock.isHeldFor(handed!, "status.acme.com"),
    ).toBe(false);
  });

  test("answers with what the order answers: an order the account's budget refused is LimitReached", async () => {
    useInMemoryRedis();
    useCertificates(new Map());

    expect(
      await CertificateOrder.orderIfMissing({
        domain: "status.acme.com",
        recordAsOrdered: jest.fn(async () => {}) as never,
        order: async (): Promise<CertificateOrderOutcome> => {
          return CertificateOrderOutcome.LimitReached;
        },
      }),
    ).toBe(CertificateOrderOutcome.LimitReached);
  });

  test("an expired certificate is recorded and left to the renewal run, unless renewIfExpired asks for an order", async () => {
    useInMemoryRedis();
    useCertificates(
      new Map([["status.acme.com", new Date(Date.now() - 24 * 3600 * 1000)]]),
    );

    const order: Mock<() => Promise<void>> = jest.fn(async () => {});
    const recordAsOrdered: Mock<() => Promise<void>> = jest.fn(async () => {});

    expect(
      await CertificateOrder.orderIfMissing({
        domain: "status.acme.com",
        order: order as never,
        recordAsOrdered: recordAsOrdered as never,
      }),
    ).toBe(CertificateOrderOutcome.AlreadyIssued);
    expect(order).not.toHaveBeenCalled();

    expect(
      await CertificateOrder.orderIfMissing({
        domain: "status.acme.com",
        order: order as never,
        recordAsOrdered: recordAsOrdered as never,
        renewIfExpired: true,
      }),
    ).toBe(CertificateOrderOutcome.Ordered);
    expect(order).toHaveBeenCalledTimes(1);
    expect(recordAsOrdered).toHaveBeenCalledTimes(1);
  });

  test("renewIfExpired still records a certificate that has not expired", async () => {
    useInMemoryRedis();
    useCertificates(new Map([["status.acme.com", IN_SIXTY_DAYS]]));
    const order: Mock<() => Promise<void>> = jest.fn(async () => {});

    expect(
      await CertificateOrder.orderIfMissing({
        domain: "status.acme.com",
        order: order as never,
        recordAsOrdered: jest.fn(async () => {}) as never,
        renewIfExpired: true,
      }),
    ).toBe(CertificateOrderOutcome.AlreadyIssued);
    expect(order).not.toHaveBeenCalled();
  });
});

describe("CertificateOrder on-demand budget", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * Each domain has a window of its own for orders somebody asks for; this
   * bounds them across every domain, so clicking through many failing
   * domains cannot use up the new certificates of the whole installation.
   */
  test("gives out ON_DEMAND_ORDERS_PER_WINDOW orders on demand in a window, across every domain", async () => {
    useInMemoryRedis();

    const now: Date = new Date("2026-10-03T12:00:00.000Z");
    const answers: Array<boolean> = [];

    for (let i: number = 0; i < 10; i++) {
      answers.push(await CertificateOrder.takeOnDemandOrderSlot(now));
    }

    expect(CertificateOrder.ON_DEMAND_ORDERS_PER_WINDOW).toBe(6);
    expect(answers).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
      false,
      false,
      false,
      false,
    ]);

    // The next window has new ones.
    expect(
      await CertificateOrder.takeOnDemandOrderSlot(
        new Date(now.getTime() + 15 * 60 * 1000),
      ),
    ).toBe(true);
  });
});

describe("CertificateOrder.getCertificateStates", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("each name's certificate expiry and last failed order, in two lookups", async () => {
    useInMemoryRedis();
    const lookups: Array<Array<string>> = useCertificates(
      new Map([["issued.acme.com", IN_SIXTY_DAYS]]),
    );

    const failedAt: Date = new Date("2026-10-03T11:00:00.000Z");

    await CertificateOrderFailures.record({
      domain: "failing.acme.com",
      error: "Unable to order certificate for failing.acme.com.",
      now: failedAt,
    });

    const states: Map<string, CustomDomainCertificateState> =
      await CertificateOrder.getCertificateStates([
        "Issued.Acme.com",
        "failing.acme.com",
        "new.acme.com",
        "",
      ]);

    expect(lookups).toEqual([
      ["issued.acme.com", "failing.acme.com", "new.acme.com"],
    ]);
    expect(states.get("issued.acme.com")).toEqual({
      certificateExpiresAt: IN_SIXTY_DAYS,
      lastOrderError: undefined,
      lastOrderFailedAt: undefined,
    });
    expect(states.get("failing.acme.com")).toEqual({
      certificateExpiresAt: undefined,
      lastOrderError: "Unable to order certificate for failing.acme.com.",
      lastOrderFailedAt: failedAt,
    });
    expect(states.get("new.acme.com")).toEqual({
      certificateExpiresAt: undefined,
      lastOrderError: undefined,
      lastOrderFailedAt: undefined,
    });
  });

  test("asked about nothing, it looks nothing up", async () => {
    useInMemoryRedis();
    const lookups: Array<Array<string>> = useCertificates(new Map());

    expect((await CertificateOrder.getCertificateStates([""])).size).toBe(0);
    expect(lookups).toEqual([]);
  });
});

describe("CertificateOrder.takeOrderSlot", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  type Increment = { namespace: string; key: string; expiresInSeconds: number };

  function useInMemoryCounters(): Array<Increment> {
    const counters: Map<string, number> = new Map();
    const increments: Array<Increment> = [];

    jest.spyOn(GlobalCache, "incrementWithExpiry").mockImplementation((async (
      namespace: string,
      key: string,
      options: { expiresInSeconds: number },
    ): Promise<number> => {
      increments.push({
        namespace,
        key,
        expiresInSeconds: options.expiresInSeconds,
      });

      const fullKey: string = `${namespace}-${key}`;
      const count: number = (counters.get(fullKey) || 0) + 1;
      counters.set(fullKey, count);
      return count;
    }) as never);

    return increments;
  }

  const WINDOW_START: Date = new Date(1_800_000_000_000);

  test("gives out maxPerWindow orders in a window, and no more", async () => {
    useInMemoryCounters();

    const taken: Array<boolean> = [];

    for (let i: number = 0; i < 7; i++) {
      taken.push(
        await CertificateOrder.takeOrderSlot({
          budget: "Sweeps",
          maxPerWindow: 5,
          now: WINDOW_START,
        }),
      );
    }

    expect(taken).toEqual([true, true, true, true, true, false, false]);
  });

  test("a new 15-minute window has a new budget, and budgets do not share", async () => {
    const increments: Array<Increment> = useInMemoryCounters();

    for (let i: number = 0; i < 5; i++) {
      await CertificateOrder.takeOrderSlot({
        budget: "Sweeps",
        maxPerWindow: 5,
        now: WINDOW_START,
      });
    }

    expect(
      await CertificateOrder.takeOrderSlot({
        budget: "Sweeps",
        maxPerWindow: 5,
        now: new Date(WINDOW_START.getTime() + 15 * 60 * 1000),
      }),
    ).toBe(true);
    expect(
      await CertificateOrder.takeOrderSlot({
        budget: "Other",
        maxPerWindow: 5,
        now: WINDOW_START,
      }),
    ).toBe(true);

    expect(increments[0]!.namespace).toBe(
      CertificateOrder.ORDER_BUDGET_NAMESPACE,
    );
    // Outlives its window, so no replica's clock can read a fresh counter.
    expect(increments[0]!.expiresInSeconds).toBeGreaterThanOrEqual(15 * 60);
  });

  test("without the cache it gives out nothing", async () => {
    jest
      .spyOn(GlobalCache, "incrementWithExpiry")
      .mockRejectedValue(new Error("Cache is not connected") as never);

    expect(
      await CertificateOrder.takeOrderSlot({
        budget: "Sweeps",
        maxPerWindow: 5,
        now: WINDOW_START,
      }),
    ).toBe(false);
  });
});

/*
 * The on-demand order window behind Check now: one order per domain per
 * ON_DEMAND_ORDER_WINDOW_IN_MINUTES, claimed with SET NX, and the last
 * failure kept for the clicks after it.
 */
describe("CertificateOrder on-demand order window", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  type CacheCall = {
    namespace: string;
    key: string;
    expiresInSeconds?: number | undefined;
  };

  type Cache = {
    claims: Array<CacheCall>;
    writes: Array<CacheCall>;
  };

  function useInMemoryCache(): Cache {
    const store: Map<string, string> = new Map();
    const cache: Cache = { claims: [], writes: [] };

    jest.spyOn(GlobalCache, "setStringIfNotExists").mockImplementation((async (
      namespace: string,
      key: string,
      value: string,
      options?: { expiresInSeconds?: number },
    ): Promise<boolean> => {
      cache.claims.push({
        namespace,
        key,
        expiresInSeconds: options?.expiresInSeconds,
      });

      const fullKey: string = namespace + "-" + key;

      if (store.has(fullKey)) {
        return false;
      }

      store.set(fullKey, value);
      return true;
    }) as never);

    jest.spyOn(GlobalCache, "getString").mockImplementation((async (
      namespace: string,
      key: string,
    ) => {
      return store.get(namespace + "-" + key) ?? null;
    }) as never);

    jest.spyOn(GlobalCache, "setString").mockImplementation((async (
      namespace: string,
      key: string,
      value: string,
      options?: { expiresInSeconds?: number },
    ): Promise<void> => {
      cache.writes.push({
        namespace,
        key,
        expiresInSeconds: options?.expiresInSeconds,
      });
      store.set(namespace + "-" + key, value);
    }) as never);

    return cache;
  }

  test("the first claim of a window may order; the next ones may not", async () => {
    const cache: Cache = useInMemoryCache();

    expect(
      await CertificateOrder.claimOnDemandOrder("Status.Acme.com"),
    ).toEqual({ mayOrder: true });
    expect(
      await CertificateOrder.claimOnDemandOrder("status.acme.com"),
    ).toEqual({ mayOrder: false });

    // One key per normalized name, expiring with the window.
    expect(cache.claims[0]!.key).toBe("status.acme.com");
    expect(cache.claims[0]!.namespace).toBe(
      CertificateOrder.ON_DEMAND_ORDER_NAMESPACE,
    );
    expect(cache.claims[0]!.expiresInSeconds).toBe(
      CertificateOrder.ON_DEMAND_ORDER_WINDOW_IN_MINUTES * 60,
    );
    expect(CertificateOrder.ON_DEMAND_ORDER_WINDOW_IN_MINUTES).toBe(15);
  });

  test("a failure recorded in the window is what the next claims report", async () => {
    const cache: Cache = useInMemoryCache();

    await CertificateOrder.claimOnDemandOrder("status.acme.com");
    await CertificateOrder.recordOnDemandOrderFailure(
      "status.acme.com",
      "CAA record forbids letsencrypt.org",
    );

    expect(
      await CertificateOrder.claimOnDemandOrder("status.acme.com"),
    ).toEqual({
      mayOrder: false,
      lastError: "CAA record forbids letsencrypt.org",
    });
    expect(cache.writes[0]!.expiresInSeconds).toBe(
      CertificateOrder.ON_DEMAND_ORDER_WINDOW_IN_MINUTES * 60,
    );
  });

  test("windows are per domain", async () => {
    useInMemoryCache();

    expect(await CertificateOrder.claimOnDemandOrder("a.acme.com")).toEqual({
      mayOrder: true,
    });
    expect(await CertificateOrder.claimOnDemandOrder("b.acme.com")).toEqual({
      mayOrder: true,
    });
  });

  test("without the cache nothing is ordered on demand", async () => {
    jest
      .spyOn(GlobalCache, "setStringIfNotExists")
      .mockRejectedValue(new Error("Cache is not connected") as never);

    expect(
      await CertificateOrder.claimOnDemandOrder("status.acme.com"),
    ).toEqual({ mayOrder: false });
  });

  test("recording a failure never throws, even without the cache", async () => {
    jest
      .spyOn(GlobalCache, "setString")
      .mockRejectedValue(new Error("Cache is not connected") as never);

    await expect(
      CertificateOrder.recordOnDemandOrderFailure("status.acme.com", "x"),
    ).resolves.toBeUndefined();
  });
});
