import DashboardDomainService, {
  Service as DashboardDomainServiceClass,
} from "../../../Server/Services/DashboardDomainService";
import AcmeCertificateService from "../../../Server/Services/AcmeCertificateService";
import QueryHelper from "../../../Server/Types/Database/QueryHelper";
import Domain from "../../../Server/Types/Domain";
import GreenlockUtil from "../../../Server/Utils/Greenlock/Greenlock";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * The sweeps the DashboardCerts worker runs every 15 minutes, which before
 * that job existed nothing ran: verify CNAMEs, order first certificates,
 * re-order certificates that went missing, and record which certificates are
 * being served.
 *
 * Every order spends from the Let's Encrypt account the whole installation
 * shares, so what these pin hardest is WHICH domains each sweep may order for
 * and HOW MANY per run. No database, no network and no CA: the service's own
 * reads and writes, the certificate table, the HTTPS probe and orderCert are
 * all spied on.
 */

type DomainRow = {
  _id: string;
  id: ObjectID;
  fullDomain: string;
  cnameVerificationToken?: string;
  isSslProvisioned?: boolean;
};

function makeDomain(
  fullDomain: string,
  extra: { isSslProvisioned?: boolean } = {},
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
  sort?: Record<string, unknown>;
  limit: number;
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
 * tables can answer "IN (...)" queries.
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
 * The certificate table: which domains have a certificate, expiring how
 * many days after FIRST_RUN.
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
  ordered: Array<string>;
  // Domains recorded as ordered without a new order.
  recordedAsOrdered: Array<string>;
};

/*
 * Domain rows the service reads, the domains handed to orderCert, and the
 * rows marked ordered. Any failure is per domain.
 */
