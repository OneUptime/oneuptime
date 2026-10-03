import StatusPageDomainService, {
  Service as StatusPageDomainServiceClass,
} from "../../../Server/Services/StatusPageDomainService";
import AcmeCertificateService from "../../../Server/Services/AcmeCertificateService";
import QueryHelper from "../../../Server/Types/Database/QueryHelper";
import Domain from "../../../Server/Types/Domain";
import GreenlockUtil from "../../../Server/Utils/Greenlock/Greenlock";
import { CertificateOrderOutcome } from "../../../Server/Utils/Greenlock/CertificateOrder";
import CertificateOrderFailures from "../../../Server/Utils/Greenlock/CertificateOrderFailures";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import { useInMemoryRedis } from "../Utils/Greenlock/InMemoryRedis";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * The sweeps the StatusPageCerts worker runs every 15 minutes: verify
 * CNAMEs (and order the certificate of a domain the moment it is verified),
 * order first certificates, re-order certificates that went missing, and
 * record which certificates are being served.
 *
 * Until this change the order and re-order sweeps ordered for every domain
 * they found, without a limit, and the order sweep did not even ask whether
 * a domain was verified or already had a certificate. The provisioning sweep
 * ordered again whenever its HTTPS probe failed. Every order spends from the
 * one Let's Encrypt account the installation shares, so what these pin
 * hardest is WHICH domains each sweep may order for, and HOW MANY per run -
 * the way DashboardDomainCertificateSweeps pins the dashboard twins.
 *
 * No database, no network and no CA: the service's reads and writes, the
 * certificate table, the probes and the order are spied on. How the orders
 * of Check now and of the sweeps stay apart is in
 * StatusPageCustomDomainCertificateLifecycle.test.ts, end to end.
 */

type DomainRow = {
  _id: string;
  id: ObjectID;
  fullDomain: string;
  cnameVerificationToken?: string;
  isSslOrdered?: boolean;
  isSslProvisioned?: boolean;
  isCustomCertificate?: boolean;
};

function makeDomain(
  fullDomain: string,
  extra: {
    isSslOrdered?: boolean;
    isSslProvisioned?: boolean;
    isCustomCertificate?: boolean;
  } = {},
): DomainRow {
  const id: ObjectID = ObjectID.generate();

  return {
    _id: id.toString(),
    id: id,
    fullDomain: fullDomain,
    cnameVerificationToken: `token-for-${fullDomain}`,
    ...extra,
  };
}

type FindByCall = {
  query: Record<string, unknown>;
  select: Record<string, unknown>;
  limit: number;
  skip: number;
  props: Record<string, unknown>;
};

type CertificateQuery = { query: Record<string, unknown> };

const FIFTEEN_MINUTES_IN_MS: number = 15 * 60 * 1000;

// A fixed "now" for every sweep, so runs and expiry dates are deterministic.
const FIRST_RUN: Date = new Date(1_800_000_000_000);

function inList(operator: unknown): Array<string> {
  return (operator as { inList: Array<string> }).inList;
}

/*
 * Pins the clock to the given run (0 = FIRST_RUN, 1 = fifteen minutes later,
 * and so on) and makes QueryHelper.any return its list, so the in-memory
 * certificate table can answer "IN (...)" queries.
 */
function atRun(run: number): Date {
  const now: Date = new Date(FIRST_RUN.getTime() + run * FIFTEEN_MINUTES_IN_MS);

  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(now);

  jest.spyOn(QueryHelper, "any").mockImplementation(((
    values: Array<string>,
  ) => {
    return { inList: values.map(String) };
  }) as never);

  return now;
}

/*
 * The certificate table: which domains have a certificate, expiring how many
 * days after FIRST_RUN (null: a row without an expiry).
 */
function withCertificates(
  expiringInDays: Record<string, number | null>,
): Array<CertificateQuery> {
  const queries: Array<CertificateQuery> = [];

  jest.spyOn(AcmeCertificateService, "findBy").mockImplementation((async (
    call: CertificateQuery,
  ) => {
    queries.push(call);

    return inList(call.query["domain"])
      .filter((domain: string) => {
        return expiringInDays[domain] !== undefined;
      })
      .map((domain: string) => {
        const days: number | null | undefined = expiringInDays[domain];

        return {
          domain: domain,
          expiresAt:
            days === null || days === undefined
              ? undefined
              : OneUptimeDate.addRemoveDays(FIRST_RUN, days),
        };
      });
  }) as never);

  return queries;
}

type Service = {
  findByCalls: Array<FindByCall>;
  // Domains handed to orderCertIfMissing, in order.
  ordered: Array<string>;
  // Whether each of those orders drew from the sweeps' shared budget.
  fromSweep: Array<boolean>;
  // Domains recorded as ordered without an order.
  recordedAsOrdered: Array<string>;
  // The writes that recorded them: one per run, for all of them.
  recordingWrites: Array<{
    query: Record<string, unknown>;
    data: Record<string, unknown>;
  }>;
  // What each orderCertIfMissing call was handed.
  orderOptions: Array<Record<string, unknown> | undefined>;
};

