/**
 * A renewal run never costs a domain its working certificate, and never
 * orders more than it must.
 *
 *   - A CNAME check that fails while the certificate is still valid keeps the
 *     certificate; the renewal is tried again on a later run. It used to
 *     remove it, so a moment's DNS trouble during a renewal took the domain
 *     off HTTPS with weeks left to run. Only an expired certificate - it
 *     serves nobody - is removed when the check fails.
 *   - The CNAME is checked once per renewal. The run checked it, then the
 *     order checked it again.
 *   - Each renewal runs under the name's order lock, and looks the
 *     certificate up again under it: a reissue or re-order of the same name
 *     may be running, or have just renewed it.
 *   - A name whose renewals keep failing waits longer after each failure in
 *     a row instead of taking a slot in every run.
 *
 * The table is a spy, Redis is in memory, and orderCert only records what it
 * is asked.
 */

import GreenlockUtil from "../../../../Server/Utils/Greenlock/Greenlock";
import CertificateOrderLock from "../../../../Server/Utils/Greenlock/CertificateOrderLock";
import CertificateOrderFailures from "../../../../Server/Utils/Greenlock/CertificateOrderFailures";
import { CertificateOrderReason } from "../../../../Server/Utils/Greenlock/CertificateOrderBudget";
import { CertificateOrderOutcome } from "../../../../Server/Utils/Greenlock/CertificateOrderOutcome";
import AcmeCertificateService from "../../../../Server/Services/AcmeCertificateService";
import QueryHelper from "../../../../Server/Types/Database/QueryHelper";
import AcmeCertificate from "../../../../Models/DatabaseModels/AcmeCertificate";
import OneUptimeDate from "../../../../Types/Date";
import { InMemoryRedis, useInMemoryRedis } from "./InMemoryRedis";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

type OrderCall = {
  domain: string;
  reason: CertificateOrderReason;
  validateCname: unknown;
  heldLock: boolean;
};

type Run = {
  // The certificate table: name -> expiry.
  table: Map<string, Date>;
  orders: Array<OrderCall>;
  removed: Array<string>;
  notified: Array<string>;
  cnameChecks: Array<string>;
  brokenCnames: Set<string>;
  redis: InMemoryRedis;
};

const NOW: Date = new Date("2026-10-03T12:00:00.000Z");

function inDays(days: number): Date {
  return OneUptimeDate.addRemoveDays(NOW, days);
}

function setUpRun(certificates: Record<string, number>): Run {
  const run: Run = {
    table: new Map<string, Date>(
      Object.entries(certificates).map(([domain, days]: [string, number]) => {
        return [domain, inDays(days)];
      }),
    ),
    orders: [],
    removed: [],
    notified: [],
    cnameChecks: [],
    brokenCnames: new Set<string>(),
    redis: useInMemoryRedis(),
  };

  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);

  jest.spyOn(QueryHelper, "any").mockImplementation(((
    values: Array<string>,
  ) => {
    return { inList: values.map(String) };
  }) as never);

  // The due rows by expiry, or a lookup by name.
  jest
    .spyOn(AcmeCertificateService, "findBy")
    .mockImplementation((async (call: {
      query: { domain?: { inList: Array<string> } };
      skip?: number;
    }) => {
      if (call.skip) {
        return [];
      }

      return [...run.table.entries()]
        .filter(([domain]: [string, Date]) => {
          return !call.query.domain || call.query.domain.inList.includes(domain);
        })
        .sort((a: [string, Date], b: [string, Date]) => {
          return a[1].getTime() - b[1].getTime();
        })
        .map(([domain, expiresAt]: [string, Date]) => {
          return { domain, expiresAt } as unknown as AcmeCertificate;
        });
    }) as never);

  jest
    .spyOn(AcmeCertificateService, "deleteBy")
    .mockImplementation((async (call: { query: { domain: string } }) => {
      run.removed.push(call.query.domain);
      run.table.delete(call.query.domain);
      return 1;
    }) as never);

  jest
    .spyOn(GreenlockUtil, "orderCert")
    .mockImplementation(
      async (data: {
        domain: string;
        reason: CertificateOrderReason;
        validateCname: unknown;
        lock?: unknown;
      }): Promise<CertificateOrderOutcome> => {
        run.orders.push({
          domain: data.domain,
          reason: data.reason,
          validateCname: data.validateCname,
          heldLock: CertificateOrderLock.isHeldFor(
            data.lock as never,
            data.domain,
          ),
        });
        run.table.set(data.domain, inDays(90));
        return CertificateOrderOutcome.Ordered;
      },
    );

  return run;
}