function setUpService(data: {
  rows: Array<DomainRow>;
  failOrdersFor?: Array<string>;
}): Service {
  const service: Service = {
    findByCalls: [],
    ordered: [],
    recordedAsOrdered: [],
  };

  const byId: Map<string, DomainRow> = new Map<string, DomainRow>(
    data.rows.map((row: DomainRow) => {
      return [row._id, row];
    }),
  );

  jest.spyOn(DashboardDomainService, "findBy").mockImplementation((async (
    call: FindByCall,
  ) => {
    service.findByCalls.push(call);
    return data.rows.slice(0, call.limit);
  }) as never);

  jest.spyOn(DashboardDomainService, "orderCert").mockImplementation((async (
    domain: DomainRow,
  ): Promise<void> => {
    service.ordered.push(domain.fullDomain);

    if ((data.failOrdersFor || []).includes(domain.fullDomain)) {
      throw new Error(`CA refused the order for ${domain.fullDomain}`);
    }
  }) as never);

  jest
    .spyOn(DashboardDomainService, "updateOneById")
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

describe("DashboardDomainService.orderSSLForDomainsWhichAreNotOrderedYet", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("asks for every verified, not yet ordered, Let's Encrypt domain", async () => {
    atRun(0);
    withCertificates({});
    const service: Service = setUpService({ rows: [] });

    await DashboardDomainService.orderSSLForDomainsWhichAreNotOrderedYet();

    expect(service.findByCalls).toHaveLength(1);
    expect(service.findByCalls[0]!.query).toEqual({
      isCnameVerified: true,
      isSslOrdered: false,
      isCustomCertificate: false,
    });
    expect(service.findByCalls[0]!.limit).toBe(LIMIT_MAX);
    expect(service.findByCalls[0]!.props).toEqual({ isRoot: true });
  });

  test("orders a certificate for each domain without one", async () => {
    atRun(0);
    withCertificates({});
    const service: Service = setUpService({
      rows: [makeDomain("a.example.com"), makeDomain("b.example.com")],
    });

    await DashboardDomainService.orderSSLForDomainsWhichAreNotOrderedYet();

    expect(service.ordered.sort()).toEqual(["a.example.com", "b.example.com"]);
  });

  /*
   * A CNAME check that fails for a moment marks the domain unordered; when it
   * passes again, the certificate it already has is still good. Ordering
   * again would spend an order on a duplicate (Let's Encrypt allows five a
   * week for a name).
   */
  test("a domain that still has a certificate with weeks to run is recorded as ordered, not ordered again", async () => {
    atRun(0);
    withCertificates({ "has-one.example.com": 60 });
    const service: Service = setUpService({
      rows: [makeDomain("has-one.example.com"), makeDomain("new.example.com")],
    });

    await DashboardDomainService.orderSSLForDomainsWhichAreNotOrderedYet();

    expect(service.recordedAsOrdered).toEqual(["has-one.example.com"]);
    expect(service.ordered).toEqual(["new.example.com"]);
  });

  /*
   * The renewal run claims every dashboard certificate that is due and
   * renews it in the same 15-minute tick; ordering it here as well would
   * spend two orders on one name.
   */
  test("a domain whose certificate is due or expired is recorded too, and left to the renewal run", async () => {
    atRun(0);
    withCertificates({ "due.example.com": 2, "expired.example.com": -5 });
    const service: Service = setUpService({
      rows: [makeDomain("due.example.com"), makeDomain("expired.example.com")],
    });

    await DashboardDomainService.orderSSLForDomainsWhichAreNotOrderedYet();

    expect(service.ordered).toEqual([]);
    expect(service.recordedAsOrdered.sort()).toEqual([
      "due.example.com",
      "expired.example.com",
    ]);
  });

  // It is never due, so nothing would ever replace it if it counted.
  test("a certificate row without an expiry does not count: the domain is ordered", async () => {
    atRun(0);
    withCertificates({ "half-written.example.com": null });
    const service: Service = setUpService({
      rows: [makeDomain("half-written.example.com")],
    });

    await DashboardDomainService.orderSSLForDomainsWhichAreNotOrderedYet();

    expect(service.ordered).toEqual(["half-written.example.com"]);
    expect(service.recordedAsOrdered).toEqual([]);
  });

  test("never orders more than ORDER_MAX_PER_RUN in one run", async () => {
    atRun(0);
    withCertificates({});
    const service: Service = setUpService({
      rows: manyDomains("d", DashboardDomainServiceClass.ORDER_MAX_PER_RUN * 4),
    });

    await DashboardDomainService.orderSSLForDomainsWhichAreNotOrderedYet();

    expect(service.ordered).toHaveLength(
      DashboardDomainServiceClass.ORDER_MAX_PER_RUN,
    );
  });

  test("recording an existing certificate does not use up an order slot", async () => {
    atRun(0);

    const withCertificate: Array<DomainRow> = manyDomains(
      "has",
      DashboardDomainServiceClass.ORDER_MAX_PER_RUN * 2,
    );
    const without: Array<DomainRow> = manyDomains(
      "new",
      DashboardDomainServiceClass.ORDER_MAX_PER_RUN,
    );

    const expiries: Record<string, number> = {};
    for (const row of withCertificate) {
      expiries[row.fullDomain] = 70;
    }
    withCertificates(expiries);

    const service: Service = setUpService({
      rows: [...withCertificate, ...without],
    });

    await DashboardDomainService.orderSSLForDomainsWhichAreNotOrderedYet();

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
      DashboardDomainServiceClass.ORDER_MAX_PER_RUN * 2 + 2,
    );
    const runs: number = 12;
    const everOrdered: Set<string> = new Set<string>();

    for (let run: number = 0; run < runs; run++) {
      atRun(run);
      withCertificates({});
      const service: Service = setUpService({
        rows: rows,
        failOrdersFor: domainsOf(rows),
      });

      await DashboardDomainService.orderSSLForDomainsWhichAreNotOrderedYet();

      expect(service.ordered).toHaveLength(
        DashboardDomainServiceClass.ORDER_MAX_PER_RUN,
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

    await DashboardDomainService.orderSSLForDomainsWhichAreNotOrderedYet();

    expect(service.ordered).toEqual(["broken.example.com", "ok.example.com"]);
  });
});

describe("DashboardDomainService.checkOrderStatus", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * The self-heal: the status page renewal job used to delete dashboard
   * certificates when they came due, leaving domains that say "ordered" with
   * no certificate behind them.
   */
  test("re-orders an ordered domain whose certificate is gone, and leaves the ones that have one alone", async () => {
    atRun(0);
    withCertificates({
      "healthy.example.com": 60,
      "also-healthy.example.com": 10,
    });
    const service: Service = setUpService({
      rows: [
        makeDomain("healthy.example.com"),
        makeDomain("deleted-by-old-job.example.com"),
        makeDomain("also-healthy.example.com"),
      ],
    });

    await DashboardDomainService.checkOrderStatus();

    expect(service.ordered).toEqual(["deleted-by-old-job.example.com"]);
  });

  test("reads every ordered Let's Encrypt domain, and their certificates in one query", async () => {
    atRun(0);
    const certificateQueries: Array<CertificateQuery> = withCertificates({
      "a.example.com": 60,
      "b.example.com": 60,
    });
    const service: Service = setUpService({
      rows: [makeDomain("a.example.com"), makeDomain("b.example.com")],
    });

    await DashboardDomainService.checkOrderStatus();

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

    await DashboardDomainService.checkOrderStatus();

    expect(
      certificateQueries.map((query: CertificateQuery) => {
        return inList(query.query["domain"]).length;
      }),
    ).toEqual([GreenlockUtil.DOMAIN_LOOKUP_CHUNK_SIZE, 3]);
  });

  test("re-orders at most ORDER_MAX_PER_RUN per run, and every missing certificate is picked within a few runs", async () => {
    const rows: Array<DomainRow> = manyDomains(
      "missing",
      DashboardDomainServiceClass.ORDER_MAX_PER_RUN * 3,
    );
    const everOrdered: Set<string> = new Set<string>();

    for (let run: number = 0; run < 12; run++) {
      atRun(run);
      withCertificates({});
      const service: Service = setUpService({
        rows: rows,
        failOrdersFor: domainsOf(rows),
      });

      await DashboardDomainService.checkOrderStatus();

      expect(service.ordered).toHaveLength(
        DashboardDomainServiceClass.ORDER_MAX_PER_RUN,
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
      DashboardDomainServiceClass.ORDER_MAX_PER_RUN * 2,
    );

    const expiries: Record<string, number> = {};
    for (const row of healthy) {
      expiries[row.fullDomain] = 60;
    }
    withCertificates(expiries);

    const service: Service = setUpService({
      rows: [...healthy, makeDomain("missing.example.com")],
    });

    await DashboardDomainService.checkOrderStatus();

    expect(service.ordered).toEqual(["missing.example.com"]);
  });

  test("one domain whose re-order fails does not stop the rest", async () => {
    atRun(0);
    withCertificates({});
    const service: Service = setUpService({
      rows: [makeDomain("broken.example.com"), makeDomain("ok.example.com")],
      failOrdersFor: ["broken.example.com"],
    });

    await DashboardDomainService.checkOrderStatus();

    expect(service.ordered).toEqual(["broken.example.com", "ok.example.com"]);
  });

  test("with no ordered domains it neither looks up certificates nor orders", async () => {
    atRun(0);
    const certificateQueries: Array<CertificateQuery> = withCertificates({});
    const service: Service = setUpService({ rows: [] });

    await DashboardDomainService.checkOrderStatus();

    expect(certificateQueries).toEqual([]);
    expect(service.ordered).toEqual([]);
  });
});

describe("DashboardDomainService.updateSslProvisioningStatusForAllDomains", () => {
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
      .spyOn(DashboardDomainService, "findBy")
      .mockResolvedValue(data.rows as never);

    jest
      .spyOn(DashboardDomainService, "findOneBy")
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
      .spyOn(DashboardDomainService, "isCnameValid")
      .mockImplementation((async (fullDomain: string): Promise<boolean> => {
        sweep.cnameChecks.push(fullDomain);
        return true;
      }) as never);

    jest.spyOn(DashboardDomainService, "orderCert").mockImplementation((async (
      domain: DomainRow,
    ): Promise<void> => {
      sweep.ordered.push(domain.fullDomain);
    }) as never);

    jest
      .spyOn(DashboardDomainService, "updateOneById")
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

    await DashboardDomainService.updateSslProvisioningStatusForAllDomains();

    expect(sweep.written.get("served.example.com")).toBe(true);
    expect(sweep.probed).toHaveLength(1);
    expect(sweep.probed[0]!.startsWith("https://served.example.com/")).toBe(
      true,
    );
    expect(sweep.cnameChecks).toEqual([]);
  });

  /*
   * The status page sweep re-orders here. Right after an order this probe is
   * usually racing nginx's 15-minute write of the new certificate, so the
   * dashboard sweep leaves ordering to checkOrderStatus and the renewal run.
   */
  test("marks a domain that stops serving it not provisioned, re-checks its CNAME, and never orders", async () => {
    const sweep: Sweep = setUpSweep({
      rows: [makeDomain("stopped.example.com", { isSslProvisioned: true })],
      served: [],
    });

    await DashboardDomainService.updateSslProvisioningStatusForAllDomains();

    expect(sweep.written.get("stopped.example.com")).toBe(false);
    expect(sweep.cnameChecks).toEqual(["stopped.example.com"]);
    expect(sweep.ordered).toEqual([]);
  });

  test("a domain that does not serve it yet is re-checked but not written again, and nothing is ordered", async () => {
    const sweep: Sweep = setUpSweep({
      rows: [makeDomain("not-yet.example.com", { isSslProvisioned: false })],
      served: [],
    });

    await DashboardDomainService.updateSslProvisioningStatusForAllDomains();

    expect(sweep.cnameChecks).toEqual(["not-yet.example.com"]);
    expect(sweep.written.size).toBe(0);
    expect(sweep.ordered).toEqual([]);
  });

  /*
   * This sweep visits every ordered domain every 15 minutes; rewriting an
   * unchanged value would touch every row on every run.
   */
  test("a provisioned domain that is still served is not written again", async () => {
    const sweep: Sweep = setUpSweep({
      rows: [makeDomain("served.example.com", { isSslProvisioned: true })],
      served: ["served.example.com"],
    });

    await DashboardDomainService.updateSslProvisioningStatusForAllDomains();

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

    await DashboardDomainService.updateSslProvisioningStatusForAllDomains();

    expect(sweep.written.get("served.example.com")).toBe(true);
    expect(sweep.written.get("stopped.example.com")).toBe(false);
    expect(sweep.written.has("broken.example.com")).toBe(false);
    expect(sweep.ordered).toEqual([]);
  });

  test("reads only ordered Let's Encrypt domains", async () => {
    setUpSweep({ rows: [], served: [] });

    await DashboardDomainService.updateSslProvisioningStatusForAllDomains();

    const findBy: unknown = DashboardDomainService.findBy;
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

describe("DashboardDomainService.verifyCnameWhoseCnameisNotVerified", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("checks every unverified domain and keeps going past one that throws", async () => {
    const checked: Array<string> = [];
    const findByCalls: Array<FindByCall> = [];

    jest.spyOn(DashboardDomainService, "findBy").mockImplementation((async (
      call: FindByCall,
    ) => {
      findByCalls.push(call);
      return [
        makeDomain("a.example.com"),
        makeDomain("broken.example.com"),
        makeDomain("b.example.com"),
      ];
    }) as never);

    jest
      .spyOn(DashboardDomainService, "isCnameValid")
      .mockImplementation((async (fullDomain: string): Promise<boolean> => {
        checked.push(fullDomain);

        if (fullDomain === "broken.example.com") {
          throw new Error("DNS lookup failed");
        }

        return true;
      }) as never);

    await DashboardDomainService.verifyCnameWhoseCnameisNotVerified();

    expect(findByCalls[0]!.query).toEqual({ isCnameVerified: false });
    expect(checked.sort()).toEqual([
      "a.example.com",
      "b.example.com",
      "broken.example.com",
    ]);
  });

  test("checks at most DOMAIN_CHECK_CONCURRENCY domains at once", async () => {
    const total: number =
      DashboardDomainServiceClass.DOMAIN_CHECK_CONCURRENCY * 3;
    let inFlight: number = 0;
    let mostInFlight: number = 0;
    let checked: number = 0;

    jest.spyOn(DashboardDomainService, "findBy").mockResolvedValue(
      Array.from({ length: total }, (_value: unknown, index: number) => {
        return makeDomain(`d${index}.example.com`);
      }) as never,
    );

    jest
      .spyOn(DashboardDomainService, "isCnameValid")
      .mockImplementation((async (): Promise<boolean> => {
        inFlight++;
        mostInFlight = Math.max(mostInFlight, inFlight);
        await new Promise<void>((resolve: () => void) => {
          setTimeout(resolve, 0);
        });
        inFlight--;
        checked++;
        return true;
      }) as never);

    await DashboardDomainService.verifyCnameWhoseCnameisNotVerified();

    expect(checked).toBe(total);
    expect(mostInFlight).toBe(
      DashboardDomainServiceClass.DOMAIN_CHECK_CONCURRENCY,
    );
  });
});