/*
 * Domain rows the service reads (pages honoured, so findAllBy reads them
 * all), the domains handed to orderCertIfMissing, and the rows marked
 * ordered. Any failure is per domain.
 */
function setUpService(data: {
  rows: Array<DomainRow>;
  failOrdersFor?: Array<string>;
}): Service {
  const service: Service = {
    findByCalls: [],
    ordered: [],
    fromSweep: [],
    recordedAsOrdered: [],
    recordingWrites: [],
    orderOptions: [],
  };

  const byId: Map<string, DomainRow> = new Map<string, DomainRow>(
    data.rows.map((row: DomainRow) => {
      return [row._id, row];
    }),
  );

  jest.spyOn(StatusPageDomainService, "findBy").mockImplementation((async (
    call: FindByCall,
  ) => {
    service.findByCalls.push(call);
    return data.rows.slice(call.skip || 0, (call.skip || 0) + call.limit);
  }) as never);

  jest
    .spyOn(StatusPageDomainService, "orderCertIfMissing")
    .mockImplementation((async (
      domain: DomainRow,
      options?: { fromSweep?: boolean },
    ): Promise<CertificateOrderOutcome> => {
      service.ordered.push(domain.fullDomain);
      service.fromSweep.push(Boolean(options?.fromSweep));
      service.orderOptions.push(options as Record<string, unknown>);

      if ((data.failOrdersFor || []).includes(domain.fullDomain)) {
        throw new Error(`CA refused the order for ${domain.fullDomain}`);
      }

      return CertificateOrderOutcome.Ordered;
    }) as never);

  jest
    .spyOn(StatusPageDomainService, "updateOneById")
    .mockImplementation((async (update: {
      id: ObjectID;
      data: { isSslOrdered?: boolean };
    }): Promise<void> => {
      if (update.data.isSslOrdered === true) {
        service.recordedAsOrdered.push(
          byId.get(update.id.toString())?.fullDomain || "unknown",
        );
      }
    }) as never);

  // Domains with a certificate are recorded in one write, by id.
  jest
    .spyOn(StatusPageDomainService, "updateBy")
    .mockImplementation((async (update: {
      query: Record<string, unknown>;
      data: { isSslOrdered?: boolean };
    }): Promise<number> => {
      service.recordingWrites.push({
        query: update.query,
        data: update.data as Record<string, unknown>,
      });

      const ids: Array<string> = inList(update.query["_id"]);

      if (update.data.isSslOrdered === true) {
        for (const id of ids) {
          service.recordedAsOrdered.push(byId.get(id)?.fullDomain || "unknown");
        }
      }

      return ids.length;
    }) as never);

  return service;
}

function manyDomains(prefix: string, count: number): Array<DomainRow> {
  return Array.from({ length: count }, (_value: unknown, index: number) => {
    return makeDomain(`${prefix}${String(index).padStart(2, "0")}.example.com`);
  });
}

function domainsOf(rows: Array<DomainRow>): Array<string> {
  return rows
    .map((row: DomainRow) => {
      return row.fullDomain;
    })
    .sort();
}

describe("StatusPageDomainService.ORDER_MAX_PER_RUN", () => {
  /*
   * The same budget as the dashboard sweeps: a handful of orders per sweep
   * per 15-minute run, against Let's Encrypt's 300 new orders per account
   * per three hours that the whole installation shares.
   */
  test("is a handful, and no more than the renewal run's own cap", () => {
    expect(StatusPageDomainServiceClass.ORDER_MAX_PER_RUN).toBe(5);
    expect(StatusPageDomainServiceClass.ORDER_MAX_PER_RUN).toBeLessThanOrEqual(
      GreenlockUtil.RENEW_MAX_PER_RUN,
    );
  });
});

