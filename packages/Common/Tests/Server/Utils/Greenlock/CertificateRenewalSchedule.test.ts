/**
 * Regression tests for status page certificate renewal scheduling.
 *
 * These pin the two properties whose absence let customer status pages serve
 * expired certificates:
 *
 * - Renewal must be PROACTIVE. A run picks up a certificate weeks before it
 *   expires. Previously renewal ran once a day over every certificate inside a
 *   fixed window, strictly one domain at a time; once the fleet outgrew a
 *   single run the queue stopped draining, and certificates were reordered only
 *   after they had already expired and the provisioning sweep noticed the page
 *   was serving a dead certificate.
 *
 * - Renewal must be SPREAD OUT. Let's Encrypt issues for 90 days, so domains
 *   ordered together expire together. With one fixed lead time that batch stays
 *   together forever and one bad run expires all of it at once. The lead time
 *   is jittered per domain so batches disperse.
 *
 * A run is also capped, because the CA rate-limits new orders per account and
 * the reactive sweep spends from the same allowance.
 *
 * AcmeCertificateService.findBy is spied on, so no database is touched, and
 * orderCert is spied on so no ACME order is ever attempted. Every run here
 * owns every certificate it is shown; which certificates a run may touch at
 * all is pinned in CertificateRenewalOwnership.test.ts.
 */

import GreenlockUtil from "../../../../Server/Utils/Greenlock/Greenlock";
import AcmeCertificateService from "../../../../Server/Services/AcmeCertificateService";
import AcmeCertificate from "../../../../Models/DatabaseModels/AcmeCertificate";
import OneUptimeDate from "../../../../Types/Date";
import { afterEach, describe, expect, test, jest } from "@jest/globals";

function certificateExpiringInDays(
  domain: string,
  days: number,
): AcmeCertificate {
  return {
    domain: domain,
    expiresAt: OneUptimeDate.addRemoveDays(
      OneUptimeDate.getCurrentDate(),
      days,
    ),
  } as unknown as AcmeCertificate;
}

// The caller owns every domain it is asked about.
async function ownsEveryDomain(domains: Array<string>): Promise<Array<string>> {
  return domains;
}

/*
 * Drive a renewal run over a fixed set of certificates and report which domains
 * it actually tried to order. The CNAME check is stubbed valid so the run
 * reaches the order step for every domain it selects.
 */
async function domainsRenewedFor(
  certificates: Array<AcmeCertificate>,
): Promise<Array<string>> {
  const ordered: Array<string> = [];

  jest
    .spyOn(AcmeCertificateService, "findBy")
    .mockResolvedValue(certificates as never);

  jest
    .spyOn(GreenlockUtil, "orderCert")
    .mockImplementation(async (data: { domain: string }): Promise<void> => {
      ordered.push(data.domain);
    });

  await GreenlockUtil.renewAllCertsWhichAreExpiringSoon({
    getOwnedDomains: ownsEveryDomain,
    validateCname: async (): Promise<boolean> => {
      return true;
    },
    notifyDomainRemoved: async (): Promise<void> => {
      return undefined;
    },
  });

  return ordered;
}

describe("Certificate renewal lead time", () => {
  test("every domain renews well before it expires", () => {
    const domains: Array<string> = [
      "status.aleyant.com",
      "status.example.com",
      "a.status.syniti.com",
      "b.status.avsw.io",
      "x",
      "",
    ];

    for (const domain of domains) {
      const leadTime: number = GreenlockUtil.getRenewalLeadTimeInDays(domain);

      expect(leadTime).toBeGreaterThanOrEqual(
        GreenlockUtil.RENEW_LEAD_TIME_MIN_IN_DAYS,
      );
      expect(leadTime).toBeLessThanOrEqual(
        GreenlockUtil.RENEW_LEAD_TIME_MAX_IN_DAYS,
      );
    }
  });

  test("the shortest possible lead time still leaves days of margin", () => {
    /*
     * The whole point is that renewal happens before expiry, not at it. Even
     * the least eager domain must have room for several failed runs.
     */
    expect(GreenlockUtil.RENEW_LEAD_TIME_MIN_IN_DAYS).toBeGreaterThanOrEqual(7);
  });

  test("a domain's lead time is stable across calls", () => {
    const first: number =
      GreenlockUtil.getRenewalLeadTimeInDays("status.aleyant.com");
    const second: number =
      GreenlockUtil.getRenewalLeadTimeInDays("status.aleyant.com");

    expect(first).toBe(second);
  });

  test("domains expiring on the same day do not all come due on the same day", () => {
    /*
     * The thundering herd: a batch ordered together must not renew together.
     */
    const leadTimes: Set<number> = new Set<number>();

    for (let i: number = 0; i < 200; i++) {
      leadTimes.add(
        GreenlockUtil.getRenewalLeadTimeInDays(`status${i}.example.com`),
      );
    }

    expect(leadTimes.size).toBeGreaterThan(1);
  });
});

