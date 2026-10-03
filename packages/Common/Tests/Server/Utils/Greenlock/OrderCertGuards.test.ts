/**
 * GreenlockUtil.orderCert - the one function that orders certificates from
 * Let's Encrypt - and what it guarantees every caller: Check now, the
 * sweeps, the order and reissue APIs, the renewal runs and CoreSSL.
 *
 *   - One order per name at a time: it takes the name's order lock, or
 *     checks that its caller holds it. Reissue SSL used to order without it.
 *   - The installation's Let's Encrypt allowance: each order takes one unit
 *     of CertificateOrderBudget, renewals before new certificates. Each sweep
 *     used to cap only itself, and the caps added up past the account's 300
 *     new orders per three hours.
 *   - A failed CNAME check deletes nothing. It used to remove the name's
 *     certificate by default.
 *   - A failed order is recorded for the Status column and the sweeps' retry
 *     delay; a successful one clears the record.
 *
 * Redis is in memory (InMemoryRedis), the CA is acme-client mocked, and the
 * certificate table is spied on.
 */

import GreenlockUtil from "../../../../Server/Utils/Greenlock/Greenlock";
import CertificateOrderLock, {
  CertificateOrderLockHandle,
} from "../../../../Server/Utils/Greenlock/CertificateOrderLock";
import CertificateOrderBudget, {
  CertificateOrderReason,
} from "../../../../Server/Utils/Greenlock/CertificateOrderBudget";
import CertificateOrderFailures, {
  CertificateOrderFailure,
} from "../../../../Server/Utils/Greenlock/CertificateOrderFailures";
import { CertificateOrderOutcome } from "../../../../Server/Utils/Greenlock/CertificateOrderOutcome";
import AcmeCertificateService from "../../../../Server/Services/AcmeCertificateService";
import OneUptimeDate from "../../../../Types/Date";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { InMemoryRedis, useInMemoryRedis } from "./InMemoryRedis";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

// Names the CA was asked for, in order.
const mockCaOrders: Array<string> = [];

// What the CA does with the next order; by default it issues at once.
let mockAuto: () => Promise<string> = async (): Promise<string> => {
  return "-----BEGIN CERTIFICATE-----\nissued\n-----END CERTIFICATE-----";
};

jest.mock("acme-client", () => {
  return {
    __esModule: true,
    default: {
      Client: class {
        public async auto(): Promise<string> {
          return mockAuto();
        }
      },
      directory: {
        letsencrypt: {
          production: "https://acme.example.com/directory",
        },
      },
      crypto: {
        createCsr: async (data: {
          commonName: string;
        }): Promise<Array<string>> => {
          mockCaOrders.push(data.commonName);
          return ["-----BEGIN PRIVATE KEY-----", "csr"];
        },
        readCertificateInfo: (): { notBefore: Date; notAfter: Date } => {
          return {
            notBefore: new Date("2026-10-01T00:00:00.000Z"),
            notAfter: new Date("2026-12-30T00:00:00.000Z"),
          };
        },
      },
    },
  };
});

jest.mock("../../../../Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("../../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    __esModule: true,
    IsBillingEnabled: false,
    LetsEncryptAccountKey: Buffer.from("account key").toString("base64"),
    LetsEncryptNotificationEmail: "certificates@example.com",
  };
});

const DEFAULT_AUTO: () => Promise<string> = mockAuto;

const NOW: Date = new Date("2026-10-03T12:07:00.000Z");

const DOMAIN: string = "status.acme.com";

const LOCK_KEY: string = `${CertificateOrderLock.NAMESPACE}-${DOMAIN}`;

const BUDGET_KEY: string = `${CertificateOrderBudget.NAMESPACE}-window-${CertificateOrderBudget.getWindowIndex(NOW)}`;

let redis: InMemoryRedis;

// The table the order writes to: it has no row for the name.
function useEmptyCertificateTable(): void {
  jest
    .spyOn(AcmeCertificateService, "findOneBy")
    .mockResolvedValue(null as never);
  jest.spyOn(AcmeCertificateService, "updateBy").mockResolvedValue(0 as never);
  jest
    .spyOn(AcmeCertificateService, "create")
    .mockImplementation((async (createBy: { data: unknown }) => {
      return createBy.data;
    }) as never);
}

