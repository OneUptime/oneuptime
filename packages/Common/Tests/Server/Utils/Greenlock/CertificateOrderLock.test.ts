/**
 * CertificateOrderLock - one certificate order per name at a time, across
 * every replica, for every kind of order.
 *
 * The handle tryLock gives out is what GreenlockUtil.orderCert accepts as
 * proof that its caller holds the name's lock; anything else is refused. So
 * it must be the name it was taken for, normalized, and stop counting once
 * released.
 */

import CertificateOrderLock, {
  CertificateOrderLockHandle,
} from "../../../../Server/Utils/Greenlock/CertificateOrderLock";
import CertificateOrder from "../../../../Server/Utils/Greenlock/CertificateOrder";
import Semaphore, {
  SemaphoreMutex,
} from "../../../../Server/Infrastructure/Semaphore";
import { InMemoryRedis, useInMemoryRedis } from "./InMemoryRedis";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

describe("CertificateOrderLock", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("locks the normalized name, without waiting, for long enough to outlive a slow order", async () => {
    const redis: InMemoryRedis = useInMemoryRedis();

    const lock: CertificateOrderLockHandle | null =
      await CertificateOrderLock.tryLock("  Status.Acme.COM ");

    expect(lock?.domain).toBe("status.acme.com");
    expect(redis.lockRequests).toEqual([
      expect.objectContaining({
        key: "status.acme.com",
        namespace: "CustomDomainCertificateOrder",
        acquireAttemptsLimit: 1,
        lockTimeout: 2 * 60 * 1000,
      }),
    ]);
  });

  /*
   * The namespace is the one CertificateOrder used before every order took
   * the lock, so an order placed by a replica still running the old code
   * during a deploy keeps out a new one for the same name.
   */
  test("keeps the namespace and timeout CertificateOrder has always used", () => {
    expect(CertificateOrder.LOCK_NAMESPACE).toBe(CertificateOrderLock.NAMESPACE);
    expect(CertificateOrder.LOCK_TIMEOUT_IN_MS).toBe(
      CertificateOrderLock.TIMEOUT_IN_MS,
    );
    expect(CertificateOrderLock.NAMESPACE).toBe("CustomDomainCertificateOrder");
  });

  test("a name whose lock is held cannot be locked again until it is released", async () => {
    const redis: InMemoryRedis = useInMemoryRedis();

    const first: CertificateOrderLockHandle | null =
      await CertificateOrderLock.tryLock("status.acme.com");

    expect(first).not.toBeNull();
    expect(await CertificateOrderLock.tryLock("STATUS.acme.com")).toBeNull();
    // Another name is not held up.
    expect(await CertificateOrderLock.tryLock("other.acme.com")).not.toBeNull();

    await CertificateOrderLock.release(first!);

    expect(redis.heldLocks.has("CustomDomainCertificateOrder-status.acme.com")).toBe(
      false,
    );
    expect(await CertificateOrderLock.tryLock("status.acme.com")).not.toBeNull();
  });

  test("a handle holds its own name only, and only until it is released", async () => {
    useInMemoryRedis();

    const lock: CertificateOrderLockHandle | null =
      await CertificateOrderLock.tryLock("status.acme.com");

    expect(CertificateOrderLock.isHeldFor(lock!, "Status.Acme.com")).toBe(true);
    expect(CertificateOrderLock.isHeldFor(lock!, "other.acme.com")).toBe(false);
    expect(
      CertificateOrderLock.isHeldFor(
        { domain: "status.acme.com" } as CertificateOrderLockHandle,
        "status.acme.com",
      ),
    ).toBe(false);
    expect(CertificateOrderLock.isHeldFor(undefined, "status.acme.com")).toBe(
      false,
    );

    await CertificateOrderLock.release(lock!);

    expect(CertificateOrderLock.isHeldFor(lock!, "status.acme.com")).toBe(
      false,
    );
  });

  test("without Redis no lock is taken, so nothing is ordered", async () => {
    const redis: InMemoryRedis = useInMemoryRedis();
    redis.goDown();

    expect(await CertificateOrderLock.tryLock("status.acme.com")).toBeNull();
  });

  test("a release that fails, or a second release, never throws", async () => {
    useInMemoryRedis();

    const lock: CertificateOrderLockHandle | null =
      await CertificateOrderLock.tryLock("status.acme.com");

    jest
      .spyOn(Semaphore, "release")
      .mockImplementation((async (_mutex: SemaphoreMutex) => {
        throw new Error("Valkey went away");
      }) as never);

    await expect(CertificateOrderLock.release(lock!)).resolves.toBeUndefined();
    await expect(CertificateOrderLock.release(lock!)).resolves.toBeUndefined();
  });
});