describe("StatusPageDomainService.orderSSLForDomainsWhichAreNotOrderedYet", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * It used to ask for every domain not marked ordered - verified or not -
   * and order each one. For an unverified domain that order checked the
   * CNAME again and, failing, removed the name's certificate: the one a
   * domain whose check failed for a moment still had.
   */
  test("asks for verified, not yet ordered, Let's Encrypt domains only - every one of them", async () => {
    atRun(0);
    withCertificates({});
    const service: Service = setUpService({ rows: [] });

    await StatusPageDomainService.orderSSLForDomainsWhichAreNotOrderedYet();

    expect(service.findByCalls).toHaveLength(1);
    expect(service.findByCalls[0]!.query).toEqual({
      isCnameVerified: true,
      isSslOrdered: false,
      isCustomCertificate: false,
    });
    expect(service.findByCalls[0]!.limit).toBe(LIMIT_MAX);
    expect(service.findByCalls[0]!.props).toEqual({ isRoot: true });
  });

  test("reads past the first page: findAllBy, not one page of findBy", async () => {
    atRun(0);
    withCertificates({});
    const rows: Array<DomainRow> = manyDomains("d", 3);
    const service: Service = setUpService({ rows: rows });

    await StatusPageDomainService.orderSSLForDomainsWhichAreNotOrderedYet();

    // A short page ends the read.
    expect(
      service.findByCalls.map((call: FindByCall) => {
        return call.skip;
      }),
    ).toEqual([0]);
    expect(service.ordered.sort()).toEqual(domainsOf(rows));
  });

  test("orders a certificate for each verified domain without one, through orderCertIfMissing", async () => {
    atRun(0);
    withCertificates({});
    const service: Service = setUpService({
      rows: [makeDomain("a.example.com"), makeDomain("b.example.com")],
    });

    await StatusPageDomainService.orderSSLForDomainsWhichAreNotOrderedYet();

    expect(service.ordered.sort()).toEqual(["a.example.com", "b.example.com"]);
    expect(service.recordedAsOrdered).toEqual([]);
    // Each order draws from the budget the ordering sweeps share.
    expect(service.fromSweep).toEqual([true, true]);
  });

  /*
   * Regression: duplicate orders after an isSslOrdered reset. A CNAME check
   * that fails for a moment marks the domain unordered; when it passes
   * again, the certificate it already has is still good. Ordering again
   * would spend an order on a duplicate (Let's Encrypt allows five a week
   * for a name).
   */
  test("a domain that still has its certificate is recorded as ordered, not ordered again", async () => {
    atRun(0);
    withCertificates({ "has-one.example.com": 60 });
    const service: Service = setUpService({
      rows: [makeDomain("has-one.example.com"), makeDomain("new.example.com")],
    });

    await StatusPageDomainService.orderSSLForDomainsWhichAreNotOrderedYet();

    expect(service.recordedAsOrdered).toEqual(["has-one.example.com"]);
    expect(service.ordered).toEqual(["new.example.com"]);
  });

  test("a domain whose certificate is due or expired is recorded too, and left to the renewal run", async () => {
    atRun(0);
    withCertificates({ "due.example.com": 2, "expired.example.com": -5 });
    const service: Service = setUpService({
      rows: [makeDomain("due.example.com"), makeDomain("expired.example.com")],
    });

    await StatusPageDomainService.orderSSLForDomainsWhichAreNotOrderedYet();

    expect(service.ordered).toEqual([]);
    expect(service.recordedAsOrdered.sort()).toEqual([
      "due.example.com",
      "expired.example.com",
    ]);
  });

  test("a certificate row without an expiry does not count: the domain is ordered", async () => {
    atRun(0);
    withCertificates({ "half-written.example.com": null });
    const service: Service = setUpService({
      rows: [makeDomain("half-written.example.com")],
    });

    await StatusPageDomainService.orderSSLForDomainsWhichAreNotOrderedYet();

    expect(service.ordered).toEqual(["half-written.example.com"]);
    expect(service.recordedAsOrdered).toEqual([]);
  });

  test("a domain written in capitals finds its certificate under the lower-cased name", async () => {
    atRun(0);
    const queries: Array<CertificateQuery> = withCertificates({
      "status.example.com": 60,
    });
    const service: Service = setUpService({
      rows: [makeDomain("Status.Example.com")],
    });

    await StatusPageDomainService.orderSSLForDomainsWhichAreNotOrderedYet();

    expect(inList(queries[0]!.query["domain"])).toEqual(["status.example.com"]);
    expect(service.ordered).toEqual([]);
    expect(service.recordedAsOrdered).toEqual(["Status.Example.com"]);
  });

  test("never orders more than ORDER_MAX_PER_RUN in one run", async () => {
    atRun(0);
    withCertificates({});
    const service: Service = setUpService({
      rows: manyDomains(
        "d",
        StatusPageDomainServiceClass.ORDER_MAX_PER_RUN * 4,
      ),
    });

    await StatusPageDomainService.orderSSLForDomainsWhichAreNotOrderedYet();

    expect(service.ordered).toHaveLength(
      StatusPageDomainServiceClass.ORDER_MAX_PER_RUN,
    );
  });

  test("recording an existing certificate does not use up an order slot", async () => {
    atRun(0);

    const withCertificate: Array<DomainRow> = manyDomains(
      "has",
      StatusPageDomainServiceClass.ORDER_MAX_PER_RUN * 2,
    );
    const without: Array<DomainRow> = manyDomains(
      "new",
      StatusPageDomainServiceClass.ORDER_MAX_PER_RUN,
    );

    const expiries: Record<string, number> = {};
    for (const row of withCertificate) {
      expiries[row.fullDomain] = 70;
    }
    withCertificates(expiries);

    const service: Service = setUpService({
      rows: [...withCertificate, ...without],
    });

    await StatusPageDomainService.orderSSLForDomainsWhichAreNotOrderedYet();

    expect(service.recordedAsOrdered.sort()).toEqual(
      domainsOf(withCertificate),
    );
    expect(service.ordered.sort()).toEqual(domainsOf(without));
  });

  /*
   * Orders that keep failing - a CAA record, a per-name limit - leave the
   * same domains waiting run after run. The batch is picked afresh every
   * run, so the domains behind them still get ordered.
   */
  test("picked afresh every run: within a few runs every waiting domain has been ordered", async () => {
    const rows: Array<DomainRow> = manyDomains(
      "d",
      StatusPageDomainServiceClass.ORDER_MAX_PER_RUN * 2 + 2,
    );
    const everOrdered: Set<string> = new Set<string>();

    for (let run: number = 0; run < 12; run++) {
      atRun(run);
      withCertificates({});
      const service: Service = setUpService({
        rows: rows,
        failOrdersFor: domainsOf(rows),
      });

      await StatusPageDomainService.orderSSLForDomainsWhichAreNotOrderedYet();

      expect(service.ordered).toHaveLength(
        StatusPageDomainServiceClass.ORDER_MAX_PER_RUN,
      );
      for (const domain of service.ordered) {
        everOrdered.add(domain);
      }

      jest.restoreAllMocks();
    }

    expect([...everOrdered].sort()).toEqual(domainsOf(rows));
  });

  test("one domain whose order fails does not stop the rest", async () => {
    atRun(0);
    withCertificates({});
    const service: Service = setUpService({
      rows: [makeDomain("broken.example.com"), makeDomain("ok.example.com")],
      failOrdersFor: ["broken.example.com"],
    });

    await StatusPageDomainService.orderSSLForDomainsWhichAreNotOrderedYet();

    expect(service.ordered.sort()).toEqual([
      "broken.example.com",
      "ok.example.com",
    ]);
  });

  /*
   * Review finding 10: one UPDATE per domain, in a loop of its own. Now one
   * write records them all - and only on domains still verified and not yet
   * ordered, so a CNAME check that failed meanwhile is not overwritten with
   * "ordered" (review finding 8).
   */
  test("records every domain that has a certificate in one write, only while it is still verified", async () => {
    atRun(0);
    withCertificates({ "a.example.com": 40, "b.example.com": 50 });
    const rows: Array<DomainRow> = [
      makeDomain("a.example.com", { isSslOrdered: false }),
      makeDomain("b.example.com", { isSslOrdered: false }),
      makeDomain("c.example.com", { isSslOrdered: false }),
    ];
    const service: Service = setUpService({ rows });

    await StatusPageDomainService.orderSSLForDomainsWhichAreNotOrderedYet();

    expect(service.recordingWrites).toHaveLength(1);
    expect(service.recordingWrites[0]!.query).toEqual({
      _id: { inList: [rows[0]!._id, rows[1]!._id] },
      isCnameVerified: true,
      isSslOrdered: false,
    });
    expect(service.recordingWrites[0]!.data).toEqual({ isSslOrdered: true });
    expect(service.ordered).toEqual(["c.example.com"]);
  });

  test("with nothing to record, it writes nothing", async () => {
    atRun(0);
    withCertificates({});
    const service: Service = setUpService({
      rows: [makeDomain("a.example.com")],
    });

    await StatusPageDomainService.orderSSLForDomainsWhichAreNotOrderedYet();

    expect(service.recordingWrites).toEqual([]);
  });

  /*
   * A domain whose order keeps failing - a CAA record that leaves Let's
   * Encrypt out - used to be ordered every run it was picked, each order
   * against the account the whole installation shares. Now it waits longer
   * after each failure, and its slot goes to a domain that can be ordered.
   */
  test("a domain waiting after a failed order is not ordered this run, and its slot goes to another", async () => {
    const now: Date = atRun(0);
    withCertificates({});
    useInMemoryRedis();

    await CertificateOrderFailures.record({
      domain: "failing.example.com",
      error: "Unable to order certificate for failing.example.com.",
      now: now,
    });

    const service: Service = setUpService({
      rows: [
        makeDomain("failing.example.com"),
        ...manyDomains("w", StatusPageDomainServiceClass.ORDER_MAX_PER_RUN),
      ],
    });

    await StatusPageDomainService.orderSSLForDomainsWhichAreNotOrderedYet();

    expect(service.ordered).toHaveLength(
      StatusPageDomainServiceClass.ORDER_MAX_PER_RUN,
    );
    expect(service.ordered).not.toContain("failing.example.com");

    // Its delay is up 15 minutes later.
    atRun(1);
    const later: Service = setUpService({
      rows: [makeDomain("failing.example.com")],
    });

    await StatusPageDomainService.orderSSLForDomainsWhichAreNotOrderedYet();

    expect(later.ordered).toEqual(["failing.example.com"]);
  });
});