function cnameCheck(answer: boolean): {
  check: (domain: string) => Promise<boolean>;
  checked: Array<string>;
} {
  const checked: Array<string> = [];

  return {
    checked: checked,
    check: async (domain: string): Promise<boolean> => {
      checked.push(domain);
      return answer;
    },
  };
}

function budgetTaken(): number {
  return Number(redis.cache.get(BUDGET_KEY) || "0");
}

async function failureOf(
  domain: string,
): Promise<CertificateOrderFailure | undefined> {
  return (await CertificateOrderFailures.get([domain])).get(domain);
}

describe("GreenlockUtil.orderCert", () => {
  beforeEach(() => {
    mockCaOrders.length = 0;
    mockAuto = DEFAULT_AUTO;
    redis = useInMemoryRedis();
    useEmptyCertificateTable();
    jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("one order per name at a time", () => {
    test("takes the name's lock without waiting, and lets go of it after the order", async () => {
      const outcome: CertificateOrderOutcome = await GreenlockUtil.orderCert({
        domain: "Status.Acme.com ",
        reason: CertificateOrderReason.Renewal,
        validateCname: null,
      });

      expect(outcome).toBe(CertificateOrderOutcome.Ordered);
      expect(mockCaOrders).toEqual([DOMAIN]);
      expect(redis.lockRequests).toEqual([
        expect.objectContaining({
          key: DOMAIN,
          namespace: CertificateOrderLock.NAMESPACE,
          acquireAttemptsLimit: 1,
          lockTimeout: CertificateOrderLock.TIMEOUT_IN_MS,
        }),
      ]);
      expect(redis.heldLocks.size).toBe(0);
    });

    /*
     * Regression: a reissue ordered without the lock, beside a Check now or
     * a re-order of the same name - two orders, and two http-01 challenges
     * that remove each other's challenge rows.
     */
    test.each(Object.values(CertificateOrderReason))(
      "a %s order of a name whose lock is taken orders nothing, checks nothing and spends nothing",
      async (reason: CertificateOrderReason) => {
        redis.heldLocks.add(LOCK_KEY);
        const cname: ReturnType<typeof cnameCheck> = cnameCheck(true);

        const outcome: CertificateOrderOutcome = await GreenlockUtil.orderCert(
          {
            domain: DOMAIN,
            reason: reason,
            validateCname: cname.check,
          },
        );

        expect(outcome).toBe(CertificateOrderOutcome.NotOrderedNow);
        expect(mockCaOrders).toEqual([]);
        expect(cname.checked).toEqual([]);
        expect(budgetTaken()).toBe(0);
        expect(await failureOf(DOMAIN)).toBeUndefined();
        // The other order's lock is left alone.
        expect(redis.heldLocks.has(LOCK_KEY)).toBe(true);
      },
    );

    test("orders under the lock its caller hands in, and leaves letting go of it to the caller", async () => {
      const lock: CertificateOrderLockHandle | null =
        await CertificateOrderLock.tryLock(DOMAIN);

      expect(lock).not.toBeNull();

      const outcome: CertificateOrderOutcome = await GreenlockUtil.orderCert({
        domain: DOMAIN,
        reason: CertificateOrderReason.FirstCertificate,
        validateCname: null,
        lock: lock!,
      });

      expect(outcome).toBe(CertificateOrderOutcome.Ordered);
      expect(mockCaOrders).toEqual([DOMAIN]);
      // Only the caller asked for the lock.
      expect(redis.lockRequests).toHaveLength(1);
      expect(redis.heldLocks.has(LOCK_KEY)).toBe(true);

      await CertificateOrderLock.release(lock!);

      expect(redis.heldLocks.size).toBe(0);
    });

    test("a lock handed in for another name, a released one or a made-up one orders nothing", async () => {
      const otherLock: CertificateOrderLockHandle | null =
        await CertificateOrderLock.tryLock("other.acme.com");

      const releasedLock: CertificateOrderLockHandle | null =
        await CertificateOrderLock.tryLock(DOMAIN);
      await CertificateOrderLock.release(releasedLock!);

      for (const lock of [
        otherLock!,
        releasedLock!,
        { domain: DOMAIN } as CertificateOrderLockHandle,
      ]) {
        await expect(
          GreenlockUtil.orderCert({
            domain: DOMAIN,
            reason: CertificateOrderReason.FirstCertificate,
            validateCname: null,
            lock: lock,
          }),
        ).rejects.toThrow(BadDataException);
      }

      expect(mockCaOrders).toEqual([]);
      expect(budgetTaken()).toBe(0);
    });

    test("without Redis nothing is ordered", async () => {
      redis.goDown();

      const outcome: CertificateOrderOutcome = await GreenlockUtil.orderCert({
        domain: DOMAIN,
        reason: CertificateOrderReason.Renewal,
        validateCname: null,
      });

      expect(outcome).toBe(CertificateOrderOutcome.NotOrderedNow);
      expect(mockCaOrders).toEqual([]);
    });
  });

  describe("the CNAME check", () => {
    test("runs before anything is spent, and an order follows when it passes", async () => {
      const cname: ReturnType<typeof cnameCheck> = cnameCheck(true);

      await GreenlockUtil.orderCert({
        domain: DOMAIN,
        reason: CertificateOrderReason.FirstCertificate,
        validateCname: cname.check,
      });

      expect(cname.checked).toEqual([DOMAIN]);
      expect(mockCaOrders).toEqual([DOMAIN]);
    });

    /*
     * Regression: the route, the CNAME sweep and the renewal run check the
     * record, then the order checked it again - one more chance for a DNS
     * blip to refuse an order the first check had allowed.
     */
    test("a caller that has just checked it passes null, and it is not checked again", async () => {
      const outcome: CertificateOrderOutcome = await GreenlockUtil.orderCert({
        domain: DOMAIN,
        reason: CertificateOrderReason.FirstCertificate,
        validateCname: null,
      });

      expect(outcome).toBe(CertificateOrderOutcome.Ordered);
      expect(mockCaOrders).toEqual([DOMAIN]);
    });

    test("one that fails refuses the order, spends nothing, records no failed order and deletes nothing", async () => {
      const deleteSpy: SpyInstance<any> = jest
        .spyOn(AcmeCertificateService, "deleteBy")
        .mockResolvedValue(1 as never);

      await expect(
        GreenlockUtil.orderCert({
          domain: DOMAIN,
          reason: CertificateOrderReason.Renewal,
          validateCname: cnameCheck(false).check,
        }),
      ).rejects.toThrow("Cname is not valid");

      expect(mockCaOrders).toEqual([]);
      expect(budgetTaken()).toBe(0);
      expect(await failureOf(DOMAIN)).toBeUndefined();
      expect(deleteSpy).not.toHaveBeenCalled();
      expect(redis.heldLocks.size).toBe(0);
    });
  });

  describe("the installation's Let's Encrypt budget", () => {
    test("every order takes one unit of this window's budget", async () => {
      await GreenlockUtil.orderCert({
        domain: DOMAIN,
        reason: CertificateOrderReason.FirstCertificate,
        validateCname: null,
      });

      await GreenlockUtil.orderCert({
        domain: "renewed.acme.com",
        reason: CertificateOrderReason.Renewal,
        validateCname: null,
      });

      expect(budgetTaken()).toBe(2);
    });

    test.each([
      [CertificateOrderReason.FirstCertificate],
      [CertificateOrderReason.Reissue],
    ])(
      "a %s order stops at NEW_CERTIFICATE_ORDERS_PER_WINDOW, takes nothing more, and releases the lock",
      async (reason: CertificateOrderReason) => {
        redis.cache.set(
          BUDGET_KEY,
          String(CertificateOrderBudget.NEW_CERTIFICATE_ORDERS_PER_WINDOW),
        );

        const outcome: CertificateOrderOutcome = await GreenlockUtil.orderCert(
          {
            domain: DOMAIN,
            reason: reason,
            validateCname: null,
          },
        );

        expect(outcome).toBe(CertificateOrderOutcome.LimitReached);
        expect(mockCaOrders).toEqual([]);
        expect(budgetTaken()).toBe(
          CertificateOrderBudget.NEW_CERTIFICATE_ORDERS_PER_WINDOW,
        );
        // Used up is not failed: nothing for the Status column to show.
        expect(await failureOf(DOMAIN)).toBeUndefined();
        expect(redis.heldLocks.size).toBe(0);
      },
    );

    test.each([
      [CertificateOrderReason.Renewal],
      [CertificateOrderReason.PrimaryHost],
    ])(
      "a %s order still goes ahead past the new certificates' share, up to ORDERS_PER_WINDOW",
      async (reason: CertificateOrderReason) => {
        redis.cache.set(
          BUDGET_KEY,
          String(CertificateOrderBudget.NEW_CERTIFICATE_ORDERS_PER_WINDOW),
        );

        expect(
          await GreenlockUtil.orderCert({
            domain: DOMAIN,
            reason: reason,
            validateCname: null,
          }),
        ).toBe(CertificateOrderOutcome.Ordered);

        redis.cache.set(
          BUDGET_KEY,
          String(CertificateOrderBudget.ORDERS_PER_WINDOW),
        );

        expect(
          await GreenlockUtil.orderCert({
            domain: "next.acme.com",
            reason: reason,
            validateCname: null,
          }),
        ).toBe(CertificateOrderOutcome.LimitReached);

        expect(mockCaOrders).toEqual([DOMAIN]);
      },
    );

    test("the next window has a new budget", async () => {
      redis.cache.set(BUDGET_KEY, String(CertificateOrderBudget.ORDERS_PER_WINDOW));

      jest
        .spyOn(OneUptimeDate, "getCurrentDate")
        .mockReturnValue(
          new Date(
            NOW.getTime() +
              OneUptimeDate.convertMinutesToMilliseconds(
                CertificateOrderBudget.WINDOW_IN_MINUTES,
              ),
          ),
        );

      expect(
        await GreenlockUtil.orderCert({
          domain: DOMAIN,
          reason: CertificateOrderReason.FirstCertificate,
          validateCname: null,
        }),
      ).toBe(CertificateOrderOutcome.Ordered);
    });
  });

  describe("failed orders", () => {
    test("are recorded, in the words the caller is told, and counted in a row", async () => {
      mockAuto = async (): Promise<string> => {
        throw new Error("urn:ietf:params:acme:error:caa");
      };

      let thrown: Error | null = null;

      try {
        await GreenlockUtil.orderCert({
          domain: DOMAIN,
          reason: CertificateOrderReason.FirstCertificate,
          validateCname: null,
        });
      } catch (err) {
        thrown = err as Error;
      }

      expect(thrown?.message).toContain(
        `Unable to order certificate for ${DOMAIN}`,
      );

      const first: CertificateOrderFailure | undefined =
        await failureOf(DOMAIN);

      expect(first).toEqual({
        error: thrown!.message,
        failedAt: NOW,
        failures: 1,
      });

      await expect(
        GreenlockUtil.orderCert({
          domain: DOMAIN,
          reason: CertificateOrderReason.Renewal,
          validateCname: null,
        }),
      ).rejects.toThrow();

      expect((await failureOf(DOMAIN))?.failures).toBe(2);
      // A failed order still counted against the account.
      expect(budgetTaken()).toBe(2);
      expect(redis.heldLocks.size).toBe(0);
    });

    test("an order that succeeds clears the record", async () => {
      await CertificateOrderFailures.record({
        domain: DOMAIN,
        error: "Unable to order certificate",
        now: NOW,
      });

      expect(await failureOf(DOMAIN)).toBeDefined();

      await GreenlockUtil.orderCert({
        domain: DOMAIN,
        reason: CertificateOrderReason.FirstCertificate,
        validateCname: null,
      });

      expect(await failureOf(DOMAIN)).toBeUndefined();
    });
  });
});