async function renew(run: Run): Promise<void> {
  await GreenlockUtil.renewAllCertsWhichAreExpiringSoon({
    getOwnedDomains: async (domains: Array<string>) => {
      return domains;
    },
    validateCname: async (domain: string): Promise<boolean> => {
      run.cnameChecks.push(domain);
      return !run.brokenCnames.has(domain);
    },
    notifyDomainRemoved: async (domain: string): Promise<void> => {
      run.notified.push(domain);
    },
  });
}

function orderedDomains(run: Run): Array<string> {
  return run.orders
    .map((order: OrderCall) => {
      return order.domain;
    })
    .sort();
}

describe("a renewal run", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("renews under the name's lock, as a renewal, with the CNAME checked once", async () => {
    const run: Run = setUpRun({ "status.acme.com": 3 });

    await renew(run);

    expect(run.orders).toEqual([
      {
        domain: "status.acme.com",
        reason: CertificateOrderReason.Renewal,
        validateCname: null,
        heldLock: true,
      },
    ]);
    expect(run.cnameChecks).toEqual(["status.acme.com"]);
    expect(run.redis.heldLocks.size).toBe(0);
  });

  test("a CNAME check that fails while the certificate is valid keeps it, and a later run renews it", async () => {
    const run: Run = setUpRun({ "status.acme.com": 3, "other.acme.com": 4 });
    run.brokenCnames.add("status.acme.com");

    await renew(run);

    expect(run.removed).toEqual([]);
    expect(run.notified).toEqual([]);
    expect(orderedDomains(run)).toEqual(["other.acme.com"]);
    expect(run.table.get("status.acme.com")).toEqual(inDays(3));

    run.brokenCnames.clear();
    await renew(run);

    expect(orderedDomains(run)).toEqual(["other.acme.com", "status.acme.com"]);
  });

  test("a CNAME check that fails on an expired certificate removes it, and tells its owner", async () => {
    const run: Run = setUpRun({ "status.acme.com": -2 });
    run.brokenCnames.add("status.acme.com");

    await renew(run);

    expect(run.removed).toEqual(["status.acme.com"]);
    expect(run.notified).toEqual(["status.acme.com"]);
    expect(run.orders).toEqual([]);
  });

  test("a name being ordered right now - a reissue, a Check now - is left to a later run", async () => {
    const run: Run = setUpRun({ "status.acme.com": 3, "other.acme.com": 4 });
    run.redis.heldLocks.add(
      `${CertificateOrderLock.NAMESPACE}-status.acme.com`,
    );

    await renew(run);

    expect(orderedDomains(run)).toEqual(["other.acme.com"]);
    expect(run.cnameChecks).toEqual(["other.acme.com"]);
    // The other order's lock is left alone.
    expect(
      run.redis.heldLocks.has(
        `${CertificateOrderLock.NAMESPACE}-status.acme.com`,
      ),
    ).toBe(true);
  });

  test("a certificate another order renewed since the run read the table is not renewed again", async () => {
    const run: Run = setUpRun({ "status.acme.com": 3 });

    const findBy: (call: unknown) => Promise<unknown> = (
      AcmeCertificateService.findBy as unknown as {
        getMockImplementation: () => (call: unknown) => Promise<unknown>;
      }
    ).getMockImplementation();

    // The run reads the due rows; a reissue renews the name; then the lookup under the lock.
    jest
      .spyOn(AcmeCertificateService, "findBy")
      .mockImplementation((async (call: {
        query: { domain?: unknown };
      }) => {
        if (call.query.domain) {
          run.table.set("status.acme.com", inDays(90));
        }

        return await findBy(call);
      }) as never);

    await renew(run);

    expect(run.orders).toEqual([]);
    expect(run.cnameChecks).toEqual([]);
  });

  test("a name whose renewal just failed waits, and does not take a slot from the others", async () => {
    const domains: Record<string, number> = {};

    for (let i: number = 0; i <= GreenlockUtil.RENEW_MAX_PER_RUN; i++) {
      domains[`status${String(i).padStart(2, "0")}.acme.com`] = 1 + i;
    }

    const run: Run = setUpRun(domains);

    // The one closest to expiry failed a moment ago.
    await CertificateOrderFailures.record({
      domain: "status00.acme.com",
      error: "Unable to order certificate for status00.acme.com.",
      now: NOW,
    });

    await renew(run);

    expect(run.orders).toHaveLength(GreenlockUtil.RENEW_MAX_PER_RUN);
    expect(orderedDomains(run)).not.toContain("status00.acme.com");

    // Once its delay is up, it is renewed first again.
    jest
      .spyOn(OneUptimeDate, "getCurrentDate")
      .mockReturnValue(OneUptimeDate.addRemoveMinutes(NOW, 15));
    run.orders.length = 0;

    await renew(run);

    expect(orderedDomains(run)).toContain("status00.acme.com");
  });
});