describe("StatusPageDomainService.checkOrderStatus", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("re-orders an ordered domain whose certificate is gone, and leaves the ones that have one alone", async () => {
    atRun(0);
    withCertificates({
      "healthy.example.com": 60,
      "also-healthy.example.com": 10,
    });
    const service: Service = setUpService({
      rows: [
        makeDomain("healthy.example.com", { isSslOrdered: true }),
        makeDomain("lost-its-certificate.example.com", { isSslOrdered: true }),
        makeDomain("also-healthy.example.com", { isSslOrdered: true }),
      ],
    });

    await StatusPageDomainService.checkOrderStatus();

    expect(service.ordered).toEqual(["lost-its-certificate.example.com"]);
    expect(service.fromSweep).toEqual([true]);
  });

  /*
   * It used to look every domain's certificate up with a query of its own.
   */
  test("reads every ordered Let's Encrypt domain, and their certificates in one query", async () => {
    atRun(0);
    const certificateQueries: Array<CertificateQuery> = withCertificates({
      "a.example.com": 60,
      "b.example.com": 60,
    });
    const service: Service = setUpService({
      rows: [makeDomain("a.example.com"), makeDomain("b.example.com")],
    });

    await StatusPageDomainService.checkOrderStatus();

    expect(service.findByCalls[0]!.query).toEqual({
      isSslOrdered: true,
      isCustomCertificate: false,
    });
    expect(service.findByCalls[0]!.limit).toBe(LIMIT_MAX);
    expect(service.findByCalls[0]!.props).toEqual({ isRoot: true });

    expect(certificateQueries).toHaveLength(1);
    expect(inList(certificateQueries[0]!.query["domain"])).toEqual([
      "a.example.com",
      "b.example.com",
    ]);
    expect(service.ordered).toEqual([]);
  });

  test("looks certificates up DOMAIN_LOOKUP_CHUNK_SIZE domains at a time", async () => {
    atRun(0);
    const certificateQueries: Array<CertificateQuery> = withCertificates({});
    setUpService({
      rows: Array.from(
        { length: GreenlockUtil.DOMAIN_LOOKUP_CHUNK_SIZE + 3 },
        (_value: unknown, index: number) => {
          return makeDomain(`d${index}.example.com`);
        },
      ),
    });

    await StatusPageDomainService.checkOrderStatus();

    expect(
      certificateQueries.map((query: CertificateQuery) => {
        return inList(query.query["domain"]).length;
      }),
    ).toEqual([GreenlockUtil.DOMAIN_LOOKUP_CHUNK_SIZE, 3]);
  });

  test("re-orders at most ORDER_MAX_PER_RUN per run, and every missing certificate is picked within a few runs", async () => {
    const rows: Array<DomainRow> = manyDomains(
      "missing",
      StatusPageDomainServiceClass.ORDER_MAX_PER_RUN * 3,
    );
    const everOrdered: Set<string> = new Set<string>();

    for (let run: number = 0; run < 12; run++) {
      atRun(run);
      withCertificates({});
      const service: Service = setUpService({
        rows: rows,
        failOrdersFor: domainsOf(rows),
      });

      await StatusPageDomainService.checkOrderStatus();

      expect(service.ordered).toHaveLength(
        StatusPageDomainServiceClass.ORDER_MAX_PER_RUN,
      );
      for (const domain of service.ordered) {
        everOrdered.add(domain);
      }

      jest.restoreAllMocks();
    }

    expect([...everOrdered].sort()).toEqual(domainsOf(rows));
  });

  test("the cap counts only domains that need an order", async () => {
    atRun(0);

    const healthy: Array<DomainRow> = manyDomains(
      "healthy",
      StatusPageDomainServiceClass.ORDER_MAX_PER_RUN * 2,
    );

    const expiries: Record<string, number> = {};
    for (const row of healthy) {
      expiries[row.fullDomain] = 60;
    }
    withCertificates(expiries);

    const service: Service = setUpService({
      rows: [...healthy, makeDomain("missing.example.com")],
    });

    await StatusPageDomainService.checkOrderStatus();

    expect(service.ordered).toEqual(["missing.example.com"]);
  });

  test("one domain whose re-order fails does not stop the rest", async () => {
    atRun(0);
    withCertificates({});
    const service: Service = setUpService({
      rows: [makeDomain("broken.example.com"), makeDomain("ok.example.com")],
      failOrdersFor: ["broken.example.com"],
    });

    await StatusPageDomainService.checkOrderStatus();

    expect(service.ordered.sort()).toEqual([
      "broken.example.com",
      "ok.example.com",
    ]);
  });

  test("with no ordered domains it neither looks up certificates nor orders", async () => {
    atRun(0);
    const certificateQueries: Array<CertificateQuery> = withCertificates({});
    const service: Service = setUpService({ rows: [] });

    await StatusPageDomainService.checkOrderStatus();

    expect(certificateQueries).toEqual([]);
    expect(service.ordered).toEqual([]);
  });
});