describe("Certificate renewal run", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("renews a certificate that is close to expiry", async () => {
    const domain: string = "status.aleyant.com";

    // one day left: due under any lead time in the range.
    const renewed: Array<string> = await domainsRenewedFor([
      certificateExpiringInDays(domain, 1),
    ]);

    expect(renewed).toEqual([domain]);
  });

  test("renews before expiry rather than after it", async () => {
    /*
     * This is the regression. A certificate with three weeks of life left is
     * inside every domain's lead time, so a run must pick it up now - not wait
     * until it has expired and the page is already broken.
     */
    const domain: string = "status.aleyant.com";

    const renewed: Array<string> = await domainsRenewedFor([
      certificateExpiringInDays(domain, 21),
    ]);

    expect(renewed).toEqual([domain]);
  });

  test("leaves a freshly issued certificate alone", async () => {
    const renewed: Array<string> = await domainsRenewedFor([
      certificateExpiringInDays("status.aleyant.com", 89),
    ]);

    expect(renewed).toEqual([]);
  });

  test("caps how many certificates one run orders", async () => {
    /*
     * A large backlog must not be dispatched as a single burst - the CA
     * rate-limits new orders per account, and orders refused for rate limiting
     * are renewals that did not happen.
     */
    const certificates: Array<AcmeCertificate> = Array.from(
      { length: GreenlockUtil.RENEW_MAX_PER_RUN + 25 },
      (_v: unknown, i: number) => {
        return certificateExpiringInDays(`status${i}.example.com`, 1);
      },
    );

    const renewed: Array<string> = await domainsRenewedFor(certificates);

    expect(renewed).toHaveLength(GreenlockUtil.RENEW_MAX_PER_RUN);
  });

  test("spends a capped run on the certificates closest to expiring", async () => {
    /*
     * findBy returns rows sorted by expiry, and the cap is applied after the
     * due filter - so the domains at the edge of expiry must be the ones a
     * short run pays for, never the ones with weeks left.
     */
    const urgent: Array<AcmeCertificate> = Array.from(
      { length: GreenlockUtil.RENEW_MAX_PER_RUN },
      (_v: unknown, i: number) => {
        return certificateExpiringInDays(`urgent${i}.example.com`, 1);
      },
    );

    const lessUrgent: Array<AcmeCertificate> = Array.from(
      { length: 10 },
      (_v: unknown, i: number) => {
        return certificateExpiringInDays(`later${i}.example.com`, 24);
      },
    );

    const renewed: Array<string> = await domainsRenewedFor([
      ...urgent,
      ...lessUrgent,
    ]);

    for (const domain of renewed) {
      expect(domain.startsWith("urgent")).toBe(true);
    }
  });

  test("one domain that cannot be renewed does not abandon the rest of the run", async () => {
    const ordered: Array<string> = [];

    jest
      .spyOn(AcmeCertificateService, "findBy")
      .mockResolvedValue([
        certificateExpiringInDays("broken.example.com", 1),
        certificateExpiringInDays("healthy.example.com", 1),
      ] as never);

    jest
      .spyOn(GreenlockUtil, "orderCert")
      .mockImplementation(async (data: { domain: string }): Promise<void> => {
        if (data.domain === "broken.example.com") {
          throw new Error("CA refused the order");
        }
        ordered.push(data.domain);
      });

    await GreenlockUtil.renewAllCertsWhichAreExpiringSoon({
      getOwnedDomains: ownsEveryDomain,
      validateCname: async (): Promise<boolean> => {
        return true;
      },
      notifyDomainRemoved: async (): Promise<void> => {
        return undefined;
      },
    });

    expect(ordered).toContain("healthy.example.com");
  });
});