describe("StatusPageDomainService.updateSslProvisioningStatusForAllDomains", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  type Sweep = {
    probed: Array<string>;
    cnameChecks: Array<string>;
    ordered: Array<string>;
    // Every isSslProvisioned write, by domain.
    written: Map<string, boolean>;
  };

  /*
   * served: the domains whose HTTPS probe succeeds. throwsFor: the domains
   * whose row cannot even be read.
   */
  function setUpSweep(data: {
    rows: Array<DomainRow>;
    served: Array<string>;
    throwsFor?: Array<string>;
    cnameValid?: boolean;
  }): Sweep {
    const sweep: Sweep = {
      probed: [],
      cnameChecks: [],
      ordered: [],
      written: new Map<string, boolean>(),
    };

    const byId: Map<string, DomainRow> = new Map<string, DomainRow>(
      data.rows.map((row: DomainRow) => {
        return [row._id, row];
      }),
    );

    jest
      .spyOn(StatusPageDomainService, "findBy")
      .mockResolvedValue(data.rows as never);

    jest
      .spyOn(StatusPageDomainService, "findOneBy")
      .mockImplementation((async (call: { query: { _id: string } }) => {
        const row: DomainRow | undefined = byId.get(call.query._id);

        if (row && (data.throwsFor || []).includes(row.fullDomain)) {
          throw new Error(`could not read ${row.fullDomain}`);
        }

        return row || null;
      }) as never);

    jest
      .spyOn(Domain, "getForDomainVerification")
      .mockImplementation((async (request: { url: string }) => {
        sweep.probed.push(request.url);

        const isServed: boolean = data.served.some((domain: string) => {
          return request.url.startsWith(`https://${domain}/`);
        });

        return {
          isFailure: (): boolean => {
            return !isServed;
          },
          isSuccess: (): boolean => {
            return isServed;
          },
        };
      }) as never);

    jest
      .spyOn(StatusPageDomainService, "isCnameValid")
      .mockImplementation((async (fullDomain: string): Promise<boolean> => {
        sweep.cnameChecks.push(fullDomain);
        return data.cnameValid ?? true;
      }) as never);

    for (const method of ["orderCert", "orderCertIfMissing"] as const) {
      jest.spyOn(StatusPageDomainService, method).mockImplementation((async (
        domain: DomainRow,
      ): Promise<void> => {
        sweep.ordered.push(domain.fullDomain);
      }) as never);
    }

    jest.spyOn(GreenlockUtil, "orderCert").mockImplementation((async (data: {
      domain: string;
    }): Promise<void> => {
      sweep.ordered.push(data.domain);
    }) as never);

    jest
      .spyOn(StatusPageDomainService, "updateOneById")
      .mockImplementation((async (update: {
        id: ObjectID;
        data: { isSslProvisioned: boolean };
      }): Promise<void> => {
        const row: DomainRow | undefined = byId.get(update.id.toString());
        sweep.written.set(
          row?.fullDomain || "unknown",
          update.data.isSslProvisioned,
        );
      }) as never);

    return sweep;
  }

  test("marks a domain provisioned once it serves its certificate over HTTPS", async () => {
    const sweep: Sweep = setUpSweep({
      rows: [makeDomain("served.example.com", { isSslProvisioned: false })],
      served: ["served.example.com"],
    });

    await StatusPageDomainService.updateSslProvisioningStatusForAllDomains();

    expect(sweep.written.get("served.example.com")).toBe(true);
    expect(sweep.probed).toHaveLength(1);
    expect(sweep.probed[0]!.startsWith("https://served.example.com/")).toBe(
      true,
    );
    expect(sweep.cnameChecks).toEqual([]);
  });

  /*
   * Regression. It used to order again here whenever the probe failed and
   * the CNAME still checked out. Right after an order the probe fails as a
   * rule - nginx writes new certificates every 15 minutes - so new domains
   * were ordered twice; and the order checks the CNAME once more, and
   * removes the certificate when that check fails, so a moment's DNS
   * trouble between the two checks deleted a working certificate.
   */
  test("marks a domain that stops serving its certificate not provisioned, re-checks its CNAME, and never orders", async () => {
    const sweep: Sweep = setUpSweep({
      rows: [makeDomain("stopped.example.com", { isSslProvisioned: true })],
      served: [],
    });

    await StatusPageDomainService.updateSslProvisioningStatusForAllDomains();

    expect(sweep.written.get("stopped.example.com")).toBe(false);
    expect(sweep.cnameChecks).toEqual(["stopped.example.com"]);
    expect(sweep.ordered).toEqual([]);
  });

  test("a domain that does not serve it yet is re-checked but not written again, and nothing is ordered", async () => {
    const sweep: Sweep = setUpSweep({
      rows: [makeDomain("not-yet.example.com", { isSslProvisioned: false })],
      served: [],
    });

    await StatusPageDomainService.updateSslProvisioningStatusForAllDomains();

    expect(sweep.cnameChecks).toEqual(["not-yet.example.com"]);
    expect(sweep.written.size).toBe(0);
    expect(sweep.ordered).toEqual([]);
  });

  test("a domain whose CNAME check fails as well is not ordered either", async () => {
    const sweep: Sweep = setUpSweep({
      rows: [makeDomain("blip.example.com", { isSslProvisioned: true })],
      served: [],
      cnameValid: false,
    });

    await StatusPageDomainService.updateSslProvisioningStatusForAllDomains();

    expect(sweep.cnameChecks).toEqual(["blip.example.com"]);
    expect(sweep.ordered).toEqual([]);
  });

  /*
   * This sweep visits every ordered domain every 15 minutes; rewriting an
   * unchanged value touched every row on every run.
   */
  test("a provisioned domain that is still served is not written again", async () => {
    const sweep: Sweep = setUpSweep({
      rows: [makeDomain("served.example.com", { isSslProvisioned: true })],
      served: ["served.example.com"],
    });

    await StatusPageDomainService.updateSslProvisioningStatusForAllDomains();

    expect(sweep.written.size).toBe(0);
  });

  test("one domain that cannot be checked does not end the sweep for the rest", async () => {
    const sweep: Sweep = setUpSweep({
      rows: [
        makeDomain("broken.example.com"),
        makeDomain("served.example.com", { isSslProvisioned: false }),
        makeDomain("stopped.example.com", { isSslProvisioned: true }),
      ],
      served: ["served.example.com"],
      throwsFor: ["broken.example.com"],
    });

    await StatusPageDomainService.updateSslProvisioningStatusForAllDomains();

    expect(sweep.written.get("served.example.com")).toBe(true);
    expect(sweep.written.get("stopped.example.com")).toBe(false);
    expect(sweep.written.has("broken.example.com")).toBe(false);
    expect(sweep.ordered).toEqual([]);
  });

  test("reads only ordered Let's Encrypt domains", async () => {
    setUpSweep({ rows: [], served: [] });

    await StatusPageDomainService.updateSslProvisioningStatusForAllDomains();

    const findBy: unknown = StatusPageDomainService.findBy;
    const call: FindByCall = (
      findBy as { mock: { calls: Array<[FindByCall]> } }
    ).mock.calls[0]![0];

    expect(call.query).toEqual({
      isSslOrdered: true,
      isCustomCertificate: false,
    });
    expect(call.props).toEqual({ isRoot: true });
  });
});

describe("StatusPageDomainService.verifyCnameWhoseCnameisNotVerified", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  type Verify = {
    findByCalls: Array<FindByCall>;
    checked: Array<string>;
    ordered: Array<string>;
    // What each orderCertIfMissing call was handed.
    orderOptions: Array<Record<string, unknown> | undefined>;
    recordedAsOrdered: Array<string>;
  };

  /*
   * rows: the unverified domains. verified: those whose CNAME checks out
   * now. throwsFor: those whose check throws.
   */
  function setUpVerify(data: {
    rows: Array<DomainRow>;
    verified: Array<string>;
    throwsFor?: Array<string>;
  }): Verify {
    const verify: Verify = {
      findByCalls: [],
      checked: [],
      ordered: [],
      orderOptions: [],
      recordedAsOrdered: [],
    };

    const byId: Map<string, DomainRow> = new Map<string, DomainRow>(
      data.rows.map((row: DomainRow) => {
        return [row._id, row];
      }),
    );

    jest.spyOn(StatusPageDomainService, "findBy").mockImplementation((async (
      call: FindByCall,
    ) => {
      verify.findByCalls.push(call);
      return data.rows;
    }) as never);

    jest
      .spyOn(StatusPageDomainService, "isCnameValid")
      .mockImplementation((async (fullDomain: string): Promise<boolean> => {
        verify.checked.push(fullDomain);

        if ((data.throwsFor || []).includes(fullDomain)) {
          throw new Error("DNS lookup failed");
        }

        return data.verified.includes(fullDomain);
      }) as never);

    jest
      .spyOn(StatusPageDomainService, "orderCertIfMissing")
      .mockImplementation((async (
        domain: DomainRow,
        options?: Record<string, unknown>,
      ): Promise<CertificateOrderOutcome> => {
        verify.ordered.push(domain.fullDomain);
        verify.orderOptions.push(options);
        return CertificateOrderOutcome.Ordered;
      }) as never);

    jest
      .spyOn(StatusPageDomainService, "updateOneById")
      .mockImplementation((async (update: {
        id: ObjectID;
        data: { isSslOrdered?: boolean };
      }): Promise<void> => {
        if (update.data.isSslOrdered === true) {
          verify.recordedAsOrdered.push(
            byId.get(update.id.toString())?.fullDomain || "unknown",
          );
        }
      }) as never);

    jest
      .spyOn(StatusPageDomainService, "updateBy")
      .mockImplementation((async (update: {
        query: Record<string, unknown>;
        data: { isSslOrdered?: boolean };
      }): Promise<number> => {
        const ids: Array<string> = inList(update.query["_id"]);

        if (update.data.isSslOrdered === true) {
          for (const id of ids) {
            verify.recordedAsOrdered.push(
              byId.get(id)?.fullDomain || "unknown",
            );
          }
        }

        return ids.length;
      }) as never);

    return verify;
  }

  test("checks every unverified domain and keeps going past one that throws", async () => {
    atRun(0);
    withCertificates({});
    const verify: Verify = setUpVerify({
      rows: [
        makeDomain("a.example.com"),
        makeDomain("broken.example.com"),
        makeDomain("b.example.com"),
      ],
      verified: [],
      throwsFor: ["broken.example.com"],
    });

    await StatusPageDomainService.verifyCnameWhoseCnameisNotVerified();

    expect(verify.findByCalls[0]!.query).toEqual({ isCnameVerified: false });
    expect(verify.findByCalls[0]!.select).toEqual(
      expect.objectContaining({
        fullDomain: true,
        isCustomCertificate: true,
        isSslOrdered: true,
      }),
    );
    expect(verify.checked.sort()).toEqual([
      "a.example.com",
      "b.example.com",
      "broken.example.com",
    ]);
    expect(verify.ordered).toEqual([]);
  });

  /*
   * Without this a domain verified by the sweep waited for the next run of
   * the order sweep - another 15 minutes - before its certificate was even
   * ordered.
   */
  test("orders the certificate of a domain the moment it is verified", async () => {
    atRun(0);
    withCertificates({});
    const verify: Verify = setUpVerify({
      rows: [
        makeDomain("live-now.example.com"),
        makeDomain("not-yet.example.com"),
      ],
      verified: ["live-now.example.com"],
    });

    await StatusPageDomainService.verifyCnameWhoseCnameisNotVerified();

    expect(verify.ordered).toEqual(["live-now.example.com"]);
  });

  test("a domain on an uploaded certificate is verified, and nothing is ordered for it", async () => {
    atRun(0);
    withCertificates({});
    const verify: Verify = setUpVerify({
      rows: [makeDomain("uploaded.example.com", { isCustomCertificate: true })],
      verified: ["uploaded.example.com"],
    });

    await StatusPageDomainService.verifyCnameWhoseCnameisNotVerified();

    expect(verify.checked).toEqual(["uploaded.example.com"]);
    expect(verify.ordered).toEqual([]);
    expect(verify.recordedAsOrdered).toEqual([]);
  });

  /*
   * Regression: the CNAME blip. Verified again, the domain still has its
   * certificate, so it is recorded as ordered - not ordered a second time.
   */
  test("a domain verified again that still has its certificate is recorded, not ordered", async () => {
    atRun(0);
    withCertificates({ "back-again.example.com": 50 });
    const verify: Verify = setUpVerify({
      rows: [makeDomain("back-again.example.com", { isSslOrdered: false })],
      verified: ["back-again.example.com"],
    });

    await StatusPageDomainService.verifyCnameWhoseCnameisNotVerified();

    expect(verify.ordered).toEqual([]);
    expect(verify.recordedAsOrdered).toEqual(["back-again.example.com"]);
  });

  /*
   * Regression (review finding 3): the sweep checks the record, then the
   * order checked it again - one more chance for a DNS blip to refuse an
   * order the sweep had just allowed.
   */
  test("the orders of the domains it has just verified do not check the CNAME again", async () => {
    atRun(0);
    withCertificates({});
    const verify: Verify = setUpVerify({
      rows: [makeDomain("new.example.com")],
      verified: ["new.example.com"],
    });

    await StatusPageDomainService.verifyCnameWhoseCnameisNotVerified();

    expect(verify.ordered).toEqual(["new.example.com"]);
    expect(verify.orderOptions[0]).toEqual(
      expect.objectContaining({ fromSweep: true, cnameVerifiedJustNow: true }),
    );
    expect(verify.checked).toEqual(["new.example.com"]);
  });

  test("orders at most ORDER_MAX_PER_RUN of the domains verified in one run", async () => {
    atRun(0);
    withCertificates({});
    const rows: Array<DomainRow> = manyDomains(
      "v",
      StatusPageDomainServiceClass.ORDER_MAX_PER_RUN * 3,
    );
    const verify: Verify = setUpVerify({
      rows: rows,
      verified: domainsOf(rows),
    });

    await StatusPageDomainService.verifyCnameWhoseCnameisNotVerified();

    expect(verify.checked).toHaveLength(rows.length);
    expect(verify.ordered).toHaveLength(
      StatusPageDomainServiceClass.ORDER_MAX_PER_RUN,
    );
  });

  test("checks at most SSL_PROVISIONING_CHECK_CONCURRENCY domains at once", async () => {
    atRun(0);
    withCertificates({});

    const total: number =
      StatusPageDomainServiceClass.SSL_PROVISIONING_CHECK_CONCURRENCY * 3;
    let inFlight: number = 0;
    let mostInFlight: number = 0;
    let checked: number = 0;

    jest.spyOn(StatusPageDomainService, "findBy").mockResolvedValue(
      Array.from({ length: total }, (_value: unknown, index: number) => {
        return makeDomain(`d${index}.example.com`);
      }) as never,
    );

    jest
      .spyOn(StatusPageDomainService, "isCnameValid")
      .mockImplementation((async (): Promise<boolean> => {
        inFlight++;
        mostInFlight = Math.max(mostInFlight, inFlight);
        await new Promise<void>((resolve: () => void) => {
          setTimeout(resolve, 0);
        });
        inFlight--;
        checked++;
        return false;
      }) as never);

    await StatusPageDomainService.verifyCnameWhoseCnameisNotVerified();

    expect(checked).toBe(total);
    expect(mostInFlight).toBe(
      StatusPageDomainServiceClass.SSL_PROVISIONING_CHECK_CONCURRENCY,
    );
  });

  test("an order that cannot even be looked up does not fail the verify sweep", async () => {
    atRun(0);
    jest
      .spyOn(AcmeCertificateService, "findBy")
      .mockRejectedValue(new Error("database went away") as never);
    const verify: Verify = setUpVerify({
      rows: [makeDomain("live-now.example.com")],
      verified: ["live-now.example.com"],
    });

    await expect(
      StatusPageDomainService.verifyCnameWhoseCnameisNotVerified(),
    ).resolves.toBeUndefined();

    expect(verify.checked).toEqual(["live-now.example.com"]);
    expect(verify.ordered).toEqual([]);
  });
});