describe("GreenlockUtil.isDueForRenewal", () => {
  const now: Date = OneUptimeDate.getCurrentDate();

  test("a certificate inside its own lead time is due, an expired one too", () => {
    expect(
      GreenlockUtil.isDueForRenewal(
        certificateExpiringInDays("status.aleyant.com", 1),
        now,
      ),
    ).toBe(true);
    expect(
      GreenlockUtil.isDueForRenewal(
        certificateExpiringInDays("status.aleyant.com", -3),
        now,
      ),
    ).toBe(true);
  });

  test("a freshly issued certificate is not due", () => {
    expect(
      GreenlockUtil.isDueForRenewal(
        certificateExpiringInDays("status.aleyant.com", 89),
        now,
      ),
    ).toBe(false);
  });

  test("the boundary is the domain's own lead time", () => {
    const domain: string = "status.aleyant.com";
    const leadTime: number = GreenlockUtil.getRenewalLeadTimeInDays(domain);

    expect(
      GreenlockUtil.isDueForRenewal(
        certificateExpiringInDays(domain, leadTime - 1),
        now,
      ),
    ).toBe(true);
    expect(
      GreenlockUtil.isDueForRenewal(
        certificateExpiringInDays(domain, leadTime + 1),
        now,
      ),
    ).toBe(false);
  });

  test("a row without a domain or an expiry is never due", () => {
    expect(GreenlockUtil.isDueForRenewal({ expiresAt: now }, now)).toBe(false);
    expect(
      GreenlockUtil.isDueForRenewal({ domain: "status.aleyant.com" }, now),
    ).toBe(false);
  });
});

/*
 * The capped sweeps pick afresh every run: a domain whose order keeps
 * failing must not hold a slot every run while the domains behind it never
 * get one - however the list grows or shrinks between runs.
 */
describe("GreenlockUtil.pickForThisRun", () => {
  const FIFTEEN_MINUTES_IN_MS: number = 15 * 60 * 1000;
  const firstRun: Date = new Date(1_800_000_000_000);

  function nthRun(n: number): Date {
    return new Date(firstRun.getTime() + n * FIFTEEN_MINUTES_IN_MS);
  }

  function pick(items: Array<string>, max: number, now: Date): Array<string> {
    return GreenlockUtil.pickForThisRun({
      items: items,
      max: max,
      now: now,
      getKey: (item: string): string => {
        return item;
      },
    });
  }

  const items: Array<string> = Array.from(
    { length: 12 },
    (_value: unknown, index: number) => {
      return "d" + String(index).padStart(2, "0") + ".example.com";
    },
  );

  test("takes everything when everything fits", () => {
    expect(pick(items.slice(0, 3), 5, firstRun)).toEqual(items.slice(0, 3));
    expect(pick([], 5, firstRun)).toEqual([]);
  });

  test("takes at most max distinct items", () => {
    const taken: Array<string> = pick(items, 5, firstRun);

    expect(taken).toHaveLength(5);
    expect(new Set(taken).size).toBe(5);
  });

  test("a different pick in the next run", () => {
    expect(pick(items, 5, nthRun(0))).not.toEqual(pick(items, 5, nthRun(1)));
  });

  test("the same pick for the whole run, on every replica, whatever order the items arrive in", () => {
    const reversed: Array<string> = [...items].reverse();

    expect(pick(reversed, 5, nthRun(3))).toEqual(pick(items, 5, nthRun(3)));
    expect(pick(items, 5, new Date(nthRun(3).getTime() + 60 * 1000))).toEqual(
      pick(items, 5, nthRun(3)),
    );
  });

  test("every item is picked within a few runs, even when the items picked first keep failing", () => {
    const picked: Set<string> = new Set<string>();

    for (let run: number = 0; run < 12; run++) {
      for (const item of pick(items, 5, nthRun(run))) {
        picked.add(item);
      }
    }

    expect([...picked].sort()).toEqual(items);
  });

  /*
   * The case that broke a fixed rotation: items that succeed leave the list,
   * so the ones behind them move up. Every item that is still waiting keeps
   * its chance in every run.
   */
  test("every item is picked within a few runs while the list shrinks", () => {
    let waiting: Array<string> = [...items];

    for (let run: number = 0; run < 12 && waiting.length > 0; run++) {
      const taken: Array<string> = pick(waiting, 5, nthRun(run));

      // Two of every pick succeed and leave the list; the rest keep failing.
      const succeeded: Set<string> = new Set<string>(taken.slice(0, 2));

      waiting = waiting.filter((item: string) => {
        return !succeeded.has(item);
      });
    }

    expect(waiting).toEqual([]);
  });

  test("a max of zero takes nothing", () => {
    expect(pick(items, 0, firstRun)).toEqual([]);
  });
});
